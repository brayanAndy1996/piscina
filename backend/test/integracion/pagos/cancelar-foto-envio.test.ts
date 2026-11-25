// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  rutaCancelar,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  conRetencion,
  cuerpoInscripcion,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  rutaPublica,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  subirFotoValida,
} from '../../utilidades/inscripciones-005b';
import { filaPagoValida, insertarPago } from '../../utilidades/pagos';
import type { Retenedor } from '../../utilidades/planes-clases';

// Criterio 30 (crítico, RN-28; criterio 39 de 005): `POST /api/solicitudes/{id}/cancelar` (005b) con una solicitud `CONFIRMADA` responde 409 `SOLICITUD_NO_CANCELABLE` sin escribir (con `EN_VERIFICACION` y `PAGO_RECHAZADO`, que
// llegan con la 007b, responde 409 `SOLICITUD_CON_PAGO_PENDIENTE` y cancela como una `PENDIENTE_PAGO`). Bloquea además los pagos de la matrícula, después de la matrícula y antes de las clases.
// Criterio 31 (crítico, criterio 34 de 005; DR-21 de 005): la subida de la foto (005b) responde 409 `SOLICITUD_NO_EDITABLE` con una solicitud `CONFIRMADA` (el alumno ya no está en `CLIENTE`; la foto de un alumno es de la 008).
// Criterio 32 (crítico, RN-28, RN-03, DR-14 de 005): el envío de la 005 con el DNI de un alumno `ALUMNO_ACTIVO` responde `DNI_YA_REGISTRADO` como hasta ahora (con las partes de `EN_VERIFICACION` y `PAGO_RECHAZADO` en la 007b).

describe('la cancelación, la foto y el envío con una solicitud confirmada (criterios 30 a 32)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen();
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
    await abrirCajaDeHoy(e);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const cobrar = (c: SolicitudSembrada) =>
    ctx.http.post(rutaCobro(c.solicitudId), cuerpoCobro('42.00'), { cookie: cookies.secretaria });
  const cancelar = (c: SolicitudSembrada, cookie = cookies.admin) =>
    ctx.http.post(rutaCancelar(c.solicitudId), { motivo: 'Pidió que la cancelen por teléfono' }, { cookie });

  describe('criterio 30: cancelar con pagos', () => {
    it('criterio 30: una solicitud CONFIRMADA no se cancela: 409 SOLICITUD_NO_CANCELABLE, sin escribir ni auditar (el dinero ya entró a la caja)', async () => {
      const cliente = await sembrarCobrable(e);
      expect((await cobrar(cliente)).status).toBe(201);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await cancelar(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
        409,
        'SOLICITUD_NO_CANCELABLE',
      ]);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      expect((await leerMatriculas(e.A.id))[0]?.estado).toBe('VIGENTE');
    });

    it('criterio 30: una solicitud sin pagos se sigue cancelando como en la 005b (200 y la matrícula CANCELADA)', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await cancelar(cliente, cookies.secretaria);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((await leerMatriculas(e.A.id))[0]?.estado).toBe('CANCELADA');
    });

    it('criterio 30: la cancelación bloquea los pagos de la matrícula: con la fila de un pago de esa matrícula retenida por la prueba, espera; al soltarla, cancela', async () => {
      const cliente = await sembrarCobrable(e);
      const anterior = filaPagoValida(
        e.A.id,
        { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId, usuarioId: e.secretariaA.id },
        { estado: 'RECHAZADO' },
      );
      await insertarPago('propietario', e.A.id, anterior);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: async (retenedor: Retenedor) => {
          await retenedor.consultar(
            'SELECT id FROM pagos WHERE academia_id = $1::uuid AND matricula_id = $2::uuid FOR UPDATE',
            [e.A.id, cliente.matriculaId],
          );
        },
        enviar: [() => cancelar(cliente)],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron, 'la cancelación debía quedar esperando los pagos de la matrícula: no los bloquea').toBe(
        true,
      );
      expect(resultados[0]?.status, resultados[0]?.texto).toBe(200);
      expect((await leerMatriculas(e.A.id))[0]?.estado).toBe('CANCELADA');
    });

    it('criterio 30: un cobro y una cancelación de la misma solicitud, a la vez: gana uno (201 y 409 SOLICITUD_NO_CANCELABLE, o 200 y 409 SOLICITUD_NO_COBRABLE), sin 500', async () => {
      const cliente = await sembrarCobrable(e);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: async (retenedor: Retenedor) => {
          await retenedor.consultar(
            'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [e.A.id, cliente.matriculaId],
          );
        },
        enviar: [() => cobrar(cliente), () => cancelar(cliente)],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      const [cobro, cancelacion] = resultados;
      expect([cobro?.status, codigoDeRespuesta(cobro!), cancelacion?.status, codigoDeRespuesta(cancelacion!)]).toEqual([
        201,
        undefined,
        409,
        'SOLICITUD_NO_CANCELABLE',
      ]);
    });
  });

  describe('criterio 31: la foto de una solicitud confirmada', () => {
    it('criterio 31: la foto de una solicitud CONFIRMADA responde 409 SOLICITUD_NO_EDITABLE y no se guarda (la foto de un alumno es de la 008)', async () => {
      const cliente = await sembrarCobrable(e);
      expect((await cobrar(cliente)).status).toBe(201);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await subirFotoValida(ctx, 'academia-a', cliente.token);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      expect((await leerAlumnos(e.A.id))[0]?.foto_clave).toBeNull();
    });

    it('criterio 31: antes del pago la foto se acepta como siempre (204), y el cobro no la borra', async () => {
      const cliente = await sembrarCobrable(e);
      expect((await subirFotoValida(ctx, 'academia-a', cliente.token)).status).toBe(204);
      const fotoAntes = (await leerAlumnos(e.A.id))[0]?.foto_clave;

      expect((await cobrar(cliente)).status).toBe(201);

      expect(fotoAntes).toBeTruthy();
      expect((await leerAlumnos(e.A.id))[0]?.foto_clave).toBe(fotoAntes);
    });
  });

  describe('criterio 32: el envío con el DNI de un alumno', () => {
    it('criterio 32: con el DNI de un alumno ALUMNO_ACTIVO (recién pagado), el envío responde 409 DNI_YA_REGISTRADO como hasta ahora, sin escribir', async () => {
      const cliente = await sembrarCobrable(e);
      expect((await cobrar(cliente)).status).toBe(201);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(e, { sobre: { alumno: { dni: cliente.dni } } }),
      );

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'DNI_YA_REGISTRADO']);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    });

    it('criterio 32: con el DNI de un cliente con la solicitud PENDIENTE_PAGO (todavía sin pagar), el envío sigue respondiendo DNI_YA_REGISTRADO; el cobro no lo cambia', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(e, { sobre: { alumno: { dni: cliente.dni } } }),
      );

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'DNI_YA_REGISTRADO']);
      expect((await leerSolicitudes(e.A.id))[0]?.estado).toBe('PENDIENTE_PAGO');
    });

    it('criterio 32 y 21 b de 005: con el DNI de un cliente cuya solicitud venció (sin pagar), el envío se acepta como siempre (201)', async () => {
      const vencida = await sembrarCobrable(e, { estado: 'PENDIENTE_PAGO_VENCIDA' });

      const respuesta = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(e, { sobre: { alumno: { dni: vencida.dni } } }),
      );

      expect(respuesta.status, respuesta.texto).toBe(201);
    });
  });
});
