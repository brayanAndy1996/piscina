import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { anioYMesEnLima } from '../../comun/fechas';
import { BaseDatos, errorParaRegistro, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';

/** Lo que una academia cerró en una vuelta (criterio 27): solo cantidades, nunca alumnos, matrículas ni DNI. */
export interface ResultadoDelCierre {
  /** Matrículas `VIGENTE` de meses anteriores que pasaron a `FINALIZADA` (RN-23). */
  readonly matriculasFinalizadas: number;
  /** Alumnos que pasaron de `ALUMNO_ACTIVO` a `ALUMNO_VENCIDO`. */
  readonly alumnosVencidos: number;
  /** Alumnos que pasaron de `ALUMNO_VENCIDO` a `ALUMNO_ACTIVO`. */
  readonly alumnosActivados: number;
}

/**
 * El cierre de mes (spec 010b, criterios 27 a 29; RN-23, 8.8, D-10, D-23). `cerrar(ahora)` se puede llamar directamente (las pruebas lo hacen con un
 * instante fijo) y la llama la tarea programada (`CierreDeMesTarea`) cada 15 minutos y al arrancar. Es idempotente: una vuelta sin nada que cambiar no
 * escribe, y repetirla deja lo mismo. Con M el mes en curso de Lima de `ahora`:
 *
 * 1. La lista de academias `ACTIVA` se lee con `comoPlataforma`; esa transacción se cierra (nota O1 de 001). Una academia suspendida no se procesa.
 * 2. Después, un `conAcademia` por academia, una tras otra. Cada uno empieza con `pg_try_advisory_xact_lock('cierre-de-mes:' || academia)`: si otra
 *    instancia tiene ese bloqueo, se salta esa academia en esta vuelta (no espera) y la siguiente la procesa. Es un bloqueo de transacción: se suelta solo.
 * 3. Los alumnos afectados, sin bloquear: los que tienen una matrícula `VIGENTE` de un mes anterior a M, los `ALUMNO_ACTIVO` sin matrícula `VIGENTE` de M y los
 *    `ALUMNO_VENCIDO` con ella. `CLIENTE` e `INACTIVO` no cambian de estado (sus matrículas viejas sí se finalizan).
 * 4. Orden de bloqueos (el de la 009, la 009b, la 007a y la 010a, así que no hay ciclos): las filas de esos alumnos con `FOR UPDATE`, ordenadas por id → sus
 *    matrículas `VIGENTE` con `FOR UPDATE`, ordenadas por id. Con los alumnos bloqueados, nadie más puede confirmar ni crear una matrícula de ellos.
 * 5. Dos sentencias de muchas filas, sin bucles: `UPDATE matriculas` a `FINALIZADA` (conservan `clases_totales` y `clases_usadas`: lo no usado queda como
 *    registro y ya no sirve para marcar) y `UPDATE alumnos` con el estado que corresponde. Las dos vuelven a evaluar sus condiciones con lo que se confirmó
 *    mientras se esperaba los bloqueos (lectura comprometida) y solo escriben las filas que cambian.
 *
 * No audita (no hay actor, DT-12). Un error en una academia se registra (`errorParaRegistro`, sin datos de los alumnos), deshace solo esa academia y la
 * tarea sigue con las demás: `cerrar` no lanza. Cada academia procesada deja un `info` «Cierre de mes» con su id y las cantidades, **después** de confirmar
 * su transacción.
 */
@Injectable()
export class CierreDeMesService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(CierreDeMesService.name);
  }

  /** Una vuelta con el instante `ahora`: devuelve lo cerrado por academia (las saltadas, suspendidas o con error no aparecen). */
  async cerrar(ahora: Date = this.reloj.ahora()): Promise<Map<string, ResultadoDelCierre>> {
    const cerradas = new Map<string, ResultadoDelCierre>();
    let academias: string[];
    try {
      academias = await this.baseDatos.comoPlataforma(async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM academias WHERE estado = 'ACTIVA' ORDER BY id`;
        return filas.map((fila) => fila.id);
      });
    } catch (error) {
      this.registro.error(
        { err: errorParaRegistro(error) },
        'No se pudo leer la lista de academias para el cierre de mes',
      );
      return cerradas;
    }

    const enCurso = anioYMesEnLima(ahora);
    const indiceDelMesEnCurso = enCurso.anio * 12 + enCurso.mes - 1;
    for (const academiaId of academias) {
      try {
        const resultado = await this.baseDatos.conAcademia(academiaId, (tx) =>
          this.cerrarLaAcademia(tx, ahora, indiceDelMesEnCurso),
        );
        if (resultado === null) {
          this.registro.debug(
            { academiaId },
            'Cierre de mes: otra instancia procesa esta academia; se salta en esta vuelta',
          );
          continue;
        }
        cerradas.set(academiaId, resultado);
        this.registro.info({ academiaId, ...resultado }, 'Cierre de mes');
      } catch (error) {
        this.registro.error(
          { err: errorParaRegistro(error), academiaId },
          'No se pudo hacer el cierre de mes de una academia',
        );
      }
    }
    return cerradas;
  }

  /**
   * La transacción de una academia: `null` si otra instancia tiene su bloqueo; si no, lo que cambió. `indiceDelMesEnCurso` es `año × 12 + mes − 1`: comparar
   * un solo entero evita la comparación de pares y cruza el cambio de año sin casos especiales.
   */
  private async cerrarLaAcademia(
    tx: TransaccionAcademia,
    ahora: Date,
    indiceDelMesEnCurso: number,
  ): Promise<ResultadoDelCierre | null> {
    // Primera sentencia: el bloqueo consultivo de la academia (criterio 27). `pg_try_…` no espera: si otra instancia lo tiene, se salta.
    const bloqueo = await tx.cliente.$queryRaw<{ tomado: boolean }[]>`
      SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('cierre-de-mes:' || ${tx.academiaId}::text, 0)) AS tomado`;
    if (bloqueo[0]?.tomado !== true) return null;

    // Los afectados, sin bloquear nada (criterio 27).
    const afectados = await tx.cliente.$queryRaw<{ id: string }[]>`
      SELECT a.id::text AS id
        FROM alumnos a
       WHERE a.academia_id = ${tx.academiaId}::uuid
         AND (EXISTS (SELECT 1 FROM matriculas m
                       WHERE m.academia_id = a.academia_id AND m.alumno_id = a.id AND m.estado = 'VIGENTE'
                         AND (m.anio::int * 12 + m.mes::int - 1) < ${indiceDelMesEnCurso}::int)
              OR (a.estado = 'ALUMNO_ACTIVO' AND NOT EXISTS (SELECT 1 FROM matriculas m
                                                              WHERE m.academia_id = a.academia_id AND m.alumno_id = a.id AND m.estado = 'VIGENTE'
                                                                AND (m.anio::int * 12 + m.mes::int - 1) = ${indiceDelMesEnCurso}::int))
              OR (a.estado = 'ALUMNO_VENCIDO' AND EXISTS (SELECT 1 FROM matriculas m
                                                           WHERE m.academia_id = a.academia_id AND m.alumno_id = a.id AND m.estado = 'VIGENTE'
                                                             AND (m.anio::int * 12 + m.mes::int - 1) = ${indiceDelMesEnCurso}::int)))
       ORDER BY a.id`;
    if (afectados.length === 0) return { matriculasFinalizadas: 0, alumnosVencidos: 0, alumnosActivados: 0 };
    const alumnos = afectados.map((fila) => fila.id);

    // Primero los alumnos y después sus matrículas, cada grupo ordenado por id (criterio 29): el mismo orden que el marcado, las faltas y los cobros.
    await tx.cliente.$queryRaw`
      SELECT 1 FROM alumnos
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ANY(${alumnos}::uuid[])
       ORDER BY id
         FOR UPDATE`;
    await tx.cliente.$queryRaw`
      SELECT 1 FROM matriculas
       WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ANY(${alumnos}::uuid[]) AND estado = 'VIGENTE'::estado_matricula
       ORDER BY id
         FOR UPDATE`;

    // Las mismas condiciones, otra vez, con lo que se confirmó mientras se esperaba. Todo `VIGENTE` de estos alumnos está bloqueado.
    const matriculasFinalizadas = await tx.cliente.$executeRaw`
      UPDATE matriculas SET estado = 'FINALIZADA'::estado_matricula, actualizado_en = ${ahora}::timestamptz
       WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ANY(${alumnos}::uuid[]) AND estado = 'VIGENTE'::estado_matricula
         AND (anio::int * 12 + mes::int - 1) < ${indiceDelMesEnCurso}::int`;
    const cambiados = await tx.cliente.$queryRaw<{ estado: string }[]>`
      UPDATE alumnos a
         SET estado = CASE WHEN a.estado = 'ALUMNO_ACTIVO' THEN 'ALUMNO_VENCIDO' ELSE 'ALUMNO_ACTIVO' END::estado_alumno,
             actualizado_en = ${ahora}::timestamptz
       WHERE a.academia_id = ${tx.academiaId}::uuid AND a.id = ANY(${alumnos}::uuid[])
         AND ((a.estado = 'ALUMNO_ACTIVO' AND NOT EXISTS (SELECT 1 FROM matriculas m
                                                           WHERE m.academia_id = a.academia_id AND m.alumno_id = a.id AND m.estado = 'VIGENTE'
                                                             AND (m.anio::int * 12 + m.mes::int - 1) = ${indiceDelMesEnCurso}::int))
              OR (a.estado = 'ALUMNO_VENCIDO' AND EXISTS (SELECT 1 FROM matriculas m
                                                           WHERE m.academia_id = a.academia_id AND m.alumno_id = a.id AND m.estado = 'VIGENTE'
                                                             AND (m.anio::int * 12 + m.mes::int - 1) = ${indiceDelMesEnCurso}::int)))
      RETURNING a.estado::text AS estado`;
    return {
      matriculasFinalizadas,
      alumnosVencidos: cambiados.filter((fila) => fila.estado === 'ALUMNO_VENCIDO').length,
      alumnosActivados: cambiados.filter((fila) => fila.estado === 'ALUMNO_ACTIVO').length,
    };
  }
}
