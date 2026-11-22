// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_ABIERTA,
  AYER,
  type AppCaja,
  type Objeto,
  cajaDe,
  camposConError,
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  cuerpoApertura,
  detallesDe,
  enLima,
  type EscenarioCaja,
  exigirRutasDeCaja,
  HOY,
  instantaneaDeCaja,
  IP_LOCAL,
  leerCajas,
  leerCierres,
} from '../../utilidades/caja';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterios 10, 11, 13 (secuencial), 14 y 15 (crítico, HU-25, RN-17, RN-22, D-04): abrir la caja del día.
//  10. POST /api/cajas con { claveIdempotencia, montoInicial } responde 201 con { caja }: ABIERTA, `fecha` igual a hoy (Lima), `montoInicial` con dos
//      decimales, `abiertaPor` (id, nombres y apellidos, sin DNI), `abiertaEn`, `deOtroDia: false`, sin movimientos ni cierres y el resumen con el
//      esperado en efectivo igual al monto inicial y Yape y transferencia en "0.00". Registra CAJA_ABIERTA (entidad `caja`, actor USUARIO, IP) con
//      datosDespues { fecha, montoInicial }.
//  11. `montoInicial` es un texto de `montoNoNegativoSchema` ("0" a "99999.99", hasta dos decimales); `claveIdempotencia` es un UUID.
//  13. Con una caja abierta de hoy, otra apertura con otra clave responde 409 CAJA_YA_ABIERTA con detalles { cajaId, fecha }, sin escribir ni auditar.
//  14. Con una caja de otro día sin cerrar, 409 CAJA_PENDIENTE_DE_CIERRE con detalles { cajaId, fecha de la caja pendiente }.
//  15. Con la caja de hoy ya cerrada, 409 CAJA_DEL_DIA_CERRADA con detalles { cajaId, fecha } (una caja por día, DR-1).
// El orden de los 409 de la apertura es: CLAVE_YA_USADA -> CAJA_YA_ABIERTA -> CAJA_PENDIENTE_DE_CIERRE -> CAJA_DEL_DIA_CERRADA. Las aperturas
// simultáneas y la clave repetida están en `apertura-carreras.test.ts`; la fecha de Lima en los bordes, en `apertura-fecha-lima.test.ts`.

