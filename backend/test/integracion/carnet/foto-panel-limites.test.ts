// spec: 008-carnet-qr (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  patronDeClave,
  rutaFotoAlumno,
  rutaFotoSolicitud,
  subirFotoPanel,
  exigirRutasDe008b,
} from '../../utilidades/escenario-foto-panel';
import {
  AHORA_005,
  codigoDe,
  crearEscenarioInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  type RespuestaApi,
  sembrarSolicitud,
  tokenAleatorio,
} from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  fotoClaveDe,
  png,
  subirFoto,
} from '../../utilidades/inscripciones-005b';
import { cookieDeUsuario } from '../../utilidades/usuarios';

// Criterio 24 (crítico, criterios 74 y 75 de 001, criterio 33 de 005): «Estas rutas no cuentan en los límites por conexión de las rutas públicas (`LIMITES_PUBLICOS`)». La foto pública (`PUT /api/a/{nombreCorto}/solicitudes/foto`) tiene 10 peticiones por hora por
// conexión, con su propio contador; las dos rutas del panel (`PUT /api/alumnos/{id}/foto` y `PUT /api/solicitudes/{id}/foto`) son de personal con sesión y no lo consumen ni lo reciben: ni 429 ni un contador compartido.
// Pruebas, con el almacén real de límites por IP (`conLimites`), desde la misma conexión: (1) 15 subidas del panel (correctas y rechazadas con 400, 403, 404, 409 y 413) no responden 429; (2) esas subidas no gastaron nada del contador de la foto pública: después de
// ellas, la conexión todavía puede hacer sus 10 subidas públicas y la 11.ª responde 429; (3) con el contador público agotado, el panel sigue respondiendo (204), y (4) un 429 de la foto pública no llega al panel (la subida del panel con un cuerpo válido sigue en 204).
// Lectura estricta elegida: el contador de la foto pública cuenta cada petición, sea cual sea su resultado (criterio 33 de 005); por eso «no gastó nada» se comprueba con las 10 peticiones públicas completas después de las del panel.

