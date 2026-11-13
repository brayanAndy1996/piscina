import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';

interface ErrorCuerpo {
  codigo: string;
}

// Pruebas complementarias de los criterios 45, 58 y 59 (P-4, P-7 y P-8): direcciones mal formadas y orden de los
// middlewares de prefijo.
describe('rutas públicas y protección de los prefijos', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
  });
  beforeEach(async () => {
    await limpiarBase();
    await crearAcademiaDePrueba({ nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each(['%FF', '%E0%A4%A', 'delfines%FF', '%'])(
    'criterio 59: la dirección /api/a/%s con un % mal formado responde 404 ACADEMIA_NO_ENCONTRADA',
    async (segmento) => {
      const respuesta = await request(app.getHttpServer()).get(`/api/a/${segmento}`);

      expect(respuesta.status).toBe(404);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_NO_ENCONTRADA');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    },
  );

  it.each(['/api/PLATAFORMA/academias', '/api/Plataforma/sesion', '/api/plataforma//academias', '/api/plataforma/%FF'])(
    'criterio 45: %s sin sesión responde 401 NO_AUTENTICADO con Cache-Control: no-store',
    async (ruta) => {
      const respuesta = await request(app.getHttpServer()).get(ruta);

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    },
  );

  it('criterio 45: sin sesión, un cuerpo JSON roto en una ruta protegida responde 401 y no 400 (no se lee el cuerpo)', async () => {
    const respuesta = await request(app.getHttpServer())
      .post('/api/plataforma/academias')
      .set('Content-Type', 'application/json')
      .send('{"nombre": ');

    expect(respuesta.status).toBe(401);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
  });

  it('criterio 45: HEAD y OPTIONS sobre una ruta protegida sin sesión responden 401', async () => {
    const servidor = app.getHttpServer();

    expect((await request(servidor).head('/api/plataforma/academias')).status).toBe(401);
    expect((await request(servidor).options('/api/plataforma/academias')).status).toBe(401);
  });

  it('criterio 36 y 44: POST y DELETE sobre /api/plataforma/sesion/ (con barra final) siguen siendo públicos', async () => {
    const servidor = app.getHttpServer();

    const ingreso = await request(servidor)
      .post('/api/plataforma/sesion/')
      .send({ correo: 'nadie@aquagestion.test', clave: 'clave-equivocada-123' });
    const cierre = await request(servidor).delete('/api/plataforma/sesion/');

    expect(ingreso.status).toBe(401);
    expect((ingreso.body as ErrorCuerpo).codigo).toBe('CREDENCIALES_INVALIDAS');
    expect(cierre.status).toBe(204);
  });
});
