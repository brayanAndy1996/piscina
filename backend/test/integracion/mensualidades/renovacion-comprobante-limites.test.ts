// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AHORA_007,
  codigoDeRespuesta,
  crearEscenarioDePagos,
  type EscenarioPagos,
  exigirRutasDePagos,
} from '../../utilidades/escenario-pagos';
import { datosDeComprobante, exigirRutasDe007b, subirComprobante } from '../../utilidades/escenario-pagos-007b';
import {
  crearAlumnoDeNoviembre,
  datosComprobanteRenovacion,
  exigirRutasDe010a,
  INSTANTES,
  renovarConComprobante,
  seleccionDeDiciembre,
} from '../../utilidades/escenario-renovacion';
import { type RespuestaApi, tokenAleatorio } from '../../utilidades/inscripciones';
import { type AppConAlmacen, crearAppConAlmacen, exigirAlmacen } from '../../utilidades/inscripciones-005b';
import { cookieDeUsuario } from '../../utilidades/usuarios';

// Criterio 7, última regla (crítico, criterios 74 y 75 de 001, criterio 33 de 005, criterio 43 de 007): «Esta ruta no cuenta en `LIMITES_PUBLICOS`». El comprobante público (`PUT /api/a/{nombreCorto}/solicitudes/comprobante`) tiene 10 peticiones por hora por conexión
// con su propio contador; la ruta de la renovación (`PUT /api/alumnos/{id}/renovacion/comprobante`) es de personal con sesión y no lo consume ni lo recibe: ni 429 ni un contador compartido.
// Pruebas con el almacén real de límites por IP (`conLimites`), desde la misma conexión: (1) doce peticiones de la renovación (correcta y rechazadas con 400, 401, 403, 404, 409 y 413) no responden 429; (2) esas peticiones no gastaron nada del contador del comprobante público:
// después de ellas la conexión hace sus 10 subidas públicas (404, sin 429) y la 11.ª responde 429; (3) con el contador público agotado, la renovación sigue respondiendo (201).

