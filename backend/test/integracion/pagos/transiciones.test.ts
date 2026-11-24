// spec: 007-pagos (pruebas protegidas)
import { beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { crearCajaDePrueba } from '../../utilidades/caja';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import { sembrarSolicitud } from '../../utilidades/inscripciones';
import {
  actualizarPagos,
  type Columnas,
  crearPagoConfirmadoConMovimiento,
  filaPagoValida,
  insertarPago,
  leerPagos,
  T_VERIFICACION,
} from '../../utilidades/pagos';

// Criterio 6 (crítico, HU-09, RN-22; «aprobar un pago rechazado» de `CLAUDE.md`): un trigger `BEFORE UPDATE` en `pagos` solo admite pasar de
// `PENDIENTE_VERIFICACION` a `CONFIRMADO` o a `RECHAZADO`, una vez. Falla con 23514, como app y como dueño: aprobar un `RECHAZADO`, rechazar un `CONFIRMADO`,
// volver a `PENDIENTE_VERIFICACION`, y cambiar cualquier columna de un pago resuelto (también `motivo_rechazo`, `verificado_por` o `numero_ticket`). Un
// `UPDATE` que no cambia nada de un pago resuelto también falla. Un pago pendiente sí puede resolverse (control).

const ROLES = ['propietario', 'app'] as const;

describe.each(ROLES)('criterio 6: un pago resuelto no cambia, como %s', (rol) => {
  let e: EscenarioPagos;
  let cajaId: string;
  let ticket = 5000;

  beforeAll(async () => {
    e = await crearEscenarioDePagos();
    cajaId = (await crearCajaDePrueba(e.A.id, e.secretariaA.id)).id;
  });

  async function clienteNuevo() {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], monto: '42.00' });
    return { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId };
  }

  async function pagoPendiente(): Promise<string> {
    const c = await clienteNuevo();
    const fila = filaPagoValida(e.A.id, { alumnoId: c.alumnoId, matriculaId: c.matriculaId });
    await insertarPago(rol, e.A.id, fila);
    return fila['id'] as string;
  }

  async function pagoRechazado(): Promise<string> {
    const c = await clienteNuevo();
    const fila = filaPagoValida(
      e.A.id,
      { alumnoId: c.alumnoId, matriculaId: c.matriculaId, usuarioId: e.secretariaA.id },
      { estado: 'RECHAZADO' },
    );
    await insertarPago(rol, e.A.id, fila);
    return fila['id'] as string;
  }

  async function pagoConfirmado(): Promise<string> {
    const c = await clienteNuevo();
    ticket += 1;
    const { pagoId } = await crearPagoConfirmadoConMovimiento(e.A.id, {
      cajaId,
      alumnoId: c.alumnoId,
      matriculaId: c.matriculaId,
      usuarioId: e.secretariaA.id,
      numeroTicket: ticket,
    });
    return pagoId;
  }

  const leer = async (id: string) => (await leerPagos(e.A.id)).find((p) => p.id === id);
  const actualizar = (id: string, cambios: Columnas) => actualizarPagos(rol, e.A.id, { id }, cambios);

  /** El `UPDATE` falla con 23514 y la fila queda exactamente como estaba. */
  async function noCambia(id: string, cambios: Columnas): Promise<void> {
    const antes = await leer(id);

    await expect(actualizar(id, cambios)).rejects.toMatchObject({ code: '23514' });

    expect(await leer(id)).toEqual(antes);
  }

  describe('lo que se acepta: un pago pendiente se resuelve una vez', () => {
    it('criterio 6: PENDIENTE_VERIFICACION pasa a RECHAZADO con quién, cuándo y el motivo', async () => {
      const id = await pagoPendiente();

      const filas = await actualizar(id, {
        estado: 'RECHAZADO',
        verificado_por: e.secretariaA.id,
        verificado_en: T_VERIFICACION,
        motivo_rechazo: 'La imagen no se lee',
        actualizado_en: T_VERIFICACION,
      });

      expect(filas).toBe(1);
      expect(await leer(id)).toMatchObject({ estado: 'RECHAZADO', motivo_rechazo: 'La imagen no se lee' });
    });
  });

  describe('lo que falla con 23514 y deja la fila como estaba', () => {
    it('criterio 6: aprobar un RECHAZADO', async () => {
      const id = await pagoRechazado();

      await noCambia(id, {
        estado: 'CONFIRMADO',
        verificado_por: e.secretariaA.id,
        verificado_en: T_VERIFICACION,
        motivo_rechazo: null,
        numero_ticket: 6000,
      });
    });

    it('criterio 6: rechazar un CONFIRMADO', async () => {
      const id = await pagoConfirmado();

      await noCambia(id, {
        estado: 'RECHAZADO',
        verificado_por: e.secretariaA.id,
        verificado_en: T_VERIFICACION,
        motivo_rechazo: 'Se confirmó por error',
        numero_ticket: null,
      });
    });

    it.each([
      ['un RECHAZADO', pagoRechazado],
      ['un CONFIRMADO', pagoConfirmado],
    ])('criterio 6: volver %s a PENDIENTE_VERIFICACION', async (_nombre, crear) => {
      const id = await crear();

      await noCambia(id, {
        estado: 'PENDIENTE_VERIFICACION',
        verificado_por: null,
        verificado_en: null,
        motivo_rechazo: null,
        numero_ticket: null,
      });
    });

    it('criterio 6: cambiar el motivo de un RECHAZADO (rechazarlo otra vez con otro motivo)', async () => {
      const id = await pagoRechazado();

      await noCambia(id, { motivo_rechazo: 'Otro motivo' });
    });

    it('criterio 6: cambiar quién verificó un RECHAZADO o un CONFIRMADO', async () => {
      const rechazado = await pagoRechazado();
      const confirmado = await pagoConfirmado();

      await noCambia(rechazado, { verificado_por: e.adminA.id });
      await noCambia(confirmado, { verificado_por: e.adminA.id });
    });

    it('criterio 6: cambiar el número de ticket de un CONFIRMADO', async () => {
      const id = await pagoConfirmado();

      await noCambia(id, { numero_ticket: 9999 });
    });

    it('criterio 6: cambiar solo actualizado_en de un pago resuelto', async () => {
      const rechazado = await pagoRechazado();
      const confirmado = await pagoConfirmado();

      await noCambia(rechazado, { actualizado_en: new Date('2026-11-12T10:00:00.000Z') });
      await noCambia(confirmado, { actualizado_en: new Date('2026-11-12T10:00:00.000Z') });
    });

    it('criterio 6: un UPDATE que no cambia nada de un pago resuelto también falla (estado = estado)', async () => {
      const rechazado = await pagoRechazado();
      const confirmado = await pagoConfirmado();
      const antes = [await leer(rechazado), await leer(confirmado)];

      for (const id of [rechazado, confirmado]) {
        await expect(
          ejecutarComo(rol, 'UPDATE pagos SET estado = estado WHERE id = $1::uuid', [id], { academiaId: e.A.id }),
        ).rejects.toMatchObject({ code: '23514' });
      }

      expect([await leer(rechazado), await leer(confirmado)]).toEqual(antes);
    });

    it('criterio 6: un pago pendiente no admite quedarse pendiente (solo pasa a CONFIRMADO o a RECHAZADO): un UPDATE a PENDIENTE_VERIFICACION falla', async () => {
      const id = await pagoPendiente();

      await noCambia(id, { estado: 'PENDIENTE_VERIFICACION', actualizado_en: new Date('2026-11-12T10:00:00.000Z') });
    });

    it('criterio 6: un pago rechazado una vez no se puede rechazar de nuevo ni resolver otra vez después de otro intento fallido', async () => {
      const id = await pagoRechazado();
      await expect(actualizar(id, { estado: 'RECHAZADO', motivo_rechazo: 'Otra vez' })).rejects.toMatchObject({
        code: '23514',
      });

      await noCambia(id, { estado: 'CONFIRMADO', numero_ticket: 6001, motivo_rechazo: null });
    });
  });

  if (rol === 'propietario') {
    describe('el dueño de las tablas tampoco puede cambiar un pago resuelto', () => {
      it.each([
        ['el monto', { monto: '1.00' }],
        ['el método', { metodo: 'TRANSFERENCIA' }],
        ['el número de operación', { numero_operacion: '1', numero_operacion_normalizado: '1' }],
        ['el comprobante', { comprobante_clave: 'otro.jpg' }],
        ['la clave de idempotencia', { clave_idempotencia: 'a2f4cc4e-4d62-4a64-8d27-35c1f2f4b0aa' }],
      ])('criterio 6: cambiar %s de un RECHAZADO falla con 23514', async (_nombre, cambios) => {
        const id = await pagoRechazado();

        await noCambia(id, cambios);
      });

      it('criterio 6: cambiar el monto de un CONFIRMADO falla con 23514 (también con su movimiento)', async () => {
        const id = await pagoConfirmado();

        await noCambia(id, { monto: '1.00' });
      });
    });
  }
});
