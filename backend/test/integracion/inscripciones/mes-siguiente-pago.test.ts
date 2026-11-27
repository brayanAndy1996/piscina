// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cerrarCajaDePrueba, leerCajas, leerMovimientos } from '../../utilidades/caja';
import { en, enLima } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet, leerQr } from '../../utilidades/escenario-carnet';
import {
  consultarSolicitud,
  cambiarConfiguracion,
  cuerpoParaMes,
  enviarPublico,
  type EscenarioMesSiguiente,
  INSTANTE,
  MES_DIC,
  prepararEscenarioDeMesSiguiente,
} from '../../utilidades/escenario-mes-siguiente';
import {
  codigoDeRespuesta,
  cuerpoAjuste,
  cuerpoCobro,
  instantaneaDeLaAcademia,
  pagoDe,
  rutaAjuste,
  rutaCobro,
  rutaTicket,
} from '../../utilidades/escenario-pagos';
import {
  datosDeComprobante,
  rutaAprobacion,
  subirComprobante,
  vistaDeRespuesta,
} from '../../utilidades/escenario-pagos-007b';
import { abrirCajaPara, DICIEMBRE, NOVIEMBRE } from '../../utilidades/escenario-renovacion';
import { leerAlumnos, leerMatriculas, leerSolicitudes, solicitudDe } from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';
import { leerUsuarioPorDni } from '../../utilidades/usuarios';

// Criterio 9 (crítico, HU-04, HU-07 a HU-09, RN-17, RN-28, D-04): el cobro en efectivo en recepción (007a) y el comprobante público con su verificación (007b) funcionan igual que con una solicitud de M: el efectivo exige la caja abierta de hoy y entra a ella con concepto `INSCRIPCION`; el comprobante deja la matrícula
// `RESERVADA` sin vencimiento (RN-28), sin tocar la caja, y al aprobarlo entra a la caja abierta del día en que se verifica (D-04), antes o después del día 1. El total sale de lo guardado (`totalACobrar`, también con el ajuste del administrador). Al confirmar: la matrícula de M+1 pasa a `VIGENTE`, la solicitud a `CONFIRMADA` y la persona
// pasa de `CLIENTE` a `ALUMNO_ACTIVO` en ese momento, con su usuario, su contraseña inicial igual al DNI con cambio obligatorio y su QR, sin esperar al día 1. No se crea ni se toca ninguna matrícula de M. Un cambio de `diasPrioridadRenovacion` o el paso del día 1 no impiden pagar una solicitud de M+1 ya creada. Pruebas: cobro en
// efectivo el 27/11 (201, ingreso en la caja del 27/11, ticket, matrícula de diciembre `VIGENTE`); sin caja abierta, 409 `SIN_CAJA_ABIERTA` sin escribir; comprobante el 28/11 y aprobación el 2/12 (el ingreso va a la caja del 2/12).