describe('la ruta del comprobante de la renovación no cuenta en los límites públicos (criterio 7)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  let secretaria: string;
  let entrenador: string;

  beforeEach(async () => {
    e = await crearEscenarioDePagos();
    ctx = await crearAppConAlmacen({ conLimites: true, ahora: AHORA_007 });
    exigirAlmacen(ctx);
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
    exigirRutasDe010a(ctx.app);
    ctx.reloj.fijar(INSTANTES.viernes27);
    secretaria = cookieDeUsuario(e.secretariaA, INSTANTES.viernes27);
    entrenador = cookieDeUsuario(e.entrenadorA, INSTANTES.viernes27);
  });
  afterEach(async () => {
    await ctx?.cerrarTodo();
  });

  const esc = () => ({ e });
  const datos = () => datosComprobanteRenovacion(seleccionDeDiciembre(esc()), '120.00', '2026-11-27');
  /** Una subida pública cualquiera, con un token que no existe: sin el límite, responde 404. */
  const publica = (): Promise<RespuestaApi> =>
    subirComprobante(ctx, 'academia-a', { token: tokenAleatorio(), datos: datosDeComprobante() });

  async function repetir(n: number, hacer: (i: number) => Promise<RespuestaApi>): Promise<number[]> {
    const estados: number[] = [];
    for (let i = 0; i < n; i++) estados.push((await hacer(i)).status);
    return estados;
  }

  /** Doce peticiones de la renovación: una correcta y once rechazadas con cada código posible de la ruta. */
  async function docePeticionesDeLaRenovacion(): Promise<number[]> {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc());
    const otro = await crearAlumnoDeNoviembre(ctx, esc());
    const intentos: (() => Promise<RespuestaApi>)[] = [
      () => renovarConComprobante(ctx, alumno.alumnoId, { cookie: secretaria, datos: datos() }), // 201
      () => renovarConComprobante(ctx, alumno.alumnoId, { cookie: secretaria, datos: datos() }), // 409 MENSUALIDAD_YA_REGISTRADA
      () => renovarConComprobante(ctx, alumno.alumnoId, { cookie: secretaria, datos: datos() }), // 409
      () => renovarConComprobante(ctx, otro.alumnoId, { cookie: secretaria, datos: datos(), tipo: 'image/gif' }), // 400 IMAGEN_NO_VALIDA
      () => renovarConComprobante(ctx, otro.alumnoId, { cookie: secretaria, datos: null }), // 400 SOLICITUD_INVALIDA
      () =>
        renovarConComprobante(ctx, otro.alumnoId, {
          cookie: secretaria,
          datos: datos(),
          cuerpo: Buffer.from('basura'),
        }), // 400
      () => renovarConComprobante(ctx, randomUUID(), { cookie: secretaria, datos: datos() }), // 404
      () => renovarConComprobante(ctx, 'no-es-un-uuid', { cookie: secretaria, datos: datos() }), // 404
      () => renovarConComprobante(ctx, otro.alumnoId, { cookie: entrenador, datos: datos() }), // 403
      () => renovarConComprobante(ctx, otro.alumnoId, { datos: datos() }), // 401
      () =>
        renovarConComprobante(ctx, otro.alumnoId, {
          cookie: secretaria,
          datos: datos(),
          cuerpo: Buffer.alloc(8),
          largoDeclarado: 6 * 1024 * 1024,
          plazoMs: 8000,
        }), // 413
      () => renovarConComprobante(ctx, otro.alumnoId, { cookie: secretaria, datos: datos() }), // 201
    ];
    return repetir(intentos.length, (i) => (intentos[i] as () => Promise<RespuestaApi>)());
  }

  it('criterio 7: doce peticiones de la renovación desde la misma conexión (correctas y rechazadas con 400, 401, 403, 404, 409 y 413) no reciben ningún 429', async () => {
    const estados = await docePeticionesDeLaRenovacion();

    expect(estados).toEqual([201, 409, 409, 400, 400, 400, 404, 404, 403, 401, 413, 201]);
  });

  it('criterio 7: las peticiones de la renovación no gastan nada del contador del comprobante público: después de ellas, la conexión hace sus 10 subidas públicas (404, sin 429) y la 11.ª responde 429 DEMASIADAS_SOLICITUDES', async () => {
    await docePeticionesDeLaRenovacion();

    const estados = await repetir(10, () => publica());

    expect(estados).toEqual(new Array<number>(10).fill(404));
    const onceava = await publica();
    expect(onceava.status, onceava.texto).toBe(429);
    expect(codigoDeRespuesta(onceava)).toBe('DEMASIADAS_SOLICITUDES');
  });

  it('criterio 7: con el contador del comprobante público agotado (429), la renovación sigue registrando (201) desde la misma conexión', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc());
    await repetir(10, () => publica());
    expect((await publica()).status, 'el contador público debía estar agotado').toBe(429);

    const respuesta = await renovarConComprobante(ctx, alumno.alumnoId, { cookie: secretaria, datos: datos() });

    expect(respuesta.status, respuesta.texto).toBe(201);
  });

  it('criterio 7: más de diez renovaciones correctas por Yape en una hora (el tope público) siguen respondiendo 201', async () => {
    const alumnos: Awaited<ReturnType<typeof crearAlumnoDeNoviembre>>[] = [];
    for (let i = 0; i < 12; i++) alumnos.push(await crearAlumnoDeNoviembre(ctx, esc()));

    const estados = await repetir(12, (i) =>
      renovarConComprobante(ctx, (alumnos[i] as (typeof alumnos)[number]).alumnoId, {
        cookie: secretaria,
        datos: datos(),
      }),
    );

    expect(estados).toEqual(new Array<number>(12).fill(201));
  });
});
