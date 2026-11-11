// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerSuperadmin } from '../../utilidades/datos';
import { CONTROLES, SUSTITUTO_SUELTO } from '../../utilidades/textos';
import { cookieDePlataforma, crearSuperadminDePrueba, type SuperadminDePrueba } from '../../utilidades/superadmins';

// Criterios 76 y 77 (ataque ronda 1, O1 y O2) en POST /api/plataforma/sesion: `correo` y `clave` con un caracter de
// control (\p{Cc}, incluidos el tabulador y los saltos de linea) despues del recorte, o con un sustituto UTF-16 suelto,
// responden 400 SOLICITUD_INVALIDA con detalles.errores que nombra el campo; nunca 500; sin calcular un hash ni contar
// un intento. `clave` no se recorta: un control en cualquier posicion es 400. Cada peticion a este endpoint cuenta para
// el limite de 10 por IP (criterio 75): cada caso crea su aplicacion.

interface ErrorCuerpo {
  codigo?: string;
  detalles?: { errores?: { campo: string; mensaje: string }[] };
}

describe('criterios 76 y 77: correo y clave del inicio de sesion', () => {
  let app: NestExpressApplication;
  let superadmin: SuperadminDePrueba;

  beforeEach(async () => {
    await limpiarBase();
    superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
  });
  afterEach(async () => {
    await app?.close();
  });

  const iniciar = (cuerpo: object) => request(app.getHttpServer()).post('/api/plataforma/sesion').send(cuerpo);

  async function esperarRechazoSinIntento(respuesta: request.Response, campo: string): Promise<void> {
    expect(respuesta.status).toBe(400);
    const cuerpo = respuesta.body as ErrorCuerpo;
    expect(cuerpo.codigo).toBe('SOLICITUD_INVALIDA');
    expect(cuerpo.detalles?.errores?.map((error) => error.campo)).toContain(campo);
    expect(cookieDePlataforma(respuesta.headers)).toBeUndefined();
    expect(await leerSuperadmin(superadmin.id)).toMatchObject({
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_acceso: null,
      version_token: 0,
    });
  }

  describe('clave (no se recorta)', () => {
    it.each(CONTROLES)(
      'criterio 76: clave con %s en medio responde 400 y no cuenta un intento',
      async (_n, control) => {
        const respuesta = await iniciar({ correo: superadmin.correo, clave: `Clave${control}Segura-2026!` });

        await esperarRechazoSinIntento(respuesta, 'clave');
      },
    );

    it.each([
      ['salto de linea al comienzo', '\nClaveSegura-2026!'],
      ['salto de linea al final', 'ClaveSegura-2026!\n'],
      ['tabulador al final', 'ClaveSegura-2026!\t'],
      ['nulo al comienzo', '\u0000ClaveSegura-2026!'],
      ['nulo al final', 'ClaveSegura-2026!\u0000'],
    ])(
      'criterio 76: clave con %s responde 400 (la clave no se recorta) y no cuenta un intento',
      async (_caso, clave) => {
        const respuesta = await iniciar({ correo: superadmin.correo, clave });

        await esperarRechazoSinIntento(respuesta, 'clave');
      },
    );

    it('criterio 76: clave con un sustituto UTF-16 suelto responde 400 y no cuenta un intento', async () => {
      const respuesta = await iniciar({ correo: superadmin.correo, clave: `Clave${SUSTITUTO_SUELTO}Segura-2026!` });

      await esperarRechazoSinIntento(respuesta, 'clave');
    });

    it('criterio 76: la clave correcta, sin controles, sigue entrando (200)', async () => {
      const respuesta = await iniciar({ correo: superadmin.correo, clave: superadmin.clave });

      expect(respuesta.status).toBe(200);
    });
  });

  describe('correo', () => {
    it.each(CONTROLES)(
      'criterio 76: correo con %s en medio responde 400 y no cuenta un intento',
      async (_n, control) => {
        const respuesta = await iniciar({ correo: `dueno${control}@aquagestion.test`, clave: superadmin.clave });

        await esperarRechazoSinIntento(respuesta, 'correo');
      },
    );

    it.each([
      ['nulo al comienzo', '\u0000dueno@aquagestion.test'],
      ['nulo al final', 'dueno@aquagestion.test\u0000'],
      ['U+0085 al final (no es un espacio para el recorte)', 'dueno@aquagestion.test\u0085'],
    ])('criterio 76: correo con %s responde 400 y no cuenta un intento', async (_caso, correo) => {
      const respuesta = await iniciar({ correo, clave: superadmin.clave });

      await esperarRechazoSinIntento(respuesta, 'correo');
    });

    it('criterio 76: correo con un sustituto UTF-16 suelto responde 400 y no cuenta un intento', async () => {
      const respuesta = await iniciar({ correo: `dueno${SUSTITUTO_SUELTO}@aquagestion.test`, clave: superadmin.clave });

      await esperarRechazoSinIntento(respuesta, 'correo');
    });

    it('criterio 76: los espacios y saltos de linea de los extremos del correo se recortan y el inicio de sesion funciona', async () => {
      const respuesta = await iniciar({ correo: '\n  Dueno@AquaGestion.test \t', clave: superadmin.clave });

      expect(respuesta.status).toBe(200);
    });
  });
});
