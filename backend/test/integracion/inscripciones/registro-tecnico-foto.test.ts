// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEXTO_REDACTADO } from '../../../src/infraestructura/registro/opciones-registro';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import {
  AHORA_005,
  crearEscenarioInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  rutaPublica,
  sembrarSolicitud,
  tokenAleatorio,
} from '../../utilidades/inscripciones';
import { desde, pedir } from '../../utilidades/inscripciones-ronda1';
import {
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  jpeg,
  png,
  subirFoto,
  TEXTO_MARCADO,
} from '../../utilidades/inscripciones-005b';

// Criterio 28, parte de la 005b (crítico, criterio 43 de 002, Ley 29733; PB9): el registro técnico de la subida de la foto, con un registro en memoria
// en el nivel `trace`, que sube una foto válida con coordenadas GPS en su EXIF y un comentario con un texto marcado (SECRETO-005B), con las cabeceras
// `X-Token-Solicitud` y `Referer` (la dirección de seguimiento con el token); además, una subida rechazada de cada tipo (400 por tipo de contenido, 400 por
// imagen, 404, 409, 413 y 429). En ninguna línea aparecen el token, el DNI, los nombres o apellidos del alumno, el texto marcado, las coordenadas ni el
// contenido de la imagen (tampoco en base64); `req.headers["x-token-solicitud"]` aparece con TEXTO_REDACTADO. Un `X-Token-Solicitud` enviado a otra ruta (por
// ejemplo `GET /api/a/{nombreCorto}`) también se redacta.

