// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { ejecutarComo, limpiarBase, type RolPruebas } from '../../utilidades/base-datos';
import {
  actualizarFilas,
  crearAlumnoSolo,
  exigirTablasDeInscripcion,
  filaValida,
  insertarFila,
  leerMatriculas,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';
import { crearClaseDePrueba, crearEntrenadorDePrueba, crearPlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 1 (crítico, RN-28, DT-2, DT-11): la migración `<marca>_renovaciones` agrega a `matriculas` el `CHECK matriculas_renovacion_sin_vencimiento`: si `solicitud_id` es nula, `reserva_vence_en` es nula (una renovación nunca tiene una
// reserva temporal). Sin tablas ni privilegios nuevos. Se prueba como app y como dueño: una matrícula sin solicitud con `reserva_vence_en` responde 23514 con ese nombre de restricción, al insertar y al actualizar; una matrícula sin solicitud y sin
// vencimiento (un pago en verificación o una renovación vigente) y una con solicitud y vencimiento (la reserva de 24 horas de la 005) se aceptan.
// Lectura estricta elegida: la restricción tiene exactamente ese nombre y es de tipo `CHECK` ya validada (se creó con la tabla vacía de renovaciones, «se valida al crearla» del plan).

const ROLES: readonly RolPruebas[] = ['propietario', 'app'];
const VENCIMIENTO = '2026-11-12T15:00:00.000Z';
const CHECK = 'matriculas_renovacion_sin_vencimiento';

describe('el CHECK de la renovación sin vencimiento (criterio 1)', () => {
  let A: AcademiaDePrueba;
  let planId: string;
  let claseId: string;

  beforeEach(exigirTablasDeInscripcion);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    const entrenador = await crearEntrenadorDePrueba(A.id);
    planId = (await crearPlanDePrueba(A.id)).id;
    claseId = (await crearClaseDePrueba(A.id, entrenador.id)).id;
  });

  /** Una matrícula sin solicitud de un alumno nuevo, con los cambios dados. */
  async function matricula(cambios: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const alumnoId = await crearAlumnoSolo(A.id);
    return { ...(await filaValida('matriculas', { alumnoId, planId, claseId })), solicitud_id: null, ...cambios };
  }

  it('criterio 1: la restricción existe en matriculas como CHECK ya validado', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT c.contype::text AS tipo, c.convalidated AS validada, pg_get_constraintdef(c.oid) AS definicion
         FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = 'public.matriculas'::regclass AND c.conname = $1`,
      [CHECK],
    );

    expect(rows, 'falta la restricción matriculas_renovacion_sin_vencimiento (010a)').toHaveLength(1);
    expect(rows[0]).toMatchObject({ tipo: 'c', validada: true });
    const definicion = String((rows[0] as { definicion: string }).definicion);
    expect(definicion).toMatch(/solicitud_id/);
    expect(definicion).toMatch(/reserva_vence_en/);
  });

  describe.each(ROLES)('como %s', (rol) => {
    it('criterio 1: INSERT de una matrícula RESERVADA sin solicitud y con reserva_vence_en falla con 23514 y ese nombre', async () => {
      const fila = await matricula({ estado: 'RESERVADA', reserva_vence_en: VENCIMIENTO });

      await expect(insertarFila(rol, 'matriculas', A.id, fila)).rejects.toMatchObject({
        code: '23514',
        constraint: CHECK,
      });
      expect(await leerMatriculas(A.id)).toEqual([]);
    });

    it('criterio 1: sin solicitud, con vencimiento en cualquier fecha o estado que lo admita, falla igual (el vencimiento nunca viaja sin solicitud)', async () => {
      for (const vence of ['2026-11-11T15:00:00.001Z', '2026-11-30T23:59:59.999Z', '2026-11-12T15:00:00.000Z']) {
        const fila = await matricula({ estado: 'RESERVADA', reserva_vence_en: vence });

        await expect(insertarFila(rol, 'matriculas', A.id, fila), vence).rejects.toMatchObject({
          code: '23514',
          constraint: CHECK,
        });
      }
    });

    it('criterio 1 (control): sin solicitud y sin vencimiento se acepta, RESERVADA (un pago en verificación) o VIGENTE (una renovación en efectivo)', async () => {
      for (const estado of ['RESERVADA', 'VIGENTE']) {
        await expect(
          insertarFila(rol, 'matriculas', A.id, await matricula({ estado, reserva_vence_en: null })),
          estado,
        ).resolves.toBeUndefined();
      }
      expect(await leerMatriculas(A.id)).toHaveLength(2);
    });

    it('criterio 1 (control): con solicitud y con vencimiento se acepta (la reserva de 24 horas de la inscripción pública no cambia)', async () => {
      const cliente = await sembrarSolicitud(A.id, {
        planId,
        claseIds: [claseId],
        reservaVenceEn: new Date(VENCIMIENTO),
      });

      const [fila] = await leerMatriculas(A.id);

      expect(fila).toMatchObject({ id: cliente.matriculaId, estado: 'RESERVADA', solicitud_id: cliente.solicitudId });
      expect(fila?.reserva_vence_en).not.toBeNull();
      // Y otra matrícula sin solicitud ni vencimiento convive con ella.
      await expect(
        insertarFila(rol, 'matriculas', A.id, await matricula({ estado: 'RESERVADA', reserva_vence_en: null })),
      ).resolves.toBeUndefined();
    });

    it('criterio 1: UPDATE que le deja un vencimiento a una matrícula sin solicitud falla con 23514', async () => {
      const fila = await matricula({ estado: 'RESERVADA', reserva_vence_en: null });
      await insertarFila('propietario', 'matriculas', A.id, fila);

      await expect(
        actualizarFilas(rol, 'matriculas', A.id, { id: fila['id'] }, { reserva_vence_en: VENCIMIENTO }),
      ).rejects.toMatchObject({ code: '23514', constraint: CHECK });
      expect((await leerMatriculas(A.id))[0]?.reserva_vence_en).toBeNull();
    });
  });

  it('criterio 1: UPDATE que le quita la solicitud a una matrícula con vencimiento falla con 23514 (como dueño: la app no tiene privilegio sobre solicitud_id)', async () => {
    const cliente = await sembrarSolicitud(A.id, {
      planId,
      claseIds: [claseId],
      reservaVenceEn: new Date(VENCIMIENTO),
    });

    await expect(
      ejecutarComo(
        'propietario',
        'UPDATE matriculas SET solicitud_id = NULL WHERE academia_id = $1::uuid AND id = $2::uuid',
        [A.id, cliente.matriculaId],
        { academiaId: A.id },
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: CHECK });
    expect((await leerMatriculas(A.id))[0]?.solicitud_id).toBe(cliente.solicitudId);
  });

  it('criterio 1: el rechazo no deja filas a medias: otra matrícula del mismo alumno y mes se acepta después de un 23514', async () => {
    const alumnoId = await crearAlumnoSolo(A.id);
    const base = { alumno_id: alumnoId, id: randomUUID() };
    const mala = { ...(await matricula({ estado: 'RESERVADA', reserva_vence_en: VENCIMIENTO })), ...base };
    await expect(insertarFila('app', 'matriculas', A.id, mala)).rejects.toMatchObject({ code: '23514' });

    const buena = { ...(await matricula({ estado: 'RESERVADA', reserva_vence_en: null })), alumno_id: alumnoId };

    await expect(insertarFila('app', 'matriculas', A.id, buena)).resolves.toBeUndefined();
  });
});
