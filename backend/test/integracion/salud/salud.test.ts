import net from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { respuestaSaludSchema } from '@aquagestion/contratos';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';

/** Obtiene un puerto libre de 127.0.0.1 y lo cierra, para apuntar a "una base que no está". */
async function puertoCerrado(): Promise<number> {
  const servidor = net.createServer();
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const direccion = servidor.address();
  const puerto = typeof direccion === 'object' && direccion ? direccion.port : 0;
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  return puerto;
}

describe('GET /api/salud con la base de pruebas encendida', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await crearAppDePruebas();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('responde 200 con no-store y el cuerpo válido según respuestaSaludSchema', async () => {
    const respuesta = await request(app.getHttpServer()).get('/api/salud');

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers['cache-control']).toBe('no-store');
    expect(respuestaSaludSchema.parse(respuesta.body)).toEqual({ estado: 'ok', baseDatos: 'ok' });
  });

  it('no deja la respuesta en caché aunque el cliente pregunte por una versión anterior', async () => {
    const primera = await request(app.getHttpServer()).get('/api/salud');
    const segunda = await request(app.getHttpServer())
      .get('/api/salud')
      .set('If-None-Match', String(primera.headers['etag'] ?? '"x"'));

    expect(segunda.status).toBe(200);
  });
});

describe('GET /api/salud con la base apagada', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const puerto = await puertoCerrado();
    // La API arranca igual: crear e inicializar la aplicación no necesita la base.
    app = await crearAppDePruebas({
      variables: { DATABASE_URL_APP: `postgresql://usuario:clave@127.0.0.1:${puerto}/base_inexistente` },
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('responde 503 en menos de 3 segundos, sin detalles de la conexión', async () => {
    const inicio = performance.now();
    const respuesta = await request(app.getHttpServer()).get('/api/salud');
    const duracion = performance.now() - inicio;

    expect(respuesta.status).toBe(503);
    expect(duracion).toBeLessThan(3000);
    expect(respuesta.headers['cache-control']).toBe('no-store');
    expect(respuestaSaludSchema.parse(respuesta.body)).toEqual({ estado: 'error', baseDatos: 'error' });

    const texto = respuesta.text;
    for (const secreto of [
      '127.0.0.1',
      'localhost',
      'postgresql',
      'ECONNREFUSED',
      'clave',
      'usuario',
      'base_inexistente',
    ]) {
      expect(texto).not.toContain(secreto);
    }
  });
});
