// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_EGRESO,
  type AppCaja,
  type CajaDePrueba,
  type Objeto,
  cajaDe,
  camposConError,
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  cuerpoEgreso,
  cuerpoReapertura,
  detallesDe,
  enLima,
  type EscenarioCaja,
  exigirRutasDeCaja,
  instantaneaDeCaja,
  IP_LOCAL,
  leerCajas,
  leerMovimientos,
  movimientoDe,
  rutaCaja,
} from '../../utilidades/caja';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterios 17, 18, 19, 20 (a a c), 21 y 22 (secuenciales), y 23 (crítico, HU-26, RN-17, RN-22, DR-3 a DR-5): el egreso.
//  17. POST /api/cajas/{C}/egresos con { claveIdempotencia, descripcion, monto, comprobante? } responde 201 con { movimiento, caja }: EGRESO, EGRESO_MENOR,
//      EFECTIVO (DR-3), el monto con dos decimales, la descripción y el comprobante (o null), `numero` (el siguiente de la caja), `registradoPor` y
//      `registradoEn`; la caja trae el resumen ya con el egreso. Registra CAJA_EGRESO_REGISTRADO (entidad movimiento_caja) con datosDespues
//      { cajaId, numero, descripcion, monto, comprobante }.
//  18. Validación: descripcion (textoVisibleSchema de 3 a 200), monto (montoSchema), comprobante (recortado de hasta 60, sin controles; vacío cuenta
//      como ausente), claveIdempotencia (UUID) y ningún campo de más (`metodo`, `concepto`, `tipo`, `alumnoId`).
//  19. Con la caja cerrada, 409 CAJA_CERRADA sin escribir ni auditar; si el administrador la reabre, el egreso se acepta.
//  20. La caja de otro día no admite movimientos (a, b, c; la interfaz de la 007, d, está en `ingreso-interfaz.test.ts`).
//  21. Un egreso no deja el efectivo en negativo: 409 EFECTIVO_INSUFICIENTE con { disponible }.
//  22. Doble clic en el egreso: la misma clave y los mismos datos responden 200 con lo ya hecho, aunque la caja ya esté cerrada o sea de otro día.
//  23. No hay ruta para cambiar o borrar un movimiento ni un cierre (404).
// Las carreras (21 y 22 simultáneos) están en `egresos-carreras.test.ts`. Orden de los errores: 404 -> CLAVE_YA_USADA (o el 200) -> CAJA_CERRADA ->
// CAJA_DE_OTRO_DIA -> EFECTIVO_INSUFICIENTE, después del 400 del esquema.

const ZONA_ORIGINAL = process.env['TZ'];

