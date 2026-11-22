// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_CERRADA,
  AYER,
  type AppCaja,
  type CajaDePrueba,
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
  cuerpoApertura,
  cuerpoCierre,
  detallesDe,
  type EscenarioCaja,
  esperadoEfectivoDeAuditoria,
  exigirRutasDeCaja,
  HOY,
  instantaneaDeCaja,
  IP_LOCAL,
  leerCajas,
  leerCierres,
  mensajeDelCampo,
  rutaCaja,
} from '../../utilidades/caja';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterios 29, 30, 31, 32 y 34 (secuenciales) (crítico, HU-27, RN-17, RN-22, RNF-12, D3 y DT-6): el cierre de la caja.
//  29. POST /api/cajas/{C}/cierre con { claveIdempotencia, montoDeclarado, ultimoMovimientoVisto, observacion? }, en una sola transacción, calcula el resumen
//      con los movimientos de C (después de bloquearla), crea el cierre número 1 (o el siguiente) con la foto de lo calculado (`montoInicial`, ingresos por
//      método, egresos, esperado por método, `montoDeclarado`, `diferencia` con signo, `resultado`, `observacion`, `tardio`, `movimientosHasta`,
//      `cerradoPor`, `cerradoEn`), pasa C a CERRADA y responde 200 con { caja } (con el cierre en `cierres`). Registra CAJA_CERRADA (entidad `caja`) con
//      datosDespues { numeroCierre, esperado, montoDeclarado, diferencia, resultado, observacion, tardio }. Cualquier SECRETARIA o ADMIN de A puede cerrar.
//  30. `montoDeclarado` usa `montoNoNegativoSchema` ("0" se acepta); `ultimoMovimientoVisto` es un entero de 0 a 1 000 000; `observacion` es opcional, con
//      `textoVisibleSchema` de 3 a 500 caracteres. Si la diferencia calculada no es 0 y no hay observación, 400 SOLICITUD_INVALIDA con
//      `detalles.errores[0].campo` igual a `observacion` y el mensaje "Explica la diferencia (sobrante o faltante)", sin escribir ni auditar.
//  31. Si `ultimoMovimientoVisto` no es igual al `ultimoMovimiento` de C dentro de la transacción, 409 CAJA_CAMBIO con { ultimoMovimiento }, sin escribir ni
//      auditar.
//  32. La caja de otro día se cierra como cualquier cierre, con `tardio: true` (la fecha de Lima de `cerradoEn` es posterior a la de C); después, la apertura
//      de la caja del día nuevo responde 201. Un cierre el mismo día en Lima (también a las 19:30, que en UTC ya es el día siguiente) tiene `tardio: false`.
//  34. Doble clic: la misma clave y el mismo `montoDeclarado` responden 200 con { caja } (como está ahora), sin otro cierre ni otra auditoría; con la clave K
//      y otro monto, 409 CLAVE_YA_USADA; con otra clave sobre C ya cerrada, 409 CAJA_CERRADA.
// Orden: 404 -> CLAVE_YA_USADA (o el 200) -> CAJA_CERRADA -> CAJA_CAMBIO -> 400 `observacion`, después del 400 del esquema. Los cruces con un egreso o un
// cobro y los cierres simultáneos están en `cierre-carreras.test.ts`.

const ZONA_ORIGINAL = process.env['TZ'];

