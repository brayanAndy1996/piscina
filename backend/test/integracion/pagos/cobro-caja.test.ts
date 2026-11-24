// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AYER, cerrarCajaDePrueba, crearCajaDePrueba, enLima, leerMovimientos } from '../../utilidades/caja';
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
  type AppInscripciones,
  crearAppInscripciones,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
} from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';
import { cookieDeUsuario, instantaneaDeUsuarios } from '../../utilidades/usuarios';

// Criterio 14 (crítico, RN-17, D-04, DR-2 de 006; «cobrar con la caja de otro día» de `CLAUDE.md`): el cobro en efectivo solo se acepta con la caja de hoy abierta. Sin caja
// abierta responde 409 `SIN_CAJA_ABIERTA` («Abre la caja antes de cobrar»); con la caja abierta de un día anterior, 409 `CAJA_DE_OTRO_DIA` con `detalles: { cajaId, fecha }`; con
// la caja de hoy cerrada, `SIN_CAJA_ABIERTA`. En los tres casos no queda nada: ni pago, ni usuario, ni cambios en el alumno, la solicitud o la matrícula, ni auditoría. Con la
// caja del 30 de noviembre abierta, un cobro a las 23:59:59.999 del 30 en Lima se acepta y uno a las 00:00 del 1 de diciembre responde `CAJA_DE_OTRO_DIA`, también con el proceso
// en `TZ=Asia/Tokyo`.

const ZONA_ORIGINAL = process.env['TZ'];

describe('el cobro solo con la caja de hoy abierta (criterio 14)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    process.env['TZ'] = 'UTC';
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });

  const cobrar = (solicitudId: string, cookie = cookies.secretaria, monto = '42.00') =>
    ctx.http.post(rutaCobro(solicitudId), cuerpoCobro(monto), { cookie });

  /** Un cobro rechazado no deja nada: ni pago, ni cuenta, ni cambios en el alumno, la solicitud o la matrícula, ni auditoría, ni movimiento. */
  async function exigirSinCambios(antes: string) {
    expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    expect(await leerPagos(e.A.id)).toEqual([]);
    expect(await leerMovimientos(e.A.id)).toEqual([]);
    expect((await leerAlumnos(e.A.id)).every((a) => a.estado === 'CLIENTE' && a.usuario_id === null)).toBe(true);
    expect((await leerSolicitudes(e.A.id)).every((s) => s.estado === 'PENDIENTE_PAGO')).toBe(true);
    expect((await leerMatriculas(e.A.id)).every((m) => m.estado === 'RESERVADA')).toBe(true);
    // Las cuentas de la academia no cambian: se compara con las de antes del cobro, no con un número fijo.
    expect(await instantaneaDeUsuarios(e.A.id)).toBe((JSON.parse(antes) as { usuarios: string }).usuarios);
  }

  it('criterio 14: sin ninguna caja responde 409 SIN_CAJA_ABIERTA («Abre la caja antes de cobrar») y no queda nada', async () => {
    const cliente = await sembrarCobrable(e);
    const antes = await instantaneaDeLaAcademia(e.A.id);

    const respuesta = await cobrar(cliente.solicitudId);

    expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SIN_CAJA_ABIERTA']);
    expect(respuesta.body?.['mensaje']).toBe('Abre la caja antes de cobrar');
    await exigirSinCambios(antes);
  });

  it('criterio 14: con la caja de hoy cerrada responde 409 SIN_CAJA_ABIERTA y no queda nada', async () => {
    const caja = await abrirCajaDeHoy(e);
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
    const cliente = await sembrarCobrable(e);
    const antes = await instantaneaDeLaAcademia(e.A.id);

    const respuesta = await cobrar(cliente.solicitudId);

    expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SIN_CAJA_ABIERTA']);
    await exigirSinCambios(antes);
  });

  it('criterio 14: la caja abierta de otra academia no cuenta: A sin caja y B con una abierta responde SIN_CAJA_ABIERTA en A y no escribe en B', async () => {
    await crearCajaDePrueba(e.B.id, e.secretariaB.id);
    const cliente = await sembrarCobrable(e);
    const antes = await instantaneaDeLaAcademia(e.A.id);
    const antesB = await instantaneaDeLaAcademia(e.B.id);

    const respuesta = await cobrar(cliente.solicitudId);

    expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'SIN_CAJA_ABIERTA']);
    await exigirSinCambios(antes);
    expect(await instantaneaDeLaAcademia(e.B.id)).toBe(antesB);
  });

  it('criterio 14: con la caja abierta de ayer responde 409 CAJA_DE_OTRO_DIA con { cajaId, fecha } y no queda nada', async () => {
    const deAyer = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });
    const cliente = await sembrarCobrable(e);
    const antes = await instantaneaDeLaAcademia(e.A.id);

    const respuesta = await cobrar(cliente.solicitudId);

    expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CAJA_DE_OTRO_DIA']);
    expect(detallesDeRespuesta(respuesta)).toEqual({ cajaId: deAyer.id, fecha: AYER });
    expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    expect(await leerPagos(e.A.id)).toEqual([]);
    expect((await leerAlumnos(e.A.id)).every((a) => a.estado === 'CLIENTE')).toBe(true);
  });

  it('criterio 14: la caja de la secretaria o del administrador da igual: quien cobra puede ser otro distinto de quien abrió la caja', async () => {
    await abrirCajaDeHoy(e);
    const cliente = await sembrarCobrable(e);

    const respuesta = await cobrar(cliente.solicitudId, cookies.admin);

    expect(respuesta.status, respuesta.texto).toBe(201);
  });

  describe.each(['UTC', 'Asia/Tokyo'])('con el proceso en TZ=%s: el día de la caja es el de America/Lima', (zona) => {
    beforeEach(() => {
      process.env['TZ'] = zona;
    });

    it.each([
      ['19:30 del 30 de noviembre en Lima (en UTC ya es el 1 de diciembre)', '2026-12-01T00:30:00.000Z', true],
      ['23:59:59.999 del 30 de noviembre en Lima', '2026-12-01T04:59:59.999Z', true],
      ['00:00 del 1 de diciembre en Lima', '2026-12-01T05:00:00.000Z', false],
    ])(
      'criterio 14: con la caja del 30 de noviembre abierta, a las %s: se acepta = %s',
      async (_nombre, instante, acepta) => {
        const ahora = new Date(instante);
        ctx.reloj.fijar(ahora);
        const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, {
          fecha: '2026-11-30',
          abierta_en: enLima('2026-11-30', '09:00'),
        });
        // Sin vencimiento: la reserva no puede cruzar el mes (criterio 56 de 005) y la solicitud sigue siendo cobrable al límite del día.
        const cliente = await sembrarCobrable(e, { reservaVenceEn: null, ahora: new Date('2026-11-30T15:00:00.000Z') });
        const antes = await instantaneaDeLaAcademia(e.A.id);

        const respuesta = await cobrar(cliente.solicitudId, cookieDeUsuario(e.secretariaA, ahora));

        if (acepta) {
          expect(respuesta.status, respuesta.texto).toBe(201);
          expect(pagoDe(respuesta).registradoEn).toBe(ahora.toISOString());
          expect((await leerMovimientos(e.A.id))[0]?.caja_id).toBe(caja.id);
          return;
        }
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'CAJA_DE_OTRO_DIA']);
        expect(detallesDeRespuesta(respuesta)).toEqual({ cajaId: caja.id, fecha: '2026-11-30' });
        expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      },
    );
  });
});
