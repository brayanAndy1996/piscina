// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cerrarCajaDePrueba } from '../../utilidades/caja';
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
  camposConError,
  crearAppInscripciones,
  type OpcionesSembrado,
} from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 15 (crítico, RN-28, D-05, DR-1 y DR-12 de 005): se cobra una solicitud con estado visible `PENDIENTE_PAGO` (con la reserva vigente). Las demás responden 409, sin
// escribir: `SOLICITUD_YA_PAGADA` (`CONFIRMADA`) y `SOLICITUD_NO_COBRABLE` con `detalles: { estado }` (`VENCIDA` o `CANCELADA`; la persona se vuelve a inscribir, DR-10). Con
// un comprobante en revisión (`PAGO_EN_VERIFICACION`) y la `PAGO_RECHAZADO` lo prueba la 007b.
// Criterio 16 (crítico, D-03, HU-34): `montoMostrado` (`montoSchema`) es el total que la web mostró a quien cobra. Si no es igual al total a cobrar al momento de cobrar ("42" y
// "42.00" son iguales), responde 409 `MONTO_CAMBIO` con `detalles: { total }`, sin escribir.
// Orden de los errores del cobro (después del 400 del esquema): 401 (actor) → 404 → la clave → `SOLICITUD_YA_PAGADA` → `PAGO_EN_VERIFICACION` → `SOLICITUD_NO_COBRABLE` →
// `MONTO_CAMBIO` → `SIN_CUPO` → `DNI_DEL_PERSONAL` → `SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA` (la caja, al final).

/** El cuerpo sin una clave. */
const omitir = (cuerpo: Record<string, unknown>, clave: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(cuerpo).filter(([nombre]) => nombre !== clave));

