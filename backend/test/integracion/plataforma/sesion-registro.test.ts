// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { OTRA_CLAVE_SUPERADMIN_PRUEBAS, crearSuperadminDePrueba } from '../../utilidades/superadmins';

// Criterio 46: la clave no aparece en ningún registro del log, en ningún nivel. nestjs-pino crea un único registrador
// por proceso, por eso este archivo tiene una sola aplicación con el destino de registros en memoria.
describe('criterio 46: la clave no aparece en el log', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let app: NestExpressApplication;

  beforeAll(async () => {
    await limpiarBase();
    app = await crearAppDePruebas({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  afterAll(async () => {
    await app.close();
  });

  it('criterio 46: ni con inicios de sesión correctos ni con fallidos ni con cuerpos inválidos', async () => {
    const claveCorrecta = OTRA_CLAVE_SUPERADMIN_PRUEBAS;
    const claveFallida = 'Clave-Fallida-Unica-98765';
    const claveInvalida = `Invalida-Unica-${'z'.repeat(130)}`;
    const superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test', clave: claveCorrecta });
    const servidor = app.getHttpServer();

    const correcto = await request(servidor)
      .post('/api/plataforma/sesion')
      .send({ correo: superadmin.correo, clave: claveCorrecta });
    const fallido = await request(servidor)
      .post('/api/plataforma/sesion')
      .send({ correo: superadmin.correo, clave: claveFallida });
    const inexistente = await request(servidor)
      .post('/api/plataforma/sesion')
      .send({ correo: 'nadie@aquagestion.test', clave: claveFallida });
    const invalido = await request(servidor)
      .post('/api/plataforma/sesion')
      .send({ correo: superadmin.correo, clave: claveInvalida });
    expect([correcto.status, fallido.status, inexistente.status, invalido.status]).toEqual([200, 401, 401, 400]);
    await esperarHasta(() => lineas.length >= 4);

    expect(lineas.length, 'la aplicación no escribió ningún registro').toBeGreaterThan(0);
    const todo = lineas.join('\n');
    for (const clave of [claveCorrecta, claveFallida, claveInvalida]) expect(todo).not.toContain(clave);
    expect(todo).not.toContain('$argon2');
  });

  it('criterio 46: el token de sesión y la cookie tampoco aparecen en el log', async () => {
    const servidor = app.getHttpServer();
    const respuesta = await request(servidor)
      .post('/api/plataforma/sesion')
      .send({ correo: 'dueno@aquagestion.test', clave: OTRA_CLAVE_SUPERADMIN_PRUEBAS });
    expect(respuesta.status).toBe(200);
    const cookie = String((respuesta.headers['set-cookie'] as string[] | undefined)?.[0] ?? '');
    const token = cookie.split(';')[0]?.split('=')[1] ?? '';
    expect(token.length).toBeGreaterThan(20);
    await request(servidor).get('/api/plataforma/sesion').set('Cookie', `aq_plataforma=${token}`);
    await esperarHasta(() => lineas.length >= 6);

    expect(lineas.join('\n')).not.toContain(token);
  });
});
