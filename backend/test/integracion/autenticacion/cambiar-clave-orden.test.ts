// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  dniInventado,
  type ErrorCuerpo,
  type Escenario,
  leerUsuario,
  pedir,
  QUINCE_MINUTOS,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 58 (ataque ronda 2, observación 2): POST /api/sesion/clave comprueba en este orden: 1) el cuerpo con cambiarClaveSchema
// (400 SOLICITUD_INVALIDA, sin contar un intento); 2) cuenta bloqueada (423, sin verificar la clave); 3) la claveActual (400
// CLAVE_ACTUAL_INCORRECTA y un intento fallido, o 423 si ese fallo bloquea); 4) solo con la claveActual correcta, la claveNueva igual al
// DNI de la cuenta o a la actual (400 SOLICITUD_INVALIDA en claveNueva, sin contar un intento ni cambiar nada).

describe('criterio 58: el cambio de clave verifica la actual antes de mirar el DNI', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let usuario: UsuarioDePrueba;
  let cookie: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
    usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
    cookie = cookieDeUsuario(usuario, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  const cambiar = (cuerpo: unknown) => pedir(app, 'post', '/api/sesion/clave', { cookie, cuerpo });
  const errorDe = (respuesta: { body: unknown }) => respuesta.body as ErrorCuerpo;
  const camposConError = (respuesta: { body: unknown }) =>
    errorDe(respuesta).detalles?.errores?.map((error) => error.campo) ?? [];

  async function noCambiaNada(antes: Awaited<ReturnType<typeof leerUsuario>>, intentos: number) {
    const despues = await leerUsuario(e.A.id, usuario.id);
    expect(despues?.clave_hash).toBe(antes?.clave_hash);
    expect(despues?.version_token).toBe(antes?.version_token);
    expect(despues?.debe_cambiar_clave).toBe(antes?.debe_cambiar_clave);
    expect(despues?.intentos_fallidos, 'intentos_fallidos').toBe(intentos);
    expect(await contarAuditoria(e.A.id, 'USUARIO_CLAVE_CAMBIADA')).toBe(0);
  }

  describe('a) con una claveActual equivocada, la claveNueva no se mira', () => {
    it('criterio 58 a): con una claveActual equivocada, una claveNueva igual al DNI de la cuenta, a otro DNI o a un texto cualquiera responden lo mismo (400 CLAVE_ACTUAL_INCORRECTA, mismo cuerpo) y cada una suma 1 intento fallido', async () => {
      const antes = await leerUsuario(e.A.id, usuario.id);
      const candidatas = [
        ['el DNI de la cuenta', usuario.dni],
        ['otro DNI de 8 dígitos', dniInventado()],
        ['un texto cualquiera válido', 'Un-Texto-Cualquiera-2026'],
      ] as const;

      let cuerpoDelPrimero: unknown;
      for (const [indice, [descripcion, claveNueva]] of candidatas.entries()) {
        const respuesta = await cambiar({ claveActual: 'clave-actual-equivocada', claveNueva });

        expect(respuesta.status, `claveNueva igual a ${descripcion}: ${JSON.stringify(respuesta.body)}`).toBe(400);
        expect(errorDe(respuesta).codigo, `claveNueva igual a ${descripcion}`).toBe('CLAVE_ACTUAL_INCORRECTA');
        if (indice === 0) cuerpoDelPrimero = respuesta.body;
        expect(respuesta.body, `el cuerpo con ${descripcion} debe ser el mismo`).toEqual(cuerpoDelPrimero);
        expect(
          (await leerUsuario(e.A.id, usuario.id))?.intentos_fallidos,
          `intentos_fallidos tras ${descripcion}`,
        ).toBe(indice + 1);
      }

      const despues = await leerUsuario(e.A.id, usuario.id);
      expect(despues?.clave_hash).toBe(antes?.clave_hash);
      expect(despues?.version_token).toBe(antes?.version_token);
      expect(await contarAuditoria(e.A.id, 'USUARIO_CLAVE_CAMBIADA')).toBe(0);
    });

    it('criterio 58 a): con una claveActual equivocada y una claveNueva igual a esa misma claveActual, responde 400 CLAVE_ACTUAL_INCORRECTA y cuenta el intento (la comparación con la actual va después de verificarla)', async () => {
      const antes = await leerUsuario(e.A.id, usuario.id);

      const respuesta = await cambiar({
        claveActual: 'Otra-Clave-Equivocada-1',
        claveNueva: 'Otra-Clave-Equivocada-1',
      });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect(errorDe(respuesta).codigo).toBe('CLAVE_ACTUAL_INCORRECTA');
      await noCambiaNada(antes, 1);
    });

    it('criterio 58 a): la sesión sigue valiendo tras el fallo', async () => {
      await cambiar({ claveActual: 'clave-actual-equivocada', claveNueva: usuario.dni });

      expect((await pedir(app, 'get', '/api/sesion', { cookie })).status).toBe(200);
    });
  });

  describe('b) con la claveActual correcta, la claveNueva igual al DNI o a la actual se rechaza sin contar', () => {
    it('criterio 58 b): con la claveActual correcta y la claveNueva igual al DNI de la cuenta, responde 400 SOLICITUD_INVALIDA en claveNueva y intentos_fallidos no cambia', async () => {
      await actualizarUsuario(e.A.id, usuario.id, { intentos_fallidos: 2 });
      const antes = await leerUsuario(e.A.id, usuario.id);

      const respuesta = await cambiar({ claveActual: CLAVE_COMUN, claveNueva: usuario.dni });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect(errorDe(respuesta).codigo).toBe('SOLICITUD_INVALIDA');
      expect(camposConError(respuesta)).toContain('claveNueva');
      await noCambiaNada(antes, 2);
    });

    it('criterio 58 b): con la claveActual correcta y la claveNueva igual a la actual, responde 400 SOLICITUD_INVALIDA en claveNueva y intentos_fallidos no cambia', async () => {
      await actualizarUsuario(e.A.id, usuario.id, { intentos_fallidos: 2 });
      const antes = await leerUsuario(e.A.id, usuario.id);

      const respuesta = await cambiar({ claveActual: CLAVE_COMUN, claveNueva: CLAVE_COMUN });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect(errorDe(respuesta).codigo).toBe('SOLICITUD_INVALIDA');
      expect(camposConError(respuesta)).toContain('claveNueva');
      await noCambiaNada(antes, 2);
    });

    it('criterio 58 b): con la claveActual correcta y la claveNueva igual al DNI de la cuenta en el cambio obligatorio (clave actual = DNI), responde 400 en claveNueva', async () => {
      const nuevo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', debeCambiarClave: true });

      const respuesta = await pedir(app, 'post', '/api/sesion/clave', {
        cookie: cookieDeUsuario(nuevo, AHORA_PRUEBAS),
        cuerpo: { claveActual: nuevo.dni, claveNueva: nuevo.dni },
      });

      expect(respuesta.status).toBe(400);
      expect(errorDe(respuesta).codigo).toBe('SOLICITUD_INVALIDA');
      expect(camposConError(respuesta)).toContain('claveNueva');
      const despues = await leerUsuario(e.A.id, nuevo.id);
      expect(despues?.debe_cambiar_clave).toBe(true);
      expect(despues?.intentos_fallidos).toBe(0);
    });
  });

  describe('c) cinco intentos con claveActual equivocada y claveNueva igual a DNIs distintos bloquean la cuenta', () => {
    it('criterio 58 c): los 4 primeros responden 400 CLAVE_ACTUAL_INCORRECTA y el 5.º 423 CUENTA_BLOQUEADA, con bloqueado_hasta = ahora + 15 min', async () => {
      const dnis = [usuario.dni, dniInventado(), dniInventado(), dniInventado(), dniInventado()];

      for (const [indice, dni] of dnis.entries()) {
        const respuesta = await cambiar({ claveActual: 'clave-actual-equivocada', claveNueva: dni });
        if (indice < 4) {
          expect(respuesta.status, `intento ${indice + 1}: ${JSON.stringify(respuesta.body)}`).toBe(400);
          expect(errorDe(respuesta).codigo, `intento ${indice + 1}`).toBe('CLAVE_ACTUAL_INCORRECTA');
        } else {
          expect(respuesta.status, `intento 5: ${JSON.stringify(respuesta.body)}`).toBe(423);
          expect(errorDe(respuesta).codigo).toBe('CUENTA_BLOQUEADA');
        }
      }

      expect((await leerUsuario(e.A.id, usuario.id))?.bloqueado_hasta?.toISOString()).toBe(
        new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS).toISOString(),
      );
      expect((await pedir(app, 'get', '/api/sesion', { cookie })).status, 'la sesión sigue valiendo').toBe(200);
    });
  });

  describe('orden de las comprobaciones: el cuerpo (1) y el bloqueo (2) van antes', () => {
    it.each([
      ['una claveNueva de menos de 8 caracteres', { claveActual: 'clave-actual-equivocada', claveNueva: 'corta' }],
      [
        'una claveNueva con caracteres de control',
        { claveActual: 'clave-actual-equivocada', claveNueva: 'Clave-con-control\u0007-2026' },
      ],
      [
        'una claveNueva de más de 128 caracteres',
        { claveActual: 'clave-actual-equivocada', claveNueva: 'x'.repeat(129) },
      ],
    ])(
      'criterio 58 1): con una claveActual equivocada y %s, responde 400 SOLICITUD_INVALIDA en claveNueva sin contar un intento',
      async (_caso, cuerpo) => {
        const antes = await leerUsuario(e.A.id, usuario.id);

        const respuesta = await cambiar(cuerpo);

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect(errorDe(respuesta).codigo).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('claveNueva');
        await noCambiaNada(antes, 0);
      },
    );

    it('criterio 58 2): con la cuenta bloqueada, una claveActual equivocada y una claveNueva igual al DNI responde 423 CUENTA_BLOQUEADA, sin verificar la clave ni contar un intento', async () => {
      await actualizarUsuario(e.A.id, usuario.id, {
        intentos_fallidos: 3,
        bloqueado_hasta: new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS),
      });
      const antes = await leerUsuario(e.A.id, usuario.id);

      const respuesta = await cambiar({ claveActual: 'clave-actual-equivocada', claveNueva: usuario.dni });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(423);
      expect(errorDe(respuesta).codigo).toBe('CUENTA_BLOQUEADA');
      const despues = await leerUsuario(e.A.id, usuario.id);
      expect(despues?.intentos_fallidos).toBe(3);
      expect(despues?.bloqueado_hasta?.toISOString()).toBe(antes?.bloqueado_hasta?.toISOString());
      expect(despues?.clave_hash).toBe(antes?.clave_hash);
    });
  });
});
