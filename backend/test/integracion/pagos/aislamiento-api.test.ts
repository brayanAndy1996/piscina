// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cerrarCajaDePrueba, crearCajaDePrueba } from '../../utilidades/caja';
import { conFilaRetenida } from '../../utilidades/carreras';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoAjuste,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  instantaneaDeLaAcademia,
  partesDeLaAcademia,
  pagoDe,
  rutaAjuste,
  rutaCobro,
  rutaTicket,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  crearAppInscripciones,
  type RespuestaApi,
  sembrarSolicitud,
  sinUuid,
} from '../../utilidades/inscripciones';
import { crearPagoConfirmadoConMovimiento } from '../../utilidades/pagos';

// Criterio 9 (crítico, D-23, DT-5 de 002, AT-2 de 004): en toda ruta de esta historia con `{id}`, un id que no es UUID, que no existe o que es de otra academia responde el mismo 404 `NO_ENCONTRADO`,
// con el mismo cuerpo y sin escribir ni auditar. La academia sale siempre de la sesión: `?academiaId=`, un `academiaId` en el cuerpo (400 por campo de más) o en una cabecera no cambian nada. Toda
// escritura llama a `bloquearActorVigente` como primera sentencia de su transacción; un actor desactivado o con la versión de token cambiada responde 401 antes que cualquier 404 o 409, sin escribir.

