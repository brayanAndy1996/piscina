import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { hoyEnLima } from '../../comun/fechas';
import {
  BaseDatos,
  errorParaRegistro,
  type Fragmento,
  sql,
  type TransaccionAcademia,
} from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** La fecha de calendario `AAAA-MM-DD` un día antes de otra (aritmética de calendario: no depende de la zona del proceso). */
function diaAnterior(fecha: string): string {
  const [anio = 0, mes = 1, dia = 1] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia) - MS_POR_DIA).toISOString().slice(0, 10);
}

/**
 * El registro de faltas (spec 009b, criterios 23 a 27; D-08, D-16, RN-14, DR-1 y DR-4). `registrarFaltas(ahora)` se puede llamar directamente (las
 * pruebas lo hacen con un instante fijo) y la llama la tarea programada (`FaltasTarea`) cada 5 minutos y al arrancar.
 *
 * 1. La lista de academias `ACTIVA` se lee con `comoPlataforma`; esa transacción se cierra (nota O1 de 001). Una academia suspendida no se procesa.
 * 2. Después, un `conAcademia` por academia, una tras otra. Cada uno empieza con `pg_try_advisory_xact_lock('faltas:' || academia)`: si otra instancia
 *    tiene ese bloqueo, se salta esa academia en esta vuelta (no espera) y la siguiente vuelta la procesa. El bloqueo es de transacción: se suelta solo.
 * 3. Para cada fecha entre ayer y hoy de Lima y cada ocurrencia cuyo fin ya pasó (al terminar la clase, sin espera, DR-1), una falta por cada alumno
 *    que cumple las condiciones del criterio 24 (`candidatos`). La falta no descuenta clases (RN-14).
 * 4. Orden de bloqueos (criterio 27): las filas de esos alumnos con `FOR KEY SHARE` (ordenadas por id) → sus matrículas con `FOR UPDATE` (ordenadas por
 *    id) → el `INSERT`, que evalúa otra vez las mismas condiciones con lo que se confirmó mientras esperaba (lectura comprometida): un registro posterior
 *    que ganó la matrícula deja su asistencia y la falta ya no se crea. `ON CONFLICT DO NOTHING` sobre `inasistencias_una_por_clase_key` hace la tarea
 *    idempotente. El `FOR KEY SHARE` explícito del alumno evita el ciclo que formaría el implícito de la llave foránea si se tomara después de la matrícula.
 *
 * Un error en una academia se registra (`errorParaRegistro`, sin datos de los alumnos) y la tarea sigue con las demás: `registrarFaltas` no lanza. Cada
 * academia procesada deja un `info` «Faltas registradas» con su id y la cantidad, **después** de confirmar su transacción; nunca alumnos, matrículas ni DNI.
 */
