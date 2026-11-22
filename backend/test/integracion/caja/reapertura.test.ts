// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_CERRADA,
  ACCION_CAJA_REABIERTA,
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
  cuerpoEgreso,
  cuerpoReapertura,
  detallesDe,
  enLima,
  type EscenarioCaja,
  exigirRutasDeCaja,
  HOY,
  instantaneaDeCaja,
  IP_LOCAL,
  leerCajas,
  leerCierres,
  leerMovimientos,
  rutaCaja,
} from '../../utilidades/caja';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterios 35 y 36 (secuenciales) (crítico, HU-27, sección 8.8, sección 11.4: motivo y auditoría, RN-17): la reapertura.
//  35. POST /api/cajas/{C}/reapertura con { motivo } (textoVisibleSchema de 3 a 200) por un ADMIN: en una sola transacción, el cierre vigente de C guarda
//      `reabiertoPor`, `reabiertoEn` y `motivoReapertura`, C pasa a ABIERTA y responde 200 con { caja }. Registra CAJA_REABIERTA (entidad `caja`) con `motivo`,
//      datosAntes { estado: 'CERRADA', numeroCierre, montoDeclarado, diferencia } y datosDespues { estado: 'ABIERTA' }. Si es la caja de hoy, vuelve a admitir
//      egresos y cobros; al cerrarla otra vez se crea el cierre número 2, y el número 1 sigue en `cierres` con su reapertura.
//  36. a) Si C ya está ABIERTA, 200 con { caja } sin escribir ni auditar (doble clic: dos reaperturas dejan una sola auditoría). b) Si otra caja de A está
//      abierta, 409 HAY_OTRA_CAJA_ABIERTA con { cajaId, fecha }, sin escribir ni auditar. c) Se puede reabrir la caja de un día anterior; queda abierta como
//      caja de otro día: no admite movimientos (criterio 20) y solo se puede volver a cerrar, con `tardio: true` (DR-8). d) Un ADMIN de B sobre una caja de A, un
//      id que no existe o que no es UUID: 404 NO_ENCONTRADO, el mismo cuerpo.
// Las reaperturas y aperturas simultáneas están en `reapertura-carreras.test.ts`.

