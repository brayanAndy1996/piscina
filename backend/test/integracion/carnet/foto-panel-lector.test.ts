import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AlumnoConQr,
  type AppCarnet,
  codigoDeRespuesta,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
  prepararEscenarioDelCarnet,
} from '../../utilidades/escenario-carnet';
import { rutaFotoAlumno, rutaFotoSolicitud, subirFotoPanel } from '../../utilidades/escenario-foto-panel';
import { png } from '../../utilidades/inscripciones-005b';

// Prueba no protegida de la 008b (T19, criterio 24): las dos rutas de la foto del panel usan el lector binario y el lector JSON no las toca.
// Si el lector JSON las leyera, un `image/png` válido de una secretaria recibiría 400 `SOLICITUD_INVALIDA` («el cuerpo debe ser JSON») y un
// `application/json` llegaría como objeto: aquí el tipo se juzga como imagen (400 `IMAGEN_NO_VALIDA`) y el permiso se decide antes de leer nada.

describe('el lector binario de la foto del panel (T19, criterio 24)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const rutas = (): [string, string][] => [
    ['alumno', rutaFotoAlumno(alumno.alumnoId)],
    ['solicitud', rutaFotoSolicitud(randomUUID())],
  ];

  it('una imagen de la secretaria no pasa por el lector JSON: nunca responde 400 SOLICITUD_INVALIDA', async () => {
    for (const [nombre, ruta] of rutas()) {
      for (const tipo of ['image/png', 'image/jpeg']) {
        const respuesta = await subirFotoPanel(ctx, ruta, {
          cookie: esc.cookies.secretaria,
          tipo,
          cuerpo: png(100, 100),
        });
        expect(codigoDeRespuesta(respuesta), `${nombre} con ${tipo}: ${respuesta.texto.slice(0, 200)}`).not.toBe(
          'SOLICITUD_INVALIDA',
        );
      }
    }
  });

  it('un JSON de la secretaria es una imagen que no sirve (400 IMAGEN_NO_VALIDA), no un cuerpo JSON', async () => {
    for (const [nombre, ruta] of rutas()) {
      const respuesta = await subirFotoPanel(ctx, ruta, {
        cookie: esc.cookies.secretaria,
        tipo: 'application/json',
        cuerpo: Buffer.from('{"foto":"x"}'),
      });
      expect([respuesta.status, codigoDeRespuesta(respuesta)], nombre).toEqual([400, 'IMAGEN_NO_VALIDA']);
    }
  });

  it('el entrenador y el alumno reciben 403 SIN_PERMISO sin que se lea el cuerpo, aunque sea JSON roto o enorme', async () => {
    for (const cookie of [esc.cookies.entrenador, alumno.cookie]) {
      for (const [nombre, ruta] of rutas()) {
        const roto = await subirFotoPanel(ctx, ruta, {
          cookie,
          tipo: 'application/json',
          cuerpo: Buffer.from('{ no es json'),
          plazoMs: 5000,
        });
        expect([roto.status, codigoDeRespuesta(roto)], `${nombre}, JSON roto`).toEqual([403, 'SIN_PERMISO']);
        const declarado = await subirFotoPanel(ctx, ruta, {
          cookie,
          largoDeclarado: 5 * 1024 * 1024,
          plazoMs: 5000,
        });
        expect([declarado.status, codigoDeRespuesta(declarado)], `${nombre}, 5 MB declarados`).toEqual([
          403,
          'SIN_PERMISO',
        ]);
      }
    }
  });
});
