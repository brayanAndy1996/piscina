// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerMovimientos } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoAjuste,
  cuerpoCobro,
  detallesDeRespuesta,
  type EscenarioPagos,
  exigirRutasDePagos,
  pagoDe,
  rutaAjuste,
  rutaCancelar,
  rutaCobro,
  sembrarCobrable,
  type SolicitudPanelApi,
  solicitudPanelDe,
} from '../../utilidades/escenario-pagos';
import {
  comprobanteDe,
  consultarPorToken,
  estadoVisibleDe,
  exigirRutasDe007b,
  instantaneaConArchivos,
  sembrarEnVerificacion,
  sembrarRechazada,
  vistaDeRespuesta,
} from '../../utilidades/escenario-pagos-007b';
import {
  actualizarFilas,
  conRetencion,
  cuerpoInscripcion,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  llenarClase,
  ocupacionDeClase,
  type RespuestaApi,
  retenerClases,
  rutaPublica,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  subirFotoValida,
} from '../../utilidades/inscripciones-005b';
import { filaPagoValida, insertarPago, leerPagos, T_PAGO } from '../../utilidades/pagos';
import { leerUsuarioPorDni, leerUsuarios } from '../../utilidades/usuarios';

// Criterio 11, parte [007b] (crítico, RN-25, HU-34, RN-22, D-03): solo se ajusta una solicitud con estado visible `PENDIENTE_PAGO` o `PAGO_RECHAZADO`; en `EN_VERIFICACION` responde 409 `SOLICITUD_NO_AJUSTABLE` con `detalles: { estado }`, sin escribir.
// Criterio 15, parte [007b] (crítico, RN-28, D-05): se cobra una solicitud `PAGO_RECHAZADO` (dentro del mes de su matrícula y con cupo); con `EN_VERIFICACION` responde 409 `PAGO_EN_VERIFICACION`, sin escribir.
// Criterio 18 c [007b] (crítico, RN-11, RN-28): una solicitud `PAGO_RECHAZADO` vuelve a pedir cupo: si alguna clase está llena, 409 `SIN_CUPO` con `detalles.clasesSinCupo`; dos cobros o reintentos de solicitudes distintas por el último cupo dejan exactamente uno.
// Criterio 21, parte [007b] (crítico, RN-01, RN-05): mientras el pago está `PENDIENTE_VERIFICACION` o después de `RECHAZADO`, la persona sigue en `CLIENTE`, sin cuenta (el ingreso con su DNI responde como uno que no existe) y sin cambios en su matrícula salvo la reserva.
// Criterio 29, parte [007b] (crítico, HU-09, RN-21): el panel muestra `EN_VERIFICACION` y `PAGO_RECHAZADO` con el último pago; el filtro `ACTIVAS` los incluye.
// Criterio 30, parte [007b] (crítico, RN-28): cancelar con `EN_VERIFICACION` responde 409 `SOLICITUD_CON_PAGO_PENDIENTE` sin escribir; con `PAGO_RECHAZADO` cancela como una `PENDIENTE_PAGO`.
// Criterio 31, parte [007b] (crítico): la subida de la foto acepta una solicitud `EN_VERIFICACION` o `PAGO_RECHAZADO` (sigue siendo la vigente del cliente).
// Criterio 32, parte [007b] (crítico, RN-28, RN-03, DR-14 de 005): con el DNI de un cliente `EN_VERIFICACION`, el envío responde 409 `DNI_YA_REGISTRADO`; con una `PAGO_RECHAZADO`, se acepta (la anterior pasa a `VENCIDA`). Una matrícula con un comprobante
// en revisión ocupa cupo hasta que se resuelve y cuenta en el límite de reservas por conexión de su solicitud (criterio 25 de 005).

