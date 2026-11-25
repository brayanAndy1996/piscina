// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  crearCajaDePrueba,
  filaEgresoValida,
  filaIngresoValida,
  leerMovimientos,
  sqlDeInsercionCaja,
} from '../../utilidades/caja';
import {
  abrirCajaDeHoy,
  AHORA_007,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  pagoDe,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  crearAlumnoSolo,
  crearAppInscripciones,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';
import {
  type Columnas,
  crearMatriculaDeApoyo,
  ejecutarTransaccion,
  filaPagoValida,
  insertarPago,
  leerPagos,
  type MetodoDePago,
  type Paso,
  sqlInsertarPago,
  T_VERIFICACION,
} from '../../utilidades/pagos';

// Criterio 58 (crítico, ronda adversarial 1 de la 007a; D-04, RN-17, D-23; amplía los criterios 3 y 5): ningún movimiento de caja con un pago que no está
// confirmado, en ningún orden ni contexto. Al confirmar la transacción, como app o como dueño de las tablas, todo movimiento con `pago_id` exige que ese pago
// exista en la misma academia, esté `CONFIRMADO` y coincida (movimiento `INGRESO` del mismo alumno, método, monto y concepto), y un pago que tiene un movimiento
// no puede quedar en otro estado. Si no se cumple, la transacción falla con `23514` y no queda nada de ella (ni el pago, ni el movimiento, ni otra escritura). Una
// comprobación que no puede ver el pago o el movimiento relacionado rechaza; nunca da por buena la transacción por no verlo.
//   a) cualquier orden de las escrituras (pago pendiente y movimiento en los dos órdenes; pendiente, movimiento y paso a `RECHAZADO`; un movimiento para un
//      pago pendiente o rechazado ya guardado);
//   b) con `SET CONSTRAINTS pagos_confirmado_con_movimiento IMMEDIATE`: el movimiento con un `pago_id` que todavía no existe y después el pago pendiente fallan
//      con `23514` (en el `INSERT` o en el `COMMIT`); con `SET CONSTRAINTS ALL IMMEDIATE`, con `23514` o `23503`; el cobro en efectivo con el movimiento antes que
//      su pago también falla (es aceptable: la API nunca cambia el modo);
//   c) aunque cambie el contexto de la academia antes del `COMMIT` (`''` o la academia B), con un pago pendiente y con un pago `CONFIRMADO` con un movimiento
//      que no coincide;
//   d) escrituras del dueño sobre el movimiento de un pago `CONFIRMADO` (el `UPDATE` de su `pago_id`, tipo, alumno, método, monto o concepto, y el `DELETE`):
//      fallan con `23514` y no dejan nada;
//   e) controles que se siguen aceptando: pago `CONFIRMADO` con su movimiento correcto en los dos órdenes, pendiente que pasa a `CONFIRMADO` junto con su
//      movimiento, egreso sin `pago_id` y el cobro en efectivo por la API (criterio 13); un `pago_id` que no existe en el modo diferido sigue dando `23503`.
// En cada caso se comprueba el código y, con otra conexión, que no quedó nada y que lo anterior sigue igual.

const ROLES = ['app', 'propietario'] as const;

describe.each(ROLES)('criterio 58: ningún movimiento de caja con un pago no confirmado, como %s', (rol) => {
  let e: EscenarioPagos;
  let cajaId: string;
  let numero = 0;

  beforeAll(async () => {
    e = await crearEscenarioDePagos();
    cajaId = (await crearCajaDePrueba(e.A.id, e.secretariaA.id)).id;
  });

  async function clienteNuevo() {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], monto: '42.00' });
    return { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId };
  }

  /** Un pago de Yape (o el método indicado) `PENDIENTE_VERIFICACION` de S/ 42.00, sin insertar. */
  function pagoPendiente(c: { alumnoId: string; matriculaId: string }, metodo: MetodoDePago = 'YAPE'): Columnas {
    return filaPagoValida(e.A.id, { alumnoId: c.alumnoId, matriculaId: c.matriculaId }, { metodo });
  }

  /** Un pago `CONFIRMADO` de efectivo (o el método indicado), sin insertar. */
  function pagoConfirmado(c: { alumnoId: string; matriculaId: string }, metodo: MetodoDePago = 'EFECTIVO'): Columnas {
    numero += 1;
    return filaPagoValida(
      e.A.id,
      { alumnoId: c.alumnoId, matriculaId: c.matriculaId, usuarioId: e.secretariaA.id },
      { metodo, estado: 'CONFIRMADO', numeroTicket: 1000 + numero },
    );
  }

  /** El movimiento de ingreso de ese pago (alumno, método, monto y concepto del pago, salvo lo que `sobre` cambie). */
  function movimientoDe(pago: Columnas, sobre: Columnas = {}): Columnas {
    numero += 1;
    return filaIngresoValida(cajaId, e.secretariaA.id, pago['alumno_id'] as string, 1000 + numero, {
      pago_id: pago['id'],
      metodo: pago['metodo'],
      monto: pago['monto'],
      concepto: pago['concepto'],
      ...sobre,
    });
  }

  const pasoPago = (pago: Columnas): Paso => sqlInsertarPago(e.A.id, pago);
  const pasoMovimiento = (movimiento: Columnas): Paso => sqlDeInsercionCaja('movimientos_caja', e.A.id, movimiento);
  const pasoContexto = (valor: string): Paso => ({
    sql: "SELECT set_config('app.academia_id', $1, true)",
    valores: [valor],
  });
  const pasoRechazar = (pagoId: string): Paso => ({
    sql: `UPDATE pagos SET estado = 'RECHAZADO', verificado_por = $2::uuid, verificado_en = $3::timestamptz, motivo_rechazo = 'La imagen no se lee'
           WHERE id = $1::uuid`,
    valores: [pagoId, e.secretariaA.id, T_VERIFICACION.toISOString()],
  });
  const pasoConfirmar = (pagoId: string): Paso => {
    numero += 1;
    return {
      sql: `UPDATE pagos SET estado = 'CONFIRMADO', verificado_por = $2::uuid, verificado_en = $3::timestamptz, numero_ticket = $4::int
             WHERE id = $1::uuid`,
      valores: [pagoId, e.secretariaA.id, T_VERIFICACION.toISOString(), 3000 + numero],
    };
  };
  const SET_NOMBRADO: Paso = { sql: 'SET CONSTRAINTS pagos_confirmado_con_movimiento IMMEDIATE' };
  const SET_TODAS: Paso = { sql: 'SET CONSTRAINTS ALL IMMEDIATE' };

  const transaccion = (pasos: Paso[]) => ejecutarTransaccion(rol, { academiaId: e.A.id }, pasos);

  /** Todo lo que hay en `pagos` y `movimientos_caja` de A, leído con otra conexión y el contexto de A. */
  const instantanea = async () =>
    JSON.stringify({ pagos: await leerPagos(e.A.id), movimientos: await leerMovimientos(e.A.id) });

  /** La transacción falla con uno de los códigos y no cambia nada de lo que había. */
  async function debeFallar(pasos: Paso[], codigos: string[] = ['23514']): Promise<void> {
    const antes = await instantanea();
    const error: unknown = await transaccion(pasos).then(
      () => null,
      (fallo: unknown) => fallo,
    );
    expect(error, `la transacción se confirmó y debía fallar con ${codigos.join(' o ')}`).not.toBeNull();
    expect(codigos).toContain((error as { code?: string }).code);
    expect(await instantanea()).toBe(antes);
  }

  /** La transacción se confirma. */
  async function debeAceptarse(pasos: Paso[]): Promise<void> {
    await expect(transaccion(pasos)).resolves.toBeUndefined();
  }

  describe('a) cualquier orden de las escrituras', () => {
    it('criterio 58 a: el pago pendiente y después su movimiento, en la misma transacción, fallan con 23514', async () => {
      const pago = pagoPendiente(await clienteNuevo());

      await debeFallar([pasoPago(pago), pasoMovimiento(movimientoDe(pago))]);
    });

    it('criterio 58 a: el movimiento y después el pago pendiente, en la misma transacción, fallan con 23514', async () => {
      const pago = pagoPendiente(await clienteNuevo());

      await debeFallar([pasoMovimiento(movimientoDe(pago)), pasoPago(pago)]);
    });

    it('criterio 58 a: el pago pendiente, su movimiento y el paso del pago a RECHAZADO antes del COMMIT fallan con 23514', async () => {
      const pago = pagoPendiente(await clienteNuevo());

      await debeFallar([pasoPago(pago), pasoMovimiento(movimientoDe(pago)), pasoRechazar(pago['id'] as string)]);
    });

    it.each([
      ['pendiente de verificación', 'PENDIENTE_VERIFICACION'],
      ['rechazado', 'RECHAZADO'],
    ] as const)(
      'criterio 58 a: un movimiento con el pago_id de un pago %s ya guardado falla con 23514',
      async (_nombre, estado) => {
        const c = await clienteNuevo();
        const guardado = filaPagoValida(
          e.A.id,
          { alumnoId: c.alumnoId, matriculaId: c.matriculaId, usuarioId: e.secretariaA.id },
          { estado },
        );
        await insertarPago(rol, e.A.id, guardado);

        await debeFallar([pasoMovimiento(movimientoDe(guardado))]);

        expect((await leerPagos(e.A.id)).find((p) => p.id === guardado['id'])?.estado).toBe(estado);
      },
    );
  });

  describe('b) con el modo IMMEDIATE', () => {
    it('criterio 58 b: SET CONSTRAINTS pagos_confirmado_con_movimiento IMMEDIATE, el movimiento con un pago_id que todavía no existe y después el pago pendiente: 23514 y no queda nada', async () => {
      const pago = pagoPendiente(await clienteNuevo());

      await debeFallar([SET_NOMBRADO, pasoMovimiento(movimientoDe(pago)), pasoPago(pago)]);
    });

    it('criterio 58 b: con el modo IMMEDIATE, el pago pendiente y después su movimiento también fallan con 23514', async () => {
      const pago = pagoPendiente(await clienteNuevo());

      await debeFallar([SET_NOMBRADO, pasoPago(pago), pasoMovimiento(movimientoDe(pago))]);
    });

    it('criterio 58 b: SET CONSTRAINTS ALL IMMEDIATE, el movimiento con un pago_id que todavía no existe y después el pago pendiente: 23514 o 23503 y no queda nada', async () => {
      const pago = pagoPendiente(await clienteNuevo());

      await debeFallar([SET_TODAS, pasoMovimiento(movimientoDe(pago)), pasoPago(pago)], ['23514', '23503']);
    });

    it('criterio 58 b: con el modo IMMEDIATE falla también el orden del cobro en efectivo (el movimiento antes que su pago CONFIRMADO): 23514', async () => {
      const pago = pagoConfirmado(await clienteNuevo());

      await debeFallar([SET_NOMBRADO, pasoMovimiento(movimientoDe(pago)), pasoPago(pago)]);
    });

    it('criterio 58 b: con SET CONSTRAINTS ALL IMMEDIATE falla también el orden del cobro en efectivo: 23514 o 23503', async () => {
      const pago = pagoConfirmado(await clienteNuevo());

      await debeFallar([SET_TODAS, pasoMovimiento(movimientoDe(pago)), pasoPago(pago)], ['23514', '23503']);
    });
  });

  describe('c) aunque cambie el contexto de la academia antes del COMMIT', () => {
    it.each([
      ['vacío', () => ''],
      ['el de la academia B', () => e.B.id],
    ])(
      'criterio 58 c: el pago pendiente y su movimiento en el orden normal y, antes del COMMIT, el contexto %s: 23514 y no queda nada',
      async (_nombre, contexto) => {
        const pago = pagoPendiente(await clienteNuevo());

        await debeFallar([pasoPago(pago), pasoMovimiento(movimientoDe(pago)), pasoContexto(contexto())]);
      },
    );

    it.each([
      ['vacío', () => ''],
      ['el de la academia B', () => e.B.id],
    ])(
      'criterio 58 c: el movimiento antes que el pago pendiente y, antes del COMMIT, el contexto %s: 23514 y no queda nada',
      async (_nombre, contexto) => {
        const pago = pagoPendiente(await clienteNuevo());

        await debeFallar([pasoMovimiento(movimientoDe(pago)), pasoPago(pago), pasoContexto(contexto())]);
      },
    );

    it.each([
      ['de otro monto', { monto: '41.00' }],
      ['de otro método', { metodo: 'YAPE' }],
    ])(
      'criterio 58 c: un pago CONFIRMADO con un movimiento %s y el contexto vacío antes del COMMIT: 23514 y no queda nada',
      async (_nombre, sobre) => {
        const pago = pagoConfirmado(await clienteNuevo());

        await debeFallar([pasoPago(pago), pasoMovimiento(movimientoDe(pago, sobre)), pasoContexto('')]);
      },
    );

    it.each([
      ['de otro monto', { monto: '41.00' }],
      ['de otro método', { metodo: 'YAPE' }],
    ])(
      'criterio 58 c: un pago CONFIRMADO con un movimiento %s y el contexto de la academia B antes del COMMIT: 23514 y no queda nada',
      async (_nombre, sobre) => {
        const pago = pagoConfirmado(await clienteNuevo());

        await debeFallar([pasoPago(pago), pasoMovimiento(movimientoDe(pago, sobre)), pasoContexto(e.B.id)]);
      },
    );

    it('criterio 58 c: un movimiento con el pago_id de un pago pendiente ya guardado y el contexto vacío antes del COMMIT: 23514 y no queda nada', async () => {
      const c = await clienteNuevo();
      const guardado = pagoPendiente(c);
      await insertarPago(rol, e.A.id, guardado);

      await debeFallar([pasoMovimiento(movimientoDe(guardado)), pasoContexto('')]);
    });
  });

  describe('e) controles: lo que se sigue aceptando', () => {
    it.each([
      ['el pago y después el movimiento', 'pago-primero'],
      ['el movimiento y después el pago', 'movimiento-primero'],
    ])(
      'criterio 58 e: un pago CONFIRMADO con su movimiento correcto, %s, con el contexto sin cambios',
      async (_nombre, orden) => {
        const pago = pagoConfirmado(await clienteNuevo());
        const pasos = [pasoPago(pago), pasoMovimiento(movimientoDe(pago))];

        await debeAceptarse(orden === 'pago-primero' ? pasos : pasos.reverse());

        expect((await leerPagos(e.A.id)).find((p) => p.id === pago['id'])?.estado).toBe('CONFIRMADO');
        expect((await leerMovimientos(e.A.id)).filter((m) => m.pago_id === pago['id'])).toHaveLength(1);
      },
    );

    it.each([
      ['la actualización y después el movimiento', 'pago-primero'],
      ['el movimiento y después la actualización', 'movimiento-primero'],
    ])(
      'criterio 58 e: un pago pendiente que pasa a CONFIRMADO en la misma transacción que inserta su movimiento (la aprobación de la 007b), %s',
      async (_nombre, orden) => {
        const pendiente = pagoPendiente(await clienteNuevo());
        await insertarPago(rol, e.A.id, pendiente);
        const movimiento = movimientoDe(pendiente);
        const pasos = [pasoConfirmar(pendiente['id'] as string), pasoMovimiento(movimiento)];

        await debeAceptarse(orden === 'pago-primero' ? pasos : pasos.reverse());

        expect((await leerPagos(e.A.id)).find((p) => p.id === pendiente['id'])?.estado).toBe('CONFIRMADO');
        expect((await leerMovimientos(e.A.id)).some((m) => m.id === movimiento['id'])).toBe(true);
      },
    );

    it('criterio 58 e: un pago pendiente sin movimiento se acepta, también con el modo IMMEDIATE', async () => {
      const pago = pagoPendiente(await clienteNuevo());

      await debeAceptarse([SET_NOMBRADO, pasoPago(pago)]);

      expect((await leerPagos(e.A.id)).find((p) => p.id === pago['id'])?.estado).toBe('PENDIENTE_VERIFICACION');
    });

    it('criterio 58 e: un egreso (sin pago_id) se sigue aceptando', async () => {
      numero += 1;
      const egreso = filaEgresoValida(cajaId, e.secretariaA.id, 1000 + numero);

      await debeAceptarse([pasoMovimiento(egreso)]);

      expect((await leerMovimientos(e.A.id)).some((m) => m.id === egreso['id'])).toBe(true);
    });

    it('criterio 58 e y 3: un movimiento con un pago_id que no existe, en el modo diferido, sigue fallando con 23503', async () => {
      const falso = pagoPendiente(await clienteNuevo());

      await debeFallar([pasoMovimiento(movimientoDe(falso))], ['23503']);
    });
  });
});

