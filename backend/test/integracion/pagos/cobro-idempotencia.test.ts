// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cerrarCajaDePrueba, crearCajaDePrueba, leerMovimientos } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  instantaneaDeLaAcademia,
  pagoDe,
  rutaCobro,
  sembrarCobrable,
  solicitudPanelDe,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  conRetencion,
  crearAppInscripciones,
  retenerClases,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { filaPagoValida, insertarPago, leerPagos } from '../../utilidades/pagos';
import { cookieDeUsuario, leerUsuarios } from '../../utilidades/usuarios';

// Criterio 17 (crítico, regla de idempotencia de `CLAUDE.md`; criterio 22 de 006): con un cobro ya registrado con la clave K, otro con la misma clave para la misma solicitud y el
// mismo `montoMostrado` responde 200 con el mismo `{ pago, solicitud }`, sin otro pago, otro movimiento, otro usuario ni otra auditoría, aunque la caja ya esté cerrada o sea de
// otro día (la clave se mira antes que el estado de la solicitud y que la caja). La clave K con otra solicitud, otro monto o de un pago que no es en efectivo responde 409
// `CLAVE_YA_USADA`. Dos cobros simultáneos con la misma clave dejan un pago (uno 201 y el otro 200); dos con claves distintas sobre la misma solicitud dejan un pago (uno 201 y el
// otro 409 `SOLICITUD_YA_PAGADA`) y un solo movimiento. Pruebas deterministas: la prueba retiene la fila de la clase y las dos peticiones esperan.