describe('apertura de la caja (criterios 10, 11, 13, 14 y 15)', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;

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

  const abrir = (cuerpo: unknown, cookie = cookies.secretaria) => ctx.http.post('/api/cajas', cookie, cuerpo);
  const auditorias = (accion = ACCION_CAJA_ABIERTA) => leerAuditoriaDeAcademia(e.A.id, accion);

  async function estado() {
    return {
      cajas: await instantaneaDeCaja(e.A.id),
      cajasB: await instantaneaDeCaja(e.B.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }

  describe('criterio 10: abrir la caja', () => {
    it.each([
      ['secretaria', 'Lucia', 'Benites'],
      ['admin', 'Rosa', 'Alvarez'],
    ] as const)(
      'criterio 10: una %s abre la caja: 201 con la caja de hoy, el monto con dos decimales, quién la abrió (sin DNI), el resumen y sin movimientos ni cierres',
      async (rol, nombres, apellidos) => {
        const actor = rol === 'admin' ? e.adminA : e.secretariaA;
        const clave = randomUUID();

        const respuesta = await abrir({ claveIdempotencia: clave, montoInicial: '150' }, cookies[rol]);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(respuesta.cacheControl).toBe('no-store');
        expect(Object.keys(respuesta.body ?? {})).toEqual(['caja']);
        const caja = cajaDe(respuesta);
        expect(caja.estado).toBe('ABIERTA');
        expect(caja.fecha).toBe(HOY);
        expect(caja.montoInicial).toBe('150.00');
        expect(caja.abiertaPor).toEqual({ id: actor.id, nombres, apellidos });
        expect(Date.parse(caja.abiertaEn)).toBe(AHORA_PRUEBAS.getTime());
        expect(caja.deOtroDia).toBe(false);
        expect(caja.movimientos).toEqual([]);
        expect(caja.cierres).toEqual([]);
        expect(caja.resumen).toEqual({
          ingresos: { efectivo: '0.00', yape: '0.00', transferencia: '0.00' },
          egresos: { efectivo: '0.00' },
          esperado: { efectivo: '150.00', yape: '0.00', transferencia: '0.00' },
          ultimoMovimiento: 0,
        });
        expect(respuesta.texto, 'el DNI nunca sale en la caja').not.toContain(actor.dni);
      },
    );

    it('criterio 10: la fila queda con la fecha de hoy, el monto, quién abrió, la hora y la clave', async () => {
      const clave = randomUUID();

      const respuesta = await abrir({ claveIdempotencia: clave, montoInicial: '150.5' });

      expect(respuesta.status, respuesta.texto).toBe(201);
      const filas = await leerCajas(e.A.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        id: cajaDe(respuesta).id,
        fecha: HOY,
        estado: 'ABIERTA',
        monto_inicial: '150.50',
        abierta_por: e.secretariaA.id,
        clave_idempotencia: clave,
      });
      expect(filas[0]?.abierta_en.getTime()).toBe(AHORA_PRUEBAS.getTime());
    });

    it('criterio 10: registra una sola auditoría CAJA_ABIERTA (entidad caja, el id de la caja, actor USUARIO con su IP) con datosDespues { fecha, montoInicial }', async () => {
      const respuesta = await abrir({ claveIdempotencia: randomUUID(), montoInicial: '150' });

      const filas = await auditorias();
      expect(filas).toHaveLength(1);
      const fila = filas[0];
      expect(fila?.entidad).toBe('caja');
      expect(fila?.entidad_id).toBe(cajaDe(respuesta).id);
      expect(fila?.actor_tipo).toBe('USUARIO');
      expect(fila?.actor_id).toBe(e.secretariaA.id);
      expect(fila?.ip).toMatch(IP_LOCAL);
      expect(fila?.datos_despues).toEqual({ fecha: HOY, montoInicial: '150.00' });
      expect((await leerAuditoriaDeAcademia(e.B.id)).length, 'B no recibe nada').toBe(0);
    });

    it('criterio 10: la fecha de la caja nunca viene del cliente: un cuerpo con fecha responde 400 y no escribe', async () => {
      const antes = await estado();

      const respuesta = await abrir(cuerpoApertura({ fecha: AYER }));

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
      expect(await estado()).toEqual(antes);
    });
  });

  describe('criterio 11: monto inicial y clave', () => {
    it.each([
      ['0', '0.00'],
      ['0.00', '0.00'],
      ['150', '150.00'],
      ['150.5', '150.50'],
      ['99999.99', '99999.99'],
    ])(
      'criterio 11: el monto inicial "%s" se acepta, se guarda en numeric(10,2) y se devuelve como "%s"',
      async (enviado, devuelto) => {
        const respuesta = await abrir({ claveIdempotencia: randomUUID(), montoInicial: enviado });

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(cajaDe(respuesta).montoInicial).toBe(devuelto);
        expect(cajaDe(respuesta).resumen.esperado.efectivo).toBe(devuelto);
        expect((await leerCajas(e.A.id))[0]?.monto_inicial).toBe(devuelto);
      },
    );

    it.each([
      ['un número JSON', 150],
      ['un número JSON con decimales', 150.5],
      ['negativo', '-1'],
      ['menos cero', '-0'],
      ['con tres decimales', '150.505'],
      ['en notación científica', '1e2'],
      ['con coma', '150,50'],
      ['con un espacio al inicio', ' 150'],
      ['con un espacio al final', '150 '],
      ['sobre el máximo', '100000'],
      ['vacío', ''],
      ['nulo', null],
      ['con letras', 'cien'],
      ['con signo más', '+100'],
      ['con ceros a la izquierda', '0150'],
    ])(
      'criterio 11: un monto inicial %s responde 400 SOLICITUD_INVALIDA en montoInicial sin escribir ni auditar',
      async (_nombre, monto) => {
        const antes = await estado();

        const respuesta = await abrir({ claveIdempotencia: randomUUID(), montoInicial: monto });

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('montoInicial');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 11: sin montoInicial responde 400 en montoInicial sin escribir ni auditar', async () => {
      const antes = await estado();

      const respuesta = await abrir({ claveIdempotencia: randomUUID() });

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(camposConError(respuesta)).toContain('montoInicial');
      expect(await estado()).toEqual(antes);
    });

    it.each([
      ['falta', undefined],
      ['no es un UUID', 'no-es-un-uuid'],
      ['está vacía', ''],
      ['es nula', null],
      ['es un número', 123],
      ['es un UUID con una letra de más', `${randomUUID()}a`],
    ])(
      'criterio 11: si la claveIdempotencia %s responde 400 en claveIdempotencia sin escribir ni auditar',
      async (_nombre, clave) => {
        const antes = await estado();
        const cuerpo: Objeto = { montoInicial: '100.00' };
        if (clave !== undefined) cuerpo['claveIdempotencia'] = clave;

        const respuesta = await abrir(cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('claveIdempotencia');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 11: un cuerpo vacío o que es una lista responde 400 sin escribir', async () => {
      const antes = await estado();

      for (const cuerpo of [{}, []]) {
        const respuesta = await abrir(cuerpo);
        expect(respuesta.status, JSON.stringify(cuerpo)).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
      }
      expect(await estado()).toEqual(antes);
    });
  });

  describe('criterio 13: una sola caja abierta por academia', () => {
    it('criterio 13: con una caja abierta de hoy, otra apertura con otra clave responde 409 CAJA_YA_ABIERTA con { cajaId, fecha } y no escribe ni audita', async () => {
      const abierta = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
      const antes = await estado();

      const respuesta = await abrir(cuerpoApertura({ montoInicial: '5.00' }), cookies.admin);

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('CAJA_YA_ABIERTA');
      expect(detallesDe(respuesta)).toEqual({ cajaId: abierta.id, fecha: HOY });
      expect(await estado()).toEqual(antes);
      expect(await auditorias()).toHaveLength(0);
    });

    it('criterio 13: una caja abierta en B no impide abrir en A', async () => {
      await crearCajaDePrueba(e.B.id, e.secretariaB.id);

      const respuesta = await abrir(cuerpoApertura());

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await leerCajas(e.A.id)).toHaveLength(1);
    });
  });

  describe('criterio 14: la caja de otro día sin cerrar', () => {
    it.each([
      ['de ayer', AYER],
      ['de hace una semana', '2026-11-04'],
      ['del mes pasado', '2026-10-15'],
    ])(
      'criterio 14: con una caja abierta %s, abrir la de hoy responde 409 CAJA_PENDIENTE_DE_CIERRE con { cajaId, fecha de la caja pendiente } y no escribe ni audita',
      async (_nombre, fecha) => {
        const pendiente = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha });
        const antes = await estado();

        const respuesta = await abrir(cuerpoApertura());

        expect(respuesta.status, respuesta.texto).toBe(409);
        expect(codigoDe(respuesta)).toBe('CAJA_PENDIENTE_DE_CIERRE');
        expect(detallesDe(respuesta)).toEqual({ cajaId: pendiente.id, fecha });
        expect(await estado()).toEqual(antes);
        expect(await auditorias()).toHaveLength(0);
      },
    );

    it('criterio 14: no se cierra sola ni se abre otra encima: la caja pendiente sigue ABIERTA y sin cierre', async () => {
      const pendiente = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });

      await abrir(cuerpoApertura());

      const filas = await leerCajas(e.A.id);
      expect(filas.map((caja) => [caja.id, caja.estado])).toEqual([[pendiente.id, 'ABIERTA']]);
      expect(await leerCierres(e.A.id)).toEqual([]);
    });

    it('criterio 14: una caja de otro día sin cerrar en B no impide abrir en A', async () => {
      await crearCajaDePrueba(e.B.id, e.secretariaB.id, { fecha: AYER });

      const respuesta = await abrir(cuerpoApertura());

      expect(respuesta.status, respuesta.texto).toBe(201);
    });
  });

  describe('criterio 15: una caja por día', () => {
    it('criterio 15: con la caja de hoy ya cerrada, otra apertura responde 409 CAJA_DEL_DIA_CERRADA con { cajaId, fecha } y no escribe ni audita', async () => {
      const cerrada = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
      await cerrarCajaDePrueba(e.A.id, cerrada.id, e.secretariaA.id, { cerradoEn: enLima(HOY, '09:30') });
      const antes = await estado();

      const respuesta = await abrir(cuerpoApertura());

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('CAJA_DEL_DIA_CERRADA');
      expect(detallesDe(respuesta)).toEqual({ cajaId: cerrada.id, fecha: HOY });
      expect(await estado()).toEqual(antes);
      expect(await auditorias()).toHaveLength(0);
    });

    it('criterio 15: con la caja de ayer cerrada, abrir la de hoy se acepta (una caja por día, no una sola caja)', async () => {
      const cerrada = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });
      await cerrarCajaDePrueba(e.A.id, cerrada.id, e.secretariaA.id, { cerradoEn: enLima(AYER, '18:00') });

      const respuesta = await abrir(cuerpoApertura());

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect((await leerCajas(e.A.id)).map((caja) => caja.fecha)).toEqual([AYER, HOY]);
    });
  });

  describe('orden de los 409 de la apertura', () => {
    it('criterio 14 y 15: con una caja de ayer sin cerrar y la de hoy ya cerrada, gana CAJA_PENDIENTE_DE_CIERRE sobre CAJA_DEL_DIA_CERRADA', async () => {
      const pendiente = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });
      const hoy = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { estado: 'CERRADA' });
      expect(hoy.fecha).toBe(HOY);

      const respuesta = await abrir(cuerpoApertura());

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('CAJA_PENDIENTE_DE_CIERRE');
      expect(detallesDe(respuesta)).toEqual({ cajaId: pendiente.id, fecha: AYER });
    });

    it('criterio 13, 14 y 16: la clave repetida con otro monto gana sobre CAJA_YA_ABIERTA (CLAVE_YA_USADA)', async () => {
      const abierta = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });

      const respuesta = await abrir({ claveIdempotencia: abierta.claveIdempotencia, montoInicial: '5.00' });

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('CLAVE_YA_USADA');
    });
  });
});