describe('egresos (criterios 17 a 23)', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let caja: CajaDePrueba;

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });

  const egreso = (cuerpo: unknown, cookie = cookies.secretaria, id = caja.id) =>
    ctx.http.post(rutaCaja(id, '/egresos'), cookie, cuerpo);
  const auditorias = () => leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO);

  async function estado() {
    return {
      cajas: await instantaneaDeCaja(e.A.id),
      cajasB: await instantaneaDeCaja(e.B.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }

  describe('criterio 17: registrar un egreso', () => {
    it.each([
      ['secretaria', 'Lucia', 'Benites'],
      ['admin', 'Rosa', 'Alvarez'],
    ] as const)(
      'criterio 17: una %s registra un egreso: 201 con { movimiento, caja }, el movimiento en efectivo con el número 1 y la caja con el resumen al día',
      async (rol, nombres, apellidos) => {
        const actor = rol === 'admin' ? e.adminA : e.secretariaA;

        const respuesta = await egreso(
          {
            claveIdempotencia: randomUUID(),
            descripcion: 'Compra de útiles de limpieza',
            monto: '20',
            comprobante: 'Boleta B001-123',
          },
          cookies[rol],
        );

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(respuesta.cacheControl).toBe('no-store');
        expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['caja', 'movimiento']);
        const movimiento = movimientoDe(respuesta);
        expect(movimiento).toMatchObject({
          numero: 1,
          tipo: 'EGRESO',
          concepto: 'EGRESO_MENOR',
          metodo: 'EFECTIVO',
          monto: '20.00',
          descripcion: 'Compra de útiles de limpieza',
          comprobante: 'Boleta B001-123',
          alumno: null,
          registradoPor: { id: actor.id, nombres, apellidos },
        });
        expect(Date.parse(movimiento.registradoEn)).toBe(AHORA_PRUEBAS.getTime());
        const deLaCaja = cajaDe(respuesta);
        expect(deLaCaja.id).toBe(caja.id);
        expect(deLaCaja.movimientos.map((m) => m.id)).toEqual([movimiento.id]);
        expect(deLaCaja.resumen).toEqual({
          ingresos: { efectivo: '0.00', yape: '0.00', transferencia: '0.00' },
          egresos: { efectivo: '20.00' },
          esperado: { efectivo: '80.00', yape: '0.00', transferencia: '0.00' },
          ultimoMovimiento: 1,
        });
        expect(respuesta.texto, 'el DNI nunca sale en la caja').not.toContain(actor.dni);
      },
    );

    it('criterio 17: la fila queda como egreso en efectivo, con la clave, el número y quién lo registró', async () => {
      const clave = randomUUID();

      const respuesta = await egreso({ claveIdempotencia: clave, descripcion: 'Compra de jabón', monto: '12.5' });

      expect(respuesta.status, respuesta.texto).toBe(201);
      const filas = await leerMovimientos(e.A.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        id: movimientoDe(respuesta).id,
        caja_id: caja.id,
        numero: 1,
        tipo: 'EGRESO',
        concepto: 'EGRESO_MENOR',
        metodo: 'EFECTIVO',
        monto: '12.50',
        descripcion: 'Compra de jabón',
        comprobante: null,
        alumno_id: null,
        pago_id: null,
        registrado_por: e.secretariaA.id,
        clave_idempotencia: clave,
      });
      expect(filas[0]?.registrado_en.getTime()).toBe(AHORA_PRUEBAS.getTime());
    });

    it('criterio 17: sin comprobante, o con uno vacío, solo con espacios o nulo, se guarda null (vacío cuenta como ausente, DR-3)', async () => {
      for (const comprobante of [undefined, '', '   ', null]) {
        const cuerpo = cuerpoEgreso({ monto: '1.00' });
        if (comprobante !== undefined) cuerpo['comprobante'] = comprobante;

        const respuesta = await egreso(cuerpo);

        expect(respuesta.status, `${JSON.stringify(comprobante)}: ${respuesta.texto}`).toBe(201);
        expect(movimientoDe(respuesta).comprobante).toBeNull();
      }
      expect((await leerMovimientos(e.A.id)).map((m) => m.comprobante)).toEqual([null, null, null, null]);
    });

    it('criterio 17: la descripción y el comprobante se guardan recortados y con sus letras tal cual (tildes, emojis y otros alfabetos)', async () => {
      const respuesta = await egreso(
        cuerpoEgreso({
          descripcion: '  Pan 🥖 y café ñandú Привет  ',
          comprobante: '  Boleta B001-123  ',
          monto: '3.00',
        }),
      );

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(movimientoDe(respuesta).descripcion).toBe('Pan 🥖 y café ñandú Привет');
      expect(movimientoDe(respuesta).comprobante).toBe('Boleta B001-123');
      expect((await leerMovimientos(e.A.id))[0]?.descripcion).toBe('Pan 🥖 y café ñandú Привет');
    });

    it('criterio 17: los números son 1, 2, 3… en la caja, siguiendo a los ingresos que ya entraron', async () => {
      const alumno = await crearAlumnoDeCaja(e.A.id);
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id);

      const primero = await egreso(cuerpoEgreso({ monto: '1.00' }));
      const segundo = await egreso(cuerpoEgreso({ monto: '1.00' }), cookies.admin);

      expect(movimientoDe(primero).numero).toBe(2);
      expect(movimientoDe(segundo).numero).toBe(3);
      expect(cajaDe(segundo).resumen.ultimoMovimiento).toBe(3);
      expect(cajaDe(segundo).movimientos.map((m) => m.numero)).toEqual([1, 2, 3]);
    });

    it('criterio 17: registra una sola auditoría CAJA_EGRESO_REGISTRADO (entidad movimiento_caja, el id del movimiento, actor USUARIO con su IP) con datosDespues { cajaId, numero, descripcion, monto, comprobante }', async () => {
      const respuesta = await egreso(
        cuerpoEgreso({ descripcion: 'Compra de papel', monto: '7', comprobante: 'Boleta 99' }),
      );

      const filas = await auditorias();
      expect(filas).toHaveLength(1);
      const fila = filas[0];
      expect(fila?.entidad).toBe('movimiento_caja');
      expect(fila?.entidad_id).toBe(movimientoDe(respuesta).id);
      expect(fila?.actor_tipo).toBe('USUARIO');
      expect(fila?.actor_id).toBe(e.secretariaA.id);
      expect(fila?.ip).toMatch(IP_LOCAL);
      expect(fila?.datos_despues).toEqual({
        cajaId: caja.id,
        numero: 1,
        descripcion: 'Compra de papel',
        monto: '7.00',
        comprobante: 'Boleta 99',
      });
    });

    it('criterio 17: sin comprobante la auditoría guarda comprobante null', async () => {
      await egreso(cuerpoEgreso({ monto: '7' }));

      expect((await auditorias())[0]?.datos_despues).toMatchObject({ comprobante: null, monto: '7.00' });
    });
  });

  describe('criterio 18: validación del egreso', () => {
    const larga = (n: number) => 'a'.repeat(n);

    it.each([
      ['vacía', ''],
      ['de 2 caracteres', 'ab'],
      ['de 2 caracteres recortada', '  ab  '],
      ['solo espacios', '       '],
      ['de 201 caracteres', larga(201)],
      ['de 201 caracteres con espacios alrededor', ` ${larga(201)} `],
      ['con un salto de línea', 'Compra de\nútiles'],
      ['con un carácter nulo', 'Compra\u0000útiles'],
      ['con un tabulador', 'Compra\tútiles'],
      ['con menos de 3 caracteres visibles', '⠀⠀⠀⠀'],
      ['con control bidireccional', 'Compra‮útiles'],
      ['un número', 12345],
      ['nula', null],
    ])(
      'criterio 18: una descripción %s responde 400 SOLICITUD_INVALIDA en descripcion sin escribir ni auditar',
      async (_nombre, descripcion) => {
        const antes = await estado();

        const respuesta = await egreso(cuerpoEgreso({ descripcion }));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('descripcion');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 18: sin descripcion responde 400 en descripcion', async () => {
      const cuerpo = cuerpoEgreso();
      delete cuerpo['descripcion'];

      const respuesta = await egreso(cuerpo);

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(camposConError(respuesta)).toContain('descripcion');
    });

    it.each([
      ['de 3 caracteres', 'abc'],
      ['de 3 caracteres con espacios alrededor', '   abc   '],
      ['de 200 caracteres', larga(200)],
      ['de 200 caracteres con espacios alrededor', ` ${larga(200)} `],
      ['con signos', '...'],
    ])('criterio 18: una descripción %s se acepta (límites)', async (_nombre, descripcion) => {
      const respuesta = await egreso(cuerpoEgreso({ descripcion, monto: '1.00' }));

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it.each([
      ['0', '0'],
      ['0.00', '0.00'],
      ['negativo', '-5'],
      ['con tres decimales', '5.555'],
      ['un número JSON', 5],
      ['en notación científica', '1e2'],
      ['con un espacio al inicio', ' 5'],
      ['sobre el máximo', '100000'],
      ['nulo', null],
      ['vacío', ''],
      ['con coma', '5,50'],
    ])(
      'criterio 18: un monto %s responde 400 SOLICITUD_INVALIDA en monto sin escribir ni auditar',
      async (_nombre, monto) => {
        const antes = await estado();

        const respuesta = await egreso(cuerpoEgreso({ monto }));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('monto');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 18: sin monto responde 400 en monto', async () => {
      const cuerpo = cuerpoEgreso();
      delete cuerpo['monto'];

      const respuesta = await egreso(cuerpo);

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(camposConError(respuesta)).toContain('monto');
    });

    it.each([
      ['de 61 caracteres', larga(61)],
      ['de 61 caracteres con espacios alrededor', ` ${larga(61)} `],
      ['con un salto de línea', 'B001\n123'],
      ['con un carácter nulo', 'B001\u0000123'],
      ['un número', 5],
    ])(
      'criterio 18: un comprobante %s responde 400 SOLICITUD_INVALIDA en comprobante sin escribir ni auditar',
      async (_nombre, comprobante) => {
        const antes = await estado();

        const respuesta = await egreso(cuerpoEgreso({ comprobante }));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('comprobante');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 18: un comprobante de 60 caracteres se acepta (límite)', async () => {
      const respuesta = await egreso(cuerpoEgreso({ comprobante: larga(60), monto: '1.00' }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(movimientoDe(respuesta).comprobante).toBe(larga(60));
    });

    it.each([
      ['falta', undefined],
      ['no es un UUID', 'no-es-un-uuid'],
      ['está vacía', ''],
      ['es nula', null],
      ['es un número', 42],
    ])(
      'criterio 18: si la claveIdempotencia %s responde 400 en claveIdempotencia sin escribir ni auditar',
      async (_nombre, clave) => {
        const antes = await estado();
        const cuerpo = cuerpoEgreso();
        delete cuerpo['claveIdempotencia'];
        if (clave !== undefined) cuerpo['claveIdempotencia'] = clave;

        const respuesta = await egreso(cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(camposConError(respuesta)).toContain('claveIdempotencia');
        expect(await estado()).toEqual(antes);
      },
    );

    it.each([
      ['metodo', 'YAPE'],
      ['concepto', 'INSCRIPCION'],
      ['tipo', 'INGRESO'],
      ['alumnoId', randomUUID()],
      ['pagoId', randomUUID()],
      ['numero', 7],
      ['registradoPor', randomUUID()],
    ])(
      'criterio 18: el campo de más %s responde 400 SOLICITUD_INVALIDA sin escribir ni auditar',
      async (campo, valor) => {
        const antes = await estado();

        const respuesta = await egreso(cuerpoEgreso({ [campo]: valor }));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 18: el cuerpo se valida antes que el id: un cuerpo inválido sobre una caja que no existe responde 400, no 404', async () => {
      const respuesta = await egreso({ descripcion: 'x' }, cookies.secretaria, randomUUID());

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
    });
  });

  describe('criterio 19: ningún movimiento con la caja cerrada (RN-17)', () => {
    it('criterio 19: con la caja cerrada, un egreso con una clave nueva responde 409 CAJA_CERRADA sin escribir ni auditar', async () => {
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
      const antes = await estado();

      const respuesta = await egreso(cuerpoEgreso());

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('CAJA_CERRADA');
      expect(await estado()).toEqual(antes);
      expect(await auditorias()).toHaveLength(0);
    });

    it('criterio 19: si el administrador reabre la caja, el egreso se acepta', async () => {
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
      expect((await egreso(cuerpoEgreso())).status).toBe(409);

      const reapertura = await ctx.http.post(rutaCaja(caja.id, '/reapertura'), cookies.admin, cuerpoReapertura());
      expect(reapertura.status, reapertura.texto).toBe(200);
      const respuesta = await egreso(cuerpoEgreso({ monto: '5.00' }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });
  });

  describe.each(['UTC', 'Asia/Tokyo'])(
    'criterio 20: la caja de otro día no admite movimientos, con el proceso en TZ=%s',
    (zona) => {
      beforeEach(() => {
        process.env['TZ'] = zona;
      });

      /** La caja abierta de `fecha` (abierta a las 09:00 de Lima) y un egreso a `instante`. */
      async function egresoA(fecha: string, instante: string) {
        const ahora = new Date(instante);
        await cerrarLaDeHoy();
        const deOtroDia = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha, monto_inicial: '100.00' });
        ctx.reloj.fijar(ahora);
        const respuesta = await egreso(
          cuerpoEgreso({ monto: '10.00' }),
          cookiesDeCaja(e, ahora).secretaria,
          deOtroDia.id,
        );
        return { respuesta, caja: deOtroDia };
      }
      /** La caja de `beforeEach` (de hoy) se cierra para poder tener otra abierta de otro día. */
      async function cerrarLaDeHoy() {
        await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
      }

      it.each([
        [
          'a) a las 19:30 del 30 de noviembre en Lima (en UTC ya es el 1 de diciembre) se acepta',
          '2026-11-30',
          '2026-12-01T00:30:00.000Z',
          201,
        ],
        ['b) a las 23:59:59.999 del 30 de noviembre en Lima se acepta', '2026-11-30', '2026-12-01T04:59:59.999Z', 201],
        [
          'b) a las 00:00 del 1 de diciembre en Lima responde 409 CAJA_DE_OTRO_DIA',
          '2026-11-30',
          '2026-12-01T05:00:00.000Z',
          409,
        ],
        [
          'c) fin de año: a las 23:59:59.999 del 31 de diciembre se acepta',
          '2026-12-31',
          '2027-01-01T04:59:59.999Z',
          201,
        ],
        [
          'c) fin de año: a las 00:00 del 1 de enero responde 409 CAJA_DE_OTRO_DIA',
          '2026-12-31',
          '2027-01-01T05:00:00.000Z',
          409,
        ],
        [
          'c) dentro del mes: a las 00:00 del día siguiente responde 409 CAJA_DE_OTRO_DIA',
          '2026-11-15',
          '2026-11-16T05:00:00.000Z',
          409,
        ],
        ['c) dos días después responde 409 CAJA_DE_OTRO_DIA', '2026-11-15', '2026-11-17T15:00:00.000Z', 409],
      ])('criterio 20 %s', async (_nombre, fecha, instante, esperado) => {
        const { respuesta, caja: deOtroDia } = await egresoA(fecha, instante);

        expect(respuesta.status, respuesta.texto).toBe(esperado);
        if (esperado === 201) return;
        expect(codigoDe(respuesta)).toBe('CAJA_DE_OTRO_DIA');
        expect(detallesDe(respuesta)).toEqual({ cajaId: deOtroDia.id, fecha });
        expect(await leerMovimientos(e.A.id), 'no se escribió ningún movimiento').toHaveLength(0);
        expect(await auditorias()).toHaveLength(0);
      });
    },
  );

  describe('criterio 21: un egreso no deja el efectivo en negativo (DR-4)', () => {
    beforeEach(async () => {
      // La caja de `beforeEach` tiene S/ 100.00; estas pruebas usan una de S/ 50.00 (se cambia su monto inicial, como dueño).
      await ejecutarComo(
        'propietario',
        'UPDATE cajas SET monto_inicial = 50.00 WHERE academia_id = $1::uuid AND id = $2::uuid',
        [e.A.id, caja.id],
        { academiaId: e.A.id },
      );
    });

    it('criterio 21: con S/ 50.00 de esperado en efectivo, un egreso de "50.00" se acepta y deja el esperado en "0.00"', async () => {
      const respuesta = await egreso(cuerpoEgreso({ monto: '50.00' }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(cajaDe(respuesta).resumen.esperado.efectivo).toBe('0.00');
    });

    it('criterio 21: uno de "50.01" responde 409 EFECTIVO_INSUFICIENTE con { disponible: "50.00" } sin escribir ni auditar', async () => {
      const antes = await estado();

      const respuesta = await egreso(cuerpoEgreso({ monto: '50.01' }));

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('EFECTIVO_INSUFICIENTE');
      expect(detallesDe(respuesta)).toEqual({ disponible: '50.00' });
      expect(await estado()).toEqual(antes);
      expect(await auditorias()).toHaveLength(0);
    });

    it('criterio 21: el disponible baja con cada egreso y sube con los ingresos en efectivo: 30 + 20.01 no cabe, pero con un ingreso de 10 sí', async () => {
      expect((await egreso(cuerpoEgreso({ monto: '30.00' }))).status).toBe(201);

      const rechazado = await egreso(cuerpoEgreso({ monto: '20.01' }));
      expect(rechazado.status, rechazado.texto).toBe(409);
      expect(detallesDe(rechazado)).toEqual({ disponible: '20.00' });

      const alumno = await crearAlumnoDeCaja(e.A.id);
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, { monto: '10.00', metodo: 'EFECTIVO' });
      const aceptado = await egreso(cuerpoEgreso({ monto: '20.01' }));
      expect(aceptado.status, aceptado.texto).toBe(201);
      expect(cajaDe(aceptado).resumen.esperado.efectivo).toBe('9.99');
    });

    it('criterio 21: el Yape y la transferencia no son efectivo: no sirven para pagar un egreso (D-04, sección 4.3)', async () => {
      const alumno = await crearAlumnoDeCaja(e.A.id);
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, { monto: '500.00', metodo: 'YAPE' });
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, {
        monto: '500.00',
        metodo: 'TRANSFERENCIA',
      });

      const respuesta = await egreso(cuerpoEgreso({ monto: '50.01' }));

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('EFECTIVO_INSUFICIENTE');
      expect(detallesDe(respuesta)).toEqual({ disponible: '50.00' });
    });

    it('criterio 21: no hay otro tope para los egresos (DR-4): un egreso de S/ 99999.99 se acepta si hay efectivo', async () => {
      const alumno = await crearAlumnoDeCaja(e.A.id);
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, {
        monto: '99999.99',
        metodo: 'EFECTIVO',
      });
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, { monto: '50.00', metodo: 'EFECTIVO' });

      const respuesta = await egreso(cuerpoEgreso({ monto: '99999.99' }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(cajaDe(respuesta).resumen.esperado.efectivo).toBe('100.00');
    });
  });

  describe('criterio 22: doble clic en el egreso', () => {
    const base = () => ({
      claveIdempotencia: randomUUID(),
      descripcion: 'Compra de útiles',
      monto: '20',
      comprobante: 'Boleta 1',
    });

    it('criterio 22: la misma clave con los mismos datos responde 200 con el mismo { movimiento, caja }, sin otra fila ni otra auditoría', async () => {
      const cuerpo = base();
      const primera = await egreso(cuerpo);
      expect(primera.status, primera.texto).toBe(201);
      const antes = await estado();

      const repetida = await egreso(cuerpo, cookies.admin);

      expect(repetida.status, repetida.texto).toBe(200);
      expect(repetida.cacheControl).toBe('no-store');
      expect(movimientoDe(repetida)).toEqual(movimientoDe(primera));
      expect(cajaDe(repetida)).toEqual(cajaDe(primera));
      expect(await estado()).toEqual(antes);
      expect(await auditorias()).toHaveLength(1);
    });

    it('criterio 22: los datos se comparan recortados y normalizados: "20" y "20.00", espacios alrededor y comprobante vacío o ausente son los mismos', async () => {
      const clave = randomUUID();
      const primera = await egreso({ claveIdempotencia: clave, descripcion: 'Compra de útiles', monto: '20' });
      expect(primera.status, primera.texto).toBe(201);

      for (const variante of [
        { descripcion: 'Compra de útiles', monto: '20.00' },
        { descripcion: '  Compra de útiles  ', monto: '20.0' },
        { descripcion: 'Compra de útiles', monto: '20', comprobante: '' },
        { descripcion: 'Compra de útiles', monto: '20', comprobante: '   ' },
        { descripcion: 'Compra de útiles', monto: '20', comprobante: null },
      ]) {
        const repetida = await egreso({ claveIdempotencia: clave, ...variante });

        expect(repetida.status, `${JSON.stringify(variante)}: ${repetida.texto}`).toBe(200);
      }
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect(await auditorias()).toHaveLength(1);
    });

    it('criterio 22: aunque la caja ya esté cerrada, el reintento responde 200 (la clave se mira antes que el estado de la caja)', async () => {
      const cuerpo = base();
      const primera = await egreso(cuerpo);
      expect(primera.status, primera.texto).toBe(201);
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);

      const repetida = await egreso(cuerpo);

      expect(repetida.status, repetida.texto).toBe(200);
      expect(movimientoDe(repetida).id).toBe(movimientoDe(primera).id);
      expect(cajaDe(repetida).estado).toBe('CERRADA');
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect(await auditorias()).toHaveLength(1);
    });

    it('criterio 22: aunque la caja ya sea de otro día, el reintento responde 200', async () => {
      const cuerpo = base();
      const primera = await egreso(cuerpo);
      expect(primera.status, primera.texto).toBe(201);
      const manana = enLima('2026-11-12', '09:00');
      ctx.reloj.fijar(manana);

      const repetida = await egreso(cuerpo, cookiesDeCaja(e, manana).secretaria);

      expect(repetida.status, repetida.texto).toBe(200);
      expect(cajaDe(repetida).deOtroDia).toBe(true);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });

    it('criterio 22: el reintento no vuelve a comprobar el efectivo: con la clave ya usada responde 200 aunque el egreso hoy ya no cabría', async () => {
      const cuerpo = { ...base(), monto: '100.00' };
      const primera = await egreso(cuerpo);
      expect(primera.status, primera.texto).toBe(201);
      expect(cajaDe(primera).resumen.esperado.efectivo).toBe('0.00');

      const repetida = await egreso(cuerpo);

      expect(repetida.status, repetida.texto).toBe(200);
    });

    it.each([
      ['otro monto', { monto: '20.01' }],
      ['otra descripción', { descripcion: 'Compra de otra cosa' }],
      ['otro comprobante', { comprobante: 'Boleta 2' }],
      ['sin el comprobante que tenía', { comprobante: undefined }],
    ])(
      'criterio 22: la misma clave con %s responde 409 CLAVE_YA_USADA sin escribir ni auditar',
      async (_nombre, cambio) => {
        const cuerpo = base();
        await egreso(cuerpo);
        const antes = await estado();
        // Una propiedad `undefined` no viaja en el JSON: así se envía el cuerpo sin comprobante.
        const distinto: Objeto = { ...cuerpo, ...cambio };

        const repetida = await egreso(distinto);

        expect(repetida.status, repetida.texto).toBe(409);
        expect(codigoDe(repetida)).toBe('CLAVE_YA_USADA');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 22: la clave de un egreso de otra caja responde 409 CLAVE_YA_USADA sin escribir', async () => {
      const clave = randomUUID();
      await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, {
        clave_idempotencia: clave,
        descripcion: 'Compra de útiles',
        monto: '20.00',
      });
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
      // Otro día, otra caja: la de hoy es la nueva y la anterior pasa a ser de ayer.
      const hoy = enLima('2026-11-12', '09:00');
      ctx.reloj.fijar(hoy);
      const otra = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-12' });
      const antes = await estado();

      const respuesta = await egreso(
        { claveIdempotencia: clave, descripcion: 'Compra de útiles', monto: '20' },
        cookiesDeCaja(e, hoy).secretaria,
        otra.id,
      );

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('CLAVE_YA_USADA');
      expect(await estado()).toEqual(antes);
    });

    it('criterio 22: una clave de B no choca con una de A: el mismo UUID registra un egreso en A aunque B ya lo usó', async () => {
      const clave = randomUUID();
      const cajaB = await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      await crearEgresoDePrueba(e.B.id, cajaB.id, e.secretariaB.id, { clave_idempotencia: clave });

      const respuesta = await egreso({ claveIdempotencia: clave, descripcion: 'Compra de útiles', monto: '20' });

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });
  });

  describe('criterio 23: los movimientos no se editan ni se borran', () => {
    it.each([
      ['PATCH', '/api/cajas/{caja}/egresos/{movimiento}'],
      ['DELETE', '/api/cajas/{caja}/egresos/{movimiento}'],
      ['PUT', '/api/cajas/{caja}/egresos/{movimiento}'],
      ['PATCH', '/api/cajas/{caja}'],
      ['DELETE', '/api/cajas/{caja}'],
      ['PATCH', '/api/movimientos-caja/{movimiento}'],
      ['DELETE', '/api/movimientos-caja/{movimiento}'],
      ['PATCH', '/api/cajas/{caja}/cierre'],
      ['DELETE', '/api/cajas/{caja}/cierre'],
      ['DELETE', '/api/cajas/{caja}/cierres/1'],
    ] as const)('criterio 23: %s %s responde 404 y no toca nada', async (metodo, plantilla) => {
      const registrado = movimientoDe(await egreso(cuerpoEgreso({ monto: '10.00' })));
      const antes = await estado();
      const direccion = plantilla.replace('{caja}', caja.id).replace('{movimiento}', registrado.id);

      const respuesta =
        metodo === 'DELETE'
          ? await ctx.http.delete(direccion, cookies.admin)
          : metodo === 'PUT'
            ? await ctx.http.put(direccion, cookies.admin, { monto: '1.00' })
            : await ctx.http.patch(direccion, cookies.admin, { monto: '1.00', descripcion: 'Cambiada' });

      expect(respuesta.status, `${metodo} ${direccion}: ${respuesta.texto}`).toBe(404);
      expect(await estado()).toEqual(antes);
      expect((await leerMovimientos(e.A.id))[0]?.monto).toBe('10.00');
      expect(await leerCajas(e.A.id)).toHaveLength(1);
    });
  });
});
