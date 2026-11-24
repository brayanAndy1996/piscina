// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fijarConfiguracion } from '../../utilidades/configuracion';
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
  pagoDe,
  rutaAjuste,
  rutaCobro,
  rutaTicket,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  crearAppInscripciones,
  type Objeto,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { crearCajaDePrueba } from '../../utilidades/caja';
import { filaPagoValida, insertarPago, LEYENDA_DEL_TICKET } from '../../utilidades/pagos';

// Criterio 26 (crítico en el aislamiento y el permiso; prueba obligatoria en el contenido; HU-07, D-09, D-23): `GET /api/pagos/{id}/ticket` (`REGISTRAR_INSCRIPCION_Y_COBRO`) responde 200 con `{ ticket }`
// (`ticketSchema`, estricto): academia (`nombre`, `telefono`), `numero`, `fechaHora` (de la confirmación, en ISO), alumno (`nombres` y `apellidos`, sin DNI; DR-4), concepto (`INSCRIPCION`), plan, mes, método,
// número de operación (solo Yape o transferencia), `monto` (el total, texto con dos decimales), quién cobró o verificó (nombres y apellidos) y la `leyenda` fija «Comprobante interno de pago. No es un
// comprobante electrónico SUNAT» (DR-4). Un pago pendiente o rechazado, de otra academia o inexistente responde 404 `NO_ENCONTRADO`. No escribe ni audita. Los permisos están en `permisos.test.ts`.
// Decisión de la prueba (la spec no fija los nombres): `plan` y `mes` se buscan por su valor en el cuerpo (el nombre del plan y `2026-11`) y quién cobró por sus nombres y apellidos; las claves fijas son las
// que la spec nombra.

