// spec: 007-pagos (pruebas protegidas)
import { beforeAll, describe, expect, it } from 'vitest';
import {
  crearCajaDePrueba,
  filaEgresoValida,
  filaIngresoValida,
  leerMovimientos,
  sqlDeInsercionCaja,
} from '../../utilidades/caja';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import { crearAlumnoSolo, sembrarSolicitud } from '../../utilidades/inscripciones';
import {
  type Columnas,
  ejecutarTransaccion,
  filaPagoValida,
  insertarPago,
  leerPagos,
  type MetodoDePago,
  sqlInsertarPago,
  T_VERIFICACION,
} from '../../utilidades/pagos';

// Criterio 5 (crítico, D-04, RN-17; «no queda un pago confirmado sin su movimiento» de la 006): al confirmar la transacción, cada pago `CONFIRMADO` tiene
// exactamente un movimiento de caja `INGRESO` con su `pago_id`, del mismo alumno, método, monto y con el concepto del pago; y cada movimiento con `pago_id`
// apunta a un pago `CONFIRMADO`. Lo garantiza un trigger de restricción diferido (`DEFERRABLE INITIALLY DEFERRED`) en `pagos` y en `movimientos_caja`: una
// transacción, como app o como dueño, que deja un pago `CONFIRMADO` sin movimiento, con un movimiento de otro monto o método, o un movimiento con el `pago_id`
// de un pago pendiente o rechazado, falla en el `COMMIT` con 23514 y no queda nada. Dentro de la transacción, el orden de las escrituras es libre.

const ROLES = ['propietario', 'app'] as const;

