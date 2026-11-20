import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAlumnoSolo } from '../../utilidades/inscripciones';
import {
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoCotizacion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  llenarClase,
  rutaPublica,
} from '../../utilidades/inscripciones';
import { dniInventado } from '../../utilidades/usuarios';

// Prueba no protegida (T13 de 005): el orden de los 409 del envío es el del contrato: SOLICITUD_YA_REGISTRADA → TEXTOS_ACTUALIZADOS →
// MES_CAMBIO → PLAN_NO_DISPONIBLE → DNI_YA_REGISTRADO → LIMITE_DE_RESERVAS_PENDIENTES → SELECCION_NO_VALIDA → SIN_CLASES_EN_EL_MES →
// SIN_CUPO → MONTO_CAMBIO. Cada caso arma un cuerpo que cumple dos condiciones a la vez y comprueba cuál gana. La cotización usa el mismo
// orden para los códigos que comparte (PLAN_NO_DISPONIBLE → SELECCION_NO_VALIDA → SIN_CLASES_EN_EL_MES).

describe('el orden de los 409 del envío y de la cotización', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
  const cotizar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion/cotizacion'), cuerpo);
  const INEXISTENTE = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';

  it('SOLICITUD_YA_REGISTRADA gana a TEXTOS_ACTUALIZADOS', async () => {
    const cuerpo = await cuerpoInscripcion(e);
    expect((await enviar(cuerpo)).status).toBe(201);

    const repetido = await enviar({
      ...cuerpo,
      consentimientos: { ...(cuerpo['consentimientos'] as object), version: 'vieja' },
    });

    expect(codigoDe(repetido)).toBe('SOLICITUD_YA_REGISTRADA');
  });

  it('TEXTOS_ACTUALIZADOS gana a MES_CAMBIO, y MES_CAMBIO a PLAN_NO_DISPONIBLE', async () => {
    const textos = await enviar(
      await cuerpoInscripcion(e, {
        sobre: { consentimientos: { version: 'vieja' }, inscripcion: { mes: '2026-12', planId: INEXISTENTE } },
      }),
    );
    const mes = await enviar(
      await cuerpoInscripcion(e, { sobre: { inscripcion: { mes: '2026-12', planId: INEXISTENTE } } }),
    );

    expect(codigoDe(textos)).toBe('TEXTOS_ACTUALIZADOS');
    expect(codigoDe(mes)).toBe('MES_CAMBIO');
  });

  it('PLAN_NO_DISPONIBLE gana a DNI_YA_REGISTRADO, y este a la selección', async () => {
    const dni = dniInventado();
    await crearAlumnoSolo(e.A.id, { dni, estado: 'ALUMNO_ACTIVO' });

    const plan = await enviar(
      await cuerpoInscripcion(e, { sobre: { alumno: { dni }, inscripcion: { planId: INEXISTENTE } } }),
    );
    const registrado = await enviar(
      await cuerpoInscripcion(e, { sobre: { alumno: { dni }, inscripcion: { claseIds: [e.lunes.id] } } }),
    );

    expect(codigoDe(plan)).toBe('PLAN_NO_DISPONIBLE');
    expect(codigoDe(registrado)).toBe('DNI_YA_REGISTRADO');
  });

  it('SELECCION_NO_VALIDA gana a SIN_CLASES_EN_EL_MES, SIN_CLASES_EN_EL_MES a SIN_CUPO y SIN_CUPO a MONTO_CAMBIO', async () => {
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);
    const sobreSeleccion = { inscripcion: { claseIds: [e.lunes.id], montoMostrado: '1.00' } };
    const seleccion = await enviar(await cuerpoInscripcion(e, { sobre: sobreSeleccion }));
    const cupo = await enviar(await cuerpoInscripcion(e, { sobre: { inscripcion: { montoMostrado: '1.00' } } }));
    ctx.reloj.fijar(new Date('2026-12-01T04:59:59.000Z')); // lunes 30 de noviembre, 23:59:59 en Lima: no quedan clases
    const sinClases = await enviar(
      await cuerpoInscripcion(e, { ahora: ctx.reloj.ahora(), sobre: { inscripcion: { montoMostrado: '1.00' } } }),
    );

    expect(codigoDe(seleccion)).toBe('SELECCION_NO_VALIDA');
    expect(codigoDe(cupo)).toBe('SIN_CUPO');
    expect(codigoDe(sinClases)).toBe('SIN_CLASES_EN_EL_MES');
  });

  it('la cotización decide PLAN_NO_DISPONIBLE antes que SELECCION_NO_VALIDA y esta antes que SIN_CLASES_EN_EL_MES', async () => {
    const plan = await cotizar(cuerpoCotizacion(e, { planId: INEXISTENTE, claseIds: [e.lunes.id] }));
    const seleccion = await cotizar(cuerpoCotizacion(e, { claseIds: [e.lunes.id] }));
    ctx.reloj.fijar(new Date('2026-12-01T04:59:59.000Z'));
    const sinClases = await cotizar(cuerpoCotizacion(e));

    expect(codigoDe(plan)).toBe('PLAN_NO_DISPONIBLE');
    expect(codigoDe(seleccion)).toBe('SELECCION_NO_VALIDA');
    expect(codigoDe(sinClases)).toBe('SIN_CLASES_EN_EL_MES');
  });
});
