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
  cuerpoCobro,
  detallesDeRespuesta,
  type EscenarioPagos,
  exigirRutasDePagos,
  instantaneaDeLaAcademia,
  pagoDe,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  comprobanteDe,
  consultarPorToken,
  estadoVisibleDe,
  exigirRutasDe007b,
  instantaneaConArchivos,
  rutaAprobacion,
  rutaRechazo,
  sembrarEnVerificacion,
  sembrarRechazada,
  vistaDeRespuesta,
} from '../../utilidades/escenario-pagos-007b';
import {
  cuerpoInscripcion,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  llenarClase,
  ocupacionDeClase,
  rutaPublica,
} from '../../utilidades/inscripciones';
import { type AppConAlmacen, crearAppConAlmacen, exigirAlmacen } from '../../utilidades/inscripciones-005b';
import { leerPagos, T_PAGO } from '../../utilidades/pagos';
import { leerUsuarioPorDni, leerUsuarios } from '../../utilidades/usuarios';

// Criterio 49 (crítico, HU-09, RN-28, D-05): `POST /api/pagos/{id}/rechazo` con `{ motivo }` (`textoVisibleSchema`, de 3 a 200) sobre un pago `PENDIENTE_VERIFICACION` responde 200 con `{ pago }`: el pago pasa a `RECHAZADO` con
// `verificado_por`, `verificado_en` y el motivo; la matrícula pasa a `CANCELADA` con `reserva_vence_en` nula y el cupo se libera; la solicitud sigue `PENDIENTE_PAGO` en la fila y se ve `PAGO_RECHAZADO`; la persona sigue en
// `CLIENTE`; se audita `PAGO_RECHAZADO` con `motivo`. No exige caja. Rechazar uno `CONFIRMADO` responde 409 `PAGO_YA_CONFIRMADO`; rechazar uno ya `RECHAZADO` responde 200 con el pago como está, sin escribir ni auditar.
// Criterio 50 (crítico, RN-28, RN-11): con una clase llena que incluye una matrícula con comprobante en revisión, después del rechazo un envío de la 005 por esa clase responde 201; y un reintento del cliente rechazado
// (criterio 41) responde 409 `SIN_CUPO`. (La carrera, en `verificacion-carreras-007b.test.ts`.)
// Criterio 52 (crítico, DR-2, DR-12 de 005, D-04), parte del rechazo: un comprobante en revisión de un mes que ya terminó en Lima también se puede rechazar; en ese caso la solicitud se ve `VENCIDA` (no se puede reintentar en un mes
// cerrado). Pruebas con `RELOJ` el 1 de diciembre a las 00:00 de Lima con un pago de noviembre.

