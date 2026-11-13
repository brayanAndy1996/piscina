// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerSuperadmin } from '../../utilidades/datos';
import { emojis } from '../../utilidades/textos-ronda2';
import { cookieDePlataforma, crearSuperadminDePrueba } from '../../utilidades/superadmins';

// Criterio 88 (ataque ronda 2, F6) en POST /api/plataforma/sesion: `clave` de 1 a 128 y `correo` hasta 254, contados por
// puntos de codigo. Una clave de 128 emojis (256 unidades UTF-16) inicia sesion (200); una de 129 responde 400 sin contar un
// intento. Cada peticion a este endpoint cuenta para el limite de 10 por IP (criterio 75): cada caso crea su aplicacion.

interface ErrorCuerpo {
  codigo?: string;
  detalles?: { errores?: { campo: string; mensaje: string }[] };
}

describe('criterio 88: clave y correo del inicio de sesion por puntos de codigo', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    await limpiarBase();
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
  });
  afterEach(async () => {
    await app?.close();
  });

  const iniciar = (cuerpo: object) => request(app.getHttpServer()).post('/api/plataforma/sesion').send(cuerpo);

  it('criterio 88: con una clave de 128 emojis (256 unidades UTF-16) el inicio de sesion responde 200 con cookie', async () => {
    const clave = emojis(128);
    const superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test', clave });

    const respuesta = await iniciar({ correo: superadmin.correo, clave });

    expect(respuesta.status).toBe(200);
    expect(cookieDePlataforma(respuesta.headers)).toBeDefined();
  });

  it('criterio 88: con una clave de 129 emojis responde 400 que nombra clave, sin cookie y sin contar un intento', async () => {
    const superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });

    const respuesta = await iniciar({ correo: superadmin.correo, clave: emojis(129) });

    expect(respuesta.status).toBe(400);
    const cuerpo = respuesta.body as ErrorCuerpo;
    expect(cuerpo.codigo).toBe('SOLICITUD_INVALIDA');
    expect(cuerpo.detalles?.errores?.map((error) => error.campo)).toContain('clave');
    expect(cookieDePlataforma(respuesta.headers)).toBeUndefined();
    expect(await leerSuperadmin(superadmin.id)).toMatchObject({
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_acceso: null,
      version_token: 0,
    });
  });

  it('criterio 88: un correo de 255 caracteres responde 400 que nombra correo y uno de 254 no se rechaza por largo', async () => {
    const superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });
    const dominio = '@aquagestion.test';
    const correoDe = (largo: number) => `${'a'.repeat(largo - dominio.length)}${dominio}`;

    const demasiado = await iniciar({ correo: correoDe(255), clave: 'ClaveCualquiera-1' });
    const justo = await iniciar({ correo: correoDe(254), clave: 'ClaveCualquiera-1' });

    expect(demasiado.status).toBe(400);
    expect((demasiado.body as ErrorCuerpo).detalles?.errores?.map((error) => error.campo)).toContain('correo');
    expect(justo.status).toBe(401);
    expect((justo.body as ErrorCuerpo).codigo).toBe('CREDENCIALES_INVALIDAS');
    expect(await leerSuperadmin(superadmin.id)).toMatchObject({ intentos_fallidos: 0 });
  });
});