describe('reapertura de la caja (criterios 35 y 36)', () => {
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
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  /** La caja de `fecha` (por defecto hoy) con S/ 100.00 y un egreso de 15.50, ya cerrada con `montoDeclarado` (por defecto, lo que cuadra: 84.50). */
  async function cajaCerrada(fecha = HOY, montoDeclarado = '84.50', observacion?: string): Promise<CajaDePrueba> {
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha, monto_inicial: '100.00' });
    await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, {
      monto: '15.50',
      registrado_en: enLima(fecha, fecha === HOY ? '09:40' : '10:00'),
    });
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, {
      montoDeclarado,
      observacion,
      // Hoy se cierra antes del reloj de las pruebas (10:00): así `reabierto_en` es exactamente `AHORA_PRUEBAS` y cumple `reabierto_en >= cerrado_en`.
      cerradoEn: enLima(fecha, fecha === HOY ? '09:50' : '18:00'),
    });
    return caja;
  }

  const reabrir = (cuerpo: unknown = cuerpoReapertura(), cookie = cookies.admin, id = caja.id) =>
    ctx.http.post(rutaCaja(id, '/reapertura'), cookie, cuerpo);
  const auditorias = () => leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_REABIERTA);

  async function estado() {
    return {
      cajas: await instantaneaDeCaja(e.A.id),
      cajasB: await instantaneaDeCaja(e.B.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }

  describe('criterio 35: reabrir un cierre', () => {
    it('criterio 35: el ADMIN reabre la caja cerrada de hoy: 200 con { caja } ABIERTA, y el cierre vigente guarda quién, cuándo y el motivo', async () => {
      await cajaCerrada();

      const respuesta = await reabrir({ motivo: 'Se cerró por error a mediodía' });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {})).toEqual(['caja']);
      const abierta = cajaDe(respuesta);
      expect(abierta).toMatchObject({ id: caja.id, estado: 'ABIERTA', fecha: HOY, deOtroDia: false });
      expect(abierta.cierres).toHaveLength(1);
      expect(abierta.cierres[0]?.numero).toBe(1);
      expect(abierta.cierres[0]?.reapertura).toMatchObject({
        reabiertaPor: { id: e.adminA.id, nombres: 'Rosa', apellidos: 'Alvarez' },
        motivo: 'Se cerró por error a mediodía',
      });
      expect(Date.parse(abierta.cierres[0]?.reapertura?.reabiertaEn ?? '')).toBe(AHORA_PRUEBAS.getTime());
      expect(abierta.resumen.esperado.efectivo).toBe('84.50');
      expect(respuesta.texto, 'el DNI nunca sale en la caja').not.toContain(e.adminA.dni);
    });

    it('criterio 35: en la base, el cierre vigente guarda reabierto_por, reabierto_en y motivo_reapertura, y la caja pasa a ABIERTA', async () => {
      await cajaCerrada();

      await reabrir({ motivo: 'Se cerró por error a mediodía' });

      const cierres = await leerCierres(e.A.id);
      expect(cierres).toHaveLength(1);
      expect(cierres[0]).toMatchObject({
        numero: 1,
        reabierto_por: e.adminA.id,
        motivo_reapertura: 'Se cerró por error a mediodía',
      });
      expect(cierres[0]?.reabierto_en?.getTime()).toBe(AHORA_PRUEBAS.getTime());
      expect((await leerCajas(e.A.id))[0]?.estado).toBe('ABIERTA');
    });

    it('criterio 35: registra una sola auditoría CAJA_REABIERTA (entidad caja, actor USUARIO con su IP, motivo) con datosAntes { estado, numeroCierre, montoDeclarado, diferencia } y datosDespues { estado: ABIERTA }', async () => {
      await cajaCerrada(HOY, '80.00', 'Faltaron 4.50');

      await reabrir({ motivo: 'Recontar el efectivo' });

      const filas = await auditorias();
      expect(filas).toHaveLength(1);
      const fila = filas[0];
      expect(fila?.entidad).toBe('caja');
      expect(fila?.entidad_id).toBe(caja.id);
      expect(fila?.actor_tipo).toBe('USUARIO');
      expect(fila?.actor_id).toBe(e.adminA.id);
      expect(fila?.ip).toMatch(IP_LOCAL);
      expect(fila?.motivo).toBe('Recontar el efectivo');
      expect(fila?.datos_antes).toEqual({
        estado: 'CERRADA',
        numeroCierre: 1,
        montoDeclarado: '80.00',
        diferencia: '-4.50',
      });
      expect(fila?.datos_despues).toEqual({ estado: 'ABIERTA' });
    });

    it('criterio 35: si es la caja de hoy, vuelve a admitir egresos; al cerrarla otra vez se crea el cierre número 2 y el número 1 sigue en cierres con su reapertura', async () => {
      await cajaCerrada();
      expect((await ctx.http.post(rutaCaja(caja.id, '/egresos'), cookies.secretaria, cuerpoEgreso())).status).toBe(409);

      expect((await reabrir()).status).toBe(200);
      const egreso = await ctx.http.post(
        rutaCaja(caja.id, '/egresos'),
        cookies.secretaria,
        cuerpoEgreso({ monto: '4.50' }),
      );
      expect(egreso.status, egreso.texto).toBe(201);
      const cierre = await ctx.http.post(
        rutaCaja(caja.id, '/cierre'),
        cookies.secretaria,
        cuerpoCierre({ montoDeclarado: '80.00', ultimoMovimientoVisto: 2 }),
      );

      expect(cierre.status, cierre.texto).toBe(200);
      const cerrada = cajaDe(cierre);
      expect(cerrada.estado).toBe('CERRADA');
      expect(cerrada.cierres.map((c) => c.numero)).toEqual([1, 2]);
      expect(cerrada.cierres[0]?.reapertura).toMatchObject({ reabiertaPor: { id: e.adminA.id } });
      expect(cerrada.cierres[1]).toMatchObject({
        montoDeclarado: '80.00',
        diferencia: '0.00',
        movimientosHasta: 2,
        reapertura: null,
      });
      expect(cerrada.cierres[0]?.movimientosHasta, 'el cierre 1 conserva lo que cubría').toBe(1);
      const cierres = await leerCierres(e.A.id);
      expect(cierres.map((c) => [c.numero, c.reabierto_en === null])).toEqual([
        [1, false],
        [2, true],
      ]);
    });

    it('criterio 35: una caja que se reabre dos veces deja los cierres 1, 2 y 3; solo el último está vigente y los anteriores muestran su reapertura', async () => {
      await cajaCerrada();
      expect((await reabrir({ motivo: 'Primera reapertura' })).status).toBe(200);
      const segundo = await ctx.http.post(
        rutaCaja(caja.id, '/cierre'),
        cookies.secretaria,
        cuerpoCierre({ montoDeclarado: '84.50', ultimoMovimientoVisto: 1 }),
      );
      expect(segundo.status, segundo.texto).toBe(200);
      expect((await reabrir({ motivo: 'Segunda reapertura' }, cookies.admin2)).status).toBe(200);

      const tercero = await ctx.http.post(
        rutaCaja(caja.id, '/cierre'),
        cookies.secretaria,
        cuerpoCierre({ montoDeclarado: '84.50', ultimoMovimientoVisto: 1 }),
      );

      expect(tercero.status, tercero.texto).toBe(200);
      const cerrada = cajaDe(tercero);
      expect(cerrada.cierres.map((c) => c.numero)).toEqual([1, 2, 3]);
      expect(cerrada.cierres.map((c) => c.reapertura?.motivo ?? null)).toEqual([
        'Primera reapertura',
        'Segunda reapertura',
        null,
      ]);
      expect(cerrada.cierres[1]?.reapertura?.reabiertaPor.id).toBe(e.adminA2.id);
      expect((await leerCierres(e.A.id)).filter((c) => c.reabierto_en === null)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_CERRADA)).toHaveLength(2);
      expect(await auditorias()).toHaveLength(2);
    });

    it('criterio 35: la reapertura no cambia los movimientos ni el cierre guardado (sus montos)', async () => {
      await cajaCerrada(HOY, '80.00', 'Faltaron 4.50');
      const antes = {
        movimientos: JSON.stringify(await leerMovimientos(e.A.id)),
        cierre: (await leerCierres(e.A.id))[0],
      };

      await reabrir();

      expect(JSON.stringify(await leerMovimientos(e.A.id))).toBe(antes.movimientos);
      const despues = (await leerCierres(e.A.id))[0];
      expect(despues).toMatchObject({
        monto_declarado: antes.cierre?.monto_declarado,
        diferencia: antes.cierre?.diferencia,
        esperado_efectivo: antes.cierre?.esperado_efectivo,
        observacion: antes.cierre?.observacion,
        movimientos_hasta: antes.cierre?.movimientos_hasta,
      });
    });

    it.each([
      ['de 3 caracteres', 'abc'],
      ['de 200 caracteres', 'a'.repeat(200)],
      ['con espacios alrededor', '   Recontar el efectivo   '],
    ])('criterio 35: un motivo %s se acepta (límites) y se guarda recortado', async (_nombre, motivo) => {
      await cajaCerrada();

      const respuesta = await reabrir({ motivo });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((await leerCierres(e.A.id))[0]?.motivo_reapertura).toBe(motivo.trim());
      expect((await auditorias())[0]?.motivo).toBe(motivo.trim());
    });

    it.each([
      ['vacío', ''],
      ['de 2 caracteres', 'ab'],
      ['de 2 caracteres recortado', '  ab  '],
      ['solo espacios', '      '],
      ['de 201 caracteres', 'a'.repeat(201)],
      ['con un salto de línea', 'Se cerró\npor error'],
      ['con un carácter nulo', 'Se cerró\u0000por error'],
      ['nulo', null],
      ['un número', 12345],
    ])(
      'criterio 35: un motivo %s responde 400 SOLICITUD_INVALIDA en motivo sin escribir ni auditar',
      async (_nombre, motivo) => {
        await cajaCerrada();
        const antes = await estado();

        const respuesta = await reabrir({ motivo });

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('motivo');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 35: sin motivo, o con un cuerpo vacío, responde 400 en motivo sin escribir ni auditar', async () => {
      await cajaCerrada();
      const antes = await estado();

      for (const cuerpo of [{}, { motivoDeLaReapertura: 'x' }]) {
        const respuesta = await reabrir(cuerpo);

        expect(respuesta.status, JSON.stringify(cuerpo)).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
      }
      expect(await estado()).toEqual(antes);
    });

    it('criterio 35: el cuerpo se valida antes que el id y antes del 200 de la caja ya abierta: un cuerpo inválido responde 400', async () => {
      const abierta = await crearCajaDePrueba(e.A.id, e.secretariaA.id);

      const sobreAbierta = await reabrir({}, cookies.admin, abierta.id);
      const sobreInexistente = await reabrir({}, cookies.admin, randomUUID());

      expect(sobreAbierta.status, sobreAbierta.texto).toBe(400);
      expect(sobreInexistente.status, sobreInexistente.texto).toBe(400);
    });
  });

  describe('criterio 36: reglas de la reapertura', () => {
    it('criterio 36 a: si la caja ya está ABIERTA responde 200 con { caja } sin escribir ni auditar', async () => {
      const abierta = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
      const antes = await estado();

      const respuesta = await reabrir(cuerpoReapertura(), cookies.admin, abierta.id);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta)).toMatchObject({ id: abierta.id, estado: 'ABIERTA' });
      expect(await estado()).toEqual(antes);
      expect(await auditorias()).toHaveLength(0);
    });

    it('criterio 36 a: doble clic: dos reaperturas seguidas dejan una sola auditoría y un solo cambio', async () => {
      await cajaCerrada();

      const primera = await reabrir();
      const antes = await estado();
      const segunda = await reabrir(cuerpoReapertura({ motivo: 'Segundo clic con otro motivo' }), cookies.admin2);

      expect(primera.status, primera.texto).toBe(200);
      expect(segunda.status, segunda.texto).toBe(200);
      expect(cajaDe(segunda).estado).toBe('ABIERTA');
      expect(await estado()).toEqual(antes);
      expect(await auditorias()).toHaveLength(1);
      expect((await leerCierres(e.A.id))[0]?.motivo_reapertura).toBe('Se cerró por error a mediodía');
    });

    it('criterio 36 b: si otra caja de A está abierta, responde 409 HAY_OTRA_CAJA_ABIERTA con { cajaId, fecha } sin escribir ni auditar', async () => {
      const cerrada = await cajaCerrada(AYER);
      const abierta = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
      const antes = await estado();

      const respuesta = await reabrir(cuerpoReapertura(), cookies.admin, cerrada.id);

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('HAY_OTRA_CAJA_ABIERTA');
      expect(detallesDe(respuesta)).toEqual({ cajaId: abierta.id, fecha: HOY });
      expect(await estado()).toEqual(antes);
      expect(await auditorias()).toHaveLength(0);
    });

    it('criterio 36 b: una caja abierta en B no impide reabrir en A', async () => {
      await cajaCerrada();
      await crearCajaDePrueba(e.B.id, e.secretariaB.id);

      const respuesta = await reabrir();

      expect(respuesta.status, respuesta.texto).toBe(200);
    });

    it('criterio 36 c: se puede reabrir la caja de un día anterior: queda ABIERTA como caja de otro día', async () => {
      await cajaCerrada(AYER);

      const respuesta = await reabrir();

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta)).toMatchObject({ id: caja.id, estado: 'ABIERTA', fecha: AYER, deOtroDia: true });
      expect((await auditorias())[0]?.datos_despues).toEqual({ estado: 'ABIERTA' });
    });

    it('criterio 36 c: la caja reabierta de un día anterior no admite egresos (409 CAJA_DE_OTRO_DIA) ni abrir la de hoy (409 CAJA_PENDIENTE_DE_CIERRE)', async () => {
      await cajaCerrada(AYER);
      await reabrir();
      const antes = await estado();

      const egreso = await ctx.http.post(rutaCaja(caja.id, '/egresos'), cookies.secretaria, cuerpoEgreso());
      const apertura = await ctx.http.post('/api/cajas', cookies.secretaria, cuerpoApertura());

      expect(egreso.status, egreso.texto).toBe(409);
      expect(codigoDe(egreso)).toBe('CAJA_DE_OTRO_DIA');
      expect(detallesDe(egreso)).toEqual({ cajaId: caja.id, fecha: AYER });
      expect(apertura.status, apertura.texto).toBe(409);
      expect(codigoDe(apertura)).toBe('CAJA_PENDIENTE_DE_CIERRE');
      expect(await estado()).toEqual(antes);
    });

    it('criterio 36 c: solo se puede volver a cerrar, con tardio: true, como cierre número 2 (DR-8)', async () => {
      await cajaCerrada(AYER);
      await reabrir();

      const respuesta = await ctx.http.post(
        rutaCaja(caja.id, '/cierre'),
        cookies.secretaria,
        cuerpoCierre({ montoDeclarado: '84.50', ultimoMovimientoVisto: 1 }),
      );

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta).cierres.map((c) => [c.numero, c.tardio])).toEqual([
        [1, false],
        [2, true],
      ]);
      const apertura = await ctx.http.post('/api/cajas', cookies.secretaria, cuerpoApertura());
      expect(apertura.status, apertura.texto).toBe(201);
    });

    it('criterio 36 d: un ADMIN de B sobre una caja de A, un id que no existe o que no es UUID responden 404 NO_ENCONTRADO con el mismo cuerpo, sin escribir', async () => {
      await cajaCerrada();
      const antes = await estado();

      const deOtraAcademia = await reabrir(cuerpoReapertura(), cookies.adminB, caja.id);
      const inexistente = await reabrir(cuerpoReapertura(), cookies.admin, randomUUID());
      const noUuid = await reabrir(cuerpoReapertura(), cookies.admin, 'no-es-un-uuid');

      for (const respuesta of [deOtraAcademia, inexistente, noUuid]) {
        expect(respuesta.status, respuesta.texto).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
      }
      expect(deOtraAcademia.body).toEqual(inexistente.body);
      expect(noUuid.body).toEqual(inexistente.body);
      expect(await estado()).toEqual(antes);
    });
  });

  describe('la reapertura con cobros (control)', () => {
    it('criterio 35: tras reabrir la caja de hoy, un ingreso de la interfaz entra y el cierre vigente cubre todos los movimientos', async () => {
      await cajaCerrada();
      await reabrir();
      const alumno = await crearAlumnoDeCaja(e.A.id);
      // El ingreso entra por la base (la interfaz de la 007 se prueba en ingreso-interfaz.test.ts): la caja está abierta, el trigger lo admite.
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, { monto: '10.00' });

      const respuesta = await ctx.http.post(
        rutaCaja(caja.id, '/cierre'),
        cookies.secretaria,
        cuerpoCierre({ montoDeclarado: '94.50', ultimoMovimientoVisto: 2 }),
      );

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta).cierres[1]).toMatchObject({ movimientosHasta: 2, esperado: { efectivo: '94.50' } });
    });
  });
});
