// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actualizarFila } from '../../utilidades/planes-clases';
import { contarAuditoria } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  cotizacionEsperada,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoCotizacion,
  cuerpoInscripcion,
  detallesDe,
  EnviadorDePrueba,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerMatriculas,
  type Objeto,
  rutaPublica,
} from '../../utilidades/inscripciones';

// Criterio 19 (crítico, HU-34, HU-19, D-03): el monto que se ve es el que se guarda. El cuerpo trae `inscripcion.mes` y
// `inscripcion.montoMostrado` (los de la cotización que vio el cliente). Si `mes` no es el mes en curso (Lima), 409 MES_CAMBIO; si el
// monto calculado al enviar (con el precio del plan en ese momento y "ahora") no es igual a `montoMostrado`, 409 MONTO_CAMBIO con la
// cotización nueva en `detalles.cotizacion`. Ninguno escribe nada. Casos: envío a las 23:59:59 del 30 de noviembre en Lima con la
// cotización de noviembre, procesado a las 00:00:00 del 1 de diciembre (MES_CAMBIO); el administrador cambia el precio entre la
// cotización y el envío (MONTO_CAMBIO); empieza una de las clases de hoy entre la cotización y el envío (MONTO_CAMBIO si el monto baja).

describe('envío: el monto que se ve es el que se guarda (criterio 19)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  const correo = new EnviadorDePrueba();

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ correo });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    correo.mensajes.length = 0;
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
  const cotizar = (cuerpo: unknown = cuerpoCotizacion(e)) =>
    ctx.http.post(rutaPublica('academia-a', '/inscripcion/cotizacion'), cuerpo);
  const estado = async () => ({
    filas: await instantaneaDeInscripciones(e.A.id),
    auditoria: await contarAuditoria(e.A.id),
    correos: correo.mensajes.length,
  });

  describe('MES_CAMBIO', () => {
    it('criterio 19: cotizado en noviembre (23:59:59 del 30 en Lima) y procesado a las 00:00:00 del 1 de diciembre responde 409 MES_CAMBIO y no escribe', async () => {
      const cotizadoEn = new Date('2026-12-01T04:59:59.000Z'); // 23:59:59 del 30 de noviembre en Lima
      const cuerpo = await cuerpoInscripcion(e, {
        ahora: cotizadoEn,
        sobre: { inscripcion: { montoMostrado: '120.00' } },
      });
      expect((cuerpo['inscripcion'] as Objeto)['mes']).toBe('2026-11');
      ctx.reloj.fijar(new Date('2026-12-01T05:00:00.000Z')); // 00:00:00 del 1 de diciembre en Lima
      const antes = await estado();

      const respuesta = await enviar(cuerpo);

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MES_CAMBIO']);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 19: a las 23:59:59 del 30 en Lima el mes en curso sigue siendo noviembre (no hay MES_CAMBIO, aunque en UTC ya sea diciembre)', async () => {
      ctx.reloj.fijar(new Date('2026-12-01T04:59:59.000Z'));

      const respuesta = await enviar(
        await cuerpoInscripcion(e, { ahora: ctx.reloj.ahora(), sobre: { inscripcion: { montoMostrado: '120.00' } } }),
      );

      expect(codigoDe(respuesta), respuesta.texto).not.toBe('MES_CAMBIO');
      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'SIN_CLASES_EN_EL_MES']);
    });

    it('criterio 19: el mes en curso se acepta y el mes siguiente o el anterior no (11 de noviembre: 2026-11 sí; 2026-12 y 2026-10 no)', async () => {
      const antes = await estado();

      for (const mes of ['2026-12', '2026-10', '2025-11', '2027-11']) {
        const respuesta = await enviar(await cuerpoInscripcion(e, { sobre: { inscripcion: { mes } } }));
        expect([respuesta.status, codigoDe(respuesta)], mes).toEqual([409, 'MES_CAMBIO']);
      }

      expect(await estado()).toEqual(antes);
      expect((await enviar(await cuerpoInscripcion(e))).status).toBe(201);
    });

    it('criterio 19: el 1 de diciembre a las 00:00:00 de Lima, con el mes 2026-12 y la cotización de diciembre, el envío se acepta (13 clases, tope de 12, monto completo)', async () => {
      ctx.reloj.fijar(new Date('2026-12-01T05:00:00.000Z'));

      const respuesta = await enviar(await cuerpoInscripcion(e, { ahora: ctx.reloj.ahora() }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(cotizacionEsperada(e.plan, [e.lunes, e.miercoles, e.viernes], ctx.reloj.ahora())).toMatchObject({
        mes: '2026-12',
        clasesRestantes: 13,
        clasesTotales: 12,
        monto: '120.00',
        esProporcional: false,
      });
    });
  });

  describe('MONTO_CAMBIO', () => {
    it('criterio 19: un monto mostrado distinto del calculado responde 409 MONTO_CAMBIO con la cotización nueva en detalles.cotizacion y no escribe', async () => {
      const antes = await estado();

      const respuesta = await enviar(
        await cuerpoInscripcion(e, { sobre: { inscripcion: { montoMostrado: '120.00' } } }),
      );

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MONTO_CAMBIO']);
      expect(detallesDe(respuesta)['cotizacion']).toEqual(
        cotizacionEsperada(e.plan, [e.lunes, e.miercoles, e.viernes], AHORA_005),
      );
      expect(await estado()).toEqual(antes);
    });

    it('criterio 19: el administrador cambia el precio entre la cotización y el envío: MONTO_CAMBIO con el monto nuevo, y reintentar con él se acepta', async () => {
      const cotizacion = await cotizar();
      expect(cotizacion.status, cotizacion.texto).toBe(200);
      const visto = (cotizacion.body?.['cotizacion'] as Objeto)['monto'] as string;
      expect(visto).toBe('90.00');
      const cuerpo = await cuerpoInscripcion(e, { sobre: { inscripcion: { montoMostrado: visto } } });
      await actualizarFila('propietario', 'planes', e.A.id, e.plan.id, { precio: '150.00' });
      const antes = await estado();

      const respuesta = await enviar(cuerpo);

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MONTO_CAMBIO']);
      const nueva = detallesDe(respuesta)['cotizacion'] as Objeto;
      expect(nueva).toMatchObject({ precioPlan: '150.00', monto: '113.00', clasesTotales: 9, esProporcional: true });
      expect(await estado()).toEqual(antes);
      const otraVez = await enviar(
        await cuerpoInscripcion(e, { sobre: { inscripcion: { montoMostrado: nueva['monto'] } } }),
      );
      expect(otraVez.status, otraVez.texto).toBe(201);
    });

    it('criterio 19: si el precio no cambia entre la cotización y el envío, se acepta y se guarda lo mismo que se vio', async () => {
      const cotizacion = await cotizar();
      const visto = (cotizacion.body?.['cotizacion'] as Objeto)['monto'] as string;

      const respuesta = await enviar(await cuerpoInscripcion(e, { sobre: { inscripcion: { montoMostrado: visto } } }));

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 19: empieza una de las clases de hoy entre la cotización y el envío: el monto baja y responde MONTO_CAMBIO', async () => {
      // Miércoles 11 de noviembre: la clase de las 18:00 todavía no empezó a las 10:00 (quedan 9 clases) y a las 18:30 ya empezó (8).
      const cotizacion = await cotizar();
      expect((cotizacion.body?.['cotizacion'] as Objeto)['monto']).toBe('90.00');
      const cuerpo = await cuerpoInscripcion(e);
      ctx.reloj.fijar(new Date('2026-11-11T23:30:00.000Z')); // 18:30 en Lima
      const antes = await estado();

      const respuesta = await enviar(cuerpo);

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MONTO_CAMBIO']);
      expect(detallesDe(respuesta)['cotizacion']).toMatchObject({
        clasesRestantes: 8,
        clasesTotales: 8,
        monto: '80.00',
      });
      expect(await estado()).toEqual(antes);
    });

    it('criterio 19: la clase de hoy cuenta hasta el segundo antes de empezar: a las 17:59:59 de Lima se acepta con 9 clases y a las 18:00:00 ya es MONTO_CAMBIO', async () => {
      const cuerpo = await cuerpoInscripcion(e);

      ctx.reloj.fijar(new Date('2026-11-11T22:59:59.000Z')); // 17:59:59 en Lima
      const antes = await enviar(await cuerpoInscripcion(e));
      expect(antes.status, antes.texto).toBe(201);

      ctx.reloj.fijar(new Date('2026-11-11T23:00:00.000Z')); // 18:00:00 en Lima
      const despues = await enviar(cuerpo);

      expect([despues.status, codigoDe(despues)], despues.texto).toEqual([409, 'MONTO_CAMBIO']);
    });

    it('criterio 19: lo que se guarda es lo calculado en el servidor, nunca lo que dice el cliente', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect((await leerMatriculas(e.A.id))[0]?.monto_calculado).toBe('90.00');
    });
  });

  describe('la cotización muestra el mismo monto que el envío calcula', () => {
    it('criterio 19: la cotización de la ruta pública y el cálculo del envío coinciden en cada instante del día (10:00, 17:59:59, 18:00:00 y 23:59 de Lima)', async () => {
      const instantes = [
        '2026-11-11T15:00:00.000Z',
        '2026-11-11T22:59:59.000Z',
        '2026-11-11T23:00:00.000Z',
        '2026-11-12T04:59:00.000Z',
      ];
      for (const instante of instantes) {
        ctx.reloj.fijar(new Date(instante));
        const cotizacion = await cotizar();
        expect(cotizacion.status, `${instante}: ${cotizacion.texto}`).toBe(200);
        const mostrado = (cotizacion.body?.['cotizacion'] as Objeto)['monto'] as string;
        expect(mostrado).toBe(cotizacionEsperada(e.plan, [e.lunes, e.miercoles, e.viernes], ctx.reloj.ahora()).monto);
      }
    });
  });
});
