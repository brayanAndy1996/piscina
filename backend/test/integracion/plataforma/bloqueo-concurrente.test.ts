// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerSuperadmin } from '../../utilidades/datos';
import { cookieDePlataforma, crearSuperadminDePrueba, type SuperadminDePrueba } from '../../utilidades/superadmins';

const AHORA = new Date('2026-11-11T15:00:00.000Z');

// Criterio 40: el contador de intentos fallidos no pierde incrementos cuando llegan intentos simultáneos.
describe('criterio 40: 10 intentos fallidos simultáneos', () => {
  let apps: NestExpressApplication[] = [];
  let reloj: RelojFijo;
  let superadmin: SuperadminDePrueba;

  async function crearApp(): Promise<NestExpressApplication> {
    const app = await crearAppDePruebas({
      nivelRegistro: 'silent',
      ajustar: (constructor) => constructor.overrideProvider(RELOJ).useValue(reloj),
    });
    apps.push(app);
    return app;
  }

  beforeEach(async () => {
    await limpiarBase();
    reloj = new RelojFijo(AHORA);
    superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });
    apps = [];
  });
  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  it('criterio 40: cada respuesta es 401 o 423, al menos una es 423 y la cuenta queda bloqueada', async () => {
    const app = await crearApp();
    const servidor = app.getHttpServer();

    const respuestas = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(servidor)
          .post('/api/plataforma/sesion')
          .send({ correo: superadmin.correo, clave: 'clave-equivocada-123' }),
      ),
    );

    const estados = respuestas.map((respuesta) => respuesta.status);
    expect(
      estados.every((estado) => estado === 401 || estado === 423),
      `estados: ${estados.join(',')}`,
    ).toBe(true);
    expect(estados.filter((estado) => estado === 423).length).toBeGreaterThan(0);
    // Sin incrementos perdidos, como máximo 4 respuestas pueden ser 401 (el 5.º fallo bloquea).
    expect(estados.filter((estado) => estado === 401).length).toBeLessThanOrEqual(4);
    for (const respuesta of respuestas) expect(respuesta.headers['set-cookie']).toBeUndefined();
    const fila = await leerSuperadmin(superadmin.id);
    expect(fila?.bloqueado_hasta, 'la cuenta no quedó bloqueada').not.toBeNull();
    expect(fila?.bloqueado_hasta?.getTime()).toBeGreaterThan(AHORA.getTime());
    expect(fila?.intentos_fallidos).toBeGreaterThanOrEqual(5);
  });

  it('criterio 40: un intento inmediato con la clave correcta responde 423 y no emite cookie', async () => {
    const app = await crearApp();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/api/plataforma/sesion')
          .send({ correo: superadmin.correo, clave: 'clave-equivocada-123' }),
      ),
    );

    // Otra aplicación, para que el límite por IP (10 por minuto) de la primera no responda 429.
    const otra = await crearApp();
    const respuesta = await request(otra.getHttpServer())
      .post('/api/plataforma/sesion')
      .send({ correo: superadmin.correo, clave: superadmin.clave });

    expect(respuesta.status).toBe(423);
    expect((respuesta.body as { codigo: string }).codigo).toBe('CUENTA_BLOQUEADA');
    expect(cookieDePlataforma(respuesta.headers)).toBeUndefined();
  });
});
