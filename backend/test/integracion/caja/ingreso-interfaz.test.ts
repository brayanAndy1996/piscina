// spec: 006-caja (pruebas protegidas)
// Actualizada por la 007 (spec 007-pagos, criterios 1, 3 y 5 y «Pruebas protegidas anteriores que amplía la 007a»): la función local `ingresar` inserta el pago `CONFIRMADO`
// del ingreso en la misma transacción, después de `registrarIngresoEnCaja` (si lanza, no se inserta nada; si devuelve `repetido`, el pago ya existía). CAMBIO
// APROBADO POR EL ORQUESTADOR (no solo suma, DT-19): la prueba del criterio 24 b «un pagoId de otra academia no cuenta» espera ahora que el ingreso en A con el
// `pagoId` de un pago de B falle al confirmar con 23503 y no deje nada en A (conserva la intención: un pago de otra academia nunca cuenta como de A).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codigoDeErrorDeBase } from '../../../src/infraestructura/prisma';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_INGRESO,
  AYER,
  type AppCaja,
  type CajaDePrueba,
  aDosDecimales,
  cajaDe,
  cargarModuloCaja,
  cerrarCajaDePrueba,
  cobroImitado,
  codigoDeError,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  cuerpoEgreso,
  decimal,
  detallesDeError,
  enLima,
  type EscenarioCaja,
  exigirRutasDeCaja,
  HOY,
  ingresoDeEjemplo,
  instantaneaDeCaja,
  intentar,
  leerCajas,
  leerMovimientos,
  mensajeDeError,
  retenerCaja,
  rutaCaja,
  type ConceptoIngreso,
  type MetodoPago,
  type ModuloCaja,
} from '../../utilidades/caja';
import { insertarPagoDeSoporteEnTransaccion } from '../../utilidades/pagos';
import { abrirRetenedor, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterios 20 d, 24 y 25 (críticos, HU-26, HU-07, D-04, RN-17): la interfaz que usará la 007, sin Nest, en `backend/src/modulos/caja/index.ts`.
//  24. `registrarIngresoEnCaja(tx, ingreso, ahora)` corre dentro de la transacción de quien llama (que ya llamó a `bloquearActorVigente`). En este orden:
//      a) bloquea la caja abierta de `tx.academiaId` con FOR UPDATE; si no hay, lanza 409 SIN_CAJA_ABIERTA (mensaje "Abre la caja antes de cobrar"); si
//         es de otro día según `ahora` en Lima, 409 CAJA_DE_OTRO_DIA;
//      b) si ya hay un movimiento con ese `pagoId` en la academia, lo devuelve con `repetido: true`, sin insertar ni auditar;
//      c) si no, inserta un INGRESO con `concepto`, `metodo`, `monto` (Decimal mayor que 0 y como mucho 100000.00, con hasta dos decimales; si no,
//         RangeError sin escribir), `alumnoId`, `pagoId`, `usuarioId` y el siguiente `numero`, y registra CAJA_INGRESO_REGISTRADO con datosDespues
//         { cajaId, numero, concepto, metodo, monto, alumnoId, pagoId }.
//      Un `alumnoId` de otra academia o que no existe hace fallar la transacción (23503) y no queda nada. Pruebas de integración que llaman a la
//      función dentro de `conAcademia`, con el reloj fijo (la 007 todavía no existe).
//  20 d) con la caja del 30 abierta, a las 00:00 del 1 en Lima lanza CAJA_DE_OTRO_DIA y no inserta.
//  25. Yape y transferencia entran a la caja, pero no al efectivo: con un monto inicial de S/ 100.00, un ingreso EFECTIVO de 42.00, uno YAPE de 88.00,
//      uno TRANSFERENCIA de 120.00 y un egreso de 15.50, el resumen es ingresos { 42.00, 88.00, 120.00 }, egresos { 15.50 } y esperado { 126.50, 88.00,
//      120.00 }.
// También `registrarEgresoEnCaja` y `leerCajaAbierta` (spec, "Interfaces del backend"). Las funciones se cargan con importación dinámica.

const ZONA_ORIGINAL = process.env['TZ'];

describe('interfaz de la caja para la 007 (criterios 20 d, 24 y 25)', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let caja: CajaDePrueba;
  let modulo: ModuloCaja;
  let alumno: { id: string; nombres: string; apellidos: string };

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    process.env['TZ'] = 'UTC';
    ctx.reloj.fijar(AHORA_PRUEBAS);
    modulo = await cargarModuloCaja();
    e = await crearEscenarioDeCaja();
    alumno = await crearAlumnoDeCaja(e.A.id);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });

  const conCaja = async (sobre: Record<string, unknown> = {}) => {
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00', ...sobre });
    return caja;
  };

  /**
   * `registrarIngresoEnCaja` y, después, el pago `CONFIRMADO` del ingreso en la misma transacción (la base lo exige desde la 007). Si el ingreso
   * ya estaba registrado (`repetido`), el pago ya existe y no se inserta otro; `conPago: false` no lo inserta (para probar la llave hacia `pagos`).
   */
  async function ingresoConSuPago(
    tx: Parameters<ModuloCaja['registrarIngresoEnCaja']>[0],
    ingreso: Parameters<ModuloCaja['registrarIngresoEnCaja']>[1],
    ahora: Date,
    conPago = true,
  ) {
    const registrado = await modulo.registrarIngresoEnCaja(tx, ingreso, ahora);
    if (conPago && !registrado.repetido) {
      await insertarPagoDeSoporteEnTransaccion(tx, {
        pagoId: ingreso.pagoId,
        alumnoId: ingreso.alumnoId,
        metodo: ingreso.metodo,
        monto: ingreso.monto.toFixed(2),
        concepto: ingreso.concepto,
        usuarioId: ingreso.usuarioId,
        registradoEn: registrado.registradoEn,
      });
    }
    return registrado;
  }

  /** Registra un ingreso dentro de `conAcademia(A)` con `registrarIngresoEnCaja` (y su pago) y devuelve el resultado o el error. */
  async function ingresar(
    ingreso = ingresoDeEjemplo(alumno.id, e.secretariaA.id),
    ahora: Date = AHORA_PRUEBAS,
    academiaId: string = e.A.id,
    conPago = true,
  ) {
    const baseDatos = await ctx.baseDatos();
    return intentar(baseDatos.conAcademia(academiaId, (tx) => ingresoConSuPago(tx, ingreso, ahora, conPago)));
  }

  describe('criterio 24 a: la caja abierta', () => {
    it('criterio 24 a: sin ninguna caja lanza 409 SIN_CAJA_ABIERTA con el mensaje "Abre la caja antes de cobrar" y no escribe', async () => {
      const antes = await instantaneaDeCaja(e.A.id);

      const resultado = await ingresar();

      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(codigoDeError(resultado.error)).toBe('SIN_CAJA_ABIERTA');
      expect((resultado.error as { estado?: number }).estado).toBe(409);
      expect(mensajeDeError(resultado.error)).toBe('Abre la caja antes de cobrar');
      expect(await instantaneaDeCaja(e.A.id)).toBe(antes);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_INGRESO)).toHaveLength(0);
    });

    it('criterio 24 a: con la caja de hoy ya cerrada lanza SIN_CAJA_ABIERTA (la secretaria pide al administrador que reabra)', async () => {
      const cerrada = await conCaja();
      await cerrarCajaDePrueba(e.A.id, cerrada.id, e.secretariaA.id);

      const resultado = await ingresar();

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(codigoDeError(resultado.error)).toBe('SIN_CAJA_ABIERTA');
      expect(await leerMovimientos(e.A.id)).toHaveLength(0);
    });

    it('criterio 24 a: la caja abierta de otra academia no cuenta: A sin caja y B con una abierta lanza SIN_CAJA_ABIERTA en A y no escribe en B', async () => {
      await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      const antesB = await instantaneaDeCaja(e.B.id);

      const resultado = await ingresar();

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(codigoDeError(resultado.error)).toBe('SIN_CAJA_ABIERTA');
      expect(await instantaneaDeCaja(e.B.id)).toBe(antesB);
    });

    it('criterio 24 a: bloquea la caja abierta con FOR UPDATE: mientras la prueba retiene la fila, el ingreso espera y, al soltarla, se registra', async () => {
      await conCaja();
      const retenedor = await abrirRetenedor(e.A.id);
      try {
        await retenerCaja(e.A.id, caja.id)(retenedor);
        const baseDatos = await ctx.baseDatos();
        const pendiente = intentar(
          baseDatos.conAcademia(e.A.id, (tx) =>
            ingresoConSuPago(tx, ingresoDeEjemplo(alumno.id, e.secretariaA.id), AHORA_PRUEBAS),
          ),
        );
        const observada = observar(pendiente);

        const espero = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [observada],
          'el ingreso ni respondió ni quedó esperando la fila de la caja.',
        );
        expect(espero, 'el ingreso no esperó la fila de la caja: no la bloquea con FOR UPDATE').toBe(true);
        await retenedor.liberar('ROLLBACK');

        const resultado = await conLimite(observada.resultado, 'el ingreso no respondió tras soltar la caja');
        expect(resultado.ok).toBe(true);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });
  });

  describe('criterio 24 a y 20 d: la caja de otro día (America/Lima)', () => {
    it('criterio 24 a: con una caja abierta de ayer lanza 409 CAJA_DE_OTRO_DIA con { cajaId, fecha } y no inserta', async () => {
      const deAyer = await conCaja({ fecha: AYER });

      const resultado = await ingresar();

      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(codigoDeError(resultado.error)).toBe('CAJA_DE_OTRO_DIA');
      expect((resultado.error as { estado?: number }).estado).toBe(409);
      expect(detallesDeError(resultado.error)).toEqual({ cajaId: deAyer.id, fecha: AYER });
      expect(await leerMovimientos(e.A.id)).toHaveLength(0);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_INGRESO)).toHaveLength(0);
    });

    describe.each(['UTC', 'Asia/Tokyo'])('con el proceso en TZ=%s', (zona) => {
      beforeEach(() => {
        process.env['TZ'] = zona;
      });

      it.each([
        [
          '19:30 del 30 de noviembre en Lima (en UTC ya es el 1 de diciembre)',
          '2026-11-30',
          '2026-12-01T00:30:00.000Z',
          true,
        ],
        ['23:59:59.999 del 30 de noviembre en Lima', '2026-11-30', '2026-12-01T04:59:59.999Z', true],
        ['00:00 del 1 de diciembre en Lima', '2026-11-30', '2026-12-01T05:00:00.000Z', false],
        ['23:59:59.999 del 31 de diciembre en Lima', '2026-12-31', '2027-01-01T04:59:59.999Z', true],
        ['00:00 del 1 de enero en Lima', '2026-12-31', '2027-01-01T05:00:00.000Z', false],
      ])(
        'criterio 20 d: con la caja abierta del %#, a las %s: se registra = %s',
        async (_nombre, fecha, instante, registra) => {
          const deOtroDia = await conCaja({ fecha });

          const resultado = await ingresar(ingresoDeEjemplo(alumno.id, e.secretariaA.id), new Date(instante));

          if (registra) {
            expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
            expect(await leerMovimientos(e.A.id)).toHaveLength(1);
            return;
          }
          expect(resultado.ok).toBe(false);
          if (resultado.ok) return;
          expect(codigoDeError(resultado.error)).toBe('CAJA_DE_OTRO_DIA');
          expect(detallesDeError(resultado.error)).toEqual({ cajaId: deOtroDia.id, fecha });
          expect(await leerMovimientos(e.A.id), 'no inserta').toHaveLength(0);
        },
      );
    });
  });

  describe('criterio 24 c: el ingreso', () => {
    it.each([
      ['INSCRIPCION', 'EFECTIVO'],
      ['MENSUALIDAD', 'YAPE'],
      ['CLASE_PARTICULAR', 'TRANSFERENCIA'],
    ] as [ConceptoIngreso, MetodoPago][])(
      'criterio 24 c: un ingreso de %s por %s se inserta con su alumno, su pago, su usuario y el número 1, y devuelve { id, cajaId, numero, registradoEn, repetido: false }',
      async (concepto, metodo) => {
        await conCaja();
        const ingreso = ingresoDeEjemplo(alumno.id, e.adminA.id, { concepto, metodo, monto: decimal('42.5') });

        const resultado = await ingresar(ingreso);

        expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
        if (!resultado.ok) return;
        const filas = await leerMovimientos(e.A.id);
        expect(filas).toHaveLength(1);
        expect(filas[0]).toMatchObject({
          id: resultado.valor.id,
          caja_id: caja.id,
          numero: 1,
          tipo: 'INGRESO',
          concepto,
          metodo,
          monto: '42.50',
          descripcion: null,
          comprobante: null,
          alumno_id: alumno.id,
          pago_id: ingreso.pagoId,
          registrado_por: e.adminA.id,
          clave_idempotencia: null,
        });
        expect(filas[0]?.registrado_en.getTime()).toBe(AHORA_PRUEBAS.getTime());
        expect(resultado.valor).toMatchObject({ id: filas[0]?.id, cajaId: caja.id, numero: 1, repetido: false });
        expect(resultado.valor.registradoEn.getTime()).toBe(AHORA_PRUEBAS.getTime());
      },
    );

    it('criterio 24 c: el número es el siguiente de la caja, también después de egresos', async () => {
      await conCaja();
      await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id);

      const primero = await ingresar();
      const segundo = await ingresar();

      expect(primero.ok && primero.valor.numero).toBe(2);
      expect(segundo.ok && segundo.valor.numero).toBe(3);
    });

    it('criterio 24 c: registra una sola auditoría CAJA_INGRESO_REGISTRADO (entidad movimiento_caja, actor USUARIO con su IP) con datosDespues { cajaId, numero, concepto, metodo, monto, alumnoId, pagoId }', async () => {
      await conCaja();
      const ingreso = ingresoDeEjemplo(alumno.id, e.secretariaA.id, {
        concepto: 'MENSUALIDAD',
        metodo: 'YAPE',
        monto: decimal('88'),
        ip: '203.0.113.9',
      });

      const resultado = await ingresar(ingreso);

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      const filas = await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_INGRESO);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.entidad).toBe('movimiento_caja');
      expect(filas[0]?.entidad_id).toBe(resultado.valor.id);
      expect(filas[0]?.actor_tipo).toBe('USUARIO');
      expect(filas[0]?.actor_id).toBe(e.secretariaA.id);
      expect(filas[0]?.ip).toBe('203.0.113.9');
      expect(filas[0]?.datos_despues).toEqual({
        cajaId: caja.id,
        numero: 1,
        concepto: 'MENSUALIDAD',
        metodo: 'YAPE',
        monto: '88.00',
        alumnoId: alumno.id,
        pagoId: ingreso.pagoId,
      });
    });

    it('criterio 24 c: sin IP (null) la auditoría queda sin IP y el ingreso se registra igual', async () => {
      await conCaja();

      const resultado = await ingresar(ingresoDeEjemplo(alumno.id, e.secretariaA.id, { ip: null }));

      expect(resultado.ok).toBe(true);
      expect((await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_INGRESO))[0]?.ip).toBeNull();
    });

    it.each([
      ['0.01', '0.01'],
      ['100000', '100000.00'],
      ['100000.00', '100000.00'],
      ['42.1', '42.10'],
    ])('criterio 24 c: un monto de %s se acepta y se guarda como %s', async (monto, guardado) => {
      await conCaja();

      const resultado = await ingresar(ingresoDeEjemplo(alumno.id, e.secretariaA.id, { monto: decimal(monto) }));

      expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
      expect((await leerMovimientos(e.A.id))[0]?.monto).toBe(guardado);
    });

    it.each([
      ['0', '0'],
      ['0.00', '0.00'],
      ['negativo', '-1.00'],
      ['sobre el máximo', '100000.01'],
      ['muy grande', '1000000'],
      ['con tres decimales', '42.001'],
      ['NaN', 'NaN'],
      ['infinito', 'Infinity'],
    ])('criterio 24 c: un monto %s lanza un RangeError y no escribe nada', async (_nombre, monto) => {
      await conCaja();
      const antes = await instantaneaDeCaja(e.A.id);

      const resultado = await ingresar(ingresoDeEjemplo(alumno.id, e.secretariaA.id, { monto: decimal(monto) }));

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.error).toBeInstanceOf(RangeError);
      expect(await instantaneaDeCaja(e.A.id)).toBe(antes);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_INGRESO)).toHaveLength(0);
    });
  });

  describe('criterio 24 b: un pago entra una sola vez a la caja', () => {
    it('criterio 24 b: con el mismo pagoId devuelve el movimiento ya registrado con repetido: true, sin insertar ni auditar', async () => {
      await conCaja();
      const ingreso = ingresoDeEjemplo(alumno.id, e.secretariaA.id, { monto: decimal('42') });
      const primero = await ingresar(ingreso);
      expect(primero.ok).toBe(true);
      if (!primero.ok) return;
      const antes = await instantaneaDeCaja(e.A.id);

      const repetido = await ingresar({ ...ingreso, monto: decimal('42') });

      expect(repetido.ok, JSON.stringify(repetido)).toBe(true);
      if (!repetido.ok) return;
      expect(repetido.valor).toMatchObject({ id: primero.valor.id, cajaId: caja.id, numero: 1, repetido: true });
      expect(await instantaneaDeCaja(e.A.id)).toBe(antes);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_INGRESO)).toHaveLength(1);
    });

    it('criterio 24 b: el mismo pagoId con otro método o monto tampoco entra dos veces (un pago, un movimiento)', async () => {
      await conCaja();
      const pagoId = randomUUID();
      await ingresar(ingresoDeEjemplo(alumno.id, e.secretariaA.id, { pagoId, metodo: 'YAPE', monto: decimal('50') }));

      const repetido = await ingresar(
        ingresoDeEjemplo(alumno.id, e.secretariaA.id, { pagoId, metodo: 'EFECTIVO', monto: decimal('60') }),
      );

      expect(repetido.ok && repetido.valor.repetido).toBe(true);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });

    it('criterio 24 b (DT-19 de 007): un pagoId de otra academia no cuenta como de A: el ingreso en A con el pagoId de un pago de B falla al confirmar con 23503 y no deja nada en A', async () => {
      await conCaja();
      const cajaB = await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      const alumnoB = await crearAlumnoDeCaja(e.B.id);
      const pagoId = randomUUID();
      await crearIngresoDePrueba(e.B.id, cajaB.id, e.secretariaB.id, alumnoB.id, { pago_id: pagoId });
      const antes = await instantaneaDeCaja(e.A.id);

      const resultado = await ingresar(
        ingresoDeEjemplo(alumno.id, e.secretariaA.id, { pagoId }),
        AHORA_PRUEBAS,
        e.A.id,
        false,
      );

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(codigoDeErrorDeBase(resultado.error)).toBe('23503');
      expect(await instantaneaDeCaja(e.A.id)).toBe(antes);
      expect(await leerMovimientos(e.A.id)).toHaveLength(0);
      expect(await leerMovimientos(e.B.id)).toHaveLength(1);
    });
  });

  describe('criterio 24: el alumno debe ser de la academia', () => {
    it.each([
      ['de otra academia', async () => (await crearAlumnoDeCaja(e.B.id)).id],
      ['que no existe', () => Promise.resolve(randomUUID())],
    ])(
      'criterio 24: un alumnoId %s hace fallar la transacción con 23503 y no queda nada (ni movimiento ni auditoría de la transacción)',
      async (_nombre, crear) => {
        await conCaja();
        const alumnoId = await crear();
        const antes = await instantaneaDeCaja(e.A.id);
        const baseDatos = await ctx.baseDatos();

        const resultado = await cobroImitado(baseDatos, {
          academiaId: e.A.id,
          actor: { id: e.secretariaA.id },
          ingreso: ingresoDeEjemplo(alumnoId, e.secretariaA.id),
          ahora: AHORA_PRUEBAS,
          marca: 'COBRO_IMITADO_QUE_SE_REVIERTE',
        });

        expect(resultado.ok).toBe(false);
        if (!resultado.ok) expect(codigoDeErrorDeBase(resultado.error)).toBe('23503');
        expect(await instantaneaDeCaja(e.A.id)).toBe(antes);
        expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_INGRESO)).toHaveLength(0);
        expect(
          await leerAuditoriaDeAcademia(e.A.id, 'COBRO_IMITADO_QUE_SE_REVIERTE'),
          'la transacción completa se revierte',
        ).toHaveLength(0);
      },
    );

    it('criterio 24: un error de la interfaz (SIN_CAJA_ABIERTA) revierte también lo que escribió antes quien llama (la transacción completa del cobro)', async () => {
      const baseDatos = await ctx.baseDatos();

      const resultado = await cobroImitado(baseDatos, {
        academiaId: e.A.id,
        actor: { id: e.secretariaA.id },
        ingreso: ingresoDeEjemplo(alumno.id, e.secretariaA.id),
        ahora: AHORA_PRUEBAS,
        marca: 'COBRO_IMITADO_SIN_CAJA',
      });

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(codigoDeError(resultado.error)).toBe('SIN_CAJA_ABIERTA');
      expect(await leerAuditoriaDeAcademia(e.A.id, 'COBRO_IMITADO_SIN_CAJA')).toHaveLength(0);
    });

    it('criterio 24: una transacción de cobro que sale bien deja el movimiento y lo que escribió quien llama', async () => {
      await conCaja();
      const baseDatos = await ctx.baseDatos();

      const resultado = await cobroImitado(baseDatos, {
        academiaId: e.A.id,
        actor: { id: e.secretariaA.id },
        ingreso: ingresoDeEjemplo(alumno.id, e.secretariaA.id),
        ahora: AHORA_PRUEBAS,
        marca: 'COBRO_IMITADO_OK',
      });

      expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'COBRO_IMITADO_OK')).toHaveLength(1);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });
  });

  describe('criterio 25: Yape y transferencia entran a la caja, pero no al efectivo', () => {
    it('criterio 25: con S/ 100.00 iniciales, ingresos de 42.00 (efectivo), 88.00 (Yape) y 120.00 (transferencia) y un egreso de 15.50, el resumen de la caja del día es el del contrato', async () => {
      await conCaja();
      for (const [metodo, monto] of [
        ['EFECTIVO', '42.00'],
        ['YAPE', '88.00'],
        ['TRANSFERENCIA', '120.00'],
      ] as const) {
        const resultado = await ingresar(
          ingresoDeEjemplo(alumno.id, e.secretariaA.id, { metodo, monto: decimal(monto) }),
        );
        expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
      }
      const egreso = await ctx.http.post(
        rutaCaja(caja.id, '/egresos'),
        cookiesDeCaja(e).secretaria,
        cuerpoEgreso({ monto: '15.50' }),
      );
      expect(egreso.status, egreso.texto).toBe(201);

      const respuesta = await ctx.http.get('/api/cajas/actual', cookiesDeCaja(e).secretaria);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const delDia = cajaDe(respuesta);
      expect(delDia.resumen).toEqual({
        ingresos: { efectivo: '42.00', yape: '88.00', transferencia: '120.00' },
        egresos: { efectivo: '15.50' },
        esperado: { efectivo: '126.50', yape: '88.00', transferencia: '120.00' },
        ultimoMovimiento: 4,
      });
      expect(delDia.movimientos.map((m) => [m.numero, m.tipo, m.metodo, m.monto])).toEqual([
        [1, 'INGRESO', 'EFECTIVO', '42.00'],
        [2, 'INGRESO', 'YAPE', '88.00'],
        [3, 'INGRESO', 'TRANSFERENCIA', '120.00'],
        [4, 'EGRESO', 'EFECTIVO', '15.50'],
      ]);
    });

    it('criterio 25: un ingreso por Yape o transferencia no sube el esperado en efectivo ni permite egresos mayores que el efectivo (D-04)', async () => {
      await conCaja();
      await ingresar(ingresoDeEjemplo(alumno.id, e.secretariaA.id, { metodo: 'YAPE', monto: decimal('500') }));

      const respuesta = await ctx.http.post(
        rutaCaja(caja.id, '/egresos'),
        cookiesDeCaja(e).secretaria,
        cuerpoEgreso({ monto: '100.01' }),
      );

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect((await leerCajas(e.A.id))[0]?.monto_inicial).toBe('100.00');
    });
  });

  describe('leerCajaAbierta (lectura sin bloqueo para que la 007 avise antes de empezar)', () => {
    async function leer(ahora: Date = AHORA_PRUEBAS) {
      const baseDatos = await ctx.baseDatos();
      return baseDatos.conAcademia(e.A.id, (tx) => modulo.leerCajaAbierta(tx, ahora));
    }

    it('criterio 24: sin caja abierta devuelve null (también con la caja de hoy cerrada y con una abierta en B)', async () => {
      await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      expect(await leer()).toBeNull();

      const cerrada = await conCaja();
      await cerrarCajaDePrueba(e.A.id, cerrada.id, e.secretariaA.id);
      expect(await leer()).toBeNull();
    });

    it('criterio 24: con la caja abierta de hoy devuelve { id, fecha, deOtroDia: false } y con una de ayer, deOtroDia: true', async () => {
      const deHoy = await conCaja();
      expect(await leer()).toEqual({ id: deHoy.id, fecha: HOY, deOtroDia: false });

      expect(await leer(enLima('2026-11-12', '00:00'))).toEqual({ id: deHoy.id, fecha: HOY, deOtroDia: true });
      expect(await leer(new Date('2026-11-12T04:59:59.999Z'))).toEqual({ id: deHoy.id, fecha: HOY, deOtroDia: false });
    });

    it('criterio 24: no bloquea: mientras la prueba retiene la fila de la caja con FOR UPDATE, responde sin esperar', async () => {
      await conCaja();
      const retenedor = await abrirRetenedor(e.A.id);
      try {
        await retenerCaja(e.A.id, caja.id)(retenedor);

        const lectura = await conLimite(
          leer(),
          'leerCajaAbierta esperó el bloqueo de la caja (debe leer sin bloquear)',
        );

        expect(lectura?.id).toBe(caja.id);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });
  });

  describe('registrarEgresoEnCaja (la usa la ruta de egresos y la usará la 019)', () => {
    const egresoDe = (sobre: Record<string, unknown> = {}) => ({
      cajaId: caja.id,
      claveIdempotencia: randomUUID(),
      descripcion: 'Compra de útiles',
      monto: decimal('20'),
      comprobante: null as string | null,
      usuarioId: e.secretariaA.id,
      ip: null as string | null,
      ...sobre,
    });
    async function egresar(egreso: ReturnType<typeof egresoDe>, ahora: Date = AHORA_PRUEBAS) {
      const baseDatos = await ctx.baseDatos();
      return intentar(baseDatos.conAcademia(e.A.id, (tx) => modulo.registrarEgresoEnCaja(tx, egreso, ahora)));
    }

    it('criterio 17: registra el egreso en efectivo y devuelve { id, cajaId, numero, registradoEn, repetido: false }; la misma clave y los mismos datos devuelven el mismo con repetido: true', async () => {
      await conCaja();
      const egreso = egresoDe({ comprobante: 'Boleta 1' });

      const primero = await egresar(egreso);
      const repetido = await egresar({ ...egreso, monto: decimal('20.00') });

      expect(primero.ok, JSON.stringify(primero)).toBe(true);
      expect(repetido.ok, JSON.stringify(repetido)).toBe(true);
      if (!primero.ok || !repetido.ok) return;
      expect(primero.valor).toMatchObject({ cajaId: caja.id, numero: 1, repetido: false });
      expect(repetido.valor).toMatchObject({ id: primero.valor.id, numero: 1, repetido: true });
      const filas = await leerMovimientos(e.A.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ tipo: 'EGRESO', metodo: 'EFECTIVO', monto: '20.00', comprobante: 'Boleta 1' });
      expect(await leerAuditoriaDeAcademia(e.A.id, 'CAJA_EGRESO_REGISTRADO')).toHaveLength(1);
    });

    it('criterio 19, 21 y 22: lanza CLAVE_YA_USADA con otros datos, CAJA_CERRADA, EFECTIVO_INSUFICIENTE con { disponible } y NO_ENCONTRADO para una caja de otra academia', async () => {
      await conCaja();
      const egreso = egresoDe();
      expect((await egresar(egreso)).ok).toBe(true);

      const otrosDatos = await egresar({ ...egreso, monto: decimal('21') });
      const sinEfectivo = await egresar(egresoDe({ monto: decimal('80.01') }));
      const cajaB = await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      const deOtraAcademia = await egresar(egresoDe({ cajaId: cajaB.id }));
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
      const cerrada = await egresar(egresoDe());

      expect(!otrosDatos.ok && codigoDeError(otrosDatos.error)).toBe('CLAVE_YA_USADA');
      expect(!sinEfectivo.ok && codigoDeError(sinEfectivo.error)).toBe('EFECTIVO_INSUFICIENTE');
      expect(!sinEfectivo.ok && detallesDeError(sinEfectivo.error)).toEqual({ disponible: '80.00' });
      expect(!deOtraAcademia.ok && codigoDeError(deOtraAcademia.error)).toBe('NO_ENCONTRADO');
      expect(!cerrada.ok && codigoDeError(cerrada.error)).toBe('CAJA_CERRADA');
      expect(aDosDecimales((await leerMovimientos(e.A.id))[0]?.monto)).toBe('20.00');
    });
  });
});