describe('el registro técnico de la subida de la foto no lleva datos sensibles (criterio 28)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppConAlmacen;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({
      nivelRegistro: 'trace',
      destinoRegistro: destino,
      conLimites: true,
      // La IP sale de `X-Forwarded-For`: la primera prueba agota las 10 subidas por hora desde su propia IP y las demás no se ven afectadas
      // (el límite usa el tiempo real, el reloj fijo no lo reinicia).
      ipPorCabecera: true,
      ahora: AHORA_005,
    });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    ctx.vaciarAlmacen();
    e = await crearEscenarioInscripcion();
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  /** Cada valor de `x-token-solicitud` que aparece en una línea está redactado; devuelve cuántos hay. */
  function cabecerasDeTokenRedactadas(todas: readonly string[]): number {
    let cuenta = 0;
    for (const linea of todas) {
      for (const coincidencia of linea.matchAll(/"x-token-solicitud":\s*"((?:[^"\\]|\\.)*)"/g)) {
        expect(coincidencia[1], `x-token-solicitud sin redactar en: ${linea.slice(0, 300)}`).toBe(TEXTO_REDACTADO);
        cuenta += 1;
      }
    }
    return cuenta;
  }

  it('criterio 28: una subida correcta y una rechazada de cada tipo (400 tipo, 400 imagen, 404, 409, 413 y 429) no dejan token, datos del alumno, texto marcado, coordenadas ni contenido de la imagen en el registro', async () => {
    const dni = '47811902';
    const cliente = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id],
      dni,
      nombres: 'Zenobia',
      apellidos: 'Quillahuaman Torrico',
    });
    const cancelada = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id],
      estado: 'CANCELADA',
    });
    const referer = (token: string) => `https://academia.test/a/academia-a/solicitud/${token}`;
    const foto = await jpeg(600, 400, { gps: true, comentario: TEXTO_MARCADO, orientacion: 1 });
    const cabeceras = (token: string) => ({ referer: referer(token), ...desde('203.0.113.28') });
    const subir = (token: string, cuerpo: Buffer, extra: Parameters<typeof subirFoto>[2] = {}) =>
      subirFoto(ctx, 'academia-a', { token, cuerpo, headers: cabeceras(token), tipo: 'image/jpeg', ...extra });

    const correcta = await subir(cliente.token, foto);
    const tipoMalo = await subir(cliente.token, foto, { tipo: 'image/gif' });
    const imagenMala = await subir(cliente.token, png(99, 99), { tipo: 'image/png' });
    const noEncontrada = await subir(tokenAleatorio(), foto);
    const noEditable = await subir(cancelada.token, foto);
    const grande = await subir(cliente.token, Buffer.alloc(8), { largoDeclarado: 6 * 1024 * 1024, plazoMs: 8000 });
    expect([
      correcta.status,
      tipoMalo.status,
      imagenMala.status,
      noEncontrada.status,
      noEditable.status,
      grande.status,
    ]).toEqual([204, 400, 400, 404, 409, 413]);
    // Con 6 subidas hechas, cuatro más agotan las 10 por hora y la siguiente responde 429.
    for (let i = 0; i < 4; i++) await subir(tokenAleatorio(), foto);
    const limite = await subir(cliente.token, foto);
    expect(limite.status, limite.texto).toBe(429);
    await esperarHasta(() => lineas.some((linea) => linea.includes('"statusCode":429')));

    expect(lineas.length, 'la aplicación escribió registros').toBeGreaterThan(0);
    const todo = lineas.join('\n');
    const sensibles: Record<string, string> = {
      token: cliente.token,
      tokenDeLaCancelada: cancelada.token,
      dni,
      nombres: 'Zenobia',
      apellidos: 'Quillahuaman',
      textoMarcado: TEXTO_MARCADO,
      enlaceDeSeguimiento: referer(cliente.token),
      coordenadas: 'GPS',
      latitud: 'GPSLatitude',
      longitud: 'GPSLongitude',
      exif: 'Exif',
    };
    for (const [nombre, valor] of Object.entries(sensibles)) {
      expect(todo, `el registro lleva ${nombre}`).not.toContain(valor);
    }
    // El contenido de la imagen, ni en bruto ni en base64 ni en hexadecimal.
    for (const trozo of [foto.subarray(0, 48), foto.subarray(200, 248), foto.subarray(foto.length - 48)]) {
      expect(todo, 'el registro lleva el contenido de la imagen en base64').not.toContain(trozo.toString('base64'));
      expect(todo, 'el registro lleva el contenido de la imagen en hexadecimal').not.toContain(trozo.toString('hex'));
      expect(todo, 'el registro lleva el contenido de la imagen en base64url').not.toContain(
        trozo.toString('base64url'),
      );
    }
    expect(todo, 'el registro lleva el encabezado JPEG en base64').not.toContain('/9j/4');
    expect(
      cabecerasDeTokenRedactadas(lineas),
      'ninguna línea de petición lleva req.headers["x-token-solicitud"] redactado',
    ).toBeGreaterThan(0);
    expect(todo).toContain(TEXTO_REDACTADO);
    expect(todo, 'la petición se anota con su dirección sin datos').toContain('/solicitudes/foto');
  });

  it('criterio 28: una subida que llega con el token también en el Referer redacta las dos cabeceras, y el valor redactado es TEXTO_REDACTADO', async () => {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });

    const respuesta = await subirFoto(ctx, 'academia-a', {
      token: cliente.token,
      cuerpo: png(100, 100),
      headers: { referer: `https://academia.test/a/academia-a/solicitud/${cliente.token}` },
    });
    expect(respuesta.status).toBe(204);
    await esperarHasta(() => lineas.some((linea) => linea.includes('/solicitudes/foto')));

    const todo = lineas.join('\n');
    expect(todo).not.toContain(cliente.token);
    expect(cabecerasDeTokenRedactadas(lineas)).toBeGreaterThan(0);
    for (const linea of lineas) {
      for (const coincidencia of linea.matchAll(/"referer":\s*"((?:[^"\\]|\\.)*)"/g)) {
        expect(coincidencia[1]).toBe(TEXTO_REDACTADO);
      }
    }
  });

  it('criterio 28: un X-Token-Solicitud enviado a otra ruta (GET /api/a/{nombreCorto}, la consulta, una ruta que no existe y una del panel) también se redacta', async () => {
    const token = tokenAleatorio();
    const conToken = { 'x-token-solicitud': token };
    const peticiones = [
      pedir(ctx, 'GET', rutaPublica('academia-a'), { headers: conToken }),
      pedir(ctx, 'GET', rutaPublica('academia-a', '/inscripcion'), { headers: conToken }),
      pedir(ctx, 'POST', rutaPublica('academia-a', '/solicitudes/consulta'), { headers: conToken, cuerpo: { token } }),
      pedir(ctx, 'GET', rutaPublica('no-existe'), { headers: conToken }),
      pedir(ctx, 'GET', '/api/clases', { headers: conToken }),
    ];
    const estados = (await Promise.all(peticiones)).map((r) => r.status);
    expect(estados.slice(0, 4)).toEqual([200, 200, 404, 404]);
    await esperarHasta(() => lineas.some((linea) => linea.includes('/solicitudes/consulta')));
    await new Promise((resolver) => setTimeout(resolver, 150));

    const todo = lineas.join('\n');
    expect(todo, 'el registro lleva el token').not.toContain(token);
    expect(cabecerasDeTokenRedactadas(lineas)).toBeGreaterThanOrEqual(3);
  });
});