describe.each(ROLES)('criterio 5: un pago confirmado y su movimiento de caja, como %s', (rol) => {
  let e: EscenarioPagos;
  let cajaId: string;
  let numeroDeMovimiento = 0;

  beforeAll(async () => {
    e = await crearEscenarioDePagos();
    cajaId = (await crearCajaDePrueba(e.A.id, e.secretariaA.id)).id;
  });

  async function clienteNuevo() {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], monto: '42.00' });
    return { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId };
  }

  /** El pago `CONFIRMADO` de efectivo (por defecto) de un cliente, listo para insertar. */
  function pagoConfirmado(
    c: { alumnoId: string; matriculaId: string },
    sobre: Columnas = {},
    metodo: MetodoDePago = 'EFECTIVO',
  ): Columnas {
    return filaPagoValida(
      e.A.id,
      { alumnoId: c.alumnoId, matriculaId: c.matriculaId, usuarioId: e.secretariaA.id },
      { metodo, estado: 'CONFIRMADO', numeroTicket: 1000 + (numeroDeMovimiento += 1) },
      sobre,
    );
  }

  /** El movimiento de ingreso de ese pago (con el alumno, método, monto y concepto del pago, salvo lo que `sobre` cambie). */
  function movimientoDe(pago: Columnas, sobre: Columnas = {}): Columnas {
    numeroDeMovimiento += 1;
    return filaIngresoValida(cajaId, e.secretariaA.id, pago['alumno_id'] as string, 1000 + numeroDeMovimiento, {
      pago_id: pago['id'],
      metodo: pago['metodo'],
      monto: pago['monto'],
      concepto: pago['concepto'],
      ...sobre,
    });
  }

  const pasoPago = (pago: Columnas) => {
    const { sql, valores } = sqlInsertarPago(e.A.id, pago);
    return { sql, valores };
  };
  const pasoMovimiento = (movimiento: Columnas) => {
    const { sql, valores } = sqlDeInsercionCaja('movimientos_caja', e.A.id, movimiento);
    return { sql, valores };
  };
  const transaccion = (pasos: { sql: string; valores?: unknown[] }[]) =>
    ejecutarTransaccion(rol, { academiaId: e.A.id }, pasos);

  /** Cuántas filas de `pagos` y de `movimientos_caja` tiene A. */
  const conteo = async () => ({
    pagos: (await leerPagos(e.A.id)).length,
    movimientos: (await leerMovimientos(e.A.id)).length,
  });

  describe('lo que se acepta', () => {
    it.each([
      ['el pago y después el movimiento', 'pago-primero'],
      ['el movimiento y después el pago', 'movimiento-primero'],
    ])(
      'criterio 5: %s, en la misma transacción, se aceptan (el orden de las escrituras es libre)',
      async (_nombre, orden) => {
        const c = await clienteNuevo();
        const pago = pagoConfirmado(c);
        const pasos = [pasoPago(pago), pasoMovimiento(movimientoDe(pago))];

        await transaccion(orden === 'pago-primero' ? pasos : pasos.reverse());

        expect((await leerPagos(e.A.id)).find((p) => p.id === pago['id'])?.estado).toBe('CONFIRMADO');
        expect((await leerMovimientos(e.A.id)).filter((m) => m.pago_id === pago['id'])).toHaveLength(1);
      },
    );

    it.each(['YAPE', 'TRANSFERENCIA'] as const)(
      'criterio 5: un pago confirmado por %s con su movimiento del mismo método se acepta',
      async (metodo) => {
        const c = await clienteNuevo();
        const pago = pagoConfirmado(c, {}, metodo);

        await transaccion([pasoPago(pago), pasoMovimiento(movimientoDe(pago))]);

        expect((await leerMovimientos(e.A.id)).find((m) => m.pago_id === pago['id'])?.metodo).toBe(metodo);
      },
    );

    it('criterio 5: un pago pendiente que pasa a CONFIRMADO en la misma transacción que inserta su movimiento se acepta (la aprobación de la 007b)', async () => {
      const c = await clienteNuevo();
      const pendiente = filaPagoValida(e.A.id, { alumnoId: c.alumnoId, matriculaId: c.matriculaId });
      await insertarPago(rol, e.A.id, pendiente);
      const movimiento = movimientoDe({ ...pendiente, estado: 'CONFIRMADO' });

      await transaccion([
        {
          sql: `UPDATE pagos SET estado = 'CONFIRMADO', verificado_por = $2::uuid, verificado_en = $3::timestamptz, numero_ticket = $4::int
                 WHERE id = $1::uuid`,
          valores: [pendiente['id'], e.secretariaA.id, T_VERIFICACION.toISOString(), 3000 + numeroDeMovimiento],
        },
        pasoMovimiento(movimiento),
      ]);

      expect((await leerPagos(e.A.id)).find((p) => p.id === pendiente['id'])?.estado).toBe('CONFIRMADO');
    });

    it('criterio 5: un egreso (sin pago) se sigue aceptando y no necesita pago (control)', async () => {
      numeroDeMovimiento += 1;
      const egreso = filaEgresoValida(cajaId, e.secretariaA.id, 1000 + numeroDeMovimiento);

      await transaccion([pasoMovimiento(egreso)]);

      expect((await leerMovimientos(e.A.id)).some((m) => m.id === egreso['id'])).toBe(true);
    });
  });

  describe('lo que falla en el COMMIT con 23514 y no deja nada', () => {
    it('criterio 5: un pago CONFIRMADO sin movimiento', async () => {
      const c = await clienteNuevo();
      const antes = await conteo();

      await expect(transaccion([pasoPago(pagoConfirmado(c))])).rejects.toMatchObject({ code: '23514' });

      expect(await conteo()).toEqual(antes);
    });

    it.each([
      ['de otro monto', { monto: '41.00' }],
      ['de otro método', { metodo: 'YAPE' }],
      ['de otro concepto', { concepto: 'MENSUALIDAD' }],
    ])('criterio 5: un pago CONFIRMADO con un movimiento %s', async (_nombre, sobre) => {
      const c = await clienteNuevo();
      const pago = pagoConfirmado(c);
      const antes = await conteo();

      await expect(transaccion([pasoPago(pago), pasoMovimiento(movimientoDe(pago, sobre))])).rejects.toMatchObject({
        code: '23514',
      });

      expect(await conteo()).toEqual(antes);
    });

    it('criterio 5: un pago CONFIRMADO con el movimiento de otro alumno de la misma academia', async () => {
      const c = await clienteNuevo();
      const otro = await crearAlumnoSolo(e.A.id);
      const pago = pagoConfirmado(c);
      const antes = await conteo();

      await expect(
        transaccion([pasoPago(pago), pasoMovimiento(movimientoDe(pago, { alumno_id: otro }))]),
      ).rejects.toMatchObject({ code: '23514' });

      expect(await conteo()).toEqual(antes);
    });

    it.each([
      ['pendiente de verificación', 'PENDIENTE_VERIFICACION'],
      ['rechazado', 'RECHAZADO'],
    ] as const)('criterio 5: un movimiento con el pago_id de un pago %s', async (_nombre, estado) => {
      const c = await clienteNuevo();
      const resuelto = filaPagoValida(
        e.A.id,
        { alumnoId: c.alumnoId, matriculaId: c.matriculaId, usuarioId: e.secretariaA.id },
        { estado },
      );
      await insertarPago(rol, e.A.id, resuelto);
      const antes = await conteo();

      await expect(transaccion([pasoMovimiento(movimientoDe(resuelto))])).rejects.toMatchObject({ code: '23514' });

      expect(await conteo()).toEqual(antes);
      expect((await leerPagos(e.A.id)).find((p) => p.id === resuelto['id'])?.estado).toBe(estado);
    });

    it('criterio 5: un pago pendiente que pasa a CONFIRMADO sin movimiento: la transacción falla y el pago sigue pendiente', async () => {
      const c = await clienteNuevo();
      const pendiente = filaPagoValida(e.A.id, { alumnoId: c.alumnoId, matriculaId: c.matriculaId });
      await insertarPago(rol, e.A.id, pendiente);

      await expect(
        transaccion([
          {
            sql: `UPDATE pagos SET estado = 'CONFIRMADO', verificado_por = $2::uuid, verificado_en = $3::timestamptz, numero_ticket = $4::int
                   WHERE id = $1::uuid`,
            valores: [pendiente['id'], e.secretariaA.id, T_VERIFICACION.toISOString(), 4000 + numeroDeMovimiento],
          },
        ]),
      ).rejects.toMatchObject({ code: '23514' });

      expect((await leerPagos(e.A.id)).find((p) => p.id === pendiente['id'])?.estado).toBe('PENDIENTE_VERIFICACION');
    });

    it('criterio 5 y 5 de 006: un segundo movimiento para el mismo pago falla con 23505 (un pago entra una sola vez a la caja) y no deja nada', async () => {
      const c = await clienteNuevo();
      const pago = pagoConfirmado(c);
      await transaccion([pasoPago(pago), pasoMovimiento(movimientoDe(pago))]);
      const antes = await conteo();

      await expect(transaccion([pasoMovimiento(movimientoDe(pago))])).rejects.toMatchObject({ code: '23505' });

      expect(await conteo()).toEqual(antes);
    });
  });

  describe('lo que falla por su cuenta, también sin el trigger', () => {
    it('criterio 5 y 3: un movimiento con un pago_id que no existe falla con 23503 en el COMMIT', async () => {
      const c = await clienteNuevo();
      const falso = pagoConfirmado(c);

      await expect(transaccion([pasoMovimiento(movimientoDe(falso))])).rejects.toMatchObject({ code: '23503' });
    });

    it('criterio 5: dos pagos confirmados con sus dos movimientos en la misma transacción se aceptan (control)', async () => {
      const uno = await clienteNuevo();
      const dos = await clienteNuevo();
      const pagoUno = pagoConfirmado(uno);
      const pagoDos = pagoConfirmado(dos);

      await transaccion([
        pasoPago(pagoUno),
        pasoMovimiento(movimientoDe(pagoUno)),
        pasoPago(pagoDos),
        pasoMovimiento(movimientoDe(pagoDos)),
      ]);

      const ids = (await leerMovimientos(e.A.id)).map((m) => m.pago_id);
      expect(ids).toEqual(expect.arrayContaining([pagoUno['id'], pagoDos['id']]));
    });
  });
});