describe('las rutas de la foto del panel no cuentan en los límites públicos (criterio 24)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioInscripcion;

  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    e = await crearEscenarioInscripcion();
    ctx = await crearAppConAlmacen({ conLimites: true, ahora: AHORA_005 });
    exigirAlmacen(ctx);
    exigirRutasDe008b(ctx.app);
  });
  afterEach(async () => {
    await ctx?.cerrarTodo();
  });

  const secretaria = () => cookieDeUsuario(e.secretariaA, AHORA_005);
  const entrenador = () => cookieDeUsuario(e.entrenadorA, AHORA_005);

  /** Una subida pública cualquiera, con un token que no existe: sin el límite, responde 404. */
  const publica = (): Promise<RespuestaApi> =>
    subirFoto(ctx, 'academia-a', { token: tokenAleatorio(), cuerpo: png(100, 100) });

  async function repetir(n: number, hacer: (i: number) => Promise<RespuestaApi>): Promise<number[]> {
    const estados: number[] = [];
    for (let i = 0; i < n; i++) estados.push((await hacer(i)).status);
    return estados;
  }

  /** 15 peticiones del panel: correctas (204) y rechazadas con cada código posible de las dos rutas. */
  async function quinceDelPanel(): Promise<number[]> {
    const alumno = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id],
      estadoAlumno: 'ALUMNO_ACTIVO',
    });
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    const cancelada = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id],
      estado: 'CANCELADA',
    });
    const intentos: (() => Promise<RespuestaApi>)[] = [
      () => subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: secretaria() }), // 204
      () => subirFotoPanel(ctx, rutaFotoSolicitud(cliente.solicitudId), { cookie: secretaria() }), // 204
      () => subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: secretaria(), cuerpo: png(120, 120) }), // 204
      () => subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: secretaria(), tipo: 'image/gif' }), // 400
      () =>
        subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: secretaria(), cuerpo: Buffer.from('basura') }), // 400
      () => subirFotoPanel(ctx, rutaFotoAlumno(randomUUID()), { cookie: secretaria() }), // 404
      () => subirFotoPanel(ctx, rutaFotoSolicitud(randomUUID()), { cookie: secretaria() }), // 404
      () => subirFotoPanel(ctx, rutaFotoAlumno(cliente.alumnoId), { cookie: secretaria() }), // 404 (un CLIENTE)
      () => subirFotoPanel(ctx, rutaFotoSolicitud(cancelada.solicitudId), { cookie: secretaria() }), // 409
      () => subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: entrenador() }), // 403
      () => subirFotoPanel(ctx, rutaFotoSolicitud(cliente.solicitudId), { cookie: entrenador() }), // 403
      () => subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cuerpo: png(100, 100) }), // 401
      () =>
        subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), {
          cookie: secretaria(),
          cuerpo: Buffer.alloc(8),
          largoDeclarado: 6 * 1024 * 1024,
          plazoMs: 8000,
        }), // 413
      () =>
        subirFotoPanel(ctx, rutaFotoSolicitud(cliente.solicitudId), { cookie: secretaria(), cuerpo: png(130, 130) }), // 204
      () => subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: secretaria(), cuerpo: png(140, 140) }), // 204
    ];
    return repetir(intentos.length, (i) => (intentos[i] as () => Promise<RespuestaApi>)());
  }

  it('criterio 24: quince subidas del panel desde la misma conexión (correctas y rechazadas con 400, 401, 403, 404, 409 y 413) no reciben ningún 429', async () => {
    const estados = await quinceDelPanel();

    expect(estados).toEqual([204, 204, 204, 400, 400, 404, 404, 404, 409, 403, 403, 401, 413, 204, 204]);
  });

  it('criterio 24: las subidas del panel no gastan nada del contador de la foto pública: después de ellas, la conexión hace sus 10 subidas públicas (404, sin 429) y la 11.ª responde 429 DEMASIADAS_SOLICITUDES', async () => {
    await quinceDelPanel();

    const estados = await repetir(10, () => publica());

    expect(estados.filter((estado) => estado === 429)).toEqual([]);
    expect(estados).toEqual(new Array<number>(10).fill(404));
    const onceava = await publica();
    expect(onceava.status, onceava.texto).toBe(429);
    expect(codigoDe(onceava)).toBe('DEMASIADAS_SOLICITUDES');
  });

  it('criterio 24: con el contador de la foto pública agotado (429), el panel sigue subiendo fotos (204) desde la misma conexión, también las dos rutas y los rechazos propios (404, 409, 403)', async () => {
    const alumno = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id],
      estadoAlumno: 'ALUMNO_ACTIVO',
    });
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    await repetir(10, () => publica());
    expect((await publica()).status, 'el contador público debía estar agotado').toBe(429);

    const respuestas = [
      await subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: secretaria() }),
      await subirFotoPanel(ctx, rutaFotoSolicitud(cliente.solicitudId), { cookie: secretaria() }),
      await subirFotoPanel(ctx, rutaFotoAlumno(randomUUID()), { cookie: secretaria() }),
      await subirFotoPanel(ctx, rutaFotoSolicitud(cliente.solicitudId), { cookie: entrenador() }),
      await subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: secretaria(), tipo: 'image/gif' }),
    ];

    expect(respuestas.map((r) => r.status)).toEqual([204, 204, 404, 403, 400]);
    expect(await fotoClaveDe(e.A.id, alumno.alumnoId)).toMatch(patronDeClave(e.A.id, alumno.alumnoId));
    expect(await fotoClaveDe(e.A.id, cliente.alumnoId)).toMatch(patronDeClave(e.A.id, cliente.alumnoId));
  });

  it('criterio 24: más de diez subidas correctas del panel en una hora (el tope público) siguen respondiendo 204', async () => {
    const alumno = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id],
      estadoAlumno: 'ALUMNO_ACTIVO',
    });

    const estados = await repetir(12, (i) =>
      subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: secretaria(), cuerpo: png(100 + i, 100) }),
    );

    expect(estados).toEqual(new Array<number>(12).fill(204));
  });
});
