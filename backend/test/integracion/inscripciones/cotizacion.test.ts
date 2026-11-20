import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contarAuditoria } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  cotizacionEsperada,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoCotizacion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  llenarClase,
  rutaPublica,
} from '../../utilidades/inscripciones';

// Criterio 11 de 005 (HU-34): la cotización responde 200 con exactamente
// { cotizacion: { mes, fechaInicio, fechaFin, clasesRestantes, clasesTotales, clasesPorMes, precioPlan, monto, esProporcional } },
// no escribe ni reserva nada (matrículas, solicitudes ni auditoría quedan igual) y no exige cupo: con una clase llena también responde
// 200 (el cupo se comprueba al enviar). Prueba de integración no protegida (la pidió la revisión de 005a).

describe('cotización pública (criterio 11)', () => {
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

  const cotizar = (cuerpo: unknown = cuerpoCotizacion(e)) =>
    ctx.http.post(rutaPublica('academia-a', '/inscripcion/cotizacion'), cuerpo);
  const estado = async () => ({
    filas: await instantaneaDeInscripciones(e.A.id),
    filasB: await instantaneaDeInscripciones(e.B.id),
    auditoria: await contarAuditoria(e.A.id),
    auditoriaB: await contarAuditoria(e.B.id),
  });

  it('criterio 11: responde 200 con exactamente las claves de la cotización y los valores del cálculo', async () => {
    const respuesta = await cotizar();

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(Object.keys(respuesta.body ?? {})).toEqual(['cotizacion']);
    const cotizacion = (respuesta.body as { cotizacion: Record<string, unknown> }).cotizacion;
    expect(Object.keys(cotizacion).sort()).toEqual(
      [
        'mes',
        'fechaInicio',
        'fechaFin',
        'clasesRestantes',
        'clasesTotales',
        'clasesPorMes',
        'precioPlan',
        'monto',
        'esProporcional',
      ].sort(),
    );
    expect(cotizacion).toEqual(cotizacionEsperada(e.plan, [e.lunes, e.miercoles, e.viernes], AHORA_005));
  });

  it('criterio 11: no escribe ni reserva nada, ni siquiera auditoría, y repetirla da la misma respuesta', async () => {
    const antes = await estado();

    const primera = await cotizar();
    const segunda = await cotizar();

    expect(primera.status, primera.texto).toBe(200);
    expect(segunda.texto).toBe(primera.texto);
    expect(await estado(), 'matrículas, solicitudes, consentimientos y auditoría quedan igual').toEqual(antes);
  });

  it('criterio 11: no exige cupo; con una clase llena responde 200 y no escribe nada (el cupo se comprueba al enviar)', async () => {
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 25);
    const antes = await estado();

    const respuesta = await cotizar();

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect((respuesta.body as { cotizacion: unknown }).cotizacion).toEqual(
      cotizacionEsperada(e.plan, [e.lunes, e.miercoles, e.viernes], AHORA_005),
    );
    expect(await estado()).toEqual(antes);
  });
});
