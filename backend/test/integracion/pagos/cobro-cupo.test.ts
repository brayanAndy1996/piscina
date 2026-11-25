// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { leerMovimientos } from '../../utilidades/caja';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  pagoDe,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  crearAppInscripciones,
  crearPlanYClaseSabado,
  cuerpoInscripcion,
  leerMatriculas,
  llenarClase,
  ocupacionDeClase,
  retenerClases,
  rutaPublica,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';
import { abrirRetenedor, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';
import { cookieDeUsuario } from '../../utilidades/usuarios';

// Criterio 18 (crítico, RN-11, RN-28; «Cupo de una clase» de 004): el cobro nunca deja una clase con más matrículas que ocupan cupo que su aforo por su culpa:
//   a) con la reserva vigente, el cupo ya es suyo: el cobro se acepta aunque el aforo se haya bajado con confirmación por debajo de la ocupación (DR-5 de 004, nadie pierde su lugar);
//   b) si la reserva vence mientras el cobro espera el bloqueo de las clases, se decide con el instante leído después de `bloquearClasesParaCupo`: una reserva que una inscripción
//      simultánea ya contó como vencida (y cuyo cupo tomó) no se cobra como vigente. Prueba determinista: aforo 20 con 19 ocupados más la solicitud S cuya reserva vence en el instante
//      T; un envío de la 005 en T toma el cupo y confirma mientras el cobro de S espera; el cobro responde 409 y la ocupación queda en 20. En el orden inverso (el cobro primero, con la
//      reserva todavía vigente), el envío responde 409 `SIN_CUPO`;
//   c) [007b] una solicitud `PAGO_RECHAZADO` vuelve a pedir cupo.
// El cobro llama a `bloquearClasesParaCupo` una sola vez con todas las clases de la matrícula, antes de contar.
// Nota de la prueba (b): el contrato dice que el cobro responde `SIN_CUPO`; si el estado visible también se decide con el instante de después del bloqueo, la solicitud ya es `VENCIDA` y
// responde `SOLICITUD_NO_COBRABLE`. Las dos respuestas son 409 y dejan la ocupación en 20 (lo que importa: nunca 21); la prueba acepta cualquiera de las dos.

describe('el cupo al cobrar (criterio 18)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;
  const mes = { anio: 2026, mes: 11 };

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

  const cobrar = (c: SolicitudSembrada, monto = '42.00', cookie = cookies.secretaria) =>
    ctx.http.post(rutaCobro(c.solicitudId), cuerpoCobro(monto), { cookie });
  const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
  const ocupacion = (claseId: string, ahora = AHORA_007) => ocupacionDeClase(e.A.id, claseId, mes, ahora);

  describe('criterio 18 a: con la reserva vigente, el cupo ya es suyo', () => {
    it('criterio 18 a: con el aforo bajado por debajo de la ocupación (24 de 20), el cobro se acepta y la ocupación sigue en 24', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 23);
      const cliente = await sembrarCobrable(e);
      await ejecutarComo(
        'propietario',
        'UPDATE clases SET aforo = 20 WHERE academia_id = $1::uuid AND id = $2::uuid',
        [e.A.id, e.lunes.id],
        {
          academiaId: e.A.id,
        },
      );
      expect(await ocupacion(e.lunes.id), 'la clase ya tenía 24 con el aforo en 20').toBe(24);

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await ocupacion(e.lunes.id)).toBe(24);
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)?.estado).toBe('VIGENTE');
    });

    it('criterio 18 a: con 19 matrículas más la solicitud (20 de 20), el cobro se acepta: la clase está llena, pero el cupo es suyo; quien llega por ese cupo recibe SIN_CUPO', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const cliente = await sembrarCobrable(e);

      const cobro = await cobrar(cliente);
      const envio = await enviar(await cuerpoInscripcion(e));

      expect(cobro.status, cobro.texto).toBe(201);
      expect([envio.status, codigoDeRespuesta(envio)]).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(e.lunes.id)).toBe(20);
    });
  });

  describe('criterio 18 b: la reserva que vence mientras el cobro espera el bloqueo de las clases', () => {
    const T0 = AHORA_007;
    const T = new Date(T0.getTime() + 60 * 60 * 1000);

    it('criterio 18 b: un envío en T (la reserva de S vence en T) toma el último cupo mientras el cobro de S, que empezó antes, espera: el cobro responde 409, no queda nada de su cobro y la ocupación queda en 20', async () => {
      const { plan, clase } = await crearPlanYClaseSabado(e);
      await llenarClase(e.A.id, clase.id, plan.id, 19, { ahora: T0 });
      const s = await sembrarSolicitud(e.A.id, {
        planId: plan.id,
        claseIds: [clase.id],
        clasesTotales: 3,
        clasesPorMesPlan: 4,
        precioPlan: '40.00',
        monto: '30.00',
        reservaVenceEn: T,
        ahora: T0,
      });
      expect(await ocupacion(clase.id, T0), 'antes de T, S ocupa el cupo número 20').toBe(20);
      expect(await ocupacion(clase.id, T), 'en T la reserva de S ya no cuenta').toBe(19);
      const cuerpoDelEnvio = await cuerpoInscripcion(e, { plan, clases: [clase], ahora: T });
      const retenedor = await abrirRetenedor(e.A.id);
      try {
        await retenerClases([clase.id], e.A.id)(retenedor);
        ctx.reloj.fijar(T);
        const envio = observar(enviar(cuerpoDelEnvio));
        const esperoElEnvio = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [envio],
          'el envío ni respondió ni quedó esperando el bloqueo de la clase.',
        );
        ctx.reloj.fijar(T0);
        const cobro = observar(cobrar(s, '30.00', cookieDeUsuario(e.secretariaA, T0)));
        const esperoElCobro = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 2,
          [envio, cobro],
          'el cobro ni respondió ni quedó esperando el bloqueo de la clase.',
        );
        ctx.reloj.fijar(T);
        await retenedor.liberar('COMMIT');
        const [respuestaEnvio, respuestaCobro] = await conLimite(
          Promise.all([envio.resultado, cobro.resultado]),
          'Límite de seguridad: el envío y el cobro no respondieron tras soltar la clase.',
        );

        expect(
          esperoElEnvio && esperoElCobro,
          'el envío y el cobro debían quedar esperando el bloqueo de la clase',
        ).toBe(true);
        expect(respuestaEnvio.status, respuestaEnvio.texto).toBe(201);
        expect(respuestaCobro.status, respuestaCobro.texto).toBe(409);
        expect(['SIN_CUPO', 'SOLICITUD_NO_COBRABLE']).toContain(codigoDeRespuesta(respuestaCobro));
      } finally {
        await retenedor.liberar('ROLLBACK');
      }

      expect(await ocupacion(clase.id, T), 'nunca más inscritos que el aforo').toBe(20);
      expect(await leerPagos(e.A.id)).toEqual([]);
      expect(await leerMovimientos(e.A.id)).toEqual([]);
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === s.matriculaId)?.estado).toBe('RESERVADA');
    });

    it('criterio 18 b (orden inverso): con la reserva todavía vigente, el cobro primero la confirma y el envío por el mismo cupo responde 409 SIN_CUPO; la ocupación queda en 20', async () => {
      const { plan, clase } = await crearPlanYClaseSabado(e);
      await llenarClase(e.A.id, clase.id, plan.id, 19, { ahora: T0 });
      const s = await sembrarSolicitud(e.A.id, {
        planId: plan.id,
        claseIds: [clase.id],
        clasesTotales: 3,
        clasesPorMesPlan: 4,
        precioPlan: '40.00',
        monto: '30.00',
        reservaVenceEn: T,
        ahora: T0,
      });
      const cuerpoDelEnvio = await cuerpoInscripcion(e, { plan, clases: [clase], ahora: T0 });
      const retenedor = await abrirRetenedor(e.A.id);
      try {
        await retenerClases([clase.id], e.A.id)(retenedor);
        const cobro = observar(cobrar(s, '30.00'));
        await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [cobro],
          'el cobro ni respondió ni esperó la clase.',
        );
        const envio = observar(enviar(cuerpoDelEnvio));
        const esperaron = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 2,
          [cobro, envio],
          'el envío ni respondió ni esperó la clase.',
        );
        await retenedor.liberar('COMMIT');
        const [respuestaCobro, respuestaEnvio] = await conLimite(
          Promise.all([cobro.resultado, envio.resultado]),
          'Límite de seguridad: el cobro y el envío no respondieron tras soltar la clase.',
        );

        expect(esperaron).toBe(true);
        expect(respuestaCobro.status, respuestaCobro.texto).toBe(201);
        expect(pagoDe(respuestaCobro).monto).toBe('30.00');
        expect([respuestaEnvio.status, codigoDeRespuesta(respuestaEnvio)], respuestaEnvio.texto).toEqual([
          409,
          'SIN_CUPO',
        ]);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }

      expect(await ocupacion(clase.id, T0)).toBe(20);
    });
  });

  describe('el cobro bloquea todas las clases de la matrícula antes de contar', () => {
    it('criterio 18: si una de las tres clases de la matrícula está retenida por otra transacción, el cobro espera; al soltarla, se acepta', async () => {
      const cliente = await sembrarCobrable(e, {
        claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
        clasesTotales: 12,
        clasesPorMesPlan: 12,
        precioPlan: '120.00',
        monto: '120.00',
      });
      const retenedor = await abrirRetenedor(e.A.id);
      try {
        await retenerClases([e.viernes.id], e.A.id)(retenedor);
        const cobro = observar(cobrar(cliente, '120.00'));

        const espero = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [cobro],
          'el cobro ni respondió ni quedó esperando el bloqueo de la clase.',
        );
        expect(espero, 'el cobro no esperó la clase retenida: no bloquea todas las clases de la matrícula').toBe(true);
        await retenedor.liberar('COMMIT');
        const respuesta = await conLimite(cobro.resultado, 'el cobro no respondió tras soltar la clase');

        expect(respuesta.status, respuesta.texto).toBe(201);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });

    it('criterio 18: un cobro no bloquea una clase que no es de su matrícula: con la clase de otra persona retenida, responde sin esperar', async () => {
      const cliente = await sembrarCobrable(e);
      const retenedor = await abrirRetenedor(e.A.id);
      try {
        await retenerClases([e.miercoles.id], e.A.id)(retenedor);

        const respuesta = await conLimite(cobrar(cliente), 'el cobro esperó una clase que no es de su matrícula');

        expect(respuesta.status, respuesta.texto).toBe(201);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });
  });
});