@Injectable()
export class FaltasService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(FaltasService.name);
  }

  /** Una vuelta de la tarea con el instante `ahora`: devuelve la cantidad de faltas registradas por academia (las saltadas o con error no aparecen). */
  async registrarFaltas(ahora: Date = this.reloj.ahora()): Promise<Map<string, number>> {
    const registradas = new Map<string, number>();
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
        'No se pudo leer la lista de academias para registrar las faltas',
      );
      return registradas;
    }

    const hoy = hoyEnLima(ahora);
    const fechas = [diaAnterior(hoy), hoy];
    for (const academiaId of academias) {
      try {
        const cantidad = await this.baseDatos.conAcademia(academiaId, (tx) =>
          this.registrarDeLaAcademia(tx, ahora, fechas),
        );
        if (cantidad === null) {
          this.registro.debug({ academiaId }, 'Faltas: otra instancia procesa esta academia; se salta en esta vuelta');
          continue;
        }
        registradas.set(academiaId, cantidad);
        this.registro.info({ academiaId, cantidad }, 'Faltas registradas');
      } catch (error) {
        this.registro.error(
          { err: errorParaRegistro(error), academiaId },
          'No se pudieron registrar las faltas de una academia',
        );
      }
    }
    return registradas;
  }

  /** La transacción de una academia: `null` si otra instancia tiene su bloqueo; si no, la cantidad de faltas nuevas. */
  private async registrarDeLaAcademia(
    tx: TransaccionAcademia,
    ahora: Date,
    fechas: readonly string[],
  ): Promise<number | null> {
    // Primera sentencia: el bloqueo consultivo de la academia (criterio 23). `pg_try_…` no espera: si otra instancia lo tiene, se salta.
    const bloqueo = await tx.cliente.$queryRaw<{ tomado: boolean }[]>`
      SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('faltas:' || ${tx.academiaId}::text, 0)) AS tomado`;
    if (bloqueo[0]?.tomado !== true) return null;

    const candidatos = await tx.cliente.$queryRaw<{ alumno_id: string; matricula_id: string }[]>(
      sql`SELECT alumno_id::text AS alumno_id, matricula_id::text AS matricula_id FROM (${this.candidatos(tx.academiaId, fechas, ahora)}) AS candidatos`,
    );
    if (candidatos.length === 0) return 0;

    const alumnos = [...new Set(candidatos.map((fila) => fila.alumno_id))];
    const matriculas = [...new Set(candidatos.map((fila) => fila.matricula_id))];
    await tx.cliente.$queryRaw`
      SELECT 1 FROM alumnos
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ANY(${alumnos}::uuid[])
       ORDER BY id
         FOR KEY SHARE`;
    await tx.cliente.$queryRaw`
      SELECT 1 FROM matriculas
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ANY(${matriculas}::uuid[])
       ORDER BY id
         FOR UPDATE`;

    // Las mismas condiciones, otra vez, con lo que se confirmó mientras se esperaba (criterio 27).
    const nuevas = await tx.cliente.$queryRaw<{ id: string }[]>(
      sql`
        INSERT INTO inasistencias (academia_id, alumno_id, matricula_id, clase_id, fecha, registrada_en)
        SELECT academia_id, alumno_id, matricula_id, clase_id, fecha, ${ahora}::timestamptz
          FROM (${this.candidatos(tx.academiaId, fechas, ahora)}) AS candidatos
         ORDER BY alumno_id, fecha, clase_id
        ON CONFLICT ON CONSTRAINT inasistencias_una_por_clase_key DO NOTHING
        RETURNING id::text AS id`,
    );
    return nuevas.length;
  }

  /**
   * Quién tiene una falta (criterio 24): por cada fecha D de `fechas` y cada clase activa de la matrícula del mes de D (`VIGENTE` o `FINALIZADA`, con D entre
   * `fecha_inicio` y `fecha_fin`) que cae ese día ISO:
   * - la ocurrencia ya terminó (`fin <= ahora`, con la fecha y la hora en America/Lima: DR-1);
   * - está incluida en la mensualidad (su inicio es posterior a `matriculas.creado_en`, DT-14, y a `matricula_clases.agregada_en` si la clase entró con un cambio de horario, criterio 38 de 010c) y su inicio no es anterior a la confirmación del pago
   *   (`verificado_en` del pago `CONFIRMADO`; sin pago confirmado no hay falta);
   * - el alumno no tiene ninguna asistencia de ese día (salvo las `PARTICULAR`), le quedan clases y no está `INACTIVO` (DR-4).
   */
  private candidatos(academiaId: string, fechas: readonly string[], ahora: Date): Fragmento {
    return sql`
      SELECT m.academia_id, m.alumno_id, m.id AS matricula_id, c.id AS clase_id, f.fecha
        FROM unnest(${fechas}::date[]) AS f(fecha)
        JOIN matriculas m
          ON m.academia_id = ${academiaId}::uuid AND m.estado IN ('VIGENTE', 'FINALIZADA')
         AND m.anio = EXTRACT(YEAR FROM f.fecha)::int AND m.mes = EXTRACT(MONTH FROM f.fecha)::int
         AND m.fecha_inicio <= f.fecha AND m.fecha_fin >= f.fecha
         AND m.clases_usadas < m.clases_totales
        JOIN alumnos a
          ON a.academia_id = m.academia_id AND a.id = m.alumno_id AND a.estado NOT IN ('INACTIVO', 'CLIENTE')
        JOIN matricula_clases mc ON mc.academia_id = m.academia_id AND mc.matricula_id = m.id
        JOIN clases c
          ON c.academia_id = mc.academia_id AND c.id = mc.clase_id AND c.activo
         AND c.dia_semana = EXTRACT(ISODOW FROM f.fecha)::int
        JOIN pagos p ON p.academia_id = m.academia_id AND p.matricula_id = m.id AND p.estado = 'CONFIRMADO'
       WHERE ((f.fecha + c.hora_fin) AT TIME ZONE 'America/Lima') <= ${ahora}::timestamptz
         AND ((f.fecha + c.hora_inicio) AT TIME ZONE 'America/Lima') > m.creado_en
         AND (mc.agregada_en IS NULL OR ((f.fecha + c.hora_inicio) AT TIME ZONE 'America/Lima') > mc.agregada_en)
         AND ((f.fecha + c.hora_inicio) AT TIME ZONE 'America/Lima') >= p.verificado_en
         AND NOT EXISTS (
               SELECT 1 FROM asistencias s
                WHERE s.academia_id = m.academia_id AND s.alumno_id = m.alumno_id AND s.fecha = f.fecha AND s.tipo <> 'PARTICULAR')`;
  }
}
