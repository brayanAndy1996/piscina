// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { crearPlanDePrueba, type PlanDePrueba } from '../../utilidades/planes-clases';
import { contarAuditoria } from '../../utilidades/usuarios';
import {
  ACCION_SOLICITUD_CREADA,
  type AppInscripciones,
  camposConError,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoCotizacion,
  cuerpoInscripcion,
  detallesDe,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerMatriculas,
  type Objeto,
  rutaPublica,
  solicitudDe,
} from '../../utilidades/inscripciones';

// Criterio 50 (crítico, RN-25, HU-34, D-03, criterios 9, 12 y 19; ataque ronda 1, F2): el monto cotizado siempre se puede enviar. Un plan
// puede tener un precio de hasta S/ 99999.99 y, redondeado hacia arriba al sol entero (D-03), el monto de un mes completo puede llegar a
// S/ 100000.00. `montoMostrado` se valida con `montoCotizadoSchema`: acepta "100000", "100000.0" y "100000.00"; responde 400 en
// `inscripcion.montoMostrado` con "100000.01", "100001" y "1000000". Con un plan de precio 99999.01 y otro de 99999.99, y una selección sin
// proporcional, la cotización responde 200 con monto "100000.00", y un envío con ese `montoMostrado` responde 201 y guarda
// `monto_calculado` 100000.00 en la matrícula (y en la auditoría del criterio 26); con un `montoMostrado` distinto del calculado sigue
// respondiendo 409 MONTO_CAMBIO. (La propiedad sobre todo precio válido, en la prueba unitaria `monto-cotizado-protegido.test.ts`.)

describe('el monto cotizado siempre se puede enviar (criterio 50)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  let caro1: PlanDePrueba;
  let caro2: PlanDePrueba;
  /** Domingo 1 de noviembre de 2026, 00:00 en Lima: quedan 13 clases de lunes, miércoles y viernes (tope de 12): mes completo. */
  const INICIO_DE_MES = new Date('2026-11-01T05:00:00.000Z');

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(INICIO_DE_MES);
    e = await crearEscenarioInscripcion();
    const base = {
      veces_por_semana: 3,
      clases_por_mes: 12,
      dias_permitidos: [1, 3, 5],
      franjas_permitidas: ['17:00', '18:00', '19:00'],
      niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
    };
    caro1 = await crearPlanDePrueba(e.A.id, { ...base, nombre: 'Plan de 99999.01', precio: '99999.01' });
    caro2 = await crearPlanDePrueba(e.A.id, { ...base, nombre: 'Plan de 99999.99', precio: '99999.99' });
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
  const cotizar = (planId: string) =>
    ctx.http.post(rutaPublica('academia-a', '/inscripcion/cotizacion'), cuerpoCotizacion(e, { planId }));
  const cuerpoDe = (plan: PlanDePrueba, montoMostrado?: string) =>
    cuerpoInscripcion(e, {
      plan,
      ahora: INICIO_DE_MES,
      sobre: montoMostrado === undefined ? {} : { inscripcion: { montoMostrado } },
    });

  it.each([
    ['99999.01', () => caro1],
    ['99999.99', () => caro2],
  ])(
    'criterio 50: la cotización de un mes completo con un plan de S/ %s responde 200 con monto "100000.00"',
    async (precio, plan) => {
      const respuesta = await cotizar(plan().id);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.body?.['cotizacion']).toMatchObject({
        mes: '2026-11',
        clasesRestantes: 13,
        clasesTotales: 12,
        clasesPorMes: 12,
        precioPlan: precio,
        monto: '100000.00',
        esProporcional: false,
      });
    },
  );

  it.each([
    ['99999.01', () => caro1],
    ['99999.99', () => caro2],
  ])(
    'criterio 50: el envío con un plan de S/ %s y montoMostrado "100000.00" responde 201 y guarda monto_calculado 100000.00 en la matrícula y en la auditoría',
    async (_precio, plan) => {
      const respuesta = await enviar(await cuerpoDe(plan()));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(solicitudDe(respuesta).cotizacion).toMatchObject({ monto: '100000.00', esProporcional: false });
      const [matricula] = await leerMatriculas(e.A.id);
      expect(matricula).toMatchObject({ monto_calculado: '100000.00', clases_totales: 12, es_proporcional: false });
      const [auditoria] = await leerAuditoriaDeAcademia(e.A.id, ACCION_SOLICITUD_CREADA);
      expect((auditoria?.datos_despues as Objeto)['montoCalculado']).toBe('100000.00');
    },
  );

  it.each(['100000', '100000.0', '100000.00'])(
    'criterio 50: montoMostrado %j se acepta cuando el monto calculado es 100000.00',
    async (monto) => {
      const respuesta = await enviar(await cuerpoDe(caro2, monto));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect((await leerMatriculas(e.A.id))[0]?.monto_calculado).toBe('100000.00');
    },
  );

  it.each(['100000.01', '100001', '1000000'])(
    'criterio 50: montoMostrado %j responde 400 SOLICITUD_INVALIDA en inscripcion.montoMostrado y no escribe, audita ni cambia nada',
    async (monto) => {
      const antes = { filas: await instantaneaDeInscripciones(e.A.id), auditoria: await contarAuditoria(e.A.id) };

      const respuesta = await enviar(await cuerpoDe(caro2, monto));

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
      expect(camposConError(respuesta)).toContain('inscripcion.montoMostrado');
      expect({ filas: await instantaneaDeInscripciones(e.A.id), auditoria: await contarAuditoria(e.A.id) }).toEqual(
        antes,
      );
    },
  );

  it('criterio 50: con un montoMostrado distinto del calculado sigue respondiendo 409 MONTO_CAMBIO con la cotización nueva y sin escribir', async () => {
    const antes = await instantaneaDeInscripciones(e.A.id);

    for (const distinto of ['99999.99', '99999.01', '1.00']) {
      const respuesta = await enviar(await cuerpoDe(caro2, distinto));

      expect([respuesta.status, codigoDe(respuesta)], `${distinto}: ${respuesta.texto}`).toEqual([409, 'MONTO_CAMBIO']);
      expect(detallesDe(respuesta)['cotizacion']).toMatchObject({ monto: '100000.00', precioPlan: '99999.99' });
    }
    expect(await instantaneaDeInscripciones(e.A.id)).toEqual(antes);
  });

  it('criterio 50: un monto válido pero distinto del calculado (el calculado es 99999.00 y se envía 100000.00) responde 409 MONTO_CAMBIO, no 400', async () => {
    const justo = await crearPlanDePrueba(e.A.id, {
      nombre: 'Plan de 99999.00',
      veces_por_semana: 3,
      clases_por_mes: 12,
      precio: '99999.00',
      dias_permitidos: [1, 3, 5],
      franjas_permitidas: ['17:00', '18:00', '19:00'],
      niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
    });

    const respuesta = await enviar(await cuerpoDe(justo, '100000.00'));

    expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MONTO_CAMBIO']);
    expect(detallesDe(respuesta)['cotizacion']).toMatchObject({ monto: '99999.00' });
  });
});
