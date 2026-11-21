// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cookieDeUsuario, AHORA_PRUEBAS } from '../../utilidades/usuarios';
import {
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  fotoClaveDe,
  png,
  subirFoto,
} from '../../utilidades/inscripciones-005b';
import {
  AHORA_005,
  crearEscenarioInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';
import { pedir } from '../../utilidades/inscripciones-ronda1';

// Criterio 36 (crítico, D-21, D-23; PB7): ninguna ruta de la API ni del servidor de la web sirve el directorio del almacén:
// `GET /api/almacenamiento/{clave}`, `GET /almacenamiento/{clave}` y `GET /{clave}` responden 404 y nunca el contenido.

describe('el directorio del almacén no se sirve (criterio 36)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ ahora: AHORA_005 });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    ctx.vaciarAlmacen();
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  it('criterio 36: con una foto guardada, ninguna de las tres direcciones sirve el archivo ni, con la sesión del administrador o sin ella, responde algo distinto de 404 (sin sesión, la API puede pedirla: 401)', async () => {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    const respuestaDeSubida = await subirFoto(ctx, 'academia-a', { token: cliente.token, cuerpo: png(100, 100) });
    expect(respuestaDeSubida.status, respuestaDeSubida.texto).toBe(204);
    const clave = (await fotoClaveDe(e.A.id, cliente.alumnoId)) as string;
    expect(clave).toBeTruthy();
    const cookieAdmin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    const rutas = [
      { ruta: `/api/almacenamiento/${clave}`, sinSesion: [401, 404] },
      { ruta: `/almacenamiento/${clave}`, sinSesion: [404] },
      { ruta: `/${clave}`, sinSesion: [404] },
      { ruta: `/api/${clave}`, sinSesion: [401, 404] },
      { ruta: `/api/a/academia-a/${clave}`, sinSesion: [404] },
    ];

    for (const { ruta, sinSesion } of rutas) {
      const anonimo = await pedir(ctx, 'GET', ruta);
      const conSesion = await pedir(ctx, 'GET', ruta, { headers: { cookie: cookieAdmin } });

      expect(sinSesion, `${ruta} sin sesión respondió ${anonimo.status}`).toContain(anonimo.status);
      expect(conSesion.status, `${ruta} con sesión: ${conSesion.texto.slice(0, 80)}`).toBe(404);
      for (const respuesta of [anonimo, conSesion]) {
        expect(respuesta.texto, `${ruta} devolvió el contenido`).not.toContain('JFIF');
        expect(respuesta.headers.get('content-type') ?? '').not.toMatch(/^image\//);
      }
    }
  });

  it('criterio 36: la carpeta del almacén o su raíz tampoco se sirven', async () => {
    for (const ruta of [
      '/api/almacenamiento',
      '/api/almacenamiento/',
      '/almacenamiento',
      '/almacenamiento/',
      '/academias/',
      `/academias/${e.A.id}/`,
    ]) {
      const respuesta = await pedir(ctx, 'GET', ruta, {
        headers: { cookie: cookieDeUsuario(e.adminA, AHORA_PRUEBAS) },
      });

      expect(respuesta.status, ruta).toBe(404);
    }
  });
});