describe('ticket interno del pago (criterio 26)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
    await abrirCajaDeHoy(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  async function cobrado(opciones: Parameters<typeof sembrarCobrable>[1] = {}, cookie = cookies.secretaria) {
    const cliente = await sembrarCobrable(e, opciones);
    const respuesta = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie });
    expect(respuesta.status, respuesta.texto).toBe(201);
    return { cliente, pagoId: pagoDe(respuesta).id };
  }
  const ticketDe = (pagoId: string, cookie = cookies.secretaria) => ctx.http.get(rutaTicket(pagoId), { cookie });

  describe('el contenido', () => {
    it('criterio 26: responde 200 con { ticket }, Cache-Control: no-store, con la academia, el número, la fecha, el alumno, el concepto, el método, el monto y la leyenda', async () => {
      await fijarConfiguracion(e.A.id, { telefono: '+51 987 654 321' });
      const { pagoId } = await cobrado();

      const respuesta = await ticketDe(pagoId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {})).toEqual(['ticket']);
      const ticket = respuesta.body?.['ticket'] as Objeto;
      expect(ticket).toMatchObject({
        academia: { nombre: 'Academia A', telefono: '+51 987 654 321' },
        numero: 1,
        fechaHora: AHORA_007.toISOString(),
        alumno: { nombres: 'Valeria', apellidos: 'Mendoza Salas' },
        concepto: 'INSCRIPCION',
        metodo: 'EFECTIVO',
        monto: '42.00',
        leyenda: LEYENDA_DEL_TICKET,
      });
      expect(Object.keys(ticket['academia'] as Objeto).sort()).toEqual(['nombre', 'telefono']);
      expect(Object.keys(ticket['alumno'] as Objeto).sort()).toEqual(['apellidos', 'nombres']);
      expect(ticket['numeroOperacion'] ?? null, 'el efectivo no lleva número de operación').toBeNull();
      expect(respuesta.texto).toContain(e.plan.nombre);
      expect(respuesta.texto).toContain('2026-11');
    });

    it('criterio 26: lleva quién cobró (nombres y apellidos de la secretaria o del administrador) y nunca el DNI de nadie', async () => {
      const uno = await cobrado({}, cookies.secretaria);
      const dos = await cobrado({}, cookies.admin);

      const delSecretaria = await ticketDe(uno.pagoId);
      const delAdmin = await ticketDe(dos.pagoId, cookies.admin);

      expect(delSecretaria.texto).toContain(e.secretariaA.nombres);
      expect(delSecretaria.texto).toContain(e.secretariaA.apellidos);
      expect(delAdmin.texto).toContain(e.adminA.nombres);
      expect(delAdmin.texto).toContain(e.adminA.apellidos);
      for (const [respuesta, cliente] of [
        [delSecretaria, uno.cliente],
        [delAdmin, dos.cliente],
      ] as const) {
        expect(respuesta.texto, 'sin el DNI del alumno (DR-4)').not.toContain(cliente.dni);
        expect(respuesta.texto, 'sin el DNI de quien cobró').not.toContain(e.secretariaA.dni);
        expect(respuesta.texto).not.toContain(e.adminA.dni);
      }
      expect(delSecretaria.texto).not.toMatch(
        /dni|clave|hash|token|alumnoId|matriculaId|solicitudId|claveIdempotencia|academiaId/i,
      );
    });

    it('criterio 26: el monto del ticket es el total a cobrar, también con un ajuste del administrador (S/ 35)', async () => {
      const cliente = await sembrarCobrable(e);
      const ajuste = await ctx.http.post(rutaAjuste(cliente.solicitudId), cuerpoAjuste('35'), {
        cookie: cookies.admin,
      });
      expect(ajuste.status, ajuste.texto).toBe(200);
      const cobro = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('35'), {
        cookie: cookies.secretaria,
      });
      expect(cobro.status, cobro.texto).toBe(201);

      const respuesta = await ticketDe(pagoDe(cobro).id);

      expect((respuesta.body?.['ticket'] as Objeto)['monto']).toBe('35.00');
    });

    it('criterio 26 y 25: cada ticket lleva el número de su pago (1, 2…) y el teléfono de la academia es null si no lo configuró', async () => {
      const uno = await cobrado();
      const dos = await cobrado();

      const t1 = (await ticketDe(uno.pagoId)).body?.['ticket'] as Objeto;
      const t2 = (await ticketDe(dos.pagoId)).body?.['ticket'] as Objeto;

      expect([t1['numero'], t2['numero']]).toEqual([1, 2]);
      expect((t1['academia'] as Objeto)['telefono']).toBeNull();
    });

    it('criterio 26: un ticket se puede pedir las veces que haga falta (por la secretaria o por el administrador), siempre igual, sin escribir ni auditar', async () => {
      const { pagoId } = await cobrado();
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const primero = await ticketDe(pagoId);
      const segundo = await ticketDe(pagoId, cookies.admin);

      expect(primero.status).toBe(200);
      expect(segundo.texto).toBe(primero.texto);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    });
  });

  describe('lo que no tiene ticket y el aislamiento: 404 NO_ENCONTRADO, sin escribir ni auditar', () => {
    it('criterio 26: un pago pendiente de verificación o rechazado (de un Yape), uno inexistente y un id que no es UUID responden el mismo 404', async () => {
      const yape = await sembrarCobrable(e, { reservaVenceEn: null });
      const rechazado = await sembrarCobrable(e, { reservaVenceEn: null });
      const filaPendiente = filaPagoValida(e.A.id, { alumnoId: yape.alumnoId, matriculaId: yape.matriculaId });
      const filaRechazada = filaPagoValida(
        e.A.id,
        { alumnoId: rechazado.alumnoId, matriculaId: rechazado.matriculaId, usuarioId: e.secretariaA.id },
        { estado: 'RECHAZADO' },
      );
      await insertarPago('propietario', e.A.id, filaPendiente);
      await insertarPago('propietario', e.A.id, filaRechazada);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuestas = await Promise.all(
        [filaPendiente['id'], filaRechazada['id'], randomUUID(), 'no-es-un-uuid'].map((id) => ticketDe(id as string)),
      );

      for (const r of respuestas) expect([r.status, codigoDeRespuesta(r)], r.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(new Set(respuestas.map((r) => r.texto.replaceAll(/[0-9a-f-]{36}/g, '<id>'))).size).toBe(1);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    });

    it('criterio 26 y 9: el pago confirmado de otra academia responde el mismo 404 (con la sesión de A); con la de B sí se ve', async () => {
      const caja = await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      const deB = await sembrarSolicitud(e.B.id, {
        planId: e.planB.id,
        claseIds: [e.lunesB.id],
        clasesTotales: 5,
        clasesPorMesPlan: 12,
        precioPlan: '100.00',
        monto: '42.00',
      });
      const cobro = await ctx.http.post(rutaCobro(deB.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookies.secretariaB,
      });
      expect(cobro.status, cobro.texto).toBe(201);
      const pagoId = pagoDe(cobro).id;
      const antes = await instantaneaDeLaAcademia(e.B.id);

      const conA = await ticketDe(pagoId, cookies.secretaria);
      const conB = await ticketDe(pagoId, cookies.secretariaB);

      expect([conA.status, codigoDeRespuesta(conA)]).toEqual([404, 'NO_ENCONTRADO']);
      expect(conB.status, conB.texto).toBe(200);
      expect((conB.body?.['ticket'] as Objeto)['academia']).toMatchObject({ nombre: 'Academia B' });
      expect(await instantaneaDeLaAcademia(e.B.id)).toBe(antes);
      expect(caja.id).toBeTruthy();
    });

    it('criterio 26: un cobro rechazado (409) no deja ticket: su id de pago no existe', async () => {
      const cliente: SolicitudSembrada = await sembrarCobrable(e);
      const mal = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('41.00'), {
        cookie: cookies.secretaria,
      });
      expect(mal.status).toBe(409);

      const respuesta = await ticketDe(randomUUID());

      expect(respuesta.status).toBe(404);
    });
  });
});
