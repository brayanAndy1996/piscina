// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { crearCajaDePrueba, filaIngresoValida, sqlDeInsercionCaja } from '../../utilidades/caja';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import { crearAlumnoSolo, sembrarSolicitud } from '../../utilidades/inscripciones';
import {
  actualizarPagos,
  type Columnas,
  crearMatriculaDeApoyo,
  crearPagoConfirmadoConMovimiento,
  ejecutarTransaccion,
  filaPagoValida,
  insertarPago,
  leerPagos,
} from '../../utilidades/pagos';

// Criterio 3 (crítico, D-23, D-29): con pagos de A y de B, como app: en contexto de A, SELECT devuelve solo los de A; un INSERT con `academia_id` de B o un
// UPDATE que mueve un pago a B fallan con 42501; en contexto de plataforma o sin contexto, 0 filas (D-29). Aunque quien escriba sea el dueño de las tablas:
// un pago de A con una matrícula, un alumno o un usuario de B, un pago cuya matrícula es de otro alumno, y un movimiento de caja de A con el `pago_id` de un
// pago de B o de un pago que no existe fallan con 23503 (el último, al confirmar la transacción, porque esa llave es diferida). Las filas se leen como dueño
// filtrando por `academia_id` (sirve con un dueño superusuario o no).

interface Datos {
  academiaId: string;
  adminId: string;
  secretariaId: string;
  alumnoId: string;
  matriculaId: string;
  cajaId: string;
  /** Un Yape pendiente de otra persona. */
  pagoPendienteId: string;
  /** Un efectivo confirmado con su movimiento. */
  pagoConfirmadoId: string;
  /** El alumno y la matrícula del pago pendiente. */
  alumnoPendienteId: string;
  matriculaPendienteId: string;
}