const CLAVES_DEL_PAGO = [
  'concepto',
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

describe('rechazar un comprobante de Yape o transferencia (criterios 49, 50 y 52)', () => {
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
    exigirRutasDe007b(ctx.app);
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const MOTIVO = 'La imagen no se lee, sube otra foto del comprobante';
  const rechazar = (pagoId: string, motivo: unknown = MOTIVO, cookie = cookies.secretaria) =>
    ctx.http.post(rutaRechazo(pagoId), { motivo }, { cookie });
  const snapshot = () => instantaneaConArchivos(ctx, e);

  describe('criterio 49: el rechazo', () => {
    it('criterio 49: rechazar un Yape pendiente responde 200 con { pago } RECHAZADO, con el motivo, quién verificó y cuándo, sin ticket; no exige caja', async () => {
      const cliente = await sembrarEnVerificacion(e, { numeroOperacion: '00012 345', fechaOperacion: '2026-11-10' });
      expect(await leerMovimientos(e.A.id), 'la prueba no tiene caja').toEqual([]);

      const respuesta = await rechazar(cliente.pagoId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {})).toEqual(['pago']);
      const pago = pagoDe(respuesta);
      expect(Object.keys(pago).sort()).toEqual(CLAVES_DEL_PAGO);
      expect(pago).toEqual({
        id: cliente.pagoId,
        estado: 'RECHAZADO',
        metodo: 'YAPE',
        concepto: 'INSCRIPCION',
        monto: '42.00',
        registradoEn: T_PAGO.toISOString(),
        verificadoEn: AHORA_007.toISOString(),
        numeroOperacion: '00012 345',
        fechaOperacion: '2026-11-10',
        motivoRechazo: MOTIVO,
        numeroTicket: null,
      });
      const fila = (await leerPagos(e.A.id)).find((p) => p.id === cliente.pagoId);
      expect(fila).toMatchObject({
        estado: 'RECHAZADO',
        verificado_por: e.secretariaA.id,
        motivo_rechazo: MOTIVO,
        numero_ticket: null,
      });
      expect(fila?.verificado_en?.getTime()).toBe(AHORA_007.getTime());
    });

    it('criterio 49: la matrícula pasa a CANCELADA sin vencimiento, la solicitud sigue PENDIENTE_PAGO en la fila, la persona sigue en CLIENTE sin cuenta y no hay movimiento de caja', async () => {
      const cliente = await sembrarEnVerificacion(e);

      const respuesta = await rechazar(cliente.pagoId, MOTIVO, cookies.admin);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)).toMatchObject({
        estado: 'CANCELADA',
        reserva_vence_en: null,
        clases_totales: 5,
        monto_calculado: '42.00',
      });
      expect((await leerSolicitudes(e.A.id)).find((s) => s.id === cliente.solicitudId)?.estado).toBe('PENDIENTE_PAGO');
      expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)).toMatchObject({
        estado: 'CLIENTE',
        usuario_id: null,
      });
      expect(await leerUsuarioPorDni(e.A.id, cliente.dni)).toBeUndefined();
      expect(await leerMovimientos(e.A.id)).toEqual([]);
    });

    it('criterio 49: la solicitud se ve PAGO_RECHAZADO en el enlace del cliente, con el motivo, cuándo se rechazó y hasta cuándo puede pagar (el fin del mes en Lima), sin el número de operación', async () => {
      const cliente = await sembrarEnVerificacion(e, { numeroOperacion: '9087654321' });
      await rechazar(cliente.pagoId);

      const respuesta = await consultarPorToken(ctx, cliente.token);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const vista = vistaDeRespuesta(respuesta);
      expect(Object.keys(vista).sort()).toEqual([
        'clases',
        'clasesTotales',
        'codigo',
        'creadaEn',
        'esProporcional',
        'estado',
        'fotoCargada',
        'mes',
        'monto',
        'nombres',
        'pagableHasta',
        'plan',
        'rechazo',
      ]);
      expect(vista).toMatchObject({
        estado: 'PAGO_RECHAZADO',
        nombres: 'Valeria',
        monto: '42.00',
        rechazo: { motivo: MOTIVO, rechazadoEn: AHORA_007.toISOString() },
        pagableHasta: '2026-12-01T04:59:59.999Z',
      });
      expect(Object.keys(vista['rechazo'] as object).sort()).toEqual(['motivo', 'rechazadoEn']);
      for (const prohibido of [cliente.dni, 'Mendoza', '9087654321', cliente.token, 'comprobante', 'verificadoPor']) {
        expect(respuesta.texto, `la vista lleva ${prohibido}`).not.toContain(prohibido);
      }
    });

    it('criterio 49: audita PAGO_RECHAZADO (entidad pago, el actor y el motivo), sin DNI, y no audita nada de caja ni de cuentas', async () => {
      const cliente = await sembrarEnVerificacion(e);

      await rechazar(cliente.pagoId);

      const filas = await leerAuditoriaDeAcademia(e.A.id, 'PAGO_RECHAZADO');
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        entidad: 'pago',
        entidad_id: cliente.pagoId,
        actor_tipo: 'USUARIO',
        actor_id: e.secretariaA.id,
        motivo: MOTIVO,
      });
      expect(JSON.stringify(filas[0])).not.toContain(cliente.dni);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_APROBADO')).toEqual([]);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'CAJA_INGRESO_REGISTRADO')).toEqual([]);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CREADO')).toEqual([]);
    });

    it('criterio 49: el motivo se guarda recortado (textoVisibleSchema)', async () => {
      const cliente = await sembrarEnVerificacion(e);

      const respuesta = await rechazar(cliente.pagoId, '   Foto borrosa, sube otra   ');

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(pagoDe(respuesta).motivoRechazo).toBe('Foto borrosa, sube otra');
      expect((await leerPagos(e.A.id))[0]?.motivo_rechazo).toBe('Foto borrosa, sube otra');
    });

    it('criterio 49: rechazar una transferencia es igual; rechazar uno no toca los demás pagos pendientes', async () => {
      const transferencia = await sembrarEnVerificacion(e, { metodo: 'TRANSFERENCIA' });
      const otro = await sembrarEnVerificacion(e);

      const respuesta = await rechazar(transferencia.pagoId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(pagoDe(respuesta)).toMatchObject({ metodo: 'TRANSFERENCIA', estado: 'RECHAZADO' });
      expect((await leerPagos(e.A.id)).find((p) => p.id === otro.pagoId)?.estado).toBe('PENDIENTE_VERIFICACION');
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === otro.matriculaId)).toMatchObject({
        estado: 'RESERVADA',
        reserva_vence_en: null,
      });
    });

    it('criterio 49: rechazar uno CONFIRMADO (aprobado o cobrado en efectivo) responde 409 PAGO_YA_CONFIRMADO y no escribe ni audita', async () => {
      await abrirCajaDeHoy(e);
      const aprobado = await sembrarEnVerificacion(e);
      const aprobacion = await ctx.http.post(rutaAprobacion(aprobado.pagoId), {}, { cookie: cookies.secretaria });
      expect(aprobacion.status, aprobacion.texto).toBe(200);
      const efectivo = await sembrarCobrable(e);
      const cobro = await ctx.http.post(rutaCobro(efectivo.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookies.secretaria,
      });
      const antes = await snapshot();

      const alAprobado = await rechazar(aprobado.pagoId);
      const alEfectivo = await rechazar(pagoDe(cobro).id);

      for (const respuesta of [alAprobado, alEfectivo]) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'PAGO_YA_CONFIRMADO']);
      }
      expect(await snapshot()).toBe(antes);
      expect((await leerMatriculas(e.A.id)).filter((m) => m.estado === 'VIGENTE')).toHaveLength(2);
    });

    it('criterio 49: rechazar uno ya RECHAZADO responde 200 con el pago como está (con su motivo original), sin escribir, auditar ni cambiar la fecha', async () => {
      const cliente = await sembrarEnVerificacion(e);
      const primera = await rechazar(cliente.pagoId);
      expect(primera.status, primera.texto).toBe(200);
      ctx.reloj.fijar(new Date(AHORA_007.getTime() + 60 * 60 * 1000));
      const antes = await snapshot();

      const repetida = await rechazar(
        cliente.pagoId,
        'Otro motivo distinto',
        cookiesDePagos(e, ctx.reloj.ahora()).admin,
      );

      expect(repetida.status, repetida.texto).toBe(200);
      expect(pagoDe(repetida)).toEqual(pagoDe(primera));
      expect(await snapshot()).toBe(antes);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_RECHAZADO')).toHaveLength(1);
    });

    it('criterio 49: un pago ya RECHAZADO sembrado (de antes) también responde 200 como está', async () => {
      const rechazada = await sembrarRechazada(e, { motivo: 'La imagen no se lee' });
      const antes = await snapshot();

      const respuesta = await rechazar(rechazada.pagoId, 'Un motivo nuevo');

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(pagoDe(respuesta)).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'La imagen no se lee' });
      expect(await snapshot()).toBe(antes);
    });

    it.each([
      ['sin motivo', {}],
      ['un motivo de 2 caracteres', { motivo: 'ab' }],
      ['un motivo vacío', { motivo: '' }],
      ['un motivo solo de espacios', { motivo: '        ' }],
      ['un motivo de 201 caracteres', { motivo: 'a'.repeat(201) }],
      ['un motivo con un salto de línea', { motivo: 'Foto\nborrosa' }],
      ['un motivo con un carácter de control', { motivo: 'Foto borrosa\u0007' }],
      ['un motivo que no es un texto', { motivo: 123 }],
      ['un campo de más', { motivo: 'Foto borrosa', academiaId: 'cualquiera' }],
      ['un campo de más (estado)', { motivo: 'Foto borrosa', estado: 'CONFIRMADO' }],
    ])('criterio 49: %s responde 400 SOLICITUD_INVALIDA y no rechaza nada', async (_nombre, cuerpo) => {
      const cliente = await sembrarEnVerificacion(e);
      const antes = await snapshot();

      const respuesta = await ctx.http.post(rutaRechazo(cliente.pagoId), cuerpo, { cookie: cookies.secretaria });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
      expect(await snapshot()).toBe(antes);
    });

    it.each([
      ['de 3 caracteres', 'Mal'],
      ['de 200 caracteres', 'a'.repeat(200)],
    ])('criterio 49: un motivo %s se acepta', async (_nombre, motivo) => {
      const cliente = await sembrarEnVerificacion(e);

      const respuesta = await rechazar(cliente.pagoId, motivo);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(pagoDe(respuesta).motivoRechazo).toBe(motivo);
    });
  });

  describe('criterio 50: el cupo liberado se puede tomar', () => {
    const mes = { anio: 2026, mes: 11 };

    it('criterio 50: con la clase llena (19 más el comprobante en revisión), el rechazo libera el cupo: la ocupación baja a 19, un envío de otra persona por esa clase responde 201 y el reintento del cliente rechazado responde 409 SIN_CUPO', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const cliente = await sembrarEnVerificacion(e);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007), 'antes del rechazo la clase está llena').toBe(
        20,
      );
      const sinCupo = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));
      expect([sinCupo.status, codigoDeRespuesta(sinCupo)], 'con el comprobante en revisión no hay cupo').toEqual([
        409,
        'SIN_CUPO',
      ]);

      const rechazo = await rechazar(cliente.pagoId);
      expect(rechazo.status, rechazo.texto).toBe(200);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007), 'el rechazo libera el cupo').toBe(19);
      const envio = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));
      const reintento = await comprobanteDe(ctx, cliente);

      expect(envio.status, envio.texto).toBe(201);
      expect([reintento.status, codigoDeRespuesta(reintento)], reintento.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDeRespuesta(reintento)['clasesSinCupo']).toEqual([e.lunes.id]);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007), 'nunca más que el aforo').toBe(20);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('PAGO_RECHAZADO');
    });

    it('criterio 50: si nadie toma el cupo liberado, el reintento del cliente rechazado se acepta (201) y vuelve a ocupar su cupo', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const cliente = await sembrarEnVerificacion(e);
      await rechazar(cliente.pagoId);

      const reintento = await comprobanteDe(ctx, cliente);

      expect(reintento.status, reintento.texto).toBe(201);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBe(20);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('EN_VERIFICACION');
    });

    it('criterio 50: rechazar dos veces el mismo pago no libera dos cupos: la ocupación baja en uno', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 5);
      const cliente = await sembrarEnVerificacion(e);
      const antes = await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007);

      await rechazar(cliente.pagoId);
      await rechazar(cliente.pagoId);

      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBe(antes - 1);
    });
  });

  describe('criterio 52: un comprobante en revisión cuando termina el mes (DR-2)', () => {
    const PRIMERO_DE_DICIEMBRE = new Date('2026-12-01T05:00:00.000Z');

    it('criterio 52: el 1 de diciembre a las 00:00 de Lima se puede rechazar un pago de noviembre y la solicitud se ve VENCIDA (vista reducida, sin nombre ni motivo): no se puede reintentar en un mes cerrado', async () => {
      const cliente = await sembrarEnVerificacion(e);
      ctx.reloj.fijar(PRIMERO_DE_DICIEMBRE);

      const respuesta = await rechazar(cliente.pagoId, MOTIVO, cookiesDePagos(e, PRIMERO_DE_DICIEMBRE).secretaria);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(pagoDe(respuesta)).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: MOTIVO });
      const consulta = await consultarPorToken(ctx, cliente.token);
      const vista = vistaDeRespuesta(consulta);
      expect(vista['estado']).toBe('VENCIDA');
      expect(Object.keys(vista).sort()).toEqual([
        'clases',
        'clasesTotales',
        'codigo',
        'creadaEn',
        'esProporcional',
        'estado',
        'mes',
        'monto',
        'plan',
      ]);
      const antes = await snapshot();
      const reintento = await comprobanteDe(ctx, cliente);
      expect([reintento.status, codigoDeRespuesta(reintento)], reintento.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(await snapshot()).toBe(antes);
    });

    it('criterio 52 (caso límite): rechazado el 30 de noviembre a las 23:59:59.998 se ve PAGO_RECHAZADO y el 1 de diciembre a las 00:00:00.000 ya se ve VENCIDA (409 SOLICITUD_NO_EDITABLE al reintentar)', async () => {
      const cliente = await sembrarEnVerificacion(e);
      const antesDelCierre = new Date('2026-12-01T04:59:59.998Z');
      ctx.reloj.fijar(antesDelCierre);
      const respuesta = await rechazar(cliente.pagoId, MOTIVO, cookiesDePagos(e, antesDelCierre).secretaria);
      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(vistaDeRespuesta(await consultarPorToken(ctx, cliente.token))).toMatchObject({
        estado: 'PAGO_RECHAZADO',
        pagableHasta: '2026-12-01T04:59:59.999Z',
      });

      ctx.reloj.fijar(PRIMERO_DE_DICIEMBRE);

      expect(vistaDeRespuesta(await consultarPorToken(ctx, cliente.token))['estado']).toBe('VENCIDA');
      const reintento = await comprobanteDe(ctx, cliente);
      expect([reintento.status, codigoDeRespuesta(reintento)]).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
    });

    it('criterio 52: un pago de noviembre rechazado el 1 de diciembre no deja caja, cuenta ni matrícula vigente', async () => {
      const cliente = await sembrarEnVerificacion(e);
      ctx.reloj.fijar(PRIMERO_DE_DICIEMBRE);

      await rechazar(cliente.pagoId, MOTIVO, cookiesDePagos(e, PRIMERO_DE_DICIEMBRE).admin);

      expect(await leerMovimientos(e.A.id)).toEqual([]);
      expect(await leerUsuarioPorDni(e.A.id, cliente.dni)).toBeUndefined();
      expect((await leerUsuarios(e.A.id)).every((u) => u.dni !== cliente.dni)).toBe(true);
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)?.estado).toBe('CANCELADA');
      expect(await instantaneaDeLaAcademia(e.B.id)).toBeTruthy();
    });
  });
});
