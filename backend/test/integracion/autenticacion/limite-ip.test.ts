// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLAVE_COMUN,
  cookieDeAcademia,
  crearAppConReloj,
  crearEscenario,
  type ErrorCuerpo,
  type Escenario,
  fijarEstadoDeAcademia,
  leerUsuario,
  pedir,
} from '../../utilidades/usuarios';

// Criterio 12: como máximo 10 peticiones de `POST /api/a/{cualquier nombre corto}/sesion` por IP cada 60 segundos, sumando todas
// las academias. El limitador usa su propio reloj: cada prueba crea su aplicación y arranca con el contador en cero.

describe('criterio 12: límite de ingresos por IP', () => {
  let app: NestExpressApplication;
  let e: Escenario;

  const ingresar = (nombreCorto: string, usuario: string, clave: string) =>
    pedir(app, 'post', `/api/a/${nombreCorto}/sesion`, { cuerpo: { usuario, clave } });

  /** 10 peticiones repartidas entre las academias, inexistentes y suspendidas, ninguna con la clave correcta de un usuario real. */
  async function agotarElLimite(): Promise<number[]> {
    await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');
    const peticiones = [
      ingresar('academia-a', '99999991', 'clave-equivocada-123'),
      ingresar('academia-a', '99999992', 'clave-equivocada-123'),
      ingresar('academia-a', '99999993', 'clave-equivocada-123'),
      ingresar('academia-b', '99999994', 'clave-equivocada-123'),
      ingresar('academia-b', '99999995', 'clave-equivocada-123'),
      ingresar('no-existe', '99999996', 'clave-equivocada-123'),
      ingresar('no-existe', '99999997', 'clave-equivocada-123'),
      pedir(app, 'post', '/api/a/academia-a/sesion', { cuerpo: { usuario: 'no-es-un-dni', clave: 'x' } }),
      pedir(app, 'post', '/api/a/academia-a/sesion', { cuerpo: { usuario: 'no-es-un-dni', clave: 'x' } }),
      pedir(app, 'post', '/api/a/otra-academia/sesion', { cuerpo: { usuario: 'no-es-un-dni', clave: 'x' } }),
    ];
    const estados: number[] = [];
    // En orden, para que el conteo no dependa de la concurrencia.
    for (const peticion of peticiones) estados.push((await peticion).status);
    return estados;
  }

  beforeEach(async () => {
    e = await crearEscenario();
    ({ app } = await crearAppConReloj());
  });
  afterEach(async () => {
    await app?.close();
  });

  it('criterio 12: las primeras 10 peticiones (de cualquier academia) no reciben 429 y de la 11.ª en adelante responden 429 DEMASIADAS_SOLICITUDES, aunque la clave sea correcta', async () => {
    const primeras = await agotarElLimite();

    const onceava = await ingresar('academia-a', e.secretariaA.dni, CLAVE_COMUN);
    const doceava = await ingresar('academia-b', e.secretariaB.dni, CLAVE_COMUN);

    expect(primeras.filter((estado) => estado === 429)).toEqual([]);
    for (const respuesta of [onceava, doceava]) {
      expect(respuesta.status).toBe(429);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('DEMASIADAS_SOLICITUDES');
      expect(cookieDeAcademia(respuesta.headers)).toBeUndefined();
      expect(respuesta.headers['cache-control']).toBe('no-store');
    }
  });

  it('criterio 12: la petición rechazada por el límite no cuenta como intento fallido', async () => {
    await agotarElLimite();

    for (let i = 0; i < 3; i++) {
      const respuesta = await ingresar('academia-a', e.secretariaA.dni, 'clave-equivocada-123');
      expect(respuesta.status).toBe(429);
    }

    const fila = await leerUsuario(e.A.id, e.secretariaA.id);
    expect(fila?.intentos_fallidos).toBe(0);
    expect(fila?.bloqueado_hasta).toBeNull();
  });

  it('criterio 12: cuenta antes de buscar la academia: la 11.ª con un nombre corto inexistente responde 429 y no 404', async () => {
    await agotarElLimite();

    const respuesta = await ingresar('no-existe', '99999999', 'clave-equivocada-123');

    expect(respuesta.status).toBe(429);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('DEMASIADAS_SOLICITUDES');
  });

  it('criterio 12: cuenta antes de leer el cuerpo: la 11.ª con un JSON roto o un tipo que no es JSON responde 429 y no 400', async () => {
    await agotarElLimite();

    const roto = await pedir(app, 'post', '/api/a/academia-a/sesion')
      .set('Content-Type', 'application/json')
      .send('{"usuario": ');
    const texto = await pedir(app, 'post', '/api/a/academia-a/sesion').set('Content-Type', 'text/plain').send('hola');

    expect(roto.status).toBe(429);
    expect(texto.status).toBe(429);
  });

  it('criterio 12: las peticiones inválidas (400) también cuentan para el límite', async () => {
    for (let i = 0; i < 10; i++) {
      const respuesta = await pedir(app, 'post', '/api/a/academia-a/sesion', { cuerpo: { usuario: 'no-es-un-dni' } });
      expect(respuesta.status).toBe(400);
    }

    const respuesta = await pedir(app, 'post', '/api/a/academia-a/sesion', { cuerpo: { usuario: 'no-es-un-dni' } });

    expect(respuesta.status).toBe(429);
  });

  it('criterio 12: el límite solo afecta a POST /api/a/{nombreCorto}/sesion', async () => {
    await agotarElLimite();

    const academia = await pedir(app, 'get', '/api/a/academia-a');
    const sesion = await pedir(app, 'get', '/api/sesion');
    const cierre = await pedir(app, 'delete', '/api/sesion');
    const salud = await pedir(app, 'get', '/api/salud');

    expect(academia.status).toBe(200);
    expect(sesion.status).toBe(401);
    expect(cierre.status).toBe(204);
    expect(salud.status).toBe(200);
  });

  it('criterio 12: con una aplicación nueva (contador en cero) la clave correcta entra', async () => {
    await agotarElLimite();
    await app.close();
    ({ app } = await crearAppConReloj());

    const respuesta = await ingresar('academia-a', e.secretariaA.dni, CLAVE_COMUN);

    expect(respuesta.status).toBe(200);
  });
});
