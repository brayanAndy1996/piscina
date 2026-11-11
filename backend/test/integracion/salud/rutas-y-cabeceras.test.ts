import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorApiSchema } from '@aquagestion/contratos';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';

const NO_ENCONTRADO = { codigo: 'NO_ENCONTRADO', mensaje: 'No se encontró el recurso solicitado.' };

describe('rutas inexistentes y métodos no definidos', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await crearAppDePruebas();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([
    { metodo: 'get', ruta: '/salud', caso: 'una ruta fuera de /api' },
    { metodo: 'get', ruta: '/', caso: 'la raíz' },
    { metodo: 'get', ruta: '/api/no-existe', caso: 'una ruta inexistente de la API' },
    { metodo: 'post', ruta: '/api/salud', caso: 'un método no definido' },
    { metodo: 'delete', ruta: '/api/salud', caso: 'otro método no definido' },
  ] as const)('$metodo $ruta responde 404 con ErrorApi ($caso)', async ({ metodo, ruta }) => {
    const respuesta = await request(app.getHttpServer())[metodo](ruta);

    expect(respuesta.status).toBe(404);
    expect(errorApiSchema.parse(respuesta.body)).toEqual(NO_ENCONTRADO);
  });
});

describe('cabeceras de seguridad y CORS cerrado', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await crearAppDePruebas();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['una respuesta correcta', '/api/salud'],
    ['un 404 de la API', '/api/no-existe'],
    ['un 404 fuera de /api', '/salud'],
  ])('%s trae las cabeceras de helmet, sin X-Powered-By y sin CORS', async (_nombre, ruta) => {
    const respuesta = await request(app.getHttpServer()).get(ruta).set('Origin', 'https://otro.ejemplo');

    expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
    expect(respuesta.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(respuesta.headers['x-powered-by']).toBeUndefined();
    expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('no responde a la petición previa de CORS con permisos', async () => {
    const respuesta = await request(app.getHttpServer())
      .options('/api/salud')
      .set('Origin', 'https://otro.ejemplo')
      .set('Access-Control-Request-Method', 'GET');

    expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
    expect(respuesta.headers['access-control-allow-methods']).toBeUndefined();
  });
});