describe('criterio 58 d: escrituras del dueño sobre el movimiento de un pago CONFIRMADO', () => {
  const rol = 'propietario';
  let e: EscenarioPagos;
  let cajaId: string;
  let numero = 0;

  beforeAll(async () => {
    e = await crearEscenarioDePagos();
    cajaId = (await crearCajaDePrueba(e.A.id, e.secretariaA.id)).id;
  });

  /** Un pago `CONFIRMADO` de efectivo con su movimiento correcto, ya guardados en una transacción anterior (uno nuevo por cada caso). */
  async function parConfirmado() {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], monto: '42.00' });
    numero += 1;
    const pago = filaPagoValida(
      e.A.id,
      { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId, usuarioId: e.secretariaA.id },
      { metodo: 'EFECTIVO', estado: 'CONFIRMADO', numeroTicket: 1000 + numero },
    );
    numero += 1;
    const movimiento = filaIngresoValida(cajaId, e.secretariaA.id, cliente.alumnoId, 1000 + numero, {
      pago_id: pago['id'],
      metodo: pago['metodo'],
      monto: pago['monto'],
      concepto: pago['concepto'],
    });
    await ejecutarTransaccion(rol, { academiaId: e.A.id }, [
      sqlInsertarPago(e.A.id, pago),
      sqlDeInsercionCaja('movimientos_caja', e.A.id, movimiento),
    ]);
    return { cliente, pago, movimiento };
  }

  const instantanea = async () =>
    JSON.stringify({ pagos: await leerPagos(e.A.id), movimientos: await leerMovimientos(e.A.id) });

  async function debeFallarCon23514(pasos: Paso[]): Promise<void> {
    const antes = await instantanea();
    const error: unknown = await ejecutarTransaccion(rol, { academiaId: e.A.id }, pasos).then(
      () => null,
      (fallo: unknown) => fallo,
    );
    expect(error, 'la transacción se confirmó y debía fallar con 23514').not.toBeNull();
    expect((error as { code?: string }).code).toBe('23514');
    expect(await instantanea()).toBe(antes);
  }

  const actualizar = (movimientoId: string, columna: string, tipo: string, valor: unknown): Paso => ({
    sql: `UPDATE movimientos_caja SET ${columna} = $3::${tipo} WHERE academia_id = $1::uuid AND id = $2::uuid`,
    valores: [e.A.id, movimientoId, valor],
  });

  it('criterio 58 d: el UPDATE del pago_id del movimiento a nulo falla con 23514 y no cambia nada', async () => {
    const { movimiento } = await parConfirmado();

    await debeFallarCon23514([actualizar(movimiento['id'] as string, 'pago_id', 'uuid', null)]);
  });

  it('criterio 58 d: el UPDATE del pago_id del movimiento al de un pago pendiente falla con 23514 y no cambia nada', async () => {
    const { cliente, movimiento } = await parConfirmado();
    const apoyo = await crearMatriculaDeApoyo(e.A.id, cliente.alumnoId);
    const pendiente = filaPagoValida(e.A.id, { alumnoId: cliente.alumnoId, matriculaId: apoyo.matriculaId });
    await insertarPago(rol, e.A.id, pendiente);

    await debeFallarCon23514([actualizar(movimiento['id'] as string, 'pago_id', 'uuid', pendiente['id'])]);
  });

  it.each([
    ['tipo', 'tipo', 'tipo_movimiento_caja', 'EGRESO'],
    ['método', 'metodo', 'metodo_pago', 'YAPE'],
    ['monto', 'monto', 'numeric', '41.00'],
    ['concepto', 'concepto', 'concepto_movimiento_caja', 'MENSUALIDAD'],
  ])(
    'criterio 58 d: el UPDATE del %s del movimiento falla con 23514 y no cambia nada',
    async (_nombre, columna, tipo, valor) => {
      const { movimiento } = await parConfirmado();

      await debeFallarCon23514([actualizar(movimiento['id'] as string, columna, tipo, valor)]);
    },
  );

  it('criterio 58 d: el UPDATE del alumno del movimiento (a otro de la misma academia) falla con 23514 y no cambia nada', async () => {
    const { movimiento } = await parConfirmado();
    const otro = await crearAlumnoSolo(e.A.id);

    await debeFallarCon23514([actualizar(movimiento['id'] as string, 'alumno_id', 'uuid', otro)]);
  });

  it('criterio 58 d: el DELETE del movimiento falla con 23514 y no cambia nada', async () => {
    const { movimiento } = await parConfirmado();

    await debeFallarCon23514([
      {
        sql: 'DELETE FROM movimientos_caja WHERE academia_id = $1::uuid AND id = $2::uuid',
        valores: [e.A.id, movimiento['id']],
      },
    ]);
  });
});

describe('criterio 58 e: el cobro en efectivo por la API (criterio 13) se sigue aceptando', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    await abrirCajaDeHoy(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it('criterio 58 e: el cobro de una solicitud responde 201 y deja el pago CONFIRMADO con su único movimiento de caja', async () => {
    const cliente = await sembrarCobrable(e);

    const respuesta = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), {
      cookie: cookiesDePagos(e).secretaria,
    });

    expect(respuesta.status, respuesta.texto).toBe(201);
    const pago = pagoDe(respuesta);
    expect((await leerPagos(e.A.id)).find((p) => p.id === pago.id)?.estado).toBe('CONFIRMADO');
    expect((await leerMovimientos(e.A.id)).filter((m) => m.pago_id === pago.id)).toHaveLength(1);
  });
});
