// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  pagoDe,
  rutaAjuste,
  rutaCancelar,
  rutaCobro,
  type SolicitudPanelApi,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  camposConError,
  crearAppInscripciones,
  type RespuestaApi,
} from '../../utilidades/inscripciones';
import { filaPagoValida, insertarPago } from '../../utilidades/pagos';

// Criterio 29 (crítico, HU-09, RN-21: sin datos médicos; criterio 38 de 005): la lista de solicitudes del panel y la respuesta de la cancelación (005b) muestran el estado visible de la definición, y cada
// elemento (`solicitudPanelSchema`) suma `ajuste` (`{ montoCalculado, motivo }` o `null`) y `pago` (el último pago de la matrícula: `{ id, metodo, estado, monto, registradoEn, verificadoEn, numeroOperacion,
// fechaOperacion, motivoRechazo, numeroTicket }` o `null`). `monto` es el total a cobrar. El filtro `ACTIVAS` muestra `PENDIENTE_PAGO`, `EN_VERIFICACION` y `PAGO_RECHAZADO` (los dos últimos, [007b]), y suma el
// filtro `CONFIRMADAS`. El último pago de una matrícula es el de `registrado_en` más reciente (y, a igual instante, el de mayor `id`).

const CLAVES_DEL_ELEMENTO = [
  'ajuste',
  'apellidos',
  'clases',
  'clasesTotales',
  'codigo',
  'creadaEn',
  'dni',
  'estado',
  'id',
  'menorDeEdad',
  'mes',
  'monto',
  'nombres',
  'pago',
  'plan',
  'reservaVenceEn',
  'telefono',
];
const CLAVES_DEL_PAGO = [
  'estado',
  'fechaOperacion',
  'id',
  'metodo',
  'monto',
  'motivoRechazo',
  'numeroOperacion',
  'numeroTicket',
  'registradoEn',
  'verificadoEn',
];

