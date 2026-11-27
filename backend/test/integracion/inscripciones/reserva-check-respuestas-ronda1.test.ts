// spec: 005-inscripcion-publica (pruebas protegidas)
// Actualizada por la 010a (spec 010-mensualidades, criterio 1: `CHECK matriculas_renovacion_sin_vencimiento`, una matrícula sin solicitud nunca tiene `reserva_vence_en`): las matrículas RESERVADA con vencimiento que insertan estas pruebas ahora llevan su solicitud
// (se siembra una por cada alumno), porque sin ella el 23514 sería el de la renovación y no el de `matriculas_reserva_dentro_del_mes`. No cambia lo que se comprueba.
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AcademiaDePrueba, crearAcademiaDePrueba } from '../../utilidades/academias';
import { conClienteComo, ejecutarComo, limpiarBase, type RolPruebas } from '../../utilidades/base-datos';
import { crearAlumnoSolo, exigirTablasDeInscripcion, filaValida, insertarFila } from '../../utilidades/inscripciones';
import { crearPlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 56 (crítico, RN-28, DR-12; criterio 4 c; respuesta R1, ronda 1): `matriculas` tiene el CHECK `matriculas_reserva_dentro_del_mes`:
// `reserva_vence_en` es nula o anterior al inicio del mes siguiente al de `anio` y `mes` en America/Lima (para noviembre de 2026, anterior a
// `2026-12-01T05:00:00.000Z`). Un INSERT o un UPDATE directo, como app y como dueño de las tablas, falla con 23514: una matrícula de
// noviembre de 2026 RESERVADA con `reserva_vence_en` `2026-12-01T05:00:00.000Z` o `2027-01-01T00:00:00.000Z`, y un UPDATE que lleva una
// reserva válida a `2026-12-01T05:00:00.000Z`. Se aceptan `2026-12-01T04:59:59.999Z` y NULL. Con diciembre de 2026, el límite es
// `2027-01-01T05:00:00.000Z` (cambio de año). El resultado es el mismo con la sesión en `SET TIME ZONE 'Asia/Tokyo'` y en `'UTC'`.

const NOMBRE_DEL_CHECK = 'matriculas_reserva_dentro_del_mes';
const ROLES: readonly RolPruebas[] = ['propietario', 'app'];
const ZONAS = [undefined, 'UTC', 'Asia/Tokyo', 'America/Lima'] as const;
type Zona = (typeof ZONAS)[number];

interface Mes {
  anio: number;
  mes: number;
  inicio: string;
  fin: string;
}
const NOVIEMBRE: Mes = { anio: 2026, mes: 11, inicio: '2026-11-01', fin: '2026-11-30' };
const DICIEMBRE: Mes = { anio: 2026, mes: 12, inicio: '2026-12-01', fin: '2026-12-31' };

describe('criterio 56: la base no acepta una reserva que cruce el mes', () => {
  let A: AcademiaDePrueba;
  let planId: string;

  beforeEach(exigirTablasDeInscripcion);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    planId = (await crearPlanDePrueba(A.id)).id;
  });

  /** Una sola transacción con el contexto de la academia y, si se indica, la zona horaria de la sesión. */
  async function enTransaccion<T>(
    rol: RolPruebas,
    zona: Zona,
    trabajo: (consultar: (sql: string, parametros?: unknown[]) => Promise<unknown>) => Promise<T>,
  ): Promise<T> {
    return conClienteComo(rol, async (cliente) => {
      await cliente.query('BEGIN');
      try {
        await cliente.query("SELECT set_config('app.academia_id', $1, true)", [A.id]);
        if (zona) await cliente.query("SELECT set_config('timezone', $1, true)", [zona]);
        const resultado = await trabajo((sql, parametros) => cliente.query(sql, parametros));
        await cliente.query('COMMIT');
        return resultado;
      } catch (error) {
        await cliente.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  const SQL_INSERTAR = `INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, anio, mes, fecha_inicio, fecha_fin, clases_totales,
      clases_usadas, es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado, reserva_vence_en, creado_en, actualizado_en,
      solicitud_id)
    VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::smallint, $6::smallint, $7::date, $8::date, 10, 0, true, 120.00, 12, 100.00,
      'RESERVADA'::estado_matricula, $9::timestamptz, now(), now(), $10::uuid)`;

  /** Un alumno nuevo con su solicitud (la matrícula con vencimiento solo existe con solicitud: 010a, criterio 1). */
  async function alumnoConSolicitud(): Promise<{ alumnoId: string; solicitudId: string }> {
    const alumnoId = await crearAlumnoSolo(A.id);
    const solicitud = await filaValida('solicitudes_inscripcion', { alumnoId });
    await insertarFila('propietario', 'solicitudes_inscripcion', A.id, solicitud);
    return { alumnoId, solicitudId: solicitud['id'] as string };
  }

  async function insertar(rol: RolPruebas, zona: Zona, mes: Mes, reserva: string | null): Promise<void> {
    const { alumnoId, solicitudId } = await alumnoConSolicitud();
    await enTransaccion(rol, zona, (consultar) =>
      consultar(SQL_INSERTAR, [
        randomUUID(),
        A.id,
        alumnoId,
        planId,
        mes.anio,
        mes.mes,
        mes.inicio,
        mes.fin,
        reserva,
        solicitudId,
      ]),
    );
  }

  async function actualizar(
    rol: RolPruebas,
    zona: Zona,
    mes: Mes,
    deReserva: string,
    aReserva: string | null,
  ): Promise<void> {
    const { alumnoId, solicitudId } = await alumnoConSolicitud();
    const id = randomUUID();
    await enTransaccion(rol, zona, (consultar) =>
      consultar(SQL_INSERTAR, [
        id,
        A.id,
        alumnoId,
        planId,
        mes.anio,
        mes.mes,
        mes.inicio,
        mes.fin,
        deReserva,
        solicitudId,
      ]),
    );
    await enTransaccion(rol, zona, (consultar) =>
      consultar(
        'UPDATE matriculas SET reserva_vence_en = $1::timestamptz WHERE academia_id = $2::uuid AND id = $3::uuid',
        [aReserva, A.id, id],
      ),
    );
  }

  const rechazo = { code: '23514', constraint: NOMBRE_DEL_CHECK };

  it('criterio 56: el CHECK matriculas_reserva_dentro_del_mes existe en la tabla matriculas', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT contype::text AS tipo FROM pg_catalog.pg_constraint
        WHERE conname = $1 AND conrelid = 'public.matriculas'::regclass`,
      [NOMBRE_DEL_CHECK],
    );

    expect(rows).toEqual([{ tipo: 'c' }]);
  });

  describe.each(ROLES)('como %s', (rol) => {
    describe.each(ZONAS)('con la sesión en la zona %s', (zona) => {
      it('criterio 56: un INSERT de noviembre de 2026 RESERVADA con reserva_vence_en 2026-12-01T05:00:00.000Z o 2027-01-01T00:00:00.000Z falla con 23514', async () => {
        for (const reserva of ['2026-12-01T05:00:00.000Z', '2026-12-01T05:00:00.001Z', '2027-01-01T00:00:00.000Z']) {
          await expect(insertar(rol, zona, NOVIEMBRE, reserva), reserva).rejects.toMatchObject(rechazo);
        }
      });

      it('criterio 56: se aceptan 2026-12-01T04:59:59.999Z, un vencimiento a mitad de mes y NULL', async () => {
        for (const reserva of ['2026-12-01T04:59:59.999Z', '2026-11-12T15:00:00.000Z', null]) {
          await expect(insertar(rol, zona, NOVIEMBRE, reserva), String(reserva)).resolves.toBeUndefined();
        }
      });

      it('criterio 56: un UPDATE que lleva una reserva válida a 2026-12-01T05:00:00.000Z falla con 23514, y uno a 2026-12-01T04:59:59.999Z se acepta', async () => {
        await expect(
          actualizar(rol, zona, NOVIEMBRE, '2026-11-12T15:00:00.000Z', '2026-12-01T05:00:00.000Z'),
        ).rejects.toMatchObject(rechazo);
        await expect(
          actualizar(rol, zona, NOVIEMBRE, '2026-11-12T15:00:00.000Z', '2026-12-01T04:59:59.999Z'),
        ).resolves.toBeUndefined();
      });

      it('criterio 56: con diciembre de 2026 el límite es 2027-01-01T05:00:00.000Z (cambio de año): 04:59:59.999 se acepta y 05:00:00.000 falla con 23514', async () => {
        await expect(insertar(rol, zona, DICIEMBRE, '2027-01-01T04:59:59.999Z')).resolves.toBeUndefined();
        await expect(insertar(rol, zona, DICIEMBRE, '2027-01-01T05:00:00.000Z')).rejects.toMatchObject(rechazo);
        await expect(insertar(rol, zona, DICIEMBRE, '2027-02-01T00:00:00.000Z')).rejects.toMatchObject(rechazo);
      });
    });
  });

  it('criterio 56 (control): una matrícula VIGENTE sin reserva_vence_en se sigue aceptando', async () => {
    const alumnoId = await crearAlumnoSolo(A.id);

    await expect(
      enTransaccion('propietario', undefined, (consultar) =>
        consultar(SQL_INSERTAR.replace("'RESERVADA'::estado_matricula", "'VIGENTE'::estado_matricula"), [
          randomUUID(),
          A.id,
          alumnoId,
          planId,
          NOVIEMBRE.anio,
          NOVIEMBRE.mes,
          NOVIEMBRE.inicio,
          NOVIEMBRE.fin,
          null,
          null,
        ]),
      ),
    ).resolves.toBeDefined();
  });
});
