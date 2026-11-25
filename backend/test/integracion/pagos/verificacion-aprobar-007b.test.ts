// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AYER, cerrarCajaDePrueba, crearCajaDePrueba, leerMovimientos } from '../../utilidades/caja';
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
  consultarPorToken,
  exigirRutasDe007b,
  rutaAprobacion,
  sembrarEnVerificacion,
  sembrarRechazada,
  vistaDeRespuesta,
} from '../../utilidades/escenario-pagos-007b';
import {
  type AppInscripciones,
  crearAppInscripciones,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  llenarClase,
  ocupacionDeClase,
} from '../../utilidades/inscripciones';
import { leerPagos, T_PAGO } from '../../utilidades/pagos';
import {
  crearUsuarioDePrueba,
  instantaneaDeUsuarios,
  leerUsuarioPorDni,
  leerUsuarios,
} from '../../utilidades/usuarios';

// Criterio 47 (crítico, HU-09, D-04, RN-17, HU-04): `POST /api/pagos/{id}/aprobacion` (cuerpo `{}` estricto) con un pago `PENDIENTE_VERIFICACION` y la caja de hoy abierta responde 200 con `{ pago }`: el pago pasa a `CONFIRMADO` con
// `verificado_por` (el actor), `verificado_en` («ahora», distinto de la `fecha_operacion`, D-04) y su `numero_ticket`; su ingreso entra a la caja abierta con su método real (`YAPE` o `TRANSFERENCIA`), que no suma al efectivo
// esperado; se confirma el pago (criterio 20: la cuenta del alumno, `ALUMNO_ACTIVO`, matrícula `VIGENTE`, solicitud `CONFIRMADA`); y se audita `PAGO_APROBADO` (entidad `pago`, `datosAntes: { estado }`, `datosDespues: { estado,
// numeroTicket }`). Sin caja abierta, 409 `SIN_CAJA_ABIERTA`; con la de otro día, `CAJA_DE_OTRO_DIA`; sin escribir nada.
// Criterio 48 (crítico): aprobar un pago ya `CONFIRMADO` responde 200 con el mismo pago, sin otro movimiento, usuario ni auditoría (aunque la caja ya esté cerrada). Aprobar uno `RECHAZADO` responde 409 `PAGO_YA_RECHAZADO`.
// Orden de los errores de la aprobación: 401 → 404 → 200 si ya está `CONFIRMADO` → `PAGO_YA_RECHAZADO` → `DNI_DEL_PERSONAL` → `SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA`. (Las carreras, en `verificacion-carreras-007b.test.ts`.)
// Criterio 52 (crítico, DR-2, DR-12 de 005, D-04), parte de la aprobación: un pago cuya matrícula es de un mes que ya terminó en Lima se puede aprobar: entra a la caja abierta de hoy, la matrícula pasa a `VIGENTE` en su mes y la persona
// a `ALUMNO_ACTIVO`. Pruebas con `RELOJ` el 1 de diciembre a las 00:00 de Lima con un pago de noviembre.

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

