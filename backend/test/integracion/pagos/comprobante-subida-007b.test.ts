// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
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
  HOY_007,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  comprobanteDe,
  consultarPorToken,
  datosDeComprobante,
  estadoVisibleDe,
  exigirRutasDe007b,
  instantaneaConArchivos,
  RUTA_COMPROBANTE,
  rutaAprobacion,
  sembrarEnVerificacion,
  sembrarRechazada,
  subirComprobante,
  vistaDeRespuesta,
} from '../../utilidades/escenario-pagos-007b';
import {
  cuerpoInscripcion,
  IP_RE,
  leerAlumnos,
  leerMatriculas,
  llenarClase,
  ocupacionDeClase,
  rutaPublica,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  archivosBajo,
  crearAppConAlmacen,
  exigirAlmacen,
  subirFoto,
} from '../../utilidades/inscripciones-005b';
import { leerPagos } from '../../utilidades/pagos';
import { leerUsuarios } from '../../utilidades/usuarios';

// Criterio 36 (crítico, HU-08, RN-04, RN-28, D-04, D-07): `PUT /api/a/{nombreCorto}/solicitudes/comprobante` con la imagen como cuerpo binario, el token en `X-Token-Solicitud` y los datos del pago en
// `X-Pago-Datos` responde 201 con `{ solicitud }` (la vista `EN_VERIFICACION`) y `Cache-Control: no-store`. En una transacción: el pago `PENDIENTE_VERIFICACION` con el total a cobrar, el número escrito
// (recortado) y el normalizado, la fecha de operación, la clave del comprobante, `registrado_por` nulo e `ip_origen`; la matrícula queda `RESERVADA` con `reserva_vence_en` nula; y se audita
// `PAGO_COMPROBANTE_REGISTRADO` (actor `PUBLICO`, `datosDespues: { matriculaId, metodo, monto, numeroOperacionNormalizado, fechaOperacion }`, sin DNI ni token). La persona sigue en `CLIENTE`.
// Criterio 41 (crítico, D-05, RN-28, RN-11): se sube con estado visible `PENDIENTE_PAGO` (reserva vigente) o `PAGO_RECHAZADO`. Responde 409, sin escribir: `SOLICITUD_NO_EDITABLE` (`VENCIDA` o `CANCELADA`,
// también en el instante del vencimiento y después del fin del mes), `PAGO_EN_VERIFICACION` y `SOLICITUD_YA_PAGADA`. Con `PAGO_RECHAZADO`, la matrícula vuelve de `CANCELADA` a `RESERVADA` con `reserva_vence_en`
// nula solo si todas sus clases tienen cupo; si no, 409 `SIN_CUPO` con `detalles.clasesSinCupo`. Es la única transición de una matrícula desde `CANCELADA`, y solo con un último pago `RECHAZADO`.
// Criterio 42 (crítico, idempotencia de `CLAUDE.md`): una subida con la `claveIdempotencia` de un pago ya creado para la misma solicitud, con los mismos datos, responde 200 con la vista actual, sin otro pago ni
// auditoría, y borra el archivo nuevo; con otra solicitud u otros datos, 409 `CLAVE_YA_USADA`. Dos subidas simultáneas con la misma clave dejan un pago.
// Criterio 44 (crítico, RN-28, DR-12 de 005): una matrícula con un comprobante en revisión ocupa su cupo sin límite de tiempo dentro de su mes, también después de las 24 horas y en el último segundo del mes.

const PATRON_CLAVE_COMPROBANTE =
  /^academias\/([0-9a-f-]{36})\/pagos\/([0-9a-f-]{36})\/comprobante-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;
const CLAVES_DE_LA_VISTA_EN_VERIFICACION = [
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
  'pago',
  'plan',
];