describe('los estados EN_VERIFICACION y PAGO_RECHAZADO en el ajuste, el cobro, la cancelación, la foto y el envío (criterios 11, 15, 18 c, 21, 29 a 32)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ ahora: AHORA_007 });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const snapshot = () => instantaneaConArchivos(ctx, e);
  const cobrar = (c: Pick<SolicitudSembrada, 'solicitudId'>, monto = '42.00', cookie = cookies.secretaria) =>
    ctx.http.post(rutaCobro(c.solicitudId), cuerpoCobro(monto), { cookie });
  const ajustar = (c: Pick<SolicitudSembrada, 'solicitudId'>, monto = '35', cookie = cookies.admin) =>
    ctx.http.post(rutaAjuste(c.solicitudId), cuerpoAjuste(monto), { cookie });
  const cancelar = (c: Pick<SolicitudSembrada, 'solicitudId'>, cookie = cookies.admin) =>
    ctx.http.post(rutaCancelar(c.solicitudId), { motivo: 'Pidió que la cancelen por teléfono' }, { cookie });
  const subirFoto = (c: Pick<SolicitudSembrada, 'token'>) => subirFotoValida(ctx, 'academia-a', c.token);
  const enviar = async (sobre: Record<string, unknown> = {}) =>
    ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e, { sobre }));
  const ingresar = (usuario: string, clave: string) => ctx.http.post('/api/a/academia-a/sesion', { usuario, clave });

  describe('criterio 11: el ajuste del monto', () => {
    it('criterio 11: con un comprobante en revisión (EN_VERIFICACION) responde 409 SOLICITUD_NO_AJUSTABLE con { estado: "EN_VERIFICACION" } y no escribe ni audita', async () => {
      const cliente = await sembrarEnVerificacion(e);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('EN_VERIFICACION');
      const antes = await snapshot();

      const respuesta = await ajustar(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
        409,
        'SOLICITUD_NO_AJUSTABLE',
      ]);
      expect(detallesDeRespuesta(respuesta)).toEqual({ estado: 'EN_VERIFICACION' });
      expect(await snapshot()).toBe(antes);
      expect((await leerMatriculas(e.A.id))[0]).toMatchObject({ monto_ajustado: null, motivo_ajuste: null });
    });

    it('criterio 11: con el comprobante rechazado (PAGO_RECHAZADO) se ajusta (200 con { solicitud } PAGO_RECHAZADO y el total nuevo); el ajuste no toca el cupo, la reserva ni las clases', async () => {
      const cliente = await sembrarRechazada(e);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('PAGO_RECHAZADO');

      const respuesta = await ajustar(cliente, '35');

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(Object.keys(respuesta.body ?? {})).toEqual(['solicitud']);
      expect(solicitudPanelDe(respuesta)).toMatchObject({
        id: cliente.solicitudId,
        estado: 'PAGO_RECHAZADO',
        monto: '35.00',
        reservaVenceEn: null,
        ajuste: { montoCalculado: '42.00', motivo: 'Descuento autorizado por la dirección' },
      });
      expect((await leerMatriculas(e.A.id))[0]).toMatchObject({
        estado: 'CANCELADA',
        reserva_vence_en: null,
        clases_totales: 5,
        monto_ajustado: '35.00',
      });
      const filas = await leerAuditoriaDeAcademia(e.A.id, 'MATRICULA_MONTO_AJUSTADO');
      expect(filas).toHaveLength(1);
      expect(filas[0]?.datos_despues).toEqual({ montoAjustado: '35.00', total: '35.00' });
    });

    it('criterio 11 y 38: el ajuste de una solicitud rechazada fija el total del reintento: el comprobante con el total viejo responde MONTO_DISTINTO { total: "35.00" } y con el nuevo se acepta; después ya no se ajusta (EN_VERIFICACION)', async () => {
      exigirRutasDe007b(ctx.app);
      const cliente = await sembrarRechazada(e);
      expect((await ajustar(cliente, '35')).status).toBe(200);

      const conElViejo = await comprobanteDe(ctx, cliente, { monto: '42.00' });
      const conElNuevo = await comprobanteDe(ctx, cliente, { monto: '35.00' });
      const otroAjuste = await ajustar(cliente, '30');

      expect([conElViejo.status, codigoDeRespuesta(conElViejo)]).toEqual([409, 'MONTO_DISTINTO']);
      expect(detallesDeRespuesta(conElViejo)).toEqual({ total: '35.00' });
      expect(conElNuevo.status, conElNuevo.texto).toBe(201);
      expect([otroAjuste.status, codigoDeRespuesta(otroAjuste)]).toEqual([409, 'SOLICITUD_NO_AJUSTABLE']);
      expect(detallesDeRespuesta(otroAjuste)).toEqual({ estado: 'EN_VERIFICACION' });
    });
  });

  describe('criterio 15: qué solicitudes se cobran', () => {
    beforeEach(async () => {
      await abrirCajaDeHoy(e);
    });

    it('criterio 15: con un comprobante en revisión responde 409 PAGO_EN_VERIFICACION y no escribe: se aprueba o se rechaza primero', async () => {
      const cliente = await sembrarEnVerificacion(e);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('EN_VERIFICACION');
      const antes = await snapshot();

      const respuesta = await cobrar(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'PAGO_EN_VERIFICACION']);
      expect(await snapshot()).toBe(antes);
      expect(await leerMovimientos(e.A.id)).toEqual([]);
    });

    it('criterio 15: PAGO_EN_VERIFICACION va antes que el monto: un cobro con un monto viejo de una solicitud en revisión responde PAGO_EN_VERIFICACION, no MONTO_CAMBIO', async () => {
      const cliente = await sembrarEnVerificacion(e);

      const respuesta = await cobrar(cliente, '1.00');

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'PAGO_EN_VERIFICACION']);
    });

    it('criterio 15 y 20: una solicitud PAGO_RECHAZADO con cupo se cobra en efectivo (201): se confirma, la matrícula pasa de CANCELADA a VIGENTE, entra a la caja y el pago rechazado queda como estaba', async () => {
      const cliente = await sembrarRechazada(e);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('PAGO_RECHAZADO');

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(pagoDe(respuesta)).toMatchObject({
        estado: 'CONFIRMADO',
        metodo: 'EFECTIVO',
        monto: '42.00',
        numeroTicket: 1,
      });
      expect(solicitudPanelDe(respuesta)).toMatchObject({ estado: 'CONFIRMADA', monto: '42.00' });
      expect((await leerMatriculas(e.A.id))[0]).toMatchObject({ estado: 'VIGENTE', reserva_vence_en: null });
      expect((await leerAlumnos(e.A.id))[0]).toMatchObject({ estado: 'ALUMNO_ACTIVO' });
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      const pagos = await leerPagos(e.A.id);
      expect(pagos.map((p) => p.estado).sort()).toEqual(['CONFIRMADO', 'RECHAZADO']);
      expect(pagos.find((p) => p.estado === 'RECHAZADO')?.motivo_rechazo).toBe('La imagen no se lee');
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, { anio: 2026, mes: 11 }, AHORA_007)).toBe(1);
    });

    it('criterio 15: una solicitud PAGO_RECHAZADO con un monto mostrado viejo responde 409 MONTO_CAMBIO con { total } y no escribe', async () => {
      const cliente = await sembrarRechazada(e);
      const antes = await snapshot();

      const respuesta = await cobrar(cliente, '41.00');

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'MONTO_CAMBIO']);
      expect(detallesDeRespuesta(respuesta)).toEqual({ total: '42.00' });
      expect(await snapshot()).toBe(antes);
    });

    it('criterio 15: pasado el mes de la matrícula, una PAGO_RECHAZADO ya es VENCIDA: 409 SOLICITUD_NO_COBRABLE con { estado: "VENCIDA" }; el último milisegundo del mes todavía se cobra', async () => {
      const dentro = await sembrarRechazada(e);
      const fuera = await sembrarRechazada(e);

      const alFinal = new Date('2026-12-01T04:59:59.999Z');
      ctx.reloj.fijar(alFinal);
      const cobrada = await ctx.http.post(rutaCobro(dentro.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookiesDePagos(e, alFinal).secretaria,
      });
      const despues = new Date('2026-12-01T05:00:00.000Z');
      ctx.reloj.fijar(despues);
      const vencida = await ctx.http.post(rutaCobro(fuera.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookiesDePagos(e, despues).secretaria,
      });

      expect(
        [cobrada.status, codigoDeRespuesta(cobrada)],
        'la solicitud todavía es cobrable (PAGO_RECHAZADO); lo que lo detiene es la caja abierta de otro día',
      ).toEqual([409, 'CAJA_DE_OTRO_DIA']);
      expect([vencida.status, codigoDeRespuesta(vencida)], vencida.texto).toEqual([409, 'SOLICITUD_NO_COBRABLE']);
      expect(detallesDeRespuesta(vencida)).toEqual({ estado: 'VENCIDA' });
    });

    it('criterio 15: después de aprobar un comprobante, la solicitud ya está pagada: el cobro responde 409 SOLICITUD_YA_PAGADA', async () => {
      exigirRutasDe007b(ctx.app);
      const cliente = await sembrarEnVerificacion(e);
      const aprobacion = await ctx.http.post(
        `/api/pagos/${cliente.pagoId}/aprobacion`,
        {},
        { cookie: cookies.secretaria },
      );
      expect(aprobacion.status, aprobacion.texto).toBe(200);

      const respuesta = await cobrar(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'SOLICITUD_YA_PAGADA']);
    });
  });

  describe('criterio 18 c: el cupo al cobrar una solicitud PAGO_RECHAZADO', () => {
    const mes = { anio: 2026, mes: 11 };

    beforeEach(async () => {
      await abrirCajaDeHoy(e);
    });

    it('criterio 18 c: con la clase llena responde 409 SIN_CUPO con las clases sin cupo, no queda nada del cobro y la solicitud sigue PAGO_RECHAZADO', async () => {
      const cliente = await sembrarRechazada(e);
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);
      const antes = await snapshot();

      const respuesta = await cobrar(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDeRespuesta(respuesta)['clasesSinCupo']).toEqual([e.lunes.id]);
      expect(await snapshot()).toBe(antes);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('PAGO_RECHAZADO');
    });

    it('criterio 18 c: con 19 de 20 ocupadas, la solicitud rechazada toma el último cupo al cobrarse (la ocupación llega a 20, no a 21)', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const cliente = await sembrarRechazada(e);

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBe(20);
    });

    it('criterio 18 c: dos cobros simultáneos de solicitudes rechazadas distintas por el último cupo dejan exactamente uno (201) y el otro responde 409 SIN_CUPO; la ocupación queda en 20', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const uno = await sembrarRechazada(e);
      const otro = await sembrarRechazada(e);

      const respuestas = await Promise.all([cobrar(uno), cobrar(otro, '42.00', cookies.admin)]);

      expect(respuestas.map((r) => r.status).sort(), respuestas.map((r) => r.texto).join(' | ')).toEqual([201, 409]);
      const perdedora = respuestas.find((r) => r.status === 409) as RespuestaApi;
      expect(codigoDeRespuesta(perdedora)).toBe('SIN_CUPO');
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBe(20);
      expect((await leerPagos(e.A.id)).filter((p) => p.estado === 'CONFIRMADO')).toHaveLength(1);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });

    it.each([[true], [false]])(
      'criterio 18 c (determinista): si el cobro de una de las dos solicitudes llega antes a la clase (la primera: %s), gana ella y la otra responde 409 SIN_CUPO',
      async (primeraEsLaUno) => {
        await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
        const uno = await sembrarRechazada(e);
        const otro = await sembrarRechazada(e);
        const [primera, segunda] = primeraEsLaUno ? [uno, otro] : [otro, uno];

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: e.A.id,
          retener: retenerClases([e.lunes.id], e.A.id),
          enviar: [() => cobrar(primera), () => cobrar(segunda, '42.00', cookies.admin)],
          enOrden: true,
          liberar: 'COMMIT',
        });

        expect(todasEsperaron).toBe(true);
        const [ganadora, perdedora] = resultados as [RespuestaApi, RespuestaApi];
        expect(ganadora.status, ganadora.texto).toBe(201);
        expect([perdedora.status, codigoDeRespuesta(perdedora)], perdedora.texto).toEqual([409, 'SIN_CUPO']);
        expect(await estadoVisibleDe(ctx, segunda.token)).toBe('PAGO_RECHAZADO');
        expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBe(20);
      },
    );

    it('criterio 18 c: un cobro y un reintento del comprobante de otra persona por el último cupo dejan exactamente uno (determinista, en los dos órdenes)', async () => {
      exigirRutasDe007b(ctx.app);
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const quienCobra = await sembrarRechazada(e);
      const quienReintenta = await sembrarRechazada(e);

      const cobroPrimero = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => cobrar(quienCobra), () => comprobanteDe(ctx, quienReintenta)],
        enOrden: true,
        liberar: 'COMMIT',
      });
      expect(cobroPrimero.todasEsperaron).toBe(true);
      const [cobro, reintento] = cobroPrimero.resultados as [RespuestaApi, RespuestaApi];
      expect(cobro.status, cobro.texto).toBe(201);
      expect([reintento.status, codigoDeRespuesta(reintento)], reintento.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBe(20);
    });

    it('criterio 18 c: dos reintentos simultáneos de comprobante de solicitudes rechazadas distintas por el último cupo dejan exactamente uno (201) y el otro 409 SIN_CUPO', async () => {
      exigirRutasDe007b(ctx.app);
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const uno = await sembrarRechazada(e);
      const otro = await sembrarRechazada(e);

      const respuestas = await Promise.all([comprobanteDe(ctx, uno), comprobanteDe(ctx, otro)]);

      expect(respuestas.map((r) => r.status).sort(), respuestas.map((r) => r.texto).join(' | ')).toEqual([201, 409]);
      expect(codigoDeRespuesta(respuestas.find((r) => r.status === 409) as RespuestaApi)).toBe('SIN_CUPO');
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBe(20);
    });
  });

  describe('criterio 21: la persona sigue siendo cliente mientras el pago no se confirma', () => {
    it.each([
      ['PENDIENTE_VERIFICACION', async () => sembrarEnVerificacion(e)],
      ['RECHAZADO', async () => sembrarRechazada(e)],
    ] as const)(
      'criterio 21: con el pago %s sigue en CLIENTE sin cuenta y el ingreso con su DNI responde como el de un usuario que no existe',
      async (_nombre, sembrar) => {
        const cliente = await sembrar();
        const usuariosAntes = await leerUsuarios(e.A.id);

        const delCliente = await ingresar(cliente.dni, cliente.dni);
        const inexistente = await ingresar('11112222', '11112222');

        expect(delCliente.status).toBe(401);
        expect(delCliente.texto).toBe(inexistente.texto);
        expect(delCliente.headers.get('set-cookie')).toBeNull();
        expect(await leerUsuarioPorDni(e.A.id, cliente.dni)).toBeUndefined();
        expect(await leerUsuarios(e.A.id)).toEqual(usuariosAntes);
        expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)).toMatchObject({
          estado: 'CLIENTE',
          usuario_id: null,
        });
      },
    );

    it('criterio 21: un comprobante que se sube por la API deja la matrícula igual salvo la reserva (RESERVADA, sin vencimiento): mismas clases, monto y cálculo', async () => {
      exigirRutasDe007b(ctx.app);
      const cliente = await sembrarRechazada(e);
      const [antes] = await leerMatriculas(e.A.id);

      const respuesta = await comprobanteDe(ctx, cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      const [despues] = await leerMatriculas(e.A.id);
      const sinReserva = (fila: object | undefined) =>
        Object.fromEntries(
          Object.entries(fila ?? {}).filter(
            ([clave]) => !['estado', 'reserva_vence_en', 'actualizado_en'].includes(clave),
          ),
        );
      expect(sinReserva(despues)).toEqual(sinReserva(antes));
      expect(despues).toMatchObject({ estado: 'RESERVADA', reserva_vence_en: null });
    });
  });

  describe('criterio 29: el panel de solicitudes con los estados nuevos', () => {
    const lista = (query = '', cookie = cookies.admin): Promise<RespuestaApi> =>
      ctx.http.get(`/api/solicitudes${query}`, { cookie });
    const elementos = (respuesta: RespuestaApi): SolicitudPanelApi[] => {
      expect(respuesta.status, respuesta.texto).toBe(200);
      return respuesta.body?.['solicitudes'] as SolicitudPanelApi[];
    };

    it('criterio 29: una solicitud con comprobante en revisión es EN_VERIFICACION con su último pago pendiente (con el número escrito y la fecha de operación), el total y sin vencimiento de reserva', async () => {
      const cliente = await sembrarEnVerificacion(e, { numeroOperacion: '00012 345', fechaOperacion: '2026-11-10' });

      const [elemento] = elementos(await lista());

      expect(elemento).toMatchObject({
        id: cliente.solicitudId,
        estado: 'EN_VERIFICACION',
        reservaVenceEn: null,
        monto: '42.00',
        ajuste: null,
        pago: {
          id: cliente.pagoId,
          metodo: 'YAPE',
          estado: 'PENDIENTE_VERIFICACION',
          monto: '42.00',
          registradoEn: T_PAGO.toISOString(),
          verificadoEn: null,
          numeroOperacion: '00012 345',
          fechaOperacion: '2026-11-10',
          motivoRechazo: null,
          numeroTicket: null,
        },
      });
    });

    it('criterio 29: una solicitud rechazada es PAGO_RECHAZADO con su último pago rechazado (el motivo y quién lo resolvió cuándo)', async () => {
      const cliente = await sembrarRechazada(e, { motivo: 'La imagen no se lee' });

      const [elemento] = elementos(await lista());

      expect(elemento).toMatchObject({
        id: cliente.solicitudId,
        estado: 'PAGO_RECHAZADO',
        pago: { id: cliente.pagoId, estado: 'RECHAZADO', motivoRechazo: 'La imagen no se lee', numeroTicket: null },
      });
      expect(elemento?.pago?.verificadoEn).not.toBeNull();
    });

    it('criterio 29: el filtro ACTIVAS muestra PENDIENTE_PAGO, EN_VERIFICACION y PAGO_RECHAZADO, y no las CONFIRMADAS ni las canceladas; CONFIRMADAS solo las confirmadas', async () => {
      exigirRutasDe007b(ctx.app);
      await abrirCajaDeHoy(e);
      const pendiente = await sembrarCobrable(e);
      const enRevision = await sembrarEnVerificacion(e);
      const rechazada = await sembrarRechazada(e);
      const confirmada = await sembrarEnVerificacion(e);
      const aprobacion = await ctx.http.post(
        `/api/pagos/${confirmada.pagoId}/aprobacion`,
        {},
        { cookie: cookies.secretaria },
      );
      expect(aprobacion.status, aprobacion.texto).toBe(200);

      const activas = elementos(await lista('?estado=ACTIVAS')).map((s) => [s.id, s.estado]);
      const confirmadas = elementos(await lista('?estado=CONFIRMADAS')).map((s) => s.id);

      expect(activas.sort()).toEqual(
        [
          [pendiente.solicitudId, 'PENDIENTE_PAGO'],
          [enRevision.solicitudId, 'EN_VERIFICACION'],
          [rechazada.solicitudId, 'PAGO_RECHAZADO'],
        ].sort(),
      );
      expect(confirmadas).toEqual([confirmada.solicitudId]);
    });

    it('criterio 29: el último pago de la matrícula es el de registrado_en más reciente: tras un rechazo y un nuevo comprobante, el panel muestra el nuevo (pendiente)', async () => {
      exigirRutasDe007b(ctx.app);
      const cliente = await sembrarRechazada(e, { registradoEn: T_PAGO });
      const nuevo = await comprobanteDe(ctx, cliente);
      expect(nuevo.status, nuevo.texto).toBe(201);

      const [elemento] = elementos(await lista('?estado=TODAS'));

      expect(elemento).toMatchObject({ estado: 'EN_VERIFICACION', pago: { estado: 'PENDIENTE_VERIFICACION' } });
      expect(elemento?.pago?.id).not.toBe(cliente.pagoId);
    });

    it('criterio 29: a igual instante de registro el último pago es el de mayor id', async () => {
      const cliente = await sembrarRechazada(e, {
        registradoEn: T_PAGO,
        sobrePago: { id: '00000000-0000-4000-8000-000000000001' },
      });
      await insertarPago(
        'propietario',
        e.A.id,
        filaPagoValida(
          e.A.id,
          { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId, usuarioId: e.secretariaA.id },
          { metodo: 'TRANSFERENCIA', estado: 'RECHAZADO' },
          { id: '00000000-0000-4000-8000-000000000002', motivo_rechazo: 'Segundo rechazo' },
        ),
      );

      const [elemento] = elementos(await lista());

      expect(elemento?.pago).toMatchObject({
        id: '00000000-0000-4000-8000-000000000002',
        metodo: 'TRANSFERENCIA',
        motivoRechazo: 'Segundo rechazo',
      });
    });
  });

  describe('criterio 30: cancelar con pagos', () => {
    it('criterio 30: con un comprobante en revisión responde 409 SOLICITUD_CON_PAGO_PENDIENTE y no escribe (primero se aprueba o se rechaza)', async () => {
      const cliente = await sembrarEnVerificacion(e);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('EN_VERIFICACION');
      const antes = await snapshot();

      const respuesta = await cancelar(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
        409,
        'SOLICITUD_CON_PAGO_PENDIENTE',
      ]);
      expect(await snapshot()).toBe(antes);
      expect((await leerMatriculas(e.A.id))[0]?.estado).toBe('RESERVADA');
    });

    it('criterio 30: con PAGO_RECHAZADO cancela como una PENDIENTE_PAGO: 200, la solicitud CANCELADA, la matrícula CANCELADA (ya lo estaba) y el pago rechazado intacto', async () => {
      const cliente = await sembrarRechazada(e);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('PAGO_RECHAZADO');

      const respuesta = await cancelar(cliente, cookies.secretaria);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(solicitudPanelDe(respuesta)).toMatchObject({ id: cliente.solicitudId, estado: 'CANCELADA' });
      expect((await leerSolicitudes(e.A.id))[0]?.estado).toBe('CANCELADA');
      expect((await leerMatriculas(e.A.id))[0]?.estado).toBe('CANCELADA');
      expect((await leerPagos(e.A.id))[0]).toMatchObject({
        estado: 'RECHAZADO',
        motivo_rechazo: 'La imagen no se lee',
      });
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('CANCELADA');
    });

    it('criterio 30: rechazado el comprobante, la solicitud ya se puede cancelar (el orden que pide la regla: primero se rechaza, después se cancela)', async () => {
      exigirRutasDe007b(ctx.app);
      const cliente = await sembrarEnVerificacion(e);
      const bloqueada = await cancelar(cliente);
      expect(bloqueada.status).toBe(409);
      const rechazo = await ctx.http.post(
        `/api/pagos/${cliente.pagoId}/rechazo`,
        { motivo: 'La imagen no se lee' },
        { cookie: cookies.secretaria },
      );
      expect(rechazo.status, rechazo.texto).toBe(200);

      const respuesta = await cancelar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((await leerSolicitudes(e.A.id))[0]?.estado).toBe('CANCELADA');
    });
  });

  describe('criterio 31: la foto con los estados nuevos', () => {
    it('criterio 31: con un comprobante en revisión (EN_VERIFICACION) la foto se acepta (204) y la vista sigue EN_VERIFICACION con fotoCargada: true', async () => {
      const cliente = await sembrarEnVerificacion(e);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('EN_VERIFICACION');

      const respuesta = await subirFoto(cliente);

      expect(respuesta.status, respuesta.texto).toBe(204);
      expect(vistaDeRespuesta(await consultarPorToken(ctx, cliente.token))).toMatchObject({
        estado: 'EN_VERIFICACION',
        fotoCargada: true,
      });
    });

    it('criterio 31: con PAGO_RECHAZADO la foto se acepta (204) y la vista sigue PAGO_RECHAZADO con fotoCargada: true', async () => {
      const cliente = await sembrarRechazada(e);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('PAGO_RECHAZADO');

      const respuesta = await subirFoto(cliente);

      expect(respuesta.status, respuesta.texto).toBe(204);
      expect(vistaDeRespuesta(await consultarPorToken(ctx, cliente.token))).toMatchObject({
        estado: 'PAGO_RECHAZADO',
        fotoCargada: true,
      });
    });

    it('criterio 31: con la solicitud CONFIRMADA por la aprobación responde 409 SOLICITUD_NO_EDITABLE (el alumno ya no está en CLIENTE)', async () => {
      exigirRutasDe007b(ctx.app);
      await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e);
      await ctx.http.post(`/api/pagos/${cliente.pagoId}/aprobacion`, {}, { cookie: cookies.secretaria });

      const respuesta = await subirFoto(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
    });
  });

  describe('criterio 32: el envío de la 005 con los estados nuevos', () => {
    it('criterio 32: con el DNI de un cliente con un comprobante en revisión el envío responde 409 DNI_YA_REGISTRADO (la solicitud es activa) y no escribe', async () => {
      const cliente = await sembrarEnVerificacion(e);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('EN_VERIFICACION');
      const antes = await snapshot();

      const respuesta = await enviar({ alumno: { dni: cliente.dni } });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'DNI_YA_REGISTRADO']);
      expect(await snapshot()).toBe(antes);
    });

    it('criterio 32: con el DNI de un cliente PAGO_RECHAZADO el envío se acepta (201) como el 21 b de 005: la solicitud anterior pasa a VENCIDA y la nueva queda PENDIENTE_PAGO', async () => {
      const cliente = await sembrarRechazada(e);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('PAGO_RECHAZADO');

      const respuesta = await enviar({ alumno: { dni: cliente.dni } });

      expect(respuesta.status, respuesta.texto).toBe(201);
      const solicitudes = await leerSolicitudes(e.A.id);
      expect(solicitudes.map((s) => s.estado).sort()).toEqual(['PENDIENTE_PAGO', 'VENCIDA']);
      expect(solicitudes.find((s) => s.id === cliente.solicitudId)?.estado).toBe('VENCIDA');
      expect(vistaDeRespuesta(await consultarPorToken(ctx, cliente.token))['estado']).toBe('VENCIDA');
    });

    it('criterio 32: con un alumno ALUMNO_ACTIVO (pago aprobado) responde DNI_YA_REGISTRADO como hasta ahora', async () => {
      exigirRutasDe007b(ctx.app);
      await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e);
      await ctx.http.post(`/api/pagos/${cliente.pagoId}/aprobacion`, {}, { cookie: cookies.secretaria });

      const respuesta = await enviar({ alumno: { dni: cliente.dni } });

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'DNI_YA_REGISTRADO']);
    });

    it('criterio 32 y 25 de 005: la matrícula con un comprobante en revisión cuenta en el límite de reservas de la conexión de su solicitud: con 5 reservas desde la misma conexión (una de ellas en revisión), la sexta responde 409 LIMITE_DE_RESERVAS_PENDIENTES', async () => {
      const creadas: { token: string; alumnoId: string; matriculaId: string }[] = [];
      for (let i = 0; i < 5; i++) {
        const respuesta = await enviar();
        expect(respuesta.status, `reserva ${i + 1}: ${respuesta.texto}`).toBe(201);
        const solicitud = (respuesta.body?.['solicitud'] ?? {}) as { token: string; codigo: string };
        const fila = (await leerSolicitudes(e.A.id)).find((s) => s.codigo === solicitud.codigo);
        const matricula = (await leerMatriculas(e.A.id)).find((m) => m.solicitud_id === fila?.id);
        creadas.push({ token: solicitud.token, alumnoId: fila?.alumno_id ?? '', matriculaId: matricula?.id ?? '' });
      }
      const [enRevision] = creadas;
      // La primera pasa a tener su comprobante en revisión (la reserva ya no vence).
      await actualizarFilas(
        'propietario',
        'matriculas',
        e.A.id,
        { id: enRevision?.matriculaId },
        { reserva_vence_en: null },
      );
      await insertarPago(
        'propietario',
        e.A.id,
        filaPagoValida(
          e.A.id,
          { alumnoId: enRevision?.alumnoId ?? '', matriculaId: enRevision?.matriculaId ?? '' },
          { metodo: 'YAPE' },
        ),
      );
      expect(await estadoVisibleDe(ctx, enRevision?.token ?? ''), 'la primera ya está en revisión').toBe(
        'EN_VERIFICACION',
      );
      const antes = await snapshot();

      const sexta = await enviar();

      expect([sexta.status, codigoDeRespuesta(sexta)], sexta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
      expect(await snapshot()).toBe(antes);
    });
  });
});