describe('criterio 3: RLS y llaves compuestas de pagos', () => {
  let e: EscenarioPagos;
  let A: Datos;
  let B: Datos;

  async function sembrar(academiaId: string, adminId: string, secretariaId: string, esA: boolean): Promise<Datos> {
    const planId = esA ? e.plan.id : e.planB.id;
    const claseId = esA ? e.lunes.id : e.lunesB.id;
    const pendiente = await sembrarSolicitud(academiaId, { planId, claseIds: [claseId], monto: '42.00' });
    const filaPendiente = filaPagoValida(academiaId, {
      alumnoId: pendiente.alumnoId,
      matriculaId: pendiente.matriculaId,
    });
    await insertarPago('propietario', academiaId, filaPendiente);
    const confirmado = await sembrarSolicitud(academiaId, { planId, claseIds: [claseId], monto: '42.00' });
    const caja = await crearCajaDePrueba(academiaId, secretariaId);
    const { pagoId } = await crearPagoConfirmadoConMovimiento(academiaId, {
      cajaId: caja.id,
      alumnoId: confirmado.alumnoId,
      matriculaId: confirmado.matriculaId,
      usuarioId: secretariaId,
      numeroTicket: 1,
    });
    return {
      academiaId,
      adminId,
      secretariaId,
      alumnoId: confirmado.alumnoId,
      matriculaId: confirmado.matriculaId,
      cajaId: caja.id,
      pagoPendienteId: filaPendiente['id'] as string,
      pagoConfirmadoId: pagoId,
      alumnoPendienteId: pendiente.alumnoId,
      matriculaPendienteId: pendiente.matriculaId,
    };
  }

  beforeEach(async () => {
    e = await crearEscenarioDePagos();
    A = await sembrar(e.A.id, e.adminA.id, e.secretariaA.id, true);
    B = await sembrar(e.B.id, e.adminB.id, e.secretariaB.id, false);
  });

  const idsDe = async (contexto: { academiaId?: string; plataforma?: boolean | string }) => {
    const { rows } = await ejecutarComo('app', 'SELECT id::text AS id FROM pagos ORDER BY 1', [], contexto);
    return (rows as { id: string }[]).map((fila) => fila.id);
  };

  /** Un pago nuevo y válido (Yape pendiente) para la academia de `d`, con otra solicitud y otra matrícula. */
  async function pagoNuevoDe(d: Datos, sobre: Columnas = {}): Promise<Columnas> {
    const otro = await sembrarSolicitud(d.academiaId, {
      planId: d.academiaId === e.A.id ? e.plan.id : e.planB.id,
      claseIds: [d.academiaId === e.A.id ? e.lunes.id : e.lunesB.id],
    });
    return filaPagoValida(d.academiaId, { alumnoId: otro.alumnoId, matriculaId: otro.matriculaId }, {}, sobre);
  }

  describe('SELECT', () => {
    it('criterio 3: en contexto de A devuelve solo los pagos de A; en el de B, solo los de B (cada una tiene dos)', async () => {
      const deA = await idsDe({ academiaId: A.academiaId });
      const deB = await idsDe({ academiaId: B.academiaId });

      expect(deA.sort()).toEqual([A.pagoPendienteId, A.pagoConfirmadoId].sort());
      expect(deB.sort()).toEqual([B.pagoPendienteId, B.pagoConfirmadoId].sort());
    });

    it('criterio 3: en contexto de plataforma, sin contexto o con la academia vacía devuelve 0 filas (el Superadmin no ve pagos, D-29)', async () => {
      expect(await idsDe({ plataforma: true })).toEqual([]);
      expect(await idsDe({})).toEqual([]);
      expect(await idsDe({ academiaId: '' })).toEqual([]);
    });

    it('criterio 3: en contexto de plataforma y de A a la vez solo se ven los de A (la marca de plataforma no abre nada)', async () => {
      expect(await idsDe({ plataforma: true, academiaId: A.academiaId })).toEqual(
        await idsDe({ academiaId: A.academiaId }),
      );
    });
  });

  describe('INSERT', () => {
    it('criterio 3: un INSERT con la academia_id de B en contexto de A falla con 42501 y B no recibe nada', async () => {
      const fila = await pagoNuevoDe(B);

      await expect(
        insertarPago('app', B.academiaId, fila, { contexto: { academiaId: A.academiaId } }),
      ).rejects.toMatchObject({ code: '42501' });

      expect(await leerPagos(B.academiaId)).toHaveLength(2);
    });

    it('criterio 3: en contexto de plataforma o sin contexto, un INSERT falla con 42501 (con la academia de A o de B)', async () => {
      for (const contexto of [{ plataforma: true }, {}] as const) {
        for (const d of [A, B]) {
          await expect(
            insertarPago('app', d.academiaId, await pagoNuevoDe(d), { contexto }),
            `${JSON.stringify(contexto)} en ${d.academiaId}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
      }
    });

    it('criterio 3: un INSERT de la propia academia en su contexto sí se acepta (control)', async () => {
      await insertarPago('app', A.academiaId, await pagoNuevoDe(A));

      expect(await leerPagos(A.academiaId)).toHaveLength(3);
    });
  });

  describe('UPDATE', () => {
    const RESOLVER: Columnas = {
      estado: 'RECHAZADO',
      verificado_en: '2026-11-11T14:50:00.000Z',
      motivo_rechazo: 'La imagen no se lee',
      actualizado_en: '2026-11-11T14:50:00.000Z',
    };

    it('criterio 3: un UPDATE que mueve un pago de A a B falla con 42501 y el pago sigue en A', async () => {
      await expect(
        actualizarPagos('app', A.academiaId, { id: A.pagoPendienteId }, { academia_id: B.academiaId }),
      ).rejects.toMatchObject({ code: '42501' });

      expect((await leerPagos(A.academiaId)).map((p) => p.id)).toContain(A.pagoPendienteId);
    });

    it('criterio 3: un UPDATE permitido sobre un pago de B desde el contexto de A no cambia ninguna fila (0 filas)', async () => {
      const filas = await actualizarPagos(
        'app',
        A.academiaId,
        { id: B.pagoPendienteId },
        { ...RESOLVER, verificado_por: A.adminId },
      );

      expect(filas).toBe(0);
      expect((await leerPagos(B.academiaId)).find((p) => p.id === B.pagoPendienteId)?.estado).toBe(
        'PENDIENTE_VERIFICACION',
      );
    });

    it('criterio 3: en contexto de plataforma o sin contexto, un UPDATE permitido no cambia ninguna fila (0 filas)', async () => {
      for (const contexto of [{ plataforma: true }, {}] as const) {
        expect(
          await actualizarPagos(
            'app',
            A.academiaId,
            { id: A.pagoPendienteId },
            { ...RESOLVER, verificado_por: A.adminId },
            { contexto },
          ),
          JSON.stringify(contexto),
        ).toBe(0);
      }
      expect((await leerPagos(A.academiaId)).find((p) => p.id === A.pagoPendienteId)?.estado).toBe(
        'PENDIENTE_VERIFICACION',
      );
    });
  });

  describe('llaves foráneas compuestas, aunque quien escriba sea el dueño de las tablas (23503)', () => {
    const comoDueno = (d: Datos, fila: Columnas) => insertarPago('propietario', d.academiaId, fila);

    it('criterio 3: un pago de A con la matrícula de B falla con 23503', async () => {
      const fila = await pagoNuevoDe(A, { matricula_id: B.matriculaPendienteId });

      await expect(comoDueno(A, fila)).rejects.toMatchObject({ code: '23503' });
    });

    it('criterio 3: un pago de A con el alumno de B falla con 23503', async () => {
      const fila = await pagoNuevoDe(A, { alumno_id: B.alumnoPendienteId });

      await expect(comoDueno(A, fila)).rejects.toMatchObject({ code: '23503' });
    });

    it('criterio 3: un pago de A con un registrado_por o un verificado_por de B falla con 23503', async () => {
      await expect(comoDueno(A, await pagoNuevoDe(A, { registrado_por: B.secretariaId }))).rejects.toMatchObject({
        code: '23503',
      });
      await expect(
        comoDueno(
          A,
          await pagoNuevoDe(A, {
            estado: 'RECHAZADO',
            verificado_por: B.secretariaId,
            verificado_en: new Date('2026-11-11T14:45:00.000Z'),
            motivo_rechazo: 'La imagen no se lee',
          }),
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('criterio 3: un pago cuya matrícula es de otro alumno de la misma academia falla con 23503 (la matrícula va junto con el alumno)', async () => {
      const otroAlumno = await crearAlumnoSolo(A.academiaId);
      const apoyo = await crearMatriculaDeApoyo(A.academiaId, otroAlumno);
      const fila = filaPagoValida(A.academiaId, { alumnoId: A.alumnoPendienteId, matriculaId: apoyo.matriculaId });

      await expect(comoDueno(A, fila)).rejects.toMatchObject({ code: '23503' });
    });

    it('criterio 3: un movimiento de caja de A con el pago_id de un pago de B falla con 23503 al confirmar la transacción y no queda nada', async () => {
      const alumno = await crearAlumnoSolo(A.academiaId);
      const fila = filaIngresoValida(A.cajaId, A.secretariaId, alumno, 50, { pago_id: B.pagoConfirmadoId });
      const { sql, valores } = sqlDeInsercionCaja('movimientos_caja', A.academiaId, fila);

      await expect(
        ejecutarTransaccion('propietario', { academiaId: A.academiaId }, [{ sql, valores }]),
      ).rejects.toMatchObject({ code: '23503' });

      const { rows } = await ejecutarComo(
        'propietario',
        'SELECT count(*)::int AS n FROM movimientos_caja WHERE academia_id = $1::uuid AND pago_id = $2::uuid',
        [A.academiaId, B.pagoConfirmadoId],
        { academiaId: A.academiaId },
      );
      expect((rows[0] as { n: number }).n).toBe(0);
    });

    it('criterio 3: un movimiento de caja con el pago_id de un pago que no existe falla con 23503 al confirmar la transacción', async () => {
      const alumno = await crearAlumnoSolo(A.academiaId);
      const fila = filaIngresoValida(A.cajaId, A.secretariaId, alumno, 50, { pago_id: randomUUID() });
      const { sql, valores } = sqlDeInsercionCaja('movimientos_caja', A.academiaId, fila);

      await expect(
        ejecutarTransaccion('propietario', { academiaId: A.academiaId }, [{ sql, valores }]),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('criterio 3: con matrícula, alumno y usuarios de la propia academia el mismo pago se acepta (control)', async () => {
      await comoDueno(A, await pagoNuevoDe(A, { registrado_por: A.secretariaId }));

      expect(await leerPagos(A.academiaId)).toHaveLength(3);
    });
  });
});