describe('doble clic y reintento del cobro en efectivo (criterio 17)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;
  let cajaId: string;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
    cajaId = (await abrirCajaDeHoy(e)).id;
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const cobrar = (c: SolicitudSembrada, cuerpo: Record<string, unknown>, cookie = cookies.secretaria) =>
    ctx.http.post(rutaCobro(c.solicitudId), cuerpo, { cookie });

  describe('el reintento con la misma clave', () => {
    it('criterio 17: la misma clave para la misma solicitud y el mismo monto responde 200 con el mismo { pago, solicitud }, sin otro pago, movimiento, usuario ni auditoría', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = cuerpoCobro('42.00');
      const primero = await cobrar(cliente, cuerpo);
      expect(primero.status, primero.texto).toBe(201);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const repetido = await cobrar(cliente, { ...cuerpo, montoMostrado: '42' });

      expect(repetido.status, repetido.texto).toBe(200);
      expect(repetido.body).toEqual(primero.body);
      expect(pagoDe(repetido).id).toBe(pagoDe(primero).id);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      expect(await leerPagos(e.A.id)).toHaveLength(1);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect((await leerUsuarios(e.A.id)).filter((u) => u.dni === cliente.dni)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_REGISTRADO')).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CREADO')).toHaveLength(1);
    });

    it('criterio 17: otro usuario (el administrador) con la misma clave y la misma solicitud también recibe el mismo pago, no uno nuevo', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = cuerpoCobro('42.00');
      const primero = await cobrar(cliente, cuerpo);

      const repetido = await cobrar(cliente, cuerpo, cookies.admin);

      expect(repetido.status, repetido.texto).toBe(200);
      expect(pagoDe(repetido).id).toBe(pagoDe(primero).id);
      expect(await leerPagos(e.A.id)).toHaveLength(1);
    });

    it('criterio 17: aunque la caja ya esté cerrada, el reintento responde 200 (la clave se mira antes que el estado de la caja)', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = cuerpoCobro('42.00');
      const primero = await cobrar(cliente, cuerpo);
      await cerrarCajaDePrueba(e.A.id, cajaId, e.secretariaA.id);

      const repetido = await cobrar(cliente, cuerpo);

      expect(repetido.status, repetido.texto).toBe(200);
      expect(repetido.body).toEqual(primero.body);
    });

    it('criterio 17: aunque la caja ya sea de otro día (pasó la medianoche de Lima), el reintento responde 200', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = cuerpoCobro('42.00');
      const primero = await cobrar(cliente, cuerpo);
      const manana = new Date('2026-11-12T15:00:00.000Z');
      ctx.reloj.fijar(manana);

      const repetido = await cobrar(cliente, cuerpo, cookieDeUsuario(e.secretariaA, manana));

      expect(repetido.status, repetido.texto).toBe(200);
      expect(repetido.body).toEqual(primero.body);
      expect(await leerPagos(e.A.id)).toHaveLength(1);
    });

    it('criterio 17: la clave se mira antes que el estado de la solicitud: con la solicitud ya CONFIRMADA y la misma clave responde 200, con otra clave 409 SOLICITUD_YA_PAGADA', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = cuerpoCobro('42.00');
      await cobrar(cliente, cuerpo);

      const mismaClave = await cobrar(cliente, cuerpo);
      const otraClave = await cobrar(cliente, cuerpoCobro('42.00'));

      expect(mismaClave.status).toBe(200);
      expect([otraClave.status, codigoDeRespuesta(otraClave)]).toEqual([409, 'SOLICITUD_YA_PAGADA']);
    });

    it('criterio 17: el 200 del reintento lleva el elemento del panel de la solicitud CONFIRMADA con el pago, igual que el 201', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = cuerpoCobro('42.00');
      await cobrar(cliente, cuerpo);

      const repetido = await cobrar(cliente, cuerpo);

      expect(solicitudPanelDe(repetido)).toMatchObject({
        id: cliente.solicitudId,
        estado: 'CONFIRMADA',
        monto: '42.00',
      });
      expect(solicitudPanelDe(repetido).pago?.numeroTicket).toBe(1);
    });
  });

  describe('la clave K con otra cosa: 409 CLAVE_YA_USADA, sin escribir', () => {
    it('criterio 17: la misma clave con otra solicitud', async () => {
      const uno = await sembrarCobrable(e);
      const dos = await sembrarCobrable(e);
      const cuerpo = cuerpoCobro('42.00');
      await cobrar(uno, cuerpo);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await cobrar(dos, cuerpo);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    });

    it('criterio 17: la misma clave con otro monto mostrado', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = cuerpoCobro('42.00');
      await cobrar(cliente, cuerpo);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await cobrar(cliente, { ...cuerpo, montoMostrado: '43.00' });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    });

    it('criterio 17: la clave de un pago que no es en efectivo (un Yape pendiente de otra persona) no sirve para cobrar', async () => {
      const yape = await sembrarCobrable(e, { reservaVenceEn: null });
      const otra = await sembrarCobrable(e);
      const clave = randomUUID();
      await insertarPago(
        'propietario',
        e.A.id,
        filaPagoValida(
          e.A.id,
          { alumnoId: yape.alumnoId, matriculaId: yape.matriculaId },
          {},
          { clave_idempotencia: clave },
        ),
      );
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await cobrar(otra, cuerpoCobro('42.00', { claveIdempotencia: clave }));

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    });

    it('criterio 17: la clave de un pago de efectivo de otra solicitud que ya está CONFIRMADA responde CLAVE_YA_USADA y no SOLICITUD_YA_PAGADA (la clave se mira primero)', async () => {
      const uno = await sembrarCobrable(e);
      const dos = await sembrarCobrable(e);
      const cuerpo = cuerpoCobro('42.00');
      await cobrar(uno, cuerpo);
      await cobrar(dos, cuerpoCobro('42.00'));

      const respuesta = await cobrar(dos, cuerpo);

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'CLAVE_YA_USADA']);
    });

    it('criterio 17: una clave de B no choca con una de A: el mismo UUID cobra en las dos academias', async () => {
      const deA = await sembrarCobrable(e);
      await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      const deB = await sembrarSolicitud(e.B.id, {
        planId: e.planB.id,
        claseIds: [e.lunesB.id],
        clasesTotales: 5,
        clasesPorMesPlan: 12,
        precioPlan: '100.00',
        monto: '42.00',
      });
      const cuerpo = cuerpoCobro('42.00');

      const a = await cobrar(deA, cuerpo);
      const b = await ctx.http.post(rutaCobro(deB.solicitudId), cuerpo, { cookie: cookies.secretariaB });

      expect(a.status, a.texto).toBe(201);
      expect(b.status, b.texto).toBe(201);
    });

    it('criterio 17: un cobro rechazado (409 por el monto) no gasta la clave: se puede reintentar con la misma clave y el monto correcto', async () => {
      const cliente = await sembrarCobrable(e);
      const clave = randomUUID();
      const mal = await cobrar(cliente, { claveIdempotencia: clave, montoMostrado: '41.00' });
      expect(codigoDeRespuesta(mal)).toBe('MONTO_CAMBIO');

      const bien = await cobrar(cliente, { claveIdempotencia: clave, montoMostrado: '42.00' });

      expect(bien.status, bien.texto).toBe(201);
    });
  });

  describe('dos cobros a la vez, con las dos peticiones esperando la clase', () => {
    it('criterio 17: con la misma clave dejan un solo pago (uno 201 y el otro 200 con el mismo cuerpo) y un solo movimiento', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = cuerpoCobro('42.00');

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => cobrar(cliente, cuerpo), () => cobrar(cliente, cuerpo, cookies.admin)],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron, 'los dos cobros debían quedar esperando el bloqueo de la clase').toBe(true);
      expect(resultados.map((r) => r.status).sort(), JSON.stringify(resultados.map((r) => r.body))).toEqual([200, 201]);
      expect(resultados[0]?.body?.['pago']).toEqual(resultados[1]?.body?.['pago']);
      expect(await leerPagos(e.A.id)).toHaveLength(1);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect((await leerUsuarios(e.A.id)).filter((u) => u.dni === cliente.dni)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_REGISTRADO')).toHaveLength(1);
    });

    it('criterio 17: con claves distintas sobre la misma solicitud dejan un solo pago (uno 201 y el otro 409 SOLICITUD_YA_PAGADA) y un solo movimiento', async () => {
      const cliente = await sembrarCobrable(e);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [
          () => cobrar(cliente, cuerpoCobro('42.00')),
          () => cobrar(cliente, cuerpoCobro('42.00'), cookies.admin),
        ],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      expect(resultados.map((r) => r.status).sort(), JSON.stringify(resultados.map((r) => r.body))).toEqual([201, 409]);
      const rechazado = resultados.find((r) => r.status === 409);
      expect(rechazado && codigoDeRespuesta(rechazado)).toBe('SOLICITUD_YA_PAGADA');
      expect(await leerPagos(e.A.id)).toHaveLength(1);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'CAJA_INGRESO_REGISTRADO')).toHaveLength(1);
    });

    it('criterio 17: sin retención (peticiones simultáneas a secas) con claves distintas: siempre un solo pago, nunca 500', async () => {
      const cliente = await sembrarCobrable(e);

      const respuestas = await Promise.all([1, 2, 3, 4].map(() => cobrar(cliente, cuerpoCobro('42.00'))));

      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        respuestas.every((r) => r.status === 201 || r.status === 409),
        JSON.stringify(respuestas.map((r) => r.status)),
      ).toBe(true);
      expect(await leerPagos(e.A.id)).toHaveLength(1);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });
  });
});
