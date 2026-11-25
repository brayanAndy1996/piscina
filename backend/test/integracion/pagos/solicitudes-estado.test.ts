// spec: 007-pagos (pruebas protegidas)
import { beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import {
  actualizarFilas,
  crearAlumnoSolo,
  filaValida,
  insertarFila,
  leerSolicitudes,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';

// Criterio 7 (crítico, D-23; criterio 4 de 005): el tipo `estado_solicitud` suma `CONFIRMADA`. `solicitudes_inscripcion` suma `registrada_por uuid null` con la
// llave compuesta a `usuarios` (criterio 34), que la app solo escribe al insertar. El índice parcial de una solicitud `PENDIENTE_PAGO` por alumno (criterio 4 e de
// 005) no cambia. Las pruebas de catálogo y de privilegios de 005 siguen pasando con estos agregados (actualizadas en este mismo cambio).

const ROLES = ['propietario', 'app'] as const;

describe.each(ROLES)('criterio 7: estado y origen de la solicitud, como %s', (rol) => {
  let e: EscenarioPagos;

  beforeAll(async () => {
    e = await crearEscenarioDePagos();
  });

  async function solicitudNueva() {
    return sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
  }

  it('criterio 7: una solicitud puede pasar a CONFIRMADA (la app tiene el UPDATE de estado) y la fila lo guarda', async () => {
    const cliente = await solicitudNueva();

    const filas = await actualizarFilas(
      rol,
      'solicitudes_inscripcion',
      e.A.id,
      { id: cliente.solicitudId },
      { estado: 'CONFIRMADA' },
    );

    expect(filas).toBe(1);
    expect((await leerSolicitudes(e.A.id)).find((s) => s.id === cliente.solicitudId)?.estado).toBe('CONFIRMADA');
  });

  it('criterio 7: el índice de una solicitud PENDIENTE_PAGO por alumno no cambia: dos pendientes del mismo alumno fallan con 23505', async () => {
    const cliente = await solicitudNueva();

    await expect(
      insertarFila(
        rol,
        'solicitudes_inscripcion',
        e.A.id,
        await filaValida('solicitudes_inscripcion', { alumnoId: cliente.alumnoId }),
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'solicitudes_inscripcion_alumno_pendiente_key' });
  });

  it('criterio 7: una solicitud CONFIRMADA no cuenta en ese índice: el mismo alumno puede tener una nueva PENDIENTE_PAGO (control)', async () => {
    const cliente = await solicitudNueva();
    await actualizarFilas(
      rol,
      'solicitudes_inscripcion',
      e.A.id,
      { id: cliente.solicitudId },
      { estado: 'CONFIRMADA' },
    );

    await insertarFila(
      rol,
      'solicitudes_inscripcion',
      e.A.id,
      await filaValida('solicitudes_inscripcion', { alumnoId: cliente.alumnoId }),
    );

    expect(
      (await leerSolicitudes(e.A.id))
        .filter((s) => s.alumno_id === cliente.alumnoId)
        .map((s) => s.estado)
        .sort(),
    ).toEqual(['CONFIRMADA', 'PENDIENTE_PAGO']);
  });

  it('criterio 7: registrada_por se escribe al insertar con un usuario de la academia (la secretaria que inscribe en recepción)', async () => {
    const alumnoId = await crearAlumnoSolo(e.A.id);
    const fila: Record<string, unknown> = {
      ...(await filaValida('solicitudes_inscripcion', { alumnoId })),
      registrada_por: e.secretariaA.id,
    };

    await insertarFila(rol, 'solicitudes_inscripcion', e.A.id, fila);

    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT registrada_por FROM solicitudes_inscripcion WHERE academia_id = $1::uuid AND id = $2::uuid',
      [e.A.id, fila['id']],
      { academiaId: e.A.id },
    );
    expect(rows).toEqual([{ registrada_por: e.secretariaA.id }]);
  });

  it('criterio 7: registrada_por es nula si la solicitud la envió el público (control: sin la columna se inserta igual)', async () => {
    const alumnoId = await crearAlumnoSolo(e.A.id);

    await insertarFila(
      rol,
      'solicitudes_inscripcion',
      e.A.id,
      await filaValida('solicitudes_inscripcion', { alumnoId }),
    );

    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT registrada_por FROM solicitudes_inscripcion WHERE academia_id = $1::uuid AND alumno_id = $2::uuid',
      [e.A.id, alumnoId],
      { academiaId: e.A.id },
    );
    expect(rows).toEqual([{ registrada_por: null }]);
  });

  it('criterio 7 y 3: registrada_por de un usuario de otra academia falla con 23503 (llave compuesta)', async () => {
    const alumnoId = await crearAlumnoSolo(e.A.id);
    const fila = { ...(await filaValida('solicitudes_inscripcion', { alumnoId })), registrada_por: e.secretariaB.id };

    await expect(insertarFila(rol, 'solicitudes_inscripcion', e.A.id, fila)).rejects.toMatchObject({ code: '23503' });
  });
});

describe('criterio 7: lo que la app no puede cambiar de la solicitud', () => {
  it('criterio 7: la app no puede cambiar registrada_por de una solicitud ya creada (42501), pero el dueño sí (control del dato)', async () => {
    const e = await crearEscenarioDePagos();
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });

    await expect(
      actualizarFilas(
        'app',
        'solicitudes_inscripcion',
        e.A.id,
        { id: cliente.solicitudId },
        { registrada_por: e.secretariaA.id },
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      actualizarFilas(
        'propietario',
        'solicitudes_inscripcion',
        e.A.id,
        { id: cliente.solicitudId },
        { registrada_por: e.secretariaA.id },
      ),
    ).resolves.toBe(1);
  });
});