describe('qué solicitudes se cobran y el monto que se ve es el que se cobra (criterios 15 y 16)', () => {
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
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const cobrar = (solicitudId: string, cuerpo: Record<string, unknown>, cookie = cookies.secretaria) =>
    ctx.http.post(rutaCobro(solicitudId), cuerpo, { cookie });

  describe('criterio 15: el estado de la solicitud', () => {
    it('criterio 15: una solicitud ya pagada (CONFIRMADA) responde 409 SOLICITUD_YA_PAGADA con otra clave y no cobra dos veces', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      expect((await cobrar(cliente.solicitudId, cuerpoCobro('42.00'))).status).toBe(201);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await cobrar(cliente.solicitudId, cuerpoCobro('42.00'), cookies.admin);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SOLICITUD_YA_PAGADA']);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      expect(await leerPagos(e.A.id)).toHaveLength(1);
    });

    it.each<[string, Partial<OpcionesSembrado>, string]>([
      ['con la reserva vencida (la fila aún dice PENDIENTE_PAGO)', { estado: 'PENDIENTE_PAGO_VENCIDA' }, 'VENCIDA'],
      ['con la fila VENCIDA (la persona volvió a inscribirse)', { estado: 'VENCIDA' }, 'VENCIDA'],
      ['CANCELADA', { estado: 'CANCELADA' }, 'CANCELADA'],
    ])(
      'criterio 15: una solicitud %s responde 409 SOLICITUD_NO_COBRABLE con { estado: %s } y no escribe',
      async (_nombre, opciones, estado) => {
        await abrirCajaDeHoy(e);
        const cliente = await sembrarCobrable(e, opciones);
        const antes = await instantaneaDeLaAcademia(e.A.id);

        const respuesta = await cobrar(cliente.solicitudId, cuerpoCobro('42.00'));

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
          409,
          'SOLICITUD_NO_COBRABLE',
        ]);
        expect(detallesDeRespuesta(respuesta)).toEqual({ estado });
        expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      },
    );

    it('criterio 15: una reserva que vence en este mismo instante ya es VENCIDA (no se cobra); un milisegundo después todavía se cobra', async () => {
      await abrirCajaDeHoy(e);
      const justo = await sembrarCobrable(e, { reservaVenceEn: new Date(AHORA_007.getTime()) });
      const casi = await sembrarCobrable(e, { reservaVenceEn: new Date(AHORA_007.getTime() + 1) });

      const alLimite = await cobrar(justo.solicitudId, cuerpoCobro('42.00'));
      const antes = await cobrar(casi.solicitudId, cuerpoCobro('42.00'));

      expect([alLimite.status, codigoDeRespuesta(alLimite)]).toEqual([409, 'SOLICITUD_NO_COBRABLE']);
      expect(antes.status, antes.texto).toBe(201);
    });

    it('criterio 15: una solicitud sin vencimiento (la reserva no vence) y sin pago en revisión se cobra', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e, { reservaVenceEn: null });

      const respuesta = await cobrar(cliente.solicitudId, cuerpoCobro('42.00'));

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 15: el estado se decide antes que la caja: una solicitud no cobrable con la caja cerrada responde SOLICITUD_NO_COBRABLE, no SIN_CAJA_ABIERTA', async () => {
      const cliente = await sembrarCobrable(e, { estado: 'CANCELADA' });

      const respuesta = await cobrar(cliente.solicitudId, cuerpoCobro('42.00'));

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'SOLICITUD_NO_COBRABLE']);
    });

    it('criterio 15: una solicitud ya pagada con la caja ya cerrada responde SOLICITUD_YA_PAGADA (el estado antes que la caja)', async () => {
      const caja = await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      await cobrar(cliente.solicitudId, cuerpoCobro('42.00'));
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);

      const respuesta = await cobrar(cliente.solicitudId, cuerpoCobro('42.00'));

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'SOLICITUD_YA_PAGADA']);
    });
  });

  describe('criterio 16: el monto que se ve es el que se cobra', () => {
    it.each([
      ['"42"', '42'],
      ['"42.00"', '42.00'],
    ])('criterio 16: un monto mostrado igual al total (%s) se acepta', async (_nombre, monto) => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);

      const respuesta = await cobrar(cliente.solicitudId, cuerpoCobro(monto));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(pagoDe(respuesta).monto).toBe('42.00');
    });

    it.each([
      ['uno menos', '41.00'],
      ['uno más', '43'],
      ['con céntimos', '42.50'],
      ['el precio del plan', '120.00'],
    ])(
      'criterio 16: un monto mostrado distinto del total (%s) responde 409 MONTO_CAMBIO con { total } y no escribe',
      async (_nombre, monto) => {
        await abrirCajaDeHoy(e);
        const cliente = await sembrarCobrable(e);
        const antes = await instantaneaDeLaAcademia(e.A.id);

        const respuesta = await cobrar(cliente.solicitudId, cuerpoCobro(monto));

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'MONTO_CAMBIO']);
        expect(detallesDeRespuesta(respuesta)).toEqual({ total: '42.00' });
        expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      },
    );

    it('criterio 16: el monto se decide antes que la caja: con la caja cerrada y un monto viejo responde MONTO_CAMBIO (la caja, al final)', async () => {
      const caja = await abrirCajaDeHoy(e);
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
      const cliente = await sembrarCobrable(e);

      const respuesta = await cobrar(cliente.solicitudId, cuerpoCobro('41.00'));

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'MONTO_CAMBIO']);
    });

    it('criterio 16: el estado se decide antes que el monto: una solicitud cancelada con un monto viejo responde SOLICITUD_NO_COBRABLE', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e, { estado: 'CANCELADA' });

      const respuesta = await cobrar(cliente.solicitudId, cuerpoCobro('1.00'));

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'SOLICITUD_NO_COBRABLE']);
    });
  });

  describe('el cuerpo: cobrarEnEfectivoSchema, estricto (400 SOLICITUD_INVALIDA antes que cualquier 404 o 409)', () => {
    const MALOS: [string, (c: Record<string, unknown>) => Record<string, unknown>, string][] = [
      ['sin clave de idempotencia', (c) => omitir(c, 'claveIdempotencia'), 'claveIdempotencia'],
      ['con una clave que no es UUID', (c) => ({ ...c, claveIdempotencia: 'no-es-uuid' }), 'claveIdempotencia'],
      ['sin monto mostrado', (c) => omitir(c, 'montoMostrado'), 'montoMostrado'],
      ['con el monto mostrado vacío', (c) => ({ ...c, montoMostrado: '' }), 'montoMostrado'],
      ['con el monto mostrado "abc"', (c) => ({ ...c, montoMostrado: 'abc' }), 'montoMostrado'],
      ['con el monto mostrado negativo', (c) => ({ ...c, montoMostrado: '-42' }), 'montoMostrado'],
      ['con el monto mostrado como número JSON', (c) => ({ ...c, montoMostrado: 42 }), 'montoMostrado'],
      ['con un monto mostrado con tres decimales', (c) => ({ ...c, montoMostrado: '42.001' }), 'montoMostrado'],
    ];

    it.each(MALOS)('criterio 16: %s', async (_nombre, armar, campo) => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await cobrar(
        cliente.solicitudId,
        armar({ claveIdempotencia: randomUUID(), montoMostrado: '42.00' }),
      );

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(codigoDeRespuesta(respuesta)).toBe('SOLICITUD_INVALIDA');
      expect(camposConError(respuesta)).toContain(campo);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
    });

    it('criterio 16: un cuerpo vacío o un JSON que no es un objeto responde 400 aunque el id no exista', async () => {
      for (const cuerpo of [{}, [], 'texto', null] as unknown[]) {
        const respuesta = await cobrar(randomUUID(), cuerpo as Record<string, unknown>);
        expect(respuesta.status, JSON.stringify(cuerpo)).toBe(400);
      }
    });

    it('criterio 16: el 400 va antes que el 404: un id inexistente con un cuerpo inválido responde 400; con un cuerpo válido, 404', async () => {
      const inexistente = randomUUID();

      expect((await cobrar(inexistente, { montoMostrado: 'abc' })).status).toBe(400);
      expect((await cobrar(inexistente, cuerpoCobro('42.00'))).status).toBe(404);
    });
  });
});