describe('el panel de solicitudes con los pagos (criterio 29)', () => {
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

  const lista = (query = '', cookie = cookies.admin): Promise<RespuestaApi> =>
    ctx.http.get(`/api/solicitudes${query}`, { cookie });
  const elementos = (respuesta: RespuestaApi): SolicitudPanelApi[] => {
    expect(respuesta.status, respuesta.texto).toBe(200);
    return respuesta.body?.['solicitudes'] as SolicitudPanelApi[];
  };
  const ids = (respuesta: RespuestaApi) => elementos(respuesta).map((s) => s.id);
  const cobrar = (solicitudId: string) =>
    ctx.http.post(rutaCobro(solicitudId), cuerpoCobro('42.00'), { cookie: cookies.secretaria });

  describe('la forma de cada elemento', () => {
    it('criterio 29: cada elemento tiene exactamente las claves del contrato, con ajuste y pago en null si no los hay; monto es el total a cobrar', async () => {
      await sembrarCobrable(e);

      const [elemento] = elementos(await lista());

      expect(Object.keys(elemento ?? {}).sort()).toEqual(CLAVES_DEL_ELEMENTO);
      expect(elemento).toMatchObject({ estado: 'PENDIENTE_PAGO', monto: '42.00', ajuste: null, pago: null });
    });

    it('criterio 29: con un ajuste, el elemento muestra el total ajustado en monto y el ajuste { montoCalculado, motivo }', async () => {
      const cliente = await sembrarCobrable(e);
      await ctx.http.post(rutaAjuste(cliente.solicitudId), cuerpoAjuste('35', 'Descuento autorizado'), {
        cookie: cookies.admin,
      });

      const [elemento] = elementos(await lista());

      expect(elemento).toMatchObject({
        monto: '35.00',
        ajuste: { montoCalculado: '42.00', motivo: 'Descuento autorizado' },
        pago: null,
      });
      expect(Object.keys(elemento?.ajuste ?? {}).sort()).toEqual(['montoCalculado', 'motivo']);
    });

    it('criterio 29: una solicitud cobrada es CONFIRMADA, sin vencimiento de reserva, con su último pago (todas las claves del pago) y el total', async () => {
      const cliente = await sembrarCobrable(e);
      const pagoId = pagoDe(await cobrar(cliente.solicitudId)).id;

      const [elemento] = elementos(await lista('?estado=TODAS'));

      expect(elemento).toMatchObject({
        id: cliente.solicitudId,
        estado: 'CONFIRMADA',
        reservaVenceEn: null,
        monto: '42.00',
      });
      expect(Object.keys(elemento?.pago ?? {}).sort()).toEqual(CLAVES_DEL_PAGO);
      expect(elemento?.pago).toEqual({
        id: pagoId,
        metodo: 'EFECTIVO',
        estado: 'CONFIRMADO',
        monto: '42.00',
        registradoEn: AHORA_007.toISOString(),
        verificadoEn: AHORA_007.toISOString(),
        numeroOperacion: null,
        fechaOperacion: null,
        motivoRechazo: null,
        numeroTicket: 1,
      });
    });

    it('criterio 29: el último pago de la matrícula es el de registrado_en más reciente: un rechazado anterior no tapa al confirmado', async () => {
      const cliente = await sembrarCobrable(e);
      const anterior = filaPagoValida(
        e.A.id,
        { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId, usuarioId: e.secretariaA.id },
        { estado: 'RECHAZADO' },
        { registrado_en: new Date('2026-11-11T13:00:00.000Z'), verificado_en: new Date('2026-11-11T13:30:00.000Z') },
      );
      await insertarPago('propietario', e.A.id, anterior);
      const pagoId = pagoDe(await cobrar(cliente.solicitudId)).id;

      const [elemento] = elementos(await lista('?estado=TODAS'));

      expect(elemento?.pago?.id).toBe(pagoId);
      expect(elemento?.pago?.estado).toBe('CONFIRMADO');
    });

    it('criterio 29: a igual instante, el último pago es el de mayor id', async () => {
      const cliente = await sembrarCobrable(e);
      const uno = filaPagoValida(
        e.A.id,
        { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId, usuarioId: e.secretariaA.id },
        { estado: 'RECHAZADO' },
      );
      const dos = filaPagoValida(
        e.A.id,
        { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId, usuarioId: e.secretariaA.id },
        { estado: 'RECHAZADO' },
      );
      await insertarPago('propietario', e.A.id, uno);
      await insertarPago('propietario', e.A.id, dos);
      const mayor = [uno['id'], dos['id']].sort().reverse()[0];

      const [elemento] = elementos(await lista('?estado=TODAS'));

      expect(elemento?.pago?.id).toBe(mayor);
    });

    it('criterio 29: el pago del elemento no lleva el comprobante, la IP, la clave de idempotencia ni quién lo registró', async () => {
      const cliente = await sembrarCobrable(e);
      await cobrar(cliente.solicitudId);

      const respuesta = await lista('?estado=TODAS');

      for (const prohibido of [
        'comprobante',
        'ipOrigen',
        'ip_origen',
        'claveIdempotencia',
        'registradoPor',
        'verificadoPor',
        'alumnoId',
        'matriculaId',
      ]) {
        expect(respuesta.texto, `la lista lleva ${prohibido}`).not.toContain(prohibido);
      }
    });
  });

  describe('los filtros', () => {
    it('criterio 29: ACTIVAS (por defecto) no muestra la CONFIRMADA; CONFIRMADAS muestra solo las confirmadas; TODAS muestra las dos', async () => {
      const pendiente = await sembrarCobrable(e);
      const pagada = await sembrarCobrable(e);
      await cobrar(pagada.solicitudId);

      expect(ids(await lista())).toEqual([pendiente.solicitudId]);
      expect(ids(await lista('?estado=ACTIVAS'))).toEqual([pendiente.solicitudId]);
      expect(ids(await lista('?estado=CONFIRMADAS'))).toEqual([pagada.solicitudId]);
      expect(ids(await lista('?estado=TODAS')).sort()).toEqual([pendiente.solicitudId, pagada.solicitudId].sort());
    });

    it('criterio 29: VENCIDAS y CANCELADAS no incluyen las confirmadas', async () => {
      const pagada = await sembrarCobrable(e);
      await cobrar(pagada.solicitudId);
      const vencida = await sembrarCobrable(e, { estado: 'PENDIENTE_PAGO_VENCIDA' });
      const cancelada = await sembrarCobrable(e, { estado: 'CANCELADA' });

      expect(ids(await lista('?estado=VENCIDAS'))).toEqual([vencida.solicitudId]);
      expect(ids(await lista('?estado=CANCELADAS'))).toEqual([cancelada.solicitudId]);
    });

    it('criterio 29: CONFIRMADAS sin ninguna confirmada es una lista vacía (200)', async () => {
      await sembrarCobrable(e);

      expect(ids(await lista('?estado=CONFIRMADAS'))).toEqual([]);
    });

    it.each([
      ['en minúsculas', '?estado=confirmadas'],
      ['con otro nombre', '?estado=CONFIRMADA'],
      ['repetido', '?estado=CONFIRMADAS&estado=TODAS'],
    ])(
      'criterio 29: el parámetro estado %s responde 400 SOLICITUD_INVALIDA en el campo estado',
      async (_nombre, query) => {
        const respuesta = await lista(query);

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDeRespuesta(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)[0]).toBe('estado');
      },
    );

    it('criterio 29: la lista de A nunca trae pagos ni solicitudes de B, tampoco con ?academiaId=', async () => {
      const pagada = await sembrarCobrable(e);
      await cobrar(pagada.solicitudId);

      const deB = await lista(`?estado=TODAS&academiaId=${e.A.id}`, cookies.adminB);

      expect(elementos(deB)).toEqual([]);
    });

    it('criterio 29 (permisos de la lista): ENTRENADOR y ALUMNO reciben 403 SIN_PERMISO también con el filtro nuevo', async () => {
      for (const cookie of [cookies.entrenador, cookies.alumno]) {
        const respuesta = await lista('?estado=CONFIRMADAS', cookie);
        expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([403, 'SIN_PERMISO']);
      }
    });
  });

  describe('la respuesta de la cancelación (005b) con ajuste y pago', () => {
    it('criterio 29: cancelar una solicitud con un ajuste devuelve el elemento CANCELADO con el ajuste y pago en null', async () => {
      const cliente = await sembrarCobrable(e);
      await ctx.http.post(rutaAjuste(cliente.solicitudId), cuerpoAjuste('35', 'Descuento autorizado'), {
        cookie: cookies.admin,
      });

      const respuesta = await ctx.http.post(
        rutaCancelar(cliente.solicitudId),
        { motivo: 'Pidió que la cancelen por teléfono' },
        { cookie: cookies.admin },
      );

      expect(respuesta.status, respuesta.texto).toBe(200);
      const solicitud = respuesta.body?.['solicitud'] as SolicitudPanelApi;
      expect(Object.keys(solicitud).sort()).toEqual(CLAVES_DEL_ELEMENTO);
      expect(solicitud).toMatchObject({
        estado: 'CANCELADA',
        reservaVenceEn: null,
        monto: '35.00',
        ajuste: { montoCalculado: '42.00', motivo: 'Descuento autorizado' },
        pago: null,
      });
    });

    it('criterio 29: el id de una solicitud de otra persona no aparece en la lista de confirmadas de otra academia (aislamiento)', async () => {
      const pagada = await sembrarCobrable(e);
      await cobrar(pagada.solicitudId);
      const inexistente = randomUUID();

      expect(ids(await lista('?estado=CONFIRMADAS'))).not.toContain(inexistente);
      expect(ids(await lista('?estado=CONFIRMADAS', cookies.adminB))).toEqual([]);
    });
  });
});