describe('el pago de una solicitud del mes siguiente (criterio 9)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioMesSiguiente;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeMesSiguiente(ctx);
    ctx.correo.mensajes.length = 0;
    cookies = en(ctx, esc, INSTANTE.viernes27);
    await abrirCajaPara(esc, INSTANTE.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;

  /** Una solicitud de diciembre enviada por el formulario público en `instante` (S/ 120.00, las tres clases de la semana). */
  async function solicitarDiciembre(instante = INSTANTE.viernes27) {
    en(ctx, esc, instante);
    const cuerpo = await cuerpoParaMes(esc.e, MES_DIC);
    const respuesta = await enviarPublico(ctx, cuerpo);
    expect(respuesta.status, respuesta.texto).toBe(201);
    const alumno = (await leerAlumnos(A())).find((fila) => fila.dni === (cuerpo['alumno'] as { dni: string }).dni);
    const solicitud = (await leerSolicitudes(A())).find((fila) => fila.alumno_id === alumno?.id);
    const matricula = (await leerMatriculas(A())).find((fila) => fila.solicitud_id === solicitud?.id);
    return {
      token: solicitudDe(respuesta).token,
      dni: (cuerpo['alumno'] as { dni: string }).dni,
      alumnoId: alumno?.id as string,
      solicitudId: solicitud?.id as string,
      matriculaId: matricula?.id as string,
    };
  }
  const subir = (token: string, datos: Record<string, unknown> = {}) =>
    subirComprobante(ctx, 'academia-a', {
      token,
      datos: datosDeComprobante({ monto: '120.00', fechaOperacion: '2026-11-27', ...datos }),
    });
  const aprobar = (pagoId: string, cookie = cookies.secretaria) =>
    ctx.http.post(rutaAprobacion(pagoId), {}, { cookie });
  /** Todo lo que se escribe con la confirmación del pago de una solicitud de diciembre. */
  async function comprobarConfirmada(cliente: {
    dni: string;
    alumnoId: string;
    solicitudId: string;
    matriculaId: string;
  }) {
    const matriculas = (await leerMatriculas(A())).filter((fila) => fila.alumno_id === cliente.alumnoId);
    expect(matriculas, 'una sola matrícula: la de diciembre; ninguna de noviembre').toHaveLength(1);
    expect(matriculas[0]).toMatchObject({
      id: cliente.matriculaId,
      anio: 2026,
      mes: 12,
      estado: 'VIGENTE',
      reserva_vence_en: null,
    });
    expect((await leerSolicitudes(A())).find((s) => s.id === cliente.solicitudId)?.estado).toBe('CONFIRMADA');
    const alumno = (await leerAlumnos(A())).find((fila) => fila.id === cliente.alumnoId);
    expect(alumno?.estado, 'pasa a alumno en el momento de confirmar, sin esperar al día 1').toBe('ALUMNO_ACTIVO');
    const usuario = await leerUsuarioPorDni(A(), cliente.dni);
    expect(usuario).toMatchObject({ rol: 'ALUMNO', estado: 'ACTIVO', debe_cambiar_clave: true });
    expect(alumno?.usuario_id).toBe(usuario?.id);
    expect((await leerQr(A(), cliente.alumnoId)).qr_token, 'carnet con su QR').not.toBeNull();
    const ingreso = await ctx.http.post('/api/a/academia-a/sesion', { usuario: cliente.dni, clave: cliente.dni });
    expect(ingreso.status, ingreso.texto).toBe(200);
    expect(ingreso.body?.['usuario']).toMatchObject({ rol: 'ALUMNO', debeCambiarClave: true });
  }
  const cajaDelMovimiento = async (cajaId: string) => (await leerCajas(A())).find((caja) => caja.id === cajaId);

  describe('efectivo en recepción', () => {
    it('criterio 9: el cobro en efectivo el 27/11 responde 201: ingreso en la caja del 27/11 con concepto INSCRIPCION, ticket y matrícula de diciembre VIGENTE; la persona pasa a ALUMNO_ACTIVO con su usuario, su contraseña inicial igual al DNI y su QR, sin esperar al día 1', async () => {
      const cliente = await solicitarDiciembre();

      const respuesta = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('120.00'), {
        cookie: cookies.secretaria,
      });

      expect(respuesta.status, respuesta.texto).toBe(201);
      const pago = pagoDe(respuesta);
      expect(pago).toMatchObject({
        estado: 'CONFIRMADO',
        metodo: 'EFECTIVO',
        concepto: 'INSCRIPCION',
        monto: '120.00',
      });
      expect(pago.numeroTicket).toEqual(expect.any(Number));
      const movimientos = await leerMovimientos(A());
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]).toMatchObject({
        tipo: 'INGRESO',
        concepto: 'INSCRIPCION',
        metodo: 'EFECTIVO',
        monto: '120.00',
        pago_id: pago.id,
      });
      expect((await cajaDelMovimiento(movimientos[0]?.caja_id as string))?.fecha).toBe('2026-11-27');
      const ticket = await ctx.http.get(rutaTicket(pago.id), { cookie: cookies.secretaria });
      expect(ticket.status).toBe(200);
      await comprobarConfirmada(cliente);
      expect((await leerPagos(A())).map((fila) => fila.estado)).toEqual(['CONFIRMADO']);
    });

    it('criterio 9: sin caja abierta, 409 SIN_CAJA_ABIERTA sin escribir: la solicitud sigue PENDIENTE_PAGO y la persona CLIENTE', async () => {
      const cliente = await solicitarDiciembre();
      for (const caja of (await leerCajas(A())).filter((fila) => fila.estado === 'ABIERTA')) {
        await cerrarCajaDePrueba(A(), caja.id, esc.e.secretariaA.id);
      }
      const antes = await instantaneaDeLaAcademia(A());

      const respuesta = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('120.00'), {
        cookie: cookies.secretaria,
      });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SIN_CAJA_ABIERTA']);
      expect(await instantaneaDeLaAcademia(A())).toBe(antes);
      expect((await leerAlumnos(A())).find((fila) => fila.id === cliente.alumnoId)?.estado).toBe('CLIENTE');
    });

    it('criterio 9: con la caja abierta de otro día (la del 26/11) el efectivo de una solicitud de diciembre responde 409 CAJA_DE_OTRO_DIA y no escribe', async () => {
      const cliente = await solicitarDiciembre();
      await abrirCajaPara(esc, enLima('2026-11-26', '10:00'));
      en(ctx, esc, INSTANTE.viernes27);
      const antes = await instantaneaDeLaAcademia(A());

      const respuesta = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('120.00'), {
        cookie: cookies.secretaria,
      });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CAJA_DE_OTRO_DIA']);
      expect(await instantaneaDeLaAcademia(A())).toBe(antes);
    });

    it('criterio 9: el total sale de lo guardado, también con el ajuste del administrador: ajustada a S/ 100, el cobro con S/ 120.00 responde 409 MONTO_CAMBIO y con S/ 100.00 se cobra', async () => {
      const cliente = await solicitarDiciembre();
      const ajuste = await ctx.http.post(rutaAjuste(cliente.solicitudId), cuerpoAjuste('100'), {
        cookie: cookies.admin,
      });
      expect(ajuste.status, ajuste.texto).toBe(200);

      const viejo = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('120.00'), {
        cookie: cookies.secretaria,
      });
      const nuevo = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('100.00'), {
        cookie: cookies.secretaria,
      });

      expect([viejo.status, codigoDeRespuesta(viejo)], viejo.texto).toEqual([409, 'MONTO_CAMBIO']);
      expect(nuevo.status, nuevo.texto).toBe(201);
      expect(pagoDe(nuevo).monto).toBe('100.00');
      expect((await leerMovimientos(A()))[0]).toMatchObject({ monto: '100.00', concepto: 'INSCRIPCION' });
    });

    it('criterio 9: cobrar una solicitud de diciembre no crea ni toca ninguna matrícula de noviembre, ni cambia la ocupación de noviembre de las clases', async () => {
      const cliente = await solicitarDiciembre();

      await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('120.00'), { cookie: cookies.secretaria });

      const noviembre = (await leerMatriculas(A())).filter(
        (fila) => fila.mes === NOVIEMBRE.mes && fila.anio === NOVIEMBRE.anio,
      );
      expect(noviembre).toEqual([]);
      expect((await leerMatriculas(A())).filter((fila) => fila.mes === DICIEMBRE.mes)).toHaveLength(1);
    });
  });

  describe('comprobante de Yape o transferencia', () => {
    it('criterio 9: el comprobante del 28/11 deja la matrícula RESERVADA sin vencimiento y no toca la caja; aprobado el 2/12, el ingreso va a la caja abierta del 2/12 y la persona pasa a ALUMNO_ACTIVO con su usuario y su QR', async () => {
      const cliente = await solicitarDiciembre(enLima('2026-11-27', '23:00'));
      en(ctx, esc, INSTANTE.sabado28a10);

      const subida = await subir(cliente.token, { fechaOperacion: '2026-11-28' });

      expect(subida.status, subida.texto).toBe(201);
      expect(vistaDeRespuesta(subida)).toMatchObject({ estado: 'EN_VERIFICACION', mes: '2026-12' });
      const matricula = (await leerMatriculas(A())).find((fila) => fila.id === cliente.matriculaId);
      expect(matricula).toMatchObject({ estado: 'RESERVADA', reserva_vence_en: null, anio: 2026, mes: 12 });
      expect(await leerMovimientos(A()), 'el comprobante no toca la caja').toEqual([]);
      const [pago] = await leerPagos(A());
      expect(pago).toMatchObject({ estado: 'PENDIENTE_VERIFICACION', metodo: 'YAPE', monto: '120.00' });
      expect((await leerAlumnos(A())).find((fila) => fila.id === cliente.alumnoId)?.estado).toBe('CLIENTE');

      const el2 = en(ctx, esc, INSTANTE.miercoles2);
      await abrirCajaPara(esc, INSTANTE.miercoles2);
      const aprobacion = await aprobar(pago?.id as string, el2.secretaria);

      expect(aprobacion.status, aprobacion.texto).toBe(200);
      expect(pagoDe(aprobacion)).toMatchObject({ estado: 'CONFIRMADO', monto: '120.00' });
      const movimientos = await leerMovimientos(A());
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]).toMatchObject({
        tipo: 'INGRESO',
        concepto: 'INSCRIPCION',
        metodo: 'YAPE',
        monto: '120.00',
        pago_id: pago?.id,
      });
      expect(
        (await cajaDelMovimiento(movimientos[0]?.caja_id as string))?.fecha,
        'va a la caja del día en que se verifica',
      ).toBe('2026-12-02');
      await comprobarConfirmada(cliente);
      expect(
        (await leerMatriculas(A())).find((fila) => fila.id === cliente.matriculaId),
        'el monto queda fijo: clases y monto de la cotización',
      ).toMatchObject({
        clases_totales: 12,
        monto_calculado: '120.00',
      });
    });

    it('criterio 9: aprobado antes del día 1 (el 29/11) el ingreso va a la caja del 29/11 y la persona ya es ALUMNO_ACTIVO, con la mensualidad de diciembre', async () => {
      const cliente = await solicitarDiciembre(enLima('2026-11-27', '23:00'));
      en(ctx, esc, INSTANTE.sabado28a10);
      const subida = await subir(cliente.token, { fechaOperacion: '2026-11-28' });
      expect(subida.status, subida.texto).toBe(201);
      const [pago] = await leerPagos(A());
      const el29 = en(ctx, esc, enLima('2026-11-29', '10:00'));
      await abrirCajaPara(esc, enLima('2026-11-29', '10:00'));

      const aprobacion = await aprobar(pago?.id as string, el29.secretaria);

      expect(aprobacion.status, aprobacion.texto).toBe(200);
      const [movimiento] = await leerMovimientos(A());
      expect((await cajaDelMovimiento(movimiento?.caja_id as string))?.fecha).toBe('2026-11-29');
      await comprobarConfirmada(cliente);
    });

    it('criterio 9: aprobar sin caja abierta de hoy no escribe nada del pago (la caja es la del día en que se verifica)', async () => {
      const cliente = await solicitarDiciembre(enLima('2026-11-27', '23:00'));
      en(ctx, esc, INSTANTE.sabado28a10);
      await subir(cliente.token, { fechaOperacion: '2026-11-28' });
      const [pago] = await leerPagos(A());
      const el2 = en(ctx, esc, INSTANTE.miercoles2); // la caja abierta sigue siendo la del 27/11
      const antes = await instantaneaDeLaAcademia(A());

      const aprobacion = await aprobar(pago?.id as string, el2.secretaria);

      expect(aprobacion.status, aprobacion.texto).toBe(409);
      expect(['SIN_CAJA_ABIERTA', 'CAJA_DE_OTRO_DIA'], aprobacion.texto).toContain(codigoDeRespuesta(aprobacion));
      expect(await instantaneaDeLaAcademia(A())).toBe(antes);
    });
  });

  describe('la configuración y el día 1 no impiden pagar una solicitud ya creada', () => {
    it('criterio 9: si el administrador baja `diasPrioridadRenovacion` y la ventana se cierra, la solicitud de diciembre ya creada todavía se cobra en efectivo (201)', async () => {
      const cliente = await solicitarDiciembre();
      const patch = await cambiarConfiguracion(ctx, cookies.admin, { diasPrioridadRenovacion: 3 });
      expect(patch.status, patch.texto).toBe(200);

      const respuesta = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('120.00'), {
        cookie: cookies.secretaria,
      });

      expect(respuesta.status, respuesta.texto).toBe(201);
      await comprobarConfirmada(cliente);
    });

    it('criterio 9: una solicitud de diciembre creada el 30/11 a las 22:00 se cobra el 1/12 a las 10:00 (la reserva cruza el día 1): 201 por S/ 120.00, el monto fijo, con el ingreso en la caja del 1/12', async () => {
      const cliente = await solicitarDiciembre(INSTANTE.lunes30a22);
      const el1 = en(ctx, esc, enLima('2026-12-01', '10:00'));
      await abrirCajaPara(esc, enLima('2026-12-01', '10:00'));

      const respuesta = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('120.00'), {
        cookie: el1.secretaria,
      });

      expect(respuesta.status, respuesta.texto).toBe(201);
      const [movimiento] = await leerMovimientos(A());
      expect((await cajaDelMovimiento(movimiento?.caja_id as string))?.fecha).toBe('2026-12-01');
      await comprobarConfirmada(cliente);
    });

    it('criterio 9: un Yape subido el 1/12 y aprobado el 5/12, cuando ya pasó la clase del miércoles 2, sigue por S/ 120.00 con 12 clases (el monto queda fijo al enviar)', async () => {
      const cliente = await solicitarDiciembre(INSTANTE.lunes30a22);
      en(ctx, esc, enLima('2026-12-01', '10:00'));
      const subida = await subir(cliente.token, { fechaOperacion: '2026-12-01' });
      expect(subida.status, subida.texto).toBe(201);
      const [pago] = await leerPagos(A());
      const el5 = en(ctx, esc, enLima('2026-12-05', '09:00'));
      await abrirCajaPara(esc, enLima('2026-12-05', '09:00'));

      const aprobacion = await aprobar(pago?.id as string, el5.secretaria);

      expect(aprobacion.status, aprobacion.texto).toBe(200);
      expect(pagoDe(aprobacion).monto).toBe('120.00');
      expect((await leerMatriculas(A())).find((fila) => fila.id === cliente.matriculaId)).toMatchObject({
        estado: 'VIGENTE',
        clases_totales: 12,
        clases_usadas: 0,
        monto_calculado: '120.00',
      });
      const vista = await consultarSolicitud(ctx, cliente.token);
      expect(vistaDeRespuesta(vista)).toMatchObject({ estado: 'CONFIRMADA', mes: '2026-12' });
    });
  });
});