describe('aislamiento entre academias y actor vigente en las rutas de pagos (criterio 9)', () => {
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

  const delA = async () => ({ a: await instantaneaDeLaAcademia(e.A.id), b: await instantaneaDeLaAcademia(e.B.id) });
  const deB = async () => {
    const caja = await crearCajaDePrueba(e.B.id, e.secretariaB.id);
    const solicitud = await sembrarSolicitud(e.B.id, {
      planId: e.planB.id,
      claseIds: [e.lunesB.id],
      clasesTotales: 5,
      clasesPorMesPlan: 12,
      precioPlan: '100.00',
      monto: '42.00',
    });
    return { ...solicitud, cajaId: caja.id };
  };

  describe('un id que no es UUID, que no existe o que es de otra academia: el mismo 404 NO_ENCONTRADO', () => {
    const IDS_INVALIDOS = ['no-es-un-uuid', '123', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', `${randomUUID()}x`];

    it('criterio 9: cobro, ajuste y ticket responden el mismo 404 (mismo cuerpo, sin el id) para un id inválido, uno inexistente y uno de B, sin escribir ni auditar', async () => {
      const ajeno = await deB();
      const pagoAjeno = await crearPagoConfirmadoConMovimiento(e.B.id, {
        cajaId: ajeno.cajaId,
        alumnoId: ajeno.alumnoId,
        matriculaId: ajeno.matriculaId,
        usuarioId: e.secretariaB.id,
        numeroTicket: 1,
      });
      const antes = await delA();
      const enviarCobro = (id: string) =>
        ctx.http.post(rutaCobro(id), cuerpoCobro('42.00'), { cookie: cookies.secretaria });
      const enviarAjuste = (id: string) => ctx.http.post(rutaAjuste(id), cuerpoAjuste('35'), { cookie: cookies.admin });
      const enviarTicket = (id: string) => ctx.http.get(rutaTicket(id), { cookie: cookies.secretaria });
      const casos: [string, (id: string) => Promise<RespuestaApi>, string[]][] = [
        ['cobro', enviarCobro, [...IDS_INVALIDOS, randomUUID(), ajeno.solicitudId]],
        ['ajuste', enviarAjuste, [...IDS_INVALIDOS, randomUUID(), ajeno.solicitudId]],
        ['ticket', enviarTicket, [...IDS_INVALIDOS, randomUUID(), pagoAjeno.pagoId]],
      ];

      for (const [nombre, enviar, ids] of casos) {
        const respuestas = await Promise.all(ids.map((id) => enviar(id)));
        for (const [i, respuesta] of respuestas.entries()) {
          expect([respuesta.status, codigoDeRespuesta(respuesta)], `${nombre} ${ids[i]}: ${respuesta.texto}`).toEqual([
            404,
            'NO_ENCONTRADO',
          ]);
        }
        expect(new Set(respuestas.map((r) => sinUuid(r.texto))).size, `${nombre}: el mismo cuerpo para todos`).toBe(1);
        for (const [i, id] of ids.entries())
          expect(respuestas[i]?.texto, `${nombre}: sin el id en el cuerpo`).not.toContain(id);
      }
      expect(await delA()).toEqual(antes);
    });

    it('criterio 9: lo mismo desde B: la solicitud y el pago de A no existen para B, con el mismo 404', async () => {
      const cliente = await sembrarCobrable(e);
      const { pagoId } = await crearPagoConfirmadoConMovimiento(e.A.id, {
        cajaId,
        alumnoId: cliente.alumnoId,
        matriculaId: cliente.matriculaId,
        usuarioId: e.secretariaA.id,
        numeroTicket: 1,
      });
      const antes = await delA();

      const cobro = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookies.secretariaB,
      });
      const ajuste = await ctx.http.post(rutaAjuste(cliente.solicitudId), cuerpoAjuste('35'), {
        cookie: cookies.adminB,
      });
      const ticket = await ctx.http.get(rutaTicket(pagoId), { cookie: cookies.secretariaB });

      for (const r of [cobro, ajuste, ticket])
        expect([r.status, codigoDeRespuesta(r)], r.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(await delA()).toEqual(antes);
    });

    it('criterio 9: el 400 del cuerpo va antes que el 404 del id (orden de 002): un id inexistente con un cuerpo inválido responde 400', async () => {
      const respuesta = await ctx.http.post(
        rutaCobro(randomUUID()),
        { montoMostrado: 'abc' },
        { cookie: cookies.secretaria },
      );

      expect(respuesta.status).toBe(400);
    });
  });

  describe('la academia sale siempre de la sesión', () => {
    it('criterio 9: ?academiaId=<B> en la dirección no cambia nada: el cobro de una solicitud de A sigue siendo de A y no toca a B', async () => {
      const cliente = await sembrarCobrable(e);
      const antesB = await instantaneaDeLaAcademia(e.B.id);

      const respuesta = await ctx.http.post(
        `${rutaCobro(cliente.solicitudId)}?academiaId=${e.B.id}`,
        cuerpoCobro('42.00'),
        {
          cookie: cookies.secretaria,
        },
      );

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await instantaneaDeLaAcademia(e.B.id)).toBe(antesB);
    });

    it('criterio 9: con ?academiaId=<A> una solicitud de B sigue sin existir para la sesión de A (404), y con la sesión de B se cobra en B', async () => {
      const ajena = await deB();

      const conA = await ctx.http.post(`${rutaCobro(ajena.solicitudId)}?academiaId=${e.A.id}`, cuerpoCobro('42.00'), {
        cookie: cookies.secretaria,
      });
      const conB = await ctx.http.post(`${rutaCobro(ajena.solicitudId)}?academiaId=${e.A.id}`, cuerpoCobro('42.00'), {
        cookie: cookies.secretariaB,
      });

      expect(conA.status).toBe(404);
      expect(conB.status, conB.texto).toBe(201);
    });

    it.each([
      [
        'cobro',
        (id: string) => ({
          ruta: rutaCobro(id),
          cuerpo: cuerpoCobro('42.00', { academiaId: 'cualquiera' }),
          cookie: 'secretaria' as const,
        }),
      ],
      [
        'ajuste',
        (id: string) => ({
          ruta: rutaAjuste(id),
          cuerpo: cuerpoAjuste('35', undefined, { academiaId: 'cualquiera' }),
          cookie: 'admin' as const,
        }),
      ],
    ])(
      'criterio 9: un academiaId en el cuerpo del %s responde 400 por campo de más, sin escribir',
      async (_nombre, armar) => {
        const cliente = await sembrarCobrable(e);
        const antes = await delA();
        const { ruta, cuerpo, cookie } = armar(cliente.solicitudId);

        const respuesta = await ctx.http.post(ruta, cuerpo, { cookie: cookies[cookie] });

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(await delA()).toEqual(antes);
      },
    );

    it('criterio 9: una cabecera con la academia (X-Academia-Id, X-Academia, Host) no cambia nada: la solicitud de B sigue siendo un 404 para la sesión de A', async () => {
      const ajena = await deB();

      for (const cabecera of <Record<string, string>[]>[
        { 'x-academia-id': e.B.id },
        { 'x-academia': 'academia-b' },
        { 'x-aquagestion-academia': e.B.id },
      ]) {
        const respuesta = await ctx.http.post(rutaCobro(ajena.solicitudId), cuerpoCobro('42.00'), {
          cookie: cookies.secretaria,
          headers: cabecera,
        });
        expect(respuesta.status, JSON.stringify(cabecera)).toBe(404);
      }
    });

    it('criterio 9: la sesión de A no sirve en una ruta pública de B ni la de B en la de A (la cookie lleva la academia): el ticket de un pago de A con la cookie de B es un 404', async () => {
      const cliente = await sembrarCobrable(e);
      const { pagoId } = await crearPagoConfirmadoConMovimiento(e.A.id, {
        cajaId,
        alumnoId: cliente.alumnoId,
        matriculaId: cliente.matriculaId,
        usuarioId: e.secretariaA.id,
        numeroTicket: 1,
      });

      expect((await ctx.http.get(rutaTicket(pagoId), { cookie: cookies.secretariaB })).status).toBe(404);
      expect((await ctx.http.get(rutaTicket(pagoId), { cookie: cookies.secretaria })).status).toBe(200);
    });
  });

  describe('el actor deja de estar vigente mientras la petición espera: 401 NO_AUTENTICADO antes que cualquier 404 o 409, sin escribir', () => {
    const CAMBIOS = [
      ['desactivado', 'desactivar'],
      ['con la versión de token cambiada', 'solo-version'],
    ] as const;

    describe.each(CAMBIOS)('el actor %s', (_nombre, cambio) => {
      it('criterio 9: un cobro que habría dado 201 responde 401 y no escribe', async () => {
        const cliente = await sembrarCobrable(e);
        const antes = await delA();
        const antesA = await partesDeLaAcademia(e.A.id);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: e.secretariaA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () =>
            ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie: cookies.secretaria }),
        });

        expect(
          esperoElBloqueo,
          'el cobro debía quedar esperando la fila del actor: bloquearActorVigente es su primera sentencia',
        ).toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        const despues = await delA();
        expect(despues.b).toBe(antes.b);
        // Lo único que cambia en A es la fila del actor (la hizo la prueba): ni pagos, ni cuentas de alumnos, ni movimientos, ni auditoría.
        const despuesA = await partesDeLaAcademia(e.A.id);
        expect(despuesA.pagos).toEqual([]);
        expect(despuesA.auditoria).toEqual(antesA.auditoria);
        expect(despuesA.caja).toBe(antesA.caja);
        expect(despuesA.inscripciones).toBe(antesA.inscripciones);
      });

      it('criterio 9: un cobro que habría dado 409 (la caja cerrada o la solicitud vencida) responde 401, no el 409', async () => {
        const vencida = await sembrarCobrable(e, { estado: 'PENDIENTE_PAGO_VENCIDA' });

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: e.secretariaA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () =>
            ctx.http.post(rutaCobro(vencida.solicitudId), cuerpoCobro('42.00'), { cookie: cookies.secretaria }),
        });

        expect(esperoElBloqueo).toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
      });

      it('criterio 9: con la caja cerrada, un cobro cuyo actor deja de ser vigente responde 401 y no SIN_CAJA_ABIERTA', async () => {
        await cerrarCajaDePrueba(e.A.id, cajaId, e.secretariaA.id);
        const cliente = await sembrarCobrable(e);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: e.secretariaA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () =>
            ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie: cookies.secretaria }),
        });

        expect(esperoElBloqueo).toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
      });

      it('criterio 9: un ajuste que habría dado 200 responde 401 y no escribe', async () => {
        const cliente = await sembrarCobrable(e);
        const antesA = await partesDeLaAcademia(e.A.id);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: e.adminA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => ctx.http.post(rutaAjuste(cliente.solicitudId), cuerpoAjuste('35'), { cookie: cookies.admin }),
        });

        expect(esperoElBloqueo, 'el ajuste debía quedar esperando la fila del actor').toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        const despuesA = await partesDeLaAcademia(e.A.id);
        expect(despuesA.auditoria).toEqual(antesA.auditoria);
        expect(despuesA.inscripciones).toBe(antesA.inscripciones);
      });

      it('criterio 9: un ajuste de una solicitud que habría dado 409 (vencida) responde 401, no el 409', async () => {
        const vencida = await sembrarCobrable(e, { estado: 'PENDIENTE_PAGO_VENCIDA' });

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: e.adminA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => ctx.http.post(rutaAjuste(vencida.solicitudId), cuerpoAjuste('35'), { cookie: cookies.admin }),
        });

        expect(esperoElBloqueo).toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
      });
    });

    it('criterio 9 (control): si la prueba solo bloquea la fila del actor sin cambiarla, el cobro espera y luego se acepta (201)', async () => {
      const cliente = await sembrarCobrable(e);

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: e.A.id,
        actorId: e.secretariaA.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'COMMIT',
        enviar: () =>
          ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie: cookies.secretaria }),
      });

      expect(esperoElBloqueo).toBe(true);
      expect(resultado.status, resultado.texto).toBe(201);
      expect(pagoDe(resultado).monto).toBe('42.00');
    });
  });
});