describe('aprobar un comprobante de Yape o transferencia (criterios 47, 48 y 52)', () => {
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
    exigirRutasDe007b(ctx.app);
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const aprobar = (pagoId: string, cookie = cookies.secretaria, cuerpo: unknown = {}) =>
    ctx.http.post(rutaAprobacion(pagoId), cuerpo, { cookie });
  const ingresar = (usuario: string, clave: string) => ctx.http.post('/api/a/academia-a/sesion', { usuario, clave });

  describe('criterio 47: la aprobación correcta', () => {
    it('criterio 47: aprobar un Yape con la caja de hoy abierta responde 200 con { pago } CONFIRMADO, con quién verificó, cuándo y el ticket', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e, { numeroOperacion: '00012 345', fechaOperacion: '2026-11-10' });

      const respuesta = await aprobar(cliente.pagoId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {})).toEqual(['pago']);
      const pago = pagoDe(respuesta);
      expect(Object.keys(pago).sort()).toEqual(CLAVES_DEL_PAGO);
      expect(pago).toEqual({
        id: cliente.pagoId,
        estado: 'CONFIRMADO',
        metodo: 'YAPE',
        concepto: 'INSCRIPCION',
        monto: '42.00',
        registradoEn: T_PAGO.toISOString(),
        verificadoEn: AHORA_007.toISOString(),
        numeroOperacion: '00012 345',
        fechaOperacion: '2026-11-10',
        motivoRechazo: null,
        numeroTicket: 1,
      });
      const fila = (await leerPagos(e.A.id)).find((p) => p.id === cliente.pagoId);
      expect(fila).toMatchObject({
        estado: 'CONFIRMADO',
        verificado_por: e.secretariaA.id,
        registrado_por: null,
        numero_ticket: 1,
        fecha_operacion: '2026-11-10',
        motivo_rechazo: null,
      });
      expect(fila?.verificado_en?.getTime(), 'verificado_en es «ahora», no la fecha de la operación (D-04)').toBe(
        AHORA_007.getTime(),
      );
      expect(fila?.registrado_en.getTime()).toBe(T_PAGO.getTime());
    });

    it('criterio 47: el ingreso entra a la caja de hoy con su método real (YAPE), el mismo monto, el alumno y el pago; no suma al efectivo esperado y suma al esperado de Yape', async () => {
      const caja = await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e);

      const respuesta = await aprobar(cliente.pagoId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const movimientos = await leerMovimientos(e.A.id);
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]).toMatchObject({
        caja_id: caja.id,
        numero: 1,
        tipo: 'INGRESO',
        concepto: 'INSCRIPCION',
        metodo: 'YAPE',
        monto: '42.00',
        alumno_id: cliente.alumnoId,
        pago_id: cliente.pagoId,
        registrado_por: e.secretariaA.id,
      });
      const delDia = await ctx.http.get('/api/cajas/actual', { cookie: cookies.secretaria });
      const resumen = (
        delDia.body?.['caja'] as {
          resumen: {
            ingresos: Record<string, string>;
            esperado: Record<string, string>;
          };
        }
      ).resumen;
      expect(resumen.ingresos).toEqual({ efectivo: '0.00', yape: '42.00', transferencia: '0.00' });
      expect(resumen.esperado, 'el Yape no suma al efectivo esperado (D-04)').toEqual({
        efectivo: '100.00',
        yape: '42.00',
        transferencia: '0.00',
      });
    });

    it('criterio 47: una transferencia entra a la caja como TRANSFERENCIA y tampoco suma al efectivo esperado', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e, { metodo: 'TRANSFERENCIA' });

      const respuesta = await aprobar(cliente.pagoId, cookies.admin);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(pagoDe(respuesta)).toMatchObject({ metodo: 'TRANSFERENCIA', estado: 'CONFIRMADO' });
      expect((await leerMovimientos(e.A.id))[0]).toMatchObject({ metodo: 'TRANSFERENCIA', monto: '42.00' });
      const delDia = await ctx.http.get('/api/cajas/actual', { cookie: cookies.secretaria });
      const resumen = (delDia.body?.['caja'] as { resumen: { esperado: Record<string, string> } }).resumen;
      expect(resumen.esperado).toEqual({ efectivo: '100.00', yape: '0.00', transferencia: '42.00' });
    });

    it('criterio 47: el ingreso entra a la caja por el monto del pago (el total de la matrícula al enviar el comprobante), también cuando no es el del plan', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e, { monto: '35.00' });

      const respuesta = await aprobar(cliente.pagoId);

      expect(pagoDe(respuesta).monto).toBe('35.00');
      expect((await leerMovimientos(e.A.id))[0]).toMatchObject({ monto: '35.00' });
    });

    it('criterio 47 y 20: se crea la cuenta del alumno (usuario y contraseña inicial iguales a su DNI, con el cambio obligatorio), el alumno pasa a ALUMNO_ACTIVO, la matrícula a VIGENTE sin vencimiento y la solicitud a CONFIRMADA', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e);
      expect(await leerUsuarioPorDni(e.A.id, cliente.dni)).toBeUndefined();

      const respuesta = await aprobar(cliente.pagoId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const cuenta = await leerUsuarioPorDni(e.A.id, cliente.dni);
      expect(cuenta).toMatchObject({ rol: 'ALUMNO', nombres: 'Valeria', apellidos: 'Mendoza Salas' });
      expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)).toMatchObject({
        estado: 'ALUMNO_ACTIVO',
        usuario_id: cuenta?.id,
      });
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)).toMatchObject({
        estado: 'VIGENTE',
        reserva_vence_en: null,
      });
      expect((await leerSolicitudes(e.A.id)).find((s) => s.id === cliente.solicitudId)?.estado).toBe('CONFIRMADA');
      const ingreso = await ingresar(cliente.dni, cliente.dni);
      expect(ingreso.status, ingreso.texto).toBe(200);
      expect(ingreso.body?.['usuario']).toMatchObject({ rol: 'ALUMNO', debeCambiarClave: true });
    });

    it('criterio 47: después de aprobar, el enlace del cliente muestra la solicitud CONFIRMADA con el método, el monto y el ticket del pago aprobado', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e, { metodo: 'TRANSFERENCIA' });
      await aprobar(cliente.pagoId);

      const respuesta = await consultarPorToken(ctx, cliente.token);

      expect(vistaDeRespuesta(respuesta)).toMatchObject({
        estado: 'CONFIRMADA',
        pago: { metodo: 'TRANSFERENCIA', monto: '42.00', confirmadoEn: AHORA_007.toISOString(), numeroTicket: 1 },
      });
    });

    it('criterio 47: audita PAGO_APROBADO (entidad pago, el actor, datosAntes { estado } y datosDespues { estado, numeroTicket }), además de CAJA_INGRESO_REGISTRADO y USUARIO_CREADO, y no PAGO_REGISTRADO', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e);

      await aprobar(cliente.pagoId);

      const aprobados = await leerAuditoriaDeAcademia(e.A.id, 'PAGO_APROBADO');
      expect(aprobados).toHaveLength(1);
      expect(aprobados[0]).toMatchObject({
        entidad: 'pago',
        entidad_id: cliente.pagoId,
        actor_tipo: 'USUARIO',
        actor_id: e.secretariaA.id,
      });
      expect(aprobados[0]?.datos_antes).toEqual({ estado: 'PENDIENTE_VERIFICACION' });
      expect(aprobados[0]?.datos_despues).toEqual({ estado: 'CONFIRMADO', numeroTicket: 1 });
      expect(JSON.stringify(aprobados[0]), 'sin el DNI').not.toContain(cliente.dni);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'CAJA_INGRESO_REGISTRADO')).toHaveLength(1);
      const cuenta = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CREADO');
      expect(cuenta).toHaveLength(1);
      expect(cuenta[0]).toMatchObject({ actor_tipo: 'USUARIO', actor_id: e.secretariaA.id });
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_REGISTRADO')).toEqual([]);
    });

    it('criterio 47 y 25: el ticket es el siguiente de la academia, compartido con los cobros en efectivo: un efectivo (1), un Yape (2) y una transferencia (3)', async () => {
      await abrirCajaDeHoy(e);
      const efectivo = await sembrarCobrable(e);
      const cobro = await ctx.http.post(rutaCobro(efectivo.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookies.secretaria,
      });
      expect(pagoDe(cobro).numeroTicket).toBe(1);
      const yape = await sembrarEnVerificacion(e);
      const transferencia = await sembrarEnVerificacion(e, { metodo: 'TRANSFERENCIA' });

      const a = await aprobar(yape.pagoId);
      const b = await aprobar(transferencia.pagoId, cookies.admin);

      expect([pagoDe(a).numeroTicket, pagoDe(b).numeroTicket]).toEqual([2, 3]);
    });

    it('criterio 47: no necesita cupo: con la clase llena (20 de 20, incluido el comprobante en revisión) se aprueba igual y la ocupación sigue en 20', async () => {
      await abrirCajaDeHoy(e);
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const cliente = await sembrarEnVerificacion(e);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, { anio: 2026, mes: 11 }, AHORA_007)).toBe(20);

      const respuesta = await aprobar(cliente.pagoId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, { anio: 2026, mes: 11 }, AHORA_007)).toBe(20);
    });

    it('criterio 47: aprobar uno no toca los demás pagos pendientes', async () => {
      await abrirCajaDeHoy(e);
      const uno = await sembrarEnVerificacion(e);
      const otro = await sembrarEnVerificacion(e);

      expect((await aprobar(uno.pagoId)).status).toBe(200);

      const pagos = await leerPagos(e.A.id);
      expect(pagos.find((p) => p.id === otro.pagoId)).toMatchObject({
        estado: 'PENDIENTE_VERIFICACION',
        numero_ticket: null,
        verificado_por: null,
      });
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === otro.matriculaId)).toMatchObject({
        estado: 'RESERVADA',
        reserva_vence_en: null,
      });
    });

    it.each([
      ['un campo de más', { monto: '1.00' }],
      ['el id de la academia', { academiaId: randomUUID() }],
      ['un motivo', { motivo: 'Aprobado' }],
    ])('criterio 47: el cuerpo es `{}` estricto: %s responde 400 y no aprueba', async (_nombre, cuerpo) => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await aprobar(cliente.pagoId, cookies.secretaria, cuerpo);

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    });
  });

  describe('criterio 47: la caja', () => {
    async function exigirSinCambios(antes: string, pagoId: string) {
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      expect(await leerMovimientos(e.A.id)).toEqual([]);
      expect((await leerPagos(e.A.id)).find((p) => p.id === pagoId)).toMatchObject({
        estado: 'PENDIENTE_VERIFICACION',
        numero_ticket: null,
      });
    }

    it('criterio 47: sin ninguna caja responde 409 SIN_CAJA_ABIERTA y no queda nada (ni pago aprobado, ni cuenta, ni movimiento, ni auditoría)', async () => {
      const cliente = await sembrarEnVerificacion(e);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await aprobar(cliente.pagoId);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SIN_CAJA_ABIERTA']);
      await exigirSinCambios(antes, cliente.pagoId);
      expect(await leerUsuarioPorDni(e.A.id, cliente.dni)).toBeUndefined();
      expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)?.estado).toBe('CLIENTE');
    });

    it('criterio 47: con la caja de hoy cerrada responde 409 SIN_CAJA_ABIERTA y no escribe', async () => {
      const caja = await abrirCajaDeHoy(e);
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
      const cliente = await sembrarEnVerificacion(e);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await aprobar(cliente.pagoId);

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'SIN_CAJA_ABIERTA']);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    });

    it('criterio 47: con la caja abierta de ayer responde 409 CAJA_DE_OTRO_DIA con { cajaId, fecha } y no queda nada', async () => {
      const deAyer = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });
      const cliente = await sembrarEnVerificacion(e);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await aprobar(cliente.pagoId);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CAJA_DE_OTRO_DIA']);
      expect(detallesDeRespuesta(respuesta)).toEqual({ cajaId: deAyer.id, fecha: AYER });
      await exigirSinCambios(antes, cliente.pagoId);
    });

    it('criterio 47: la caja abierta de otra academia no cuenta: A sin caja y B con una abierta responde SIN_CAJA_ABIERTA en A y no escribe en B', async () => {
      await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      const cliente = await sembrarEnVerificacion(e);
      const antesB = await instantaneaDeLaAcademia(e.B.id);

      const respuesta = await aprobar(cliente.pagoId);

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'SIN_CAJA_ABIERTA']);
      expect(await instantaneaDeLaAcademia(e.B.id)).toBe(antesB);
    });

    it('criterio 47: con la caja del 30 de noviembre abierta, aprobar a las 23:59:59.999 del 30 en Lima se acepta y a las 00:00 del 1 de diciembre responde CAJA_DE_OTRO_DIA', async () => {
      await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-30' });
      const aTiempo = await sembrarEnVerificacion(e);
      const tarde = await sembrarEnVerificacion(e);

      const alFinal = new Date('2026-12-01T04:59:59.999Z');
      ctx.reloj.fijar(alFinal);
      const aceptada = await aprobar(aTiempo.pagoId, cookiesDePagos(e, alFinal).secretaria);
      const alComenzar = new Date('2026-12-01T05:00:00.000Z');
      ctx.reloj.fijar(alComenzar);
      const rechazada = await aprobar(tarde.pagoId, cookiesDePagos(e, alComenzar).secretaria);

      expect(aceptada.status, aceptada.texto).toBe(200);
      expect([rechazada.status, codigoDeRespuesta(rechazada)], rechazada.texto).toEqual([409, 'CAJA_DE_OTRO_DIA']);
      expect(detallesDeRespuesta(rechazada)['fecha']).toBe('2026-11-30');
    });
  });

  describe('criterio 48: aprobar dos veces y aprobar un rechazado', () => {
    it('criterio 48: aprobar un pago ya CONFIRMADO responde 200 con el mismo pago, sin otro movimiento, usuario, ticket ni auditoría, también con la caja ya cerrada y por otra persona', async () => {
      const caja = await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e);
      const primera = await aprobar(cliente.pagoId);
      expect(primera.status, primera.texto).toBe(200);
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const repetida = await aprobar(cliente.pagoId);
      const porOtra = await aprobar(cliente.pagoId, cookies.admin);

      expect(repetida.status, repetida.texto).toBe(200);
      expect(pagoDe(repetida)).toEqual(pagoDe(primera));
      expect(porOtra.status, porOtra.texto).toBe(200);
      expect(pagoDe(porOtra)).toEqual(pagoDe(primera));
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_APROBADO')).toHaveLength(1);
      expect((await leerUsuarios(e.A.id)).filter((u) => u.dni === cliente.dni)).toHaveLength(1);
      expect((await leerPagos(e.A.id))[0]?.numero_ticket).toBe(1);
    });

    it('criterio 48: aprobar un pago RECHAZADO responde 409 PAGO_YA_RECHAZADO y no escribe, también sin caja (va antes que la caja)', async () => {
      const rechazada = await sembrarRechazada(e);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const sinCaja = await aprobar(rechazada.pagoId);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      await abrirCajaDeHoy(e);
      const antesConCaja = await instantaneaDeLaAcademia(e.A.id);
      const conCaja = await aprobar(rechazada.pagoId);

      expect([sinCaja.status, codigoDeRespuesta(sinCaja)], sinCaja.texto).toEqual([409, 'PAGO_YA_RECHAZADO']);
      expect([conCaja.status, codigoDeRespuesta(conCaja)], conCaja.texto).toEqual([409, 'PAGO_YA_RECHAZADO']);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antesConCaja);
      expect(await leerMovimientos(e.A.id)).toEqual([]);
      expect((await leerPagos(e.A.id))[0]).toMatchObject({ estado: 'RECHAZADO', numero_ticket: null });
      expect((await leerAlumnos(e.A.id)).find((a) => a.id === rechazada.alumnoId)?.estado).toBe('CLIENTE');
    });

    it('criterio 48: un pago en efectivo ya confirmado también responde 200 con el mismo pago al aprobarlo (es un pago CONFIRMADO), sin otro movimiento', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      const cobro = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookies.secretaria,
      });
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await aprobar(pagoDe(cobro).id);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(pagoDe(respuesta)).toEqual(pagoDe(cobro));
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    });
  });

  describe('el orden de los errores de la aprobación', () => {
    it('criterio 47: con el DNI del cliente en uso por el personal responde 409 DNI_DEL_PERSONAL antes que la caja (sin caja y con ella) y sin escribir', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', dni: cliente.dni });
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const sinCaja = await aprobar(cliente.pagoId);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      await abrirCajaDeHoy(e);
      const antesConCaja = await instantaneaDeLaAcademia(e.A.id);
      const conCaja = await aprobar(cliente.pagoId);

      expect([sinCaja.status, codigoDeRespuesta(sinCaja)], sinCaja.texto).toEqual([409, 'DNI_DEL_PERSONAL']);
      expect([conCaja.status, codigoDeRespuesta(conCaja)], conCaja.texto).toEqual([409, 'DNI_DEL_PERSONAL']);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antesConCaja);
      expect(await instantaneaDeUsuarios(e.A.id)).toBe((JSON.parse(antesConCaja) as { usuarios: string }).usuarios);
      expect((await leerPagos(e.A.id))[0]).toMatchObject({ estado: 'PENDIENTE_VERIFICACION' });
      expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)).toMatchObject({
        estado: 'CLIENTE',
        usuario_id: null,
      });
    });

    it('criterio 47 y 21: una confirmación que falla (sin caja) no deja nada a medias: ni cuenta, ni alumno activo, ni matrícula vigente, ni movimiento, ni ticket consumido; la siguiente aprobación recibe el ticket 1', async () => {
      const fallida = await sembrarEnVerificacion(e);
      const buena = await sembrarEnVerificacion(e);
      const sinCaja = await aprobar(fallida.pagoId);
      expect(sinCaja.status).toBe(409);
      expect(await leerUsuarioPorDni(e.A.id, fallida.dni)).toBeUndefined();
      await abrirCajaDeHoy(e);

      const respuesta = await aprobar(buena.pagoId);

      expect(pagoDe(respuesta).numeroTicket).toBe(1);
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === fallida.matriculaId)?.estado).toBe('RESERVADA');
    });
  });

  describe('criterio 52: un comprobante en revisión cuando termina el mes (DR-2)', () => {
    const PRIMERO_DE_DICIEMBRE = new Date('2026-12-01T05:00:00.000Z');

    it('criterio 52: el 1 de diciembre a las 00:00 de Lima se puede aprobar un pago de noviembre: entra a la caja abierta de hoy, la matrícula pasa a VIGENTE en su mes (noviembre) y la persona a ALUMNO_ACTIVO', async () => {
      const cliente = await sembrarEnVerificacion(e);
      ctx.reloj.fijar(PRIMERO_DE_DICIEMBRE);
      const cajaDeHoy = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-12-01' });

      const respuesta = await aprobar(cliente.pagoId, cookiesDePagos(e, PRIMERO_DE_DICIEMBRE).secretaria);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(pagoDe(respuesta)).toMatchObject({ estado: 'CONFIRMADO', numeroTicket: 1 });
      expect((await leerMovimientos(e.A.id))[0]).toMatchObject({
        caja_id: cajaDeHoy.id,
        metodo: 'YAPE',
        monto: '42.00',
      });
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)).toMatchObject({
        estado: 'VIGENTE',
        anio: 2026,
        mes: 11,
        reserva_vence_en: null,
      });
      expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)?.estado).toBe('ALUMNO_ACTIVO');
      expect((await leerSolicitudes(e.A.id)).find((s) => s.id === cliente.solicitudId)?.estado).toBe('CONFIRMADA');
      expect(await leerUsuarioPorDni(e.A.id, cliente.dni)).toMatchObject({ rol: 'ALUMNO' });
    });

    it('criterio 52: con la caja de noviembre todavía abierta el 1 de diciembre, la aprobación responde CAJA_DE_OTRO_DIA (el dinero entra a la caja del día en que se revisa)', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-30' });
      ctx.reloj.fijar(PRIMERO_DE_DICIEMBRE);

      const respuesta = await aprobar(cliente.pagoId, cookiesDePagos(e, PRIMERO_DE_DICIEMBRE).secretaria);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CAJA_DE_OTRO_DIA']);
    });

    it('criterio 52: la solicitud sigue EN_VERIFICACION (no VENCIDA) hasta que se resuelve, y después de aprobar se ve CONFIRMADA', async () => {
      const cliente = await sembrarEnVerificacion(e);
      ctx.reloj.fijar(PRIMERO_DE_DICIEMBRE);
      await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-12-01' });

      expect(vistaDeRespuesta(await consultarPorToken(ctx, cliente.token))['estado']).toBe('EN_VERIFICACION');
      await aprobar(cliente.pagoId, cookiesDePagos(e, PRIMERO_DE_DICIEMBRE).secretaria);

      expect(vistaDeRespuesta(await consultarPorToken(ctx, cliente.token))['estado']).toBe('CONFIRMADA');
    });
  });
});