describe('cierre de la caja (criterios 29 a 32 y 34)', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let caja: CajaDePrueba;

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    process.env['TZ'] = 'UTC';
    exigirRutasDeCaja(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });

  /** La caja de hoy con S/ 100.00 y, si se pide, los movimientos del ejemplo: ingresos de 42.00 (efectivo), 88.00 (Yape) y 120.00 (transferencia) y un egreso de 15.50. */
  async function prepararCaja(conMovimientos = true): Promise<CajaDePrueba> {
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    if (conMovimientos) {
      const alumno = await crearAlumnoDeCaja(e.A.id);
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, { monto: '42.00', metodo: 'EFECTIVO' });
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, { monto: '88.00', metodo: 'YAPE' });
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, {
        monto: '120.00',
        metodo: 'TRANSFERENCIA',
      });
      await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, { monto: '15.50' });
    }
    return caja;
  }

  const cerrar = (cuerpo: unknown, cookie = cookies.secretaria, id = caja.id) =>
    ctx.http.post(rutaCaja(id, '/cierre'), cookie, cuerpo);
  const auditorias = () => leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_CERRADA);
  const CUADRA = () => cuerpoCierre({ montoDeclarado: '126.50', ultimoMovimientoVisto: 4 });

  async function estado() {
    return {
      cajas: await instantaneaDeCaja(e.A.id),
      cajasB: await instantaneaDeCaja(e.B.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }

  describe('criterio 29: cerrar la caja', () => {
    it.each([
      ['la secretaria que la abrió', 'secretaria', 'Lucia', 'Benites'],
      ['otra secretaria', 'secretaria2', 'Marta', 'Huaman'],
      ['el administrador', 'admin', 'Rosa', 'Alvarez'],
    ] as const)(
      'criterio 29: %s cierra la caja con lo que cuadra: 200 con { caja } CERRADA y el cierre número 1 con la foto del resumen',
      async (_quien, rol, nombres, apellidos) => {
        await prepararCaja();
        const actor = { secretaria: e.secretariaA, secretaria2: e.secretariaA2, admin: e.adminA }[rol];

        const respuesta = await cerrar(CUADRA(), cookies[rol]);

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(respuesta.cacheControl).toBe('no-store');
        expect(Object.keys(respuesta.body ?? {})).toEqual(['caja']);
        const cerrada = cajaDe(respuesta);
        expect(cerrada).toMatchObject({ id: caja.id, estado: 'CERRADA', fecha: HOY, montoInicial: '100.00' });
        expect(cerrada.resumen).toEqual({
          ingresos: { efectivo: '42.00', yape: '88.00', transferencia: '120.00' },
          egresos: { efectivo: '15.50' },
          esperado: { efectivo: '126.50', yape: '88.00', transferencia: '120.00' },
          ultimoMovimiento: 4,
        });
        expect(cerrada.cierres).toHaveLength(1);
        const cierre = cerrada.cierres[0];
        expect(cierre).toMatchObject({
          numero: 1,
          cerradoPor: { id: actor.id, nombres, apellidos },
          montoInicial: '100.00',
          ingresos: { efectivo: '42.00', yape: '88.00', transferencia: '120.00' },
          egresos: { efectivo: '15.50' },
          esperado: { efectivo: '126.50', yape: '88.00', transferencia: '120.00' },
          montoDeclarado: '126.50',
          diferencia: '0.00',
          resultado: 'CUADRA',
          observacion: null,
          tardio: false,
          movimientosHasta: 4,
          reapertura: null,
        });
        expect(Date.parse(cierre?.cerradoEn ?? '')).toBe(AHORA_PRUEBAS.getTime());
        expect(respuesta.texto, 'el DNI nunca sale en la caja').not.toContain(actor.dni);
      },
    );

    it('criterio 29: en la base queda el cierre con la foto (todos los montos) y la caja pasa a CERRADA', async () => {
      await prepararCaja();
      const clave = randomUUID();

      const respuesta = await cerrar({ ...CUADRA(), claveIdempotencia: clave });

      expect(respuesta.status, respuesta.texto).toBe(200);
      const cierres = await leerCierres(e.A.id);
      expect(cierres).toHaveLength(1);
      expect(cierres[0]).toMatchObject({
        caja_id: caja.id,
        numero: 1,
        movimientos_hasta: 4,
        monto_inicial: '100.00',
        ingresos_efectivo: '42.00',
        ingresos_yape: '88.00',
        ingresos_transferencia: '120.00',
        egresos_efectivo: '15.50',
        esperado_efectivo: '126.50',
        monto_declarado: '126.50',
        diferencia: '0.00',
        observacion: null,
        tardio: false,
        cerrado_por: e.secretariaA.id,
        clave_idempotencia: clave,
        reabierto_por: null,
        reabierto_en: null,
        motivo_reapertura: null,
      });
      expect(cierres[0]?.cerrado_en.getTime()).toBe(AHORA_PRUEBAS.getTime());
      expect((await leerCajas(e.A.id))[0]?.estado).toBe('CERRADA');
    });

    it('criterio 29: registra una sola auditoría CAJA_CERRADA (entidad caja, el id de la caja, actor USUARIO con su IP) con datosDespues { numeroCierre, esperado, montoDeclarado, diferencia, resultado, observacion, tardio }', async () => {
      await prepararCaja();

      await cerrar(CUADRA(), cookies.admin);

      const filas = await auditorias();
      expect(filas).toHaveLength(1);
      const fila = filas[0];
      expect(fila?.entidad).toBe('caja');
      expect(fila?.entidad_id).toBe(caja.id);
      expect(fila?.actor_tipo).toBe('USUARIO');
      expect(fila?.actor_id).toBe(e.adminA.id);
      expect(fila?.ip).toMatch(IP_LOCAL);
      const datos = fila?.datos_despues as Record<string, unknown>;
      expect(datos).toMatchObject({
        numeroCierre: 1,
        montoDeclarado: '126.50',
        diferencia: '0.00',
        resultado: 'CUADRA',
        observacion: null,
        tardio: false,
      });
      expect(esperadoEfectivoDeAuditoria(datos['esperado'])).toBe('126.50');
    });

    it('criterio 29 y 30: con un faltante de S/ 4.50 (abrir con 100, un egreso de 15.50, contar 80) y su observación: diferencia "-4.50", FALTANTE, y la observación queda en el cierre y en la auditoría', async () => {
      await prepararCaja(false);
      await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, { monto: '15.50' });

      const respuesta = await cerrar({
        claveIdempotencia: randomUUID(),
        montoDeclarado: '80',
        ultimoMovimientoVisto: 1,
        observacion: 'Faltaron 4.50 en el cajón',
      });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta).cierres[0]).toMatchObject({
        esperado: { efectivo: '84.50', yape: '0.00', transferencia: '0.00' },
        montoDeclarado: '80.00',
        diferencia: '-4.50',
        resultado: 'FALTANTE',
        observacion: 'Faltaron 4.50 en el cajón',
      });
      expect((await leerCierres(e.A.id))[0]).toMatchObject({
        diferencia: '-4.50',
        observacion: 'Faltaron 4.50 en el cajón',
      });
      expect((await auditorias())[0]?.datos_despues).toMatchObject({
        diferencia: '-4.50',
        resultado: 'FALTANTE',
        observacion: 'Faltaron 4.50 en el cajón',
      });
    });

    it('criterio 29: con un sobrante, la diferencia es positiva y el resultado SOBRANTE', async () => {
      await prepararCaja();

      const respuesta = await cerrar({
        claveIdempotencia: randomUUID(),
        montoDeclarado: '130.5',
        ultimoMovimientoVisto: 4,
        observacion: 'Sobraron cuatro soles',
      });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta).cierres[0]).toMatchObject({
        montoDeclarado: '130.50',
        diferencia: '4.00',
        resultado: 'SOBRANTE',
      });
    });

    it('criterio 29: el esperado de Yape y de transferencia no cuentan para el efectivo: declarar 126.50 cuadra aunque hay 208.00 por otros métodos', async () => {
      await prepararCaja();

      const respuesta = await cerrar({ ...CUADRA(), montoDeclarado: '334.50', observacion: 'Contó todo junto' });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta).cierres[0]).toMatchObject({ diferencia: '208.00', resultado: 'SOBRANTE' });
    });

    it('criterio 29: una caja sin movimientos se cierra igual: el esperado es el monto inicial y ultimoMovimientoVisto es 0', async () => {
      await prepararCaja(false);

      const respuesta = await cerrar(cuerpoCierre({ montoDeclarado: '100', ultimoMovimientoVisto: 0 }));

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta).cierres[0]).toMatchObject({
        esperado: { efectivo: '100.00', yape: '0.00', transferencia: '0.00' },
        montoDeclarado: '100.00',
        diferencia: '0.00',
        resultado: 'CUADRA',
        movimientosHasta: 0,
      });
    });

    it('criterio 29: cerrar no cambia los movimientos de la caja ni los de B', async () => {
      await prepararCaja();
      await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      const antesB = await instantaneaDeCaja(e.B.id);

      await cerrar(CUADRA());

      expect(await instantaneaDeCaja(e.B.id)).toBe(antesB);
    });
  });

  describe('criterio 30: declarado y observación', () => {
    it('criterio 30: "0" se acepta (la caja puede quedar sin efectivo): el faltante es todo el esperado y exige observación', async () => {
      await prepararCaja(false);

      const sinObservacion = await cerrar(cuerpoCierre({ montoDeclarado: '0', ultimoMovimientoVisto: 0 }));
      const conObservacion = await cerrar(
        cuerpoCierre({ montoDeclarado: '0', ultimoMovimientoVisto: 0, observacion: 'Se llevaron todo el efectivo' }),
      );

      expect(sinObservacion.status, sinObservacion.texto).toBe(400);
      expect(conObservacion.status, conObservacion.texto).toBe(200);
      expect(cajaDe(conObservacion).cierres[0]).toMatchObject({
        montoDeclarado: '0.00',
        diferencia: '-100.00',
        resultado: 'FALTANTE',
      });
    });

    it.each([
      ['un número JSON', 150],
      ['negativo', '-1'],
      ['menos cero', '-0'],
      ['con tres decimales', '150.505'],
      ['en notación científica', '1e2'],
      ['con coma', '150,50'],
      ['con un espacio al inicio', ' 150'],
      ['sobre el máximo', '100000'],
      ['vacío', ''],
      ['nulo', null],
    ])(
      'criterio 30: un montoDeclarado %s responde 400 SOLICITUD_INVALIDA en montoDeclarado sin escribir ni auditar',
      async (_nombre, monto) => {
        await prepararCaja(false);
        const antes = await estado();

        const respuesta = await cerrar(cuerpoCierre({ montoDeclarado: monto }));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('montoDeclarado');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 30: sin montoDeclarado responde 400 en montoDeclarado', async () => {
      await prepararCaja(false);
      const cuerpo = cuerpoCierre();
      delete cuerpo['montoDeclarado'];

      const respuesta = await cerrar(cuerpo);

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(camposConError(respuesta)).toContain('montoDeclarado');
    });

    it.each([
      ['negativo', -1],
      ['sobre el máximo', 1_000_001],
      ['con decimales', 1.5],
      ['un texto', '3'],
      ['nulo', null],
    ])(
      'criterio 30: un ultimoMovimientoVisto %s responde 400 SOLICITUD_INVALIDA en ultimoMovimientoVisto sin escribir ni auditar',
      async (_nombre, visto) => {
        await prepararCaja(false);
        const antes = await estado();

        const respuesta = await cerrar(cuerpoCierre({ ultimoMovimientoVisto: visto }));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(camposConError(respuesta)).toContain('ultimoMovimientoVisto');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 30: sin ultimoMovimientoVisto responde 400 en ultimoMovimientoVisto', async () => {
      await prepararCaja(false);
      const cuerpo = cuerpoCierre();
      delete cuerpo['ultimoMovimientoVisto'];

      const respuesta = await cerrar(cuerpo);

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(camposConError(respuesta)).toContain('ultimoMovimientoVisto');
    });

    it('criterio 30: ultimoMovimientoVisto de 0 y de 1 000 000 son válidos para el esquema (con otro valor que el real responden 409, no 400)', async () => {
      await prepararCaja(false);

      const enElLimite = await cerrar(cuerpoCierre({ ultimoMovimientoVisto: 1_000_000 }));

      expect(enElLimite.status, enElLimite.texto).toBe(409);
      expect(codigoDe(enElLimite)).toBe('CAJA_CAMBIO');
    });

    it.each([
      ['de 2 caracteres', 'ab'],
      ['de 2 caracteres recortada', '  ab  '],
      ['vacía', ''],
      ['solo espacios', '     '],
      ['de 501 caracteres', 'a'.repeat(501)],
      ['con un salto de línea', 'Faltó\ndinero'],
      ['con un carácter nulo', 'Faltó\u0000dinero'],
      ['un número', 12345],
    ])(
      'criterio 30: una observación %s responde 400 SOLICITUD_INVALIDA en observacion sin escribir ni auditar',
      async (_nombre, observacion) => {
        await prepararCaja(false);
        const antes = await estado();

        const respuesta = await cerrar(cuerpoCierre({ montoDeclarado: '100.00', observacion }));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('observacion');
        expect(await estado()).toEqual(antes);
      },
    );

    it.each([
      ['de 3 caracteres', 'abc'],
      ['de 500 caracteres', 'a'.repeat(500)],
    ])(
      'criterio 30: una observación %s se acepta (límites) y se guarda aunque la diferencia sea 0',
      async (_nombre, observacion) => {
        await prepararCaja(false);

        const respuesta = await cerrar(cuerpoCierre({ montoDeclarado: '100.00', observacion }));

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(cajaDe(respuesta).cierres[0]?.observacion).toBe(observacion);
        expect((await leerCierres(e.A.id))[0]?.observacion).toBe(observacion);
      },
    );

    it('criterio 30: con diferencia 0 la observación nula o ausente deja null', async () => {
      await prepararCaja(false);

      const respuesta = await cerrar(cuerpoCierre({ montoDeclarado: '100.00', observacion: null }));

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta).cierres[0]?.observacion).toBeNull();
    });

    it('criterio 30: la observación se guarda recortada', async () => {
      await prepararCaja(false);

      const respuesta = await cerrar(cuerpoCierre({ montoDeclarado: '99.00', observacion: '  Faltó un sol  ' }));

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta).cierres[0]?.observacion).toBe('Faltó un sol');
    });

    it.each([
      ['faltante', '99.99'],
      ['sobrante', '100.01'],
    ])(
      'criterio 30: con diferencia distinta de 0 (%s, declarado %s) y sin observación responde 400 SOLICITUD_INVALIDA con errores[0].campo "observacion" y el mensaje "Explica la diferencia (sobrante o faltante)", sin escribir ni auditar',
      async (_nombre, declarado) => {
        await prepararCaja(false);
        const antes = await estado();

        const respuesta = await cerrar(cuerpoCierre({ montoDeclarado: declarado }));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)[0]).toBe('observacion');
        expect(mensajeDelCampo(respuesta, 'observacion')).toBe('Explica la diferencia (sobrante o faltante)');
        expect(await estado()).toEqual(antes);
        expect(await auditorias()).toHaveLength(0);
      },
    );

    it('criterio 30: la diferencia de un céntimo cuenta como diferencia ("-0.01" y "0.01") y con observación se registra', async () => {
      await prepararCaja(false);

      const faltante = await cerrar(cuerpoCierre({ montoDeclarado: '99.99', observacion: 'Un céntimo menos' }));

      expect(faltante.status, faltante.texto).toBe(200);
      expect(cajaDe(faltante).cierres[0]).toMatchObject({ diferencia: '-0.01', resultado: 'FALTANTE' });
    });

    it('criterio 30: el 409 CAJA_CAMBIO gana sobre el 400 de la observación (orden: CAJA_CAMBIO -> observacion)', async () => {
      await prepararCaja();

      const respuesta = await cerrar(cuerpoCierre({ montoDeclarado: '1.00', ultimoMovimientoVisto: 3 }));

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('CAJA_CAMBIO');
    });

    it('criterio 30: el cuerpo se valida antes que el id: un cuerpo inválido sobre una caja que no existe responde 400, no 404', async () => {
      const respuesta = await cerrar({ montoDeclarado: 'x' }, cookies.secretaria, randomUUID());

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
    });
  });

  describe('criterio 31: el cierre se hace sobre lo que se vio', () => {
    it.each([
      ['uno menos que el real', 3],
      ['cero con movimientos', 0],
      ['uno más que el real', 5],
    ])(
      'criterio 31: con ultimoMovimientoVisto %s responde 409 CAJA_CAMBIO con { ultimoMovimiento: 4 } sin escribir ni auditar y la caja sigue abierta',
      async (_nombre, visto) => {
        await prepararCaja();
        const antes = await estado();

        const respuesta = await cerrar({ ...CUADRA(), ultimoMovimientoVisto: visto });

        expect(respuesta.status, respuesta.texto).toBe(409);
        expect(codigoDe(respuesta)).toBe('CAJA_CAMBIO');
        expect(detallesDe(respuesta)).toEqual({ ultimoMovimiento: 4 });
        expect(await estado()).toEqual(antes);
        expect((await leerCajas(e.A.id))[0]?.estado).toBe('ABIERTA');
        expect(await auditorias()).toHaveLength(0);
      },
    );

    it('criterio 31: en una caja sin movimientos, ultimoMovimientoVisto 1 responde 409 CAJA_CAMBIO con { ultimoMovimiento: 0 }', async () => {
      await prepararCaja(false);

      const respuesta = await cerrar(cuerpoCierre({ ultimoMovimientoVisto: 1 }));

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(detallesDe(respuesta)).toEqual({ ultimoMovimiento: 0 });
    });

    it('criterio 31: entró un egreso después de cargar la pantalla: el cierre con el número anterior responde 409 y, con el nuevo, se acepta', async () => {
      await prepararCaja(false);
      const visto = 0;
      await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, { monto: '10.00' });

      const rechazado = await cerrar(cuerpoCierre({ montoDeclarado: '90.00', ultimoMovimientoVisto: visto }));
      const aceptado = await cerrar(cuerpoCierre({ montoDeclarado: '90.00', ultimoMovimientoVisto: 1 }));

      expect(rechazado.status, rechazado.texto).toBe(409);
      expect(codigoDe(rechazado)).toBe('CAJA_CAMBIO');
      expect(aceptado.status, aceptado.texto).toBe(200);
    });
  });

  describe.each(['UTC', 'Asia/Tokyo'])(
    'criterio 32: cierre de una caja de otro día, con el proceso en TZ=%s',
    (zona) => {
      beforeEach(() => {
        process.env['TZ'] = zona;
      });

      async function cerrarEl(fecha: string, instante: string) {
        const ahora = new Date(instante);
        const deOtroDia = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha, monto_inicial: '100.00' });
        ctx.reloj.fijar(ahora);
        const cookie = cookiesDeCaja(e, ahora).secretaria;
        const respuesta = await ctx.http.post(
          rutaCaja(deOtroDia.id, '/cierre'),
          cookie,
          cuerpoCierre({ montoDeclarado: '100.00', ultimoMovimientoVisto: 0 }),
        );
        return { respuesta, cookie, ahora };
      }

      it.each([
        [
          '10:00 del 1 de diciembre en Lima, con la caja del 30 de noviembre',
          '2026-11-30',
          '2026-12-01T15:00:00.000Z',
          true,
        ],
        ['00:00 del 1 de diciembre en Lima', '2026-11-30', '2026-12-01T05:00:00.000Z', true],
        ['23:59:59.999 del 30 de noviembre en Lima', '2026-11-30', '2026-12-01T04:59:59.999Z', false],
        [
          '19:30 del 30 de noviembre en Lima (en UTC ya es el 1 de diciembre)',
          '2026-11-30',
          '2026-12-01T00:30:00.000Z',
          false,
        ],
        [
          '20:30 del 30 de noviembre en Lima, después de la clase de 19:00 a 20:00',
          '2026-11-30',
          '2026-12-01T01:30:00.000Z',
          false,
        ],
        [
          '00:00 del 1 de enero en Lima, con la caja del 31 de diciembre',
          '2026-12-31',
          '2027-01-01T05:00:00.000Z',
          true,
        ],
        ['23:59:59.999 del 31 de diciembre en Lima', '2026-12-31', '2027-01-01T04:59:59.999Z', false],
      ])('criterio 32: cerrar a las %s: 200 con tardio = %s', async (_nombre, fecha, instante, tardio) => {
        const { respuesta } = await cerrarEl(fecha, instante);

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(cajaDe(respuesta).cierres[0]?.tardio).toBe(tardio);
        expect((await leerCierres(e.A.id))[0]?.tardio).toBe(tardio);
        expect((await auditorias())[0]?.datos_despues).toMatchObject({ tardio });
      });

      it('criterio 32: después del cierre tardío, la apertura de la caja del 1 de diciembre responde 201', async () => {
        const { cookie } = await cerrarEl('2026-11-30', '2026-12-01T15:00:00.000Z');

        const apertura = await ctx.http.post('/api/cajas', cookie, cuerpoApertura());

        expect(apertura.status, apertura.texto).toBe(201);
        expect(cajaDe(apertura).fecha).toBe('2026-12-01');
        expect((await leerCajas(e.A.id)).map((c) => [c.fecha, c.estado])).toEqual([
          ['2026-11-30', 'CERRADA'],
          ['2026-12-01', 'ABIERTA'],
        ]);
      });

      it('criterio 32: antes de cerrar la caja pendiente, la apertura de la de hoy responde 409 CAJA_PENDIENTE_DE_CIERRE (DR-2)', async () => {
        const ahora = new Date('2026-12-01T15:00:00.000Z');
        const pendiente = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-30' });
        ctx.reloj.fijar(ahora);

        const apertura = await ctx.http.post('/api/cajas', cookiesDeCaja(e, ahora).secretaria, cuerpoApertura());

        expect(apertura.status, apertura.texto).toBe(409);
        expect(codigoDe(apertura)).toBe('CAJA_PENDIENTE_DE_CIERRE');
        expect(detallesDe(apertura)).toEqual({ cajaId: pendiente.id, fecha: '2026-11-30' });
      });
    },
  );

  describe('criterio 34: doble clic en el cierre', () => {
    it('criterio 34: la misma clave con el mismo monto responde 200 con { caja } como está ahora, sin otro cierre ni otra auditoría', async () => {
      await prepararCaja();
      const cuerpo = CUADRA();
      const primera = await cerrar(cuerpo);
      expect(primera.status, primera.texto).toBe(200);
      const antes = await estado();

      const repetida = await cerrar(cuerpo, cookies.admin);

      expect(repetida.status, repetida.texto).toBe(200);
      expect(repetida.cacheControl).toBe('no-store');
      expect(cajaDe(repetida)).toEqual(cajaDe(primera));
      expect(await estado()).toEqual(antes);
      expect(await auditorias()).toHaveLength(1);
      expect(await leerCierres(e.A.id)).toHaveLength(1);
    });

    it('criterio 34: el monto equivalente ("126.5" y "126.50") es el mismo monto: 200', async () => {
      await prepararCaja();
      const clave = randomUUID();
      const primera = await cerrar({ ...CUADRA(), claveIdempotencia: clave, montoDeclarado: '126.5' });
      expect(primera.status, primera.texto).toBe(200);

      const repetida = await cerrar({ ...CUADRA(), claveIdempotencia: clave, montoDeclarado: '126.50' });

      expect(repetida.status, repetida.texto).toBe(200);
      expect(await leerCierres(e.A.id)).toHaveLength(1);
    });

    it('criterio 34: la misma clave con otro monto responde 409 CLAVE_YA_USADA y el cierre guardado es el primero', async () => {
      await prepararCaja();
      const cuerpo = CUADRA();
      await cerrar(cuerpo);
      const antes = await estado();

      const repetida = await cerrar({ ...cuerpo, montoDeclarado: '126.51', observacion: 'Otro conteo' });

      expect(repetida.status, repetida.texto).toBe(409);
      expect(codigoDe(repetida)).toBe('CLAVE_YA_USADA');
      expect(await estado()).toEqual(antes);
      expect((await leerCierres(e.A.id))[0]?.monto_declarado).toBe('126.50');
    });

    it('criterio 34: con otra clave sobre la caja ya cerrada responde 409 CAJA_CERRADA sin escribir ni auditar', async () => {
      await prepararCaja();
      await cerrar(CUADRA());
      const antes = await estado();

      const otra = await cerrar(CUADRA(), cookies.admin);

      expect(otra.status, otra.texto).toBe(409);
      expect(codigoDe(otra)).toBe('CAJA_CERRADA');
      expect(await estado()).toEqual(antes);
    });

    it('criterio 34: una clave de B no choca con una de A: el mismo UUID cierra la caja de A aunque B ya lo usó', async () => {
      await prepararCaja();
      const clave = randomUUID();
      const cajaB = await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      await cerrarCajaDePrueba(e.B.id, cajaB.id, e.secretariaB.id, { clave });

      const respuesta = await cerrar({ ...CUADRA(), claveIdempotencia: clave });

      expect(respuesta.status, respuesta.texto).toBe(200);
    });

    it('criterio 34: la clave se mira antes que el estado: tras reabrir la caja, un reintento tardío de la clave del cierre responde 200 con la caja como está (abierta) y no la cierra otra vez', async () => {
      await prepararCaja();
      const cuerpo = CUADRA();
      expect((await cerrar(cuerpo)).status).toBe(200);
      const reapertura = await ctx.http.post(rutaCaja(caja.id, '/reapertura'), cookies.admin, {
        motivo: 'Se cerró por error a mediodía',
      });
      expect(reapertura.status, reapertura.texto).toBe(200);

      const repetida = await cerrar(cuerpo);

      expect(repetida.status, repetida.texto).toBe(200);
      expect(cajaDe(repetida).estado).toBe('ABIERTA');
      expect((await leerCajas(e.A.id))[0]?.estado).toBe('ABIERTA');
      expect(await leerCierres(e.A.id)).toHaveLength(1);
    });
  });

  describe('Otras comprobaciones del cierre', () => {
    it('criterio 29: el id de una caja que no existe o que no es UUID responde 404 NO_ENCONTRADO', async () => {
      for (const id of [randomUUID(), 'no-es-un-uuid']) {
        const respuesta = await cerrar(cuerpoCierre(), cookies.secretaria, id);

        expect(respuesta.status, id).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
      }
    });

    it('criterio 29: la caja abierta de ayer (de otro día) se cierra aunque nadie la haya tocado hoy y la de hoy no exista', async () => {
      const pendiente = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER, monto_inicial: '100.00' });

      const respuesta = await cerrar(
        cuerpoCierre({ montoDeclarado: '100.00', ultimoMovimientoVisto: 0 }),
        cookies.secretaria,
        pendiente.id,
      );

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta).cierres[0]?.tardio).toBe(true);
    });
  });
});
