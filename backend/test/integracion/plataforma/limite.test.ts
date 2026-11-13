// spec: 001-academias-aislamiento (pruebas protegidas)
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerSuperadmin } from '../../utilidades/datos';
import { cookieDePlataforma, crearSuperadminDePrueba, type SuperadminDePrueba } from '../../utilidades/superadmins';

// Criterio 41: como máximo 10 peticiones de inicio de sesión por IP cada 60 segundos. El limitador usa su propio reloj:
// cada prueba crea su aplicación y por eso arranca con el contador en cero.
describe('criterio 41: límite de inicio de sesión por IP', () => {
  const apps: NestExpressApplication[] = [];
  let superadmin: SuperadminDePrueba;

  async function crearApp(): Promise<NestExpressApplication> {
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    apps.push(app);
    return app;
  }

  beforeEach(async () => {
    await limpiarBase();
    superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });
  });
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  /** 10 peticiones que no cuentan como intento del superadmin real (correos que no existen). */
  async function agotarElLimite(servidor: Server): Promise<number[]> {
    const estados: number[] = [];
    for (let i = 1; i <= 10; i++) {
      const respuesta = await request(servidor)
        .post('/api/plataforma/sesion')
        .send({ correo: `nadie${i}@aquagestion.test`, clave: 'clave-equivocada-123' });
      estados.push(respuesta.status);
    }
    return estados;
  }

  it('criterio 41: las primeras 10 peticiones no reciben 429 y de la 11.ª en adelante responden 429 DEMASIADAS_SOLICITUDES, aunque la clave sea correcta', async () => {
    const app = await crearApp();
    const servidor = app.getHttpServer();

    const primeras = await agotarElLimite(servidor);
    const onceava = await request(servidor)
      .post('/api/plataforma/sesion')
      .send({ correo: superadmin.correo, clave: superadmin.clave });
    const doceava = await request(servidor)
      .post('/api/plataforma/sesion')
      .send({ correo: superadmin.correo, clave: superadmin.clave });

    expect(
      primeras.every((estado) => estado === 401),
      `estados: ${primeras.join(',')}`,
    ).toBe(true);
    for (const respuesta of [onceava, doceava]) {
      expect(respuesta.status).toBe(429);
      expect((respuesta.body as { codigo: string }).codigo).toBe('DEMASIADAS_SOLICITUDES');
      expect(cookieDePlataforma(respuesta.headers)).toBeUndefined();
    }
  });

  it('criterio 41: una petición rechazada por el límite no cuenta como intento fallido', async () => {
    const app = await crearApp();
    const servidor = app.getHttpServer();
    await agotarElLimite(servidor);

    for (let i = 0; i < 3; i++) {
      const respuesta = await request(servidor)
        .post('/api/plataforma/sesion')
        .send({ correo: superadmin.correo, clave: 'clave-equivocada-123' });
      expect(respuesta.status).toBe(429);
    }

    const fila = await leerSuperadmin(superadmin.id);
    expect(fila?.intentos_fallidos).toBe(0);
    expect(fila?.bloqueado_hasta).toBeNull();
  });

  it('criterio 41: las peticiones inválidas (400) también cuentan para el límite', async () => {
    const app = await crearApp();
    const servidor = app.getHttpServer();
    for (let i = 0; i < 10; i++) {
      const respuesta = await request(servidor).post('/api/plataforma/sesion').send({ correo: 'no-es-un-correo' });
      expect(respuesta.status).toBe(400);
    }

    const respuesta = await request(servidor).post('/api/plataforma/sesion').send({ correo: 'no-es-un-correo' });

    expect(respuesta.status).toBe(429);
  });

  it('criterio 41: el límite solo afecta a POST /api/plataforma/sesion', async () => {
    const app = await crearApp();
    const servidor = app.getHttpServer();
    await agotarElLimite(servidor);

    const consulta = await request(servidor).get('/api/plataforma/sesion');
    const cierre = await request(servidor).delete('/api/plataforma/sesion');
    const salud = await request(servidor).get('/api/salud');

    expect(consulta.status).toBe(401);
    expect(cierre.status).toBe(204);
    expect(salud.status).toBe(200);
  });

  it('criterio 41: con una aplicación nueva (contador en cero) la clave correcta entra', async () => {
    const primera = await crearApp();
    await agotarElLimite(primera.getHttpServer());

    const nueva = await crearApp();
    const respuesta = await request(nueva.getHttpServer())
      .post('/api/plataforma/sesion')
      .send({ correo: superadmin.correo, clave: superadmin.clave });

    expect(respuesta.status).toBe(200);
  });
});
