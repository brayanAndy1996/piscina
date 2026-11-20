// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import {
  type AppInscripciones,
  AHORA_005,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  rutaPublica,
  solicitudDe,
} from '../../utilidades/inscripciones';

// Criterio 27 (crítico, D-19, pregunta T8): la implementación simulada del enviador de correo registra solo la plantilla, la academia y que
// hubo un envío; nunca el destinatario, el enlace ni el token. Aquí se usa la implementación por defecto (sin reemplazarla), con el
// registro técnico en memoria al nivel más detallado.

describe('el correo simulado no registra el destinatario ni el enlace (criterio 27, DT-8)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it('criterio 27: con correo en el formulario, el registro anota la plantilla y la academia, y nunca el correo, el enlace ni el token', async () => {
    const DIRECCION = 'familia.simulada@ejemplo.test';
    const antes = lineas.length;

    const respuesta = await ctx.http.post(
      rutaPublica('academia-a', '/inscripcion'),
      await cuerpoInscripcion(e, { sobre: { alumno: { correo: DIRECCION } } }),
    );

    expect(respuesta.status, respuesta.texto).toBe(201);
    const solicitud = solicitudDe(respuesta);
    await esperarHasta(() => lineas.slice(antes).some((linea) => linea.includes('SEGUIMIENTO_SOLICITUD')));
    const nuevas = lineas.slice(antes);
    const delCorreo = nuevas.filter((linea) => linea.includes('SEGUIMIENTO_SOLICITUD'));
    expect(delCorreo.length, 'el envío simulado deja una línea con la plantilla').toBeGreaterThan(0);
    expect(
      delCorreo.some((linea) => linea.includes(e.A.id)),
      'y con la academia',
    ).toBe(true);
    const texto = nuevas.join('\n');
    for (const prohibido of [DIRECCION, 'ejemplo.test', solicitud.token, solicitud.enlace]) {
      expect(texto, `el registro no debe llevar ${prohibido}`).not.toContain(prohibido);
    }
  });

  it('criterio 27: sin correo en el formulario el envío simulado no deja ninguna línea', async () => {
    const antes = lineas.length;

    const respuesta = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));

    expect(respuesta.status, respuesta.texto).toBe(201);
    expect(lineas.slice(antes).filter((linea) => linea.includes('SEGUIMIENTO_SOLICITUD'))).toEqual([]);
  });
});