describe('subida del comprobante: el caso correcto, los estados y la idempotencia (criterios 36, 41, 42 y 44)', () => {
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

  const snapshot = () => instantaneaConArchivos(ctx, e);
  /** Los cupos restantes de la clase del lunes que ofrece el formulario público (el aforo menos la ocupación del mes en curso). */
  const cuposDelLunes = async (): Promise<number | undefined> => {
    const lectura = await ctx.http.get(rutaPublica('academia-a', '/inscripcion'));
    const clases = (lectura.body?.['clases'] ?? []) as { id: string; cuposRestantes: number }[];
    return clases.find((c) => c.id === e.lunes.id)?.cuposRestantes;
  };
  const subir = (cliente: { token: string }, datos: Record<string, unknown> = {}, extra = {}) =>
    comprobanteDe(ctx, cliente, datos, extra);

  describe('criterio 36: el caso correcto', () => {
    it('criterio 36: un Yape de S/ 42.00 responde 201 con { solicitud } (la vista EN_VERIFICACION), Cache-Control: no-store y los datos del pago enviado', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await subir(cliente, { numeroOperacion: ' 00012 345 ', fechaOperacion: HOY_007 });

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {})).toEqual(['solicitud']);
      const vista = vistaDeRespuesta(respuesta);
      expect(Object.keys(vista).sort()).toEqual(CLAVES_DE_LA_VISTA_EN_VERIFICACION);
      expect(vista).toMatchObject({
        codigo: cliente.codigo,
        estado: 'EN_VERIFICACION',
        nombres: 'Valeria',
        mes: '2026-11',
        clasesTotales: 5,
        monto: '42.00',
        fotoCargada: false,
        pago: { metodo: 'YAPE', monto: '42.00', fechaOperacion: HOY_007, enviadoEn: AHORA_007.toISOString() },
      });
      expect(Object.keys(vista['pago'] as object).sort()).toEqual(['enviadoEn', 'fechaOperacion', 'metodo', 'monto']);
      const texto = respuesta.texto;
      for (const prohibido of [
        cliente.dni,
        'Mendoza',
        'Salas',
        cliente.token,
        '12345',
        'comprobante',
        'reservaVenceEn',
      ]) {
        expect(texto, `la vista lleva ${prohibido}`).not.toContain(prohibido);
      }
    });

    it('criterio 36: el pago queda PENDIENTE_VERIFICACION con el total, el número escrito (recortado) y el normalizado, la fecha, la clave, sin registrado_por y con la IP', async () => {
      const cliente = await sembrarCobrable(e);
      const clave = randomUUID();

      const respuesta = await subir(cliente, {
        claveIdempotencia: clave,
        numeroOperacion: ' 00012 345 ',
        fechaOperacion: HOY_007,
      });

      expect(respuesta.status, respuesta.texto).toBe(201);
      const pagos = await leerPagos(e.A.id);
      expect(pagos).toHaveLength(1);
      const pago = pagos[0];
      expect(pago).toMatchObject({
        alumno_id: cliente.alumnoId,
        matricula_id: cliente.matriculaId,
        concepto: 'INSCRIPCION',
        metodo: 'YAPE',
        estado: 'PENDIENTE_VERIFICACION',
        monto: '42.00',
        numero_operacion: '00012 345',
        numero_operacion_normalizado: '12345',
        fecha_operacion: HOY_007,
        clave_idempotencia: clave,
        registrado_por: null,
        verificado_por: null,
        verificado_en: null,
        motivo_rechazo: null,
        numero_ticket: null,
      });
      expect(pago?.ip_origen).toMatch(IP_RE);
      expect(pago?.registrado_en.getTime()).toBe(AHORA_007.getTime());
      const clavePago = PATRON_CLAVE_COMPROBANTE.exec(pago?.comprobante_clave ?? '');
      expect(clavePago, `la clave del comprobante: ${String(pago?.comprobante_clave)}`).not.toBeNull();
      expect(clavePago?.[1]).toBe(e.A.id);
      expect(clavePago?.[2], 'la clave lleva el id del pago').toBe(pago?.id);
      expect(archivosBajo(ctx.raiz)).toEqual([pago?.comprobante_clave]);
    });

    it('criterio 36: la matrícula queda RESERVADA sin vencimiento (RN-28); la persona sigue en CLIENTE sin cuenta; no hay movimiento de caja ni caja abierta que hiciera falta', async () => {
      const cliente = await sembrarCobrable(e);
      const usuariosAntes = await leerUsuarios(e.A.id);

      const respuesta = await subir(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      const matricula = (await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId);
      expect(matricula).toMatchObject({ estado: 'RESERVADA', reserva_vence_en: null, clases_totales: 5 });
      expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)).toMatchObject({
        estado: 'CLIENTE',
        usuario_id: null,
      });
      expect(await leerUsuarios(e.A.id)).toEqual(usuariosAntes);
      expect(await leerMovimientos(e.A.id)).toEqual([]);
    });

    it('criterio 36: audita PAGO_COMPROBANTE_REGISTRADO (entidad pago, actor PUBLICO, con la matrícula, el método, el monto, el normalizado y la fecha), sin DNI ni token', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await subir(cliente, { numeroOperacion: ' 0001-2345 ', fechaOperacion: HOY_007 });

      expect(respuesta.status, respuesta.texto).toBe(201);
      const pago = (await leerPagos(e.A.id))[0];
      const filas = await leerAuditoriaDeAcademia(e.A.id, 'PAGO_COMPROBANTE_REGISTRADO');
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ entidad: 'pago', entidad_id: pago?.id, actor_tipo: 'PUBLICO', actor_id: null });
      expect(filas[0]?.datos_despues).toEqual({
        matriculaId: cliente.matriculaId,
        metodo: 'YAPE',
        monto: '42.00',
        numeroOperacionNormalizado: '12345',
        fechaOperacion: HOY_007,
      });
      const texto = JSON.stringify(filas[0]);
      expect(texto).not.toContain(cliente.dni);
      expect(texto).not.toContain(cliente.token);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_REGISTRADO')).toEqual([]);
      expect(await leerAuditoriaDeAcademia(e.B.id)).toEqual([]);
    });

    it('criterio 36: una transferencia también se sube (el método viaja en el pago y en la vista)', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await subir(cliente, { metodo: 'TRANSFERENCIA' });

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(vistaDeRespuesta(respuesta)['pago']).toMatchObject({ metodo: 'TRANSFERENCIA' });
      expect((await leerPagos(e.A.id))[0]).toMatchObject({ metodo: 'TRANSFERENCIA' });
    });

    it('criterio 36: el total que se compara es el de la matrícula con el ajuste del administrador, no el precio del plan', async () => {
      const cliente = await sembrarCobrable(e);
      const ajuste = await ctx.http.post(
        `/api/solicitudes/${cliente.solicitudId}/ajuste-monto`,
        { montoAjustado: '35', motivo: 'Descuento autorizado' },
        { cookie: cookies.admin },
      );
      expect(ajuste.status, ajuste.texto).toBe(200);

      const conElTotalViejo = await subir(cliente, { monto: '42.00' });
      const conElTotalNuevo = await subir(cliente, { monto: '35.00' });

      expect([conElTotalViejo.status, codigoDeRespuesta(conElTotalViejo)], conElTotalViejo.texto).toEqual([
        409,
        'MONTO_DISTINTO',
      ]);
      expect(detallesDeRespuesta(conElTotalViejo)).toEqual({ total: '35.00' });
      expect(conElTotalNuevo.status, conElTotalNuevo.texto).toBe(201);
      expect((await leerPagos(e.A.id))[0]).toMatchObject({ monto: '35.00' });
    });

    it('criterio 36: la dirección con otras mayúsculas y con barra final también es la ruta del comprobante', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await subir(cliente, {}, { ruta: '/api/a/academia-a/Solicitudes/COMPROBANTE/' });

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 36: GET, POST, PATCH y DELETE sobre la dirección del comprobante responden como una ruta inexistente (solo existe PUT)', async () => {
      const cliente = await sembrarCobrable(e);
      const delPut = await subir(await sembrarCobrable(e));
      expect(delPut.status, 'PUT sí existe: ' + delPut.texto).toBe(201);
      const inexistente = rutaPublica('academia-a', '/solicitudes/no-existe-ninguna-ruta');
      const antes = await snapshot();

      for (const metodo of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const opciones = { metodo, token: cliente.token, tipo: null };
        const deLaRuta = await subirFoto(ctx, 'academia-a', {
          ...opciones,
          ruta: rutaPublica('academia-a', RUTA_COMPROBANTE),
        });
        const deUnaInexistente = await subirFoto(ctx, 'academia-a', { ...opciones, ruta: inexistente });

        expect(deLaRuta.status, `${metodo}: ${deLaRuta.texto}`).toBe(deUnaInexistente.status);
        expect(deLaRuta.texto, metodo).toBe(deUnaInexistente.texto);
      }
      expect(await snapshot()).toBe(antes);
    });
  });

  describe('criterio 41: los estados en los que se sube', () => {
    it.each([
      ['la fila VENCIDA (la solicitud anterior de un cliente que volvió)', { estado: 'VENCIDA' }],
      ['una solicitud CANCELADA', { estado: 'CANCELADA' }],
      ['una PENDIENTE_PAGO cuya reserva ya venció (se ve VENCIDA)', { estado: 'PENDIENTE_PAGO_VENCIDA' }],
    ] as const)('criterio 41: %s responde 409 SOLICITUD_NO_EDITABLE y no escribe', async (_nombre, opciones) => {
      const cliente = await sembrarCobrable(e, opciones);
      const antes = await snapshot();

      const respuesta = await subir(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(await snapshot()).toBe(antes);
    });

    it('criterio 41: la reserva que vence en este mismo instante ya es VENCIDA (409); un milisegundo después todavía se sube (201)', async () => {
      const justo = await sembrarCobrable(e, { reservaVenceEn: new Date(AHORA_007.getTime()) });
      const casi = await sembrarCobrable(e, { reservaVenceEn: new Date(AHORA_007.getTime() + 1) });

      const alLimite = await subir(justo);
      const antes = await subir(casi);

      expect([alLimite.status, codigoDeRespuesta(alLimite)]).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(antes.status, antes.texto).toBe(201);
    });

    it('criterio 41: en el último milisegundo del mes de la matrícula (reserva topada al fin de mes) se sube a las 23:59:59.998 y a las 23:59:59.999 ya es 409', async () => {
      const finDelMes = new Date('2026-12-01T04:59:59.999Z');
      const cliente = await sembrarCobrable(e, { reservaVenceEn: finDelMes });
      const otro = await sembrarCobrable(e, { reservaVenceEn: finDelMes });

      ctx.reloj.fijar(new Date('2026-12-01T04:59:59.998Z'));
      const antes = await subir(cliente);
      ctx.reloj.fijar(finDelMes);
      const justo = await subir(otro);

      expect(antes.status, antes.texto).toBe(201);
      expect([justo.status, codigoDeRespuesta(justo)], justo.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
    });

    it('criterio 41: con un comprobante ya en revisión, otro con otra clave responde 409 PAGO_EN_VERIFICACION y no escribe', async () => {
      const cliente = await sembrarEnVerificacion(e);
      expect(
        await estadoVisibleDe(ctx, cliente.token),
        'la solicitud con un pago pendiente se ve EN_VERIFICACION',
      ).toBe('EN_VERIFICACION');
      const antes = await snapshot();

      const respuesta = await subir(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'PAGO_EN_VERIFICACION']);
      expect(await snapshot()).toBe(antes);
    });

    it('criterio 41: una solicitud ya pagada (CONFIRMADA) responde 409 SOLICITUD_YA_PAGADA y no escribe', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      const cobro = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookies.secretaria,
      });
      expect(cobro.status, cobro.texto).toBe(201);
      const antes = await snapshot();

      const respuesta = await subir(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SOLICITUD_YA_PAGADA']);
      expect(await snapshot()).toBe(antes);
    });

    it('criterio 41: con PAGO_RECHAZADO y cupo se sube (201): la matrícula vuelve de CANCELADA a RESERVADA sin vencimiento, el pago rechazado queda y la solicitud se ve EN_VERIFICACION', async () => {
      const cliente = await sembrarRechazada(e);
      expect(await estadoVisibleDe(ctx, cliente.token), 'la solicitud rechazada se ve PAGO_RECHAZADO').toBe(
        'PAGO_RECHAZADO',
      );

      const respuesta = await subir(cliente, { monto: '42.00' });

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(vistaDeRespuesta(respuesta)['estado']).toBe('EN_VERIFICACION');
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)).toMatchObject({
        estado: 'RESERVADA',
        reserva_vence_en: null,
      });
      const pagos = await leerPagos(e.A.id);
      expect(pagos.map((p) => p.estado).sort()).toEqual(['PENDIENTE_VERIFICACION', 'RECHAZADO']);
      expect(pagos.find((p) => p.id === cliente.pagoId)).toMatchObject({ estado: 'RECHAZADO' });
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_COMPROBANTE_REGISTRADO')).toHaveLength(1);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('EN_VERIFICACION');
    });

    it('criterio 41 y 39 (caso límite): el número de operación de un pago RECHAZADO se puede volver a usar en el reintento (D-07)', async () => {
      const cliente = await sembrarRechazada(e, { numeroOperacion: '987654321' });

      const respuesta = await subir(cliente, { numeroOperacion: '987654321' });

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 41: con PAGO_RECHAZADO y una clase llena responde 409 SIN_CUPO con las clases sin cupo, la solicitud sigue PAGO_RECHAZADO y no se escribe nada', async () => {
      const cliente = await sembrarRechazada(e);
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);
      const antes = await snapshot();

      const respuesta = await subir(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDeRespuesta(respuesta)['clasesSinCupo']).toEqual([e.lunes.id]);
      expect(await snapshot()).toBe(antes);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('PAGO_RECHAZADO');
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)?.estado).toBe('CANCELADA');
    });

    it('criterio 41: con tres clases solo se listan las que no tienen cupo, y con una sola llena no se reserva ninguna', async () => {
      const cliente = await sembrarRechazada(e, { claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id] });
      await llenarClase(e.A.id, e.miercoles.id, e.plan.id, 20);

      const respuesta = await subir(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDeRespuesta(respuesta)['clasesSinCupo']).toEqual([e.miercoles.id]);
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)?.estado).toBe('CANCELADA');
    });

    it('criterio 41: con PAGO_RECHAZADO después del fin del mes de la matrícula la solicitud ya es VENCIDA: 409 SOLICITUD_NO_EDITABLE', async () => {
      const cliente = await sembrarRechazada(e);
      ctx.reloj.fijar(new Date('2026-12-01T05:00:00.000Z'));
      const antes = await snapshot();

      const respuesta = await subir(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(await snapshot()).toBe(antes);
    });

    it('criterio 41: el último milisegundo del mes todavía es PAGO_RECHAZADO y se sube; un milisegundo después ya es VENCIDA', async () => {
      const dentro = await sembrarRechazada(e);
      const fuera = await sembrarRechazada(e);

      ctx.reloj.fijar(new Date('2026-12-01T04:59:59.999Z'));
      const alFinal = await subir(dentro, { fechaOperacion: HOY_007 });
      ctx.reloj.fijar(new Date('2026-12-01T05:00:00.000Z'));
      const despues = await subir(fuera, { fechaOperacion: HOY_007 });

      expect(alFinal.status, alFinal.texto).toBe(201);
      expect([despues.status, codigoDeRespuesta(despues)]).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
    });

    it('criterio 41: la única salida de CANCELADA es con un último pago RECHAZADO: una solicitud CANCELADA por la secretaria (aunque tenga un pago rechazado viejo) no se reactiva', async () => {
      const cliente = await sembrarRechazada(e);
      const cancelacion = await ctx.http.post(
        `/api/solicitudes/${cliente.solicitudId}/cancelar`,
        { motivo: 'Pidió que la cancelen por teléfono' },
        { cookie: cookies.admin },
      );
      expect(cancelacion.status, cancelacion.texto).toBe(200);
      const antes = await snapshot();

      const respuesta = await subir(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(await snapshot()).toBe(antes);
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)?.estado).toBe('CANCELADA');
    });
  });

  describe('criterio 42: el reintento con la misma clave', () => {
    it('criterio 42: la misma clave, la misma solicitud y los mismos datos responden 200 con la misma vista, sin otro pago ni auditoría, y el archivo nuevo se borra', async () => {
      const cliente = await sembrarCobrable(e);
      const datos = datosDeComprobante();
      const primero = await subirComprobante(ctx, 'academia-a', { token: cliente.token, datos });
      expect(primero.status, primero.texto).toBe(201);
      const antes = await snapshot();

      const repetido = await subirComprobante(ctx, 'academia-a', { token: cliente.token, datos });

      expect(repetido.status, repetido.texto).toBe(200);
      expect(repetido.cacheControl).toBe('no-store');
      expect(repetido.body).toEqual(primero.body);
      expect(await snapshot(), 'el reintento no escribe, no audita y no deja otro archivo').toBe(antes);
      expect(await leerPagos(e.A.id)).toHaveLength(1);
      expect(archivosBajo(ctx.raiz)).toHaveLength(1);
    });

    it('criterio 42: la clave se mira antes que el estado: con la solicitud ya CONFIRMADA, repetir la misma subida responde 200 con la vista actual (CONFIRMADA), no 409', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      const datos = datosDeComprobante();
      expect((await subirComprobante(ctx, 'academia-a', { token: cliente.token, datos })).status).toBe(201);
      const pago = (await leerPagos(e.A.id))[0];
      const aprobacion = await ctx.http.post(rutaAprobacion(pago?.id ?? ''), {}, { cookie: cookies.secretaria });
      expect(aprobacion.status, aprobacion.texto).toBe(200);
      const antes = await snapshot();

      const repetido = await subirComprobante(ctx, 'academia-a', { token: cliente.token, datos });

      expect(repetido.status, repetido.texto).toBe(200);
      expect(vistaDeRespuesta(repetido)['estado']).toBe('CONFIRMADA');
      expect(await snapshot()).toBe(antes);
    });

    it('criterio 42: la misma clave con otra solicitud responde 409 CLAVE_YA_USADA y no escribe', async () => {
      const uno = await sembrarCobrable(e);
      const otro = await sembrarCobrable(e);
      const datos = datosDeComprobante();
      expect((await subirComprobante(ctx, 'academia-a', { token: uno.token, datos })).status).toBe(201);
      const antes = await snapshot();

      const respuesta = await subirComprobante(ctx, 'academia-a', {
        token: otro.token,
        datos: { ...datos, numeroOperacion: '55555555' },
      });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
      expect(await snapshot()).toBe(antes);
    });

    it.each([
      ['otro número de operación', { numeroOperacion: '55555555' }],
      ['otra fecha de operación', { fechaOperacion: '2026-11-10' }],
      ['otro método', { metodo: 'TRANSFERENCIA' }],
    ])(
      'criterio 42: la misma clave y la misma solicitud con %s responde 409 CLAVE_YA_USADA y no escribe',
      async (_nombre, cambio) => {
        const cliente = await sembrarCobrable(e);
        const datos = datosDeComprobante({ numeroOperacion: '12345678' });
        expect((await subirComprobante(ctx, 'academia-a', { token: cliente.token, datos })).status).toBe(201);
        const antes = await snapshot();

        const respuesta = await subirComprobante(ctx, 'academia-a', {
          token: cliente.token,
          datos: { ...datos, ...cambio },
        });

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
        expect(await snapshot()).toBe(antes);
      },
    );

    it('criterio 42: la clave de un cobro en efectivo de otra solicitud tampoco se puede usar en un comprobante (409 CLAVE_YA_USADA)', async () => {
      await abrirCajaDeHoy(e);
      const cobrada = await sembrarCobrable(e);
      const clave = randomUUID();
      const cobro = await ctx.http.post(
        rutaCobro(cobrada.solicitudId),
        cuerpoCobro('42.00', { claveIdempotencia: clave }),
        { cookie: cookies.secretaria },
      );
      expect(cobro.status, cobro.texto).toBe(201);
      const otra = await sembrarCobrable(e);

      const respuesta = await subir(otra, { claveIdempotencia: clave });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
    });

    it('criterio 42: dos subidas simultáneas con la misma clave dejan un solo pago, un solo archivo guardado y una sola auditoría, sin 500', async () => {
      const cliente = await sembrarCobrable(e);
      const datos = datosDeComprobante();

      const respuestas = await Promise.all([
        subirComprobante(ctx, 'academia-a', { token: cliente.token, datos }),
        subirComprobante(ctx, 'academia-a', { token: cliente.token, datos }),
      ]);

      const estados = respuestas.map((r) => r.status).sort();
      expect(estados, respuestas.map((r) => r.texto).join(' | ')).toEqual([200, 201]);
      const pagos = await leerPagos(e.A.id);
      expect(pagos).toHaveLength(1);
      expect(archivosBajo(ctx.raiz), 'el archivo del que no creó el pago se borra').toEqual([
        pagos[0]?.comprobante_clave,
      ]);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_COMPROBANTE_REGISTRADO')).toHaveLength(1);
    });
  });

  describe('criterio 44: la reserva mientras se revisa no vence', () => {
    it('criterio 44: pasadas las 24 horas, el cupo sigue ocupado: el formulario descuenta el cupo, un envío por el último cupo recibe SIN_CUPO y la solicitud sigue EN_VERIFICACION', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 14);
      const cliente = await sembrarCobrable(e);
      expect((await subir(cliente)).status).toBe(201);
      expect(await cuposDelLunes(), 'con 14 inscritos y un comprobante en revisión quedan 5').toBe(5);

      const pasadas25Horas = new Date(AHORA_007.getTime() + 25 * 60 * 60 * 1000);
      ctx.reloj.fijar(pasadas25Horas);

      expect(await cuposDelLunes(), 'a las 25 horas el comprobante en revisión sigue ocupando su cupo').toBe(5);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, { anio: 2026, mes: 11 }, pasadas25Horas)).toBe(15);
      expect(await estadoVisibleDe(ctx, cliente.token)).toBe('EN_VERIFICACION');
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)?.reserva_vence_en).toBeNull();
    });

    it('criterio 44: con la clase en 19 de 20, el comprobante en revisión ocupa el último cupo también después de 25 horas: el envío de otra persona responde 409 SIN_CUPO', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const cliente = await sembrarCobrable(e);
      expect((await subir(cliente)).status).toBe(201);
      const pasadas25Horas = new Date(AHORA_007.getTime() + 25 * 60 * 60 * 1000);
      ctx.reloj.fijar(pasadas25Horas);

      const envio = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(e, { ahora: pasadas25Horas }),
      );

      expect([envio.status, codigoDeRespuesta(envio)], envio.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, { anio: 2026, mes: 11 }, pasadas25Horas)).toBe(20);
    });

    it('criterio 44: en el último segundo del mes la solicitud sigue EN_VERIFICACION y con el cupo ocupado; en el mes siguiente sigue EN_VERIFICACION hasta que se resuelve', async () => {
      const cliente = await sembrarCobrable(e);
      expect((await subir(cliente)).status).toBe(201);

      for (const instante of ['2026-12-01T04:59:59.999Z', '2026-12-01T05:00:00.000Z', '2026-12-15T15:00:00.000Z']) {
        ctx.reloj.fijar(new Date(instante));
        const respuesta = await consultarPorToken(ctx, cliente.token);
        expect(respuesta.status, `${instante}: ${respuesta.texto}`).toBe(200);
        expect(vistaDeRespuesta(respuesta)['estado'], instante).toBe('EN_VERIFICACION');
      }
      ctx.reloj.fijar(new Date('2026-12-01T04:59:59.999Z'));
      expect(await cuposDelLunes(), 'en el último milisegundo de noviembre el comprobante sigue ocupando su cupo').toBe(
        19,
      );
    });

    it('criterio 44: un comprobante en revisión de otra academia no ocupa cupos de A (la ocupación es por academia)', async () => {
      const deB = await sembrarSolicitud(e.B.id, {
        planId: e.planB.id,
        claseIds: [e.lunesB.id],
        clasesTotales: 5,
        clasesPorMesPlan: 12,
        precioPlan: '100.00',
        monto: '42.00',
      });
      const respuesta = await subirComprobante(ctx, 'academia-b', { token: deB.token, datos: datosDeComprobante() });
      expect(respuesta.status, respuesta.texto).toBe(201);

      expect(await ocupacionDeClase(e.A.id, e.lunes.id, { anio: 2026, mes: 11 }, AHORA_007)).toBe(0);
      expect(await ocupacionDeClase(e.B.id, e.lunesB.id, { anio: 2026, mes: 11 }, AHORA_007)).toBe(1);
    });
  });
});
