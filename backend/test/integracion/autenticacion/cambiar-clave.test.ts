// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodificarToken } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  atributosDeCookie,
  CLAVE_COMUN,
  cuerpoDe,
  contarAuditoria,
  cookieDeAcademia,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  DURACION_SESION_ALUMNO_SEGUNDOS,
  DURACION_SESION_PERSONAL_SEGUNDOS,
  type ErrorCuerpo,
  type Escenario,
  leerUsuario,
  NOMBRE_COOKIE_ACADEMIA,
  pedir,
  QUINCE_MINUTOS,
  ROLES,
  tokenDeCookie,
  type RolUsuario,
} from '../../utilidades/usuarios';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import type { RelojFijo } from '../../../src/infraestructura/reloj';

// Criterios 22 a 25: cambio de la propia contraseña (`POST /api/sesion/clave`) para todos los roles, con su regla de contraseña
// nueva, el conteo de fallos de la contraseña actual y la carrera entre dos cambios simultáneos.

const CLAVE_NUEVA = 'Una-Clave-Nueva-2026';

describe('cambio de contraseña', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let e: Escenario;

  const cookieDe = (usuario: { id: string; academiaId: string; rol: RolUsuario }) =>
    cookieDeUsuario(usuario, AHORA_PRUEBAS);
  const cambiar = (cookie: string | undefined, cuerpo: unknown) =>
    pedir(app, 'post', '/api/sesion/clave', { cookie, cuerpo });
  const ingresar = (nombreCorto: string, usuario: string, clave: string) =>
    pedir(app, 'post', `/api/a/${nombreCorto}/sesion`, { cuerpo: { usuario, clave } });

  beforeEach(async () => {
    e = await crearEscenario();
    ({ app, reloj } = await crearAppConReloj());
  });
  afterEach(async () => {
    await app?.close();
  });

  describe('criterio 22: cambio correcto', () => {
    it.each(ROLES.map((rol) => [rol]))(
      'criterio 22: un %s con claveActual correcta recibe 200 con debeCambiarClave false y una cookie aq_sesion nueva',
      async (rol) => {
        const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol, debeCambiarClave: true });
        const cookie = cookieDe(usuario);
        const antes = await leerUsuario(e.A.id, usuario.id);

        const respuesta = await cambiar(cookie, { claveActual: usuario.dni, claveNueva: CLAVE_NUEVA });

        expect(respuesta.status).toBe(200);
        expect(respuesta.body).toEqual({
          usuario: {
            id: usuario.id,
            nombres: usuario.nombres,
            apellidos: usuario.apellidos,
            rol,
            debeCambiarClave: false,
            academia: { nombreCorto: 'academia-a', nombre: 'Academia A' },
          },
        });
        expect(respuesta.headers['cache-control']).toBe('no-store');
        const nueva = cookieDeAcademia(respuesta.headers);
        expect(nueva, 'falta la cookie aq_sesion nueva').toBeDefined();
        const atributos = atributosDeCookie(nueva ?? '');
        expect(atributos).toContain('httponly');
        expect(atributos).toContain('samesite=strict');
        expect(atributos).toContain('path=/api');
        expect(atributos).toContain(
          `max-age=${rol === 'ALUMNO' ? DURACION_SESION_ALUMNO_SEGUNDOS : DURACION_SESION_PERSONAL_SEGUNDOS}`,
        );
        const despues = await leerUsuario(e.A.id, usuario.id);
        expect(despues?.clave_hash.startsWith('$argon2id$')).toBe(true);
        expect(despues?.clave_hash).not.toBe(antes?.clave_hash);
        expect(despues?.debe_cambiar_clave).toBe(false);
        expect(despues?.version_token).toBe((antes?.version_token ?? 0) + 1);
        expect(despues?.intentos_fallidos).toBe(0);
        expect(JSON.stringify(respuesta.body)).not.toContain(CLAVE_NUEVA);
        // La cookie nueva lleva la versión nueva.
        const { claims } = decodificarToken(tokenDeCookie(nueva ?? ''));
        expect(claims).toMatchObject({ sub: usuario.id, aca: e.A.id, ver: despues?.version_token });
      },
    );

    it('criterio 22: la cookie anterior y las demás sesiones de la cuenta dejan de valer; la cookie nueva vale', async () => {
      const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA', debeCambiarClave: true });
      const anterior = cookieDe(usuario);
      const otraSesion = cookieDe(usuario);

      const respuesta = await cambiar(anterior, { claveActual: usuario.dni, claveNueva: CLAVE_NUEVA });

      const nueva = (cookieDeAcademia(respuesta.headers) ?? '').split(';')[0] ?? '';
      for (const vieja of [anterior, otraSesion]) {
        const consulta = await pedir(app, 'get', '/api/sesion', { cookie: vieja });
        expect(consulta.status).toBe(401);
        expect((consulta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      }
      const conLaNueva = await pedir(app, 'get', '/api/sesion', { cookie: nueva });
      expect(conLaNueva.status).toBe(200);
      expect((cuerpoDe(conLaNueva) as { usuario: { debeCambiarClave: boolean } }).usuario.debeCambiarClave).toBe(false);
    });

    it('criterio 22: después del cambio entra con la clave nueva y ya no con la anterior', async () => {
      const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', debeCambiarClave: true });
      await cambiar(cookieDe(usuario), { claveActual: usuario.dni, claveNueva: CLAVE_NUEVA });

      const conLaVieja = await ingresar('academia-a', usuario.dni, usuario.dni);
      const conLaNueva = await ingresar('academia-a', usuario.dni, CLAVE_NUEVA);

      expect(conLaVieja.status).toBe(401);
      expect(conLaNueva.status).toBe(200);
      expect((cuerpoDe(conLaNueva) as { usuario: { debeCambiarClave: boolean } }).usuario.debeCambiarClave).toBe(false);
    });

    it('criterio 22: registra USUARIO_CLAVE_CAMBIADA con actor USUARIO, sin datos de la clave', async () => {
      const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ALUMNO', debeCambiarClave: true });

      await cambiar(cookieDe(usuario), { claveActual: usuario.dni, claveNueva: CLAVE_NUEVA });

      const registros = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CLAVE_CAMBIADA');
      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        actor_tipo: 'USUARIO',
        actor_id: usuario.id,
        entidad: 'usuario',
        entidad_id: usuario.id,
      });
      const crudo = JSON.stringify(registros);
      expect(crudo).not.toContain(CLAVE_NUEVA);
      expect(crudo).not.toContain(usuario.dni);
      expect(crudo).not.toMatch(/argon2|clave_hash|claveHash/i);
    });

    it('criterio 22: no hace falta tener el cambio obligatorio: también se puede cambiar cuando uno quiere (HU-05)', async () => {
      const respuesta = await cambiar(cookieDe(e.secretariaA), { claveActual: CLAVE_COMUN, claveNueva: CLAVE_NUEVA });

      expect(respuesta.status).toBe(200);
    });

    it('criterio 22: las contraseñas con tildes, eñes o emojis se aceptan y se comparan exactamente como se escribieron', async () => {
      const exacta = 'Contraseña-ñandú-🏊‍♀️-2026';

      const respuesta = await cambiar(cookieDe(e.secretariaA), { claveActual: CLAVE_COMUN, claveNueva: exacta });
      const conOtraNormalizacion = await ingresar('academia-a', e.secretariaA.dni, exacta.normalize('NFD'));
      const conLaExacta = await ingresar('academia-a', e.secretariaA.dni, exacta);

      expect(respuesta.status).toBe(200);
      expect(conOtraNormalizacion.status).toBe(401);
      expect(conLaExacta.status).toBe(200);
    });

    it('criterio 22: la contraseña nueva no se recorta: los espacios en los extremos forman parte de ella', async () => {
      const conEspacios = '  clave con espacios  ';

      const respuesta = await cambiar(cookieDe(e.secretariaA), { claveActual: CLAVE_COMUN, claveNueva: conEspacios });
      const sinEspacios = await ingresar('academia-a', e.secretariaA.dni, conEspacios.trim());
      const conLosEspacios = await ingresar('academia-a', e.secretariaA.dni, conEspacios);

      expect(respuesta.status).toBe(200);
      expect(sinEspacios.status).toBe(401);
      expect(conLosEspacios.status).toBe(200);
    });
  });

  describe('criterio 23: la contraseña nueva', () => {
    const NO_CAMBIA = async (usuarioId: string, hashAntes: string | undefined, versionAntes: number | undefined) => {
      const despues = await leerUsuario(e.A.id, usuarioId);
      expect(despues?.clave_hash).toBe(hashAntes);
      expect(despues?.version_token).toBe(versionAntes);
      expect(await contarAuditoria(e.A.id, 'USUARIO_CLAVE_CAMBIADA')).toBe(0);
    };

    it.each([
      ['de 7 caracteres', 'Abcdef7'],
      ['vacía', ''],
      ['de 129 caracteres', 'x'.repeat(129)],
      ['con 7 puntos de código (emojis)', '🏊'.repeat(7)],
      ['con 129 puntos de código (emojis)', '🏊'.repeat(129)],
      ['con un carácter de control', 'Clave\u0000con-control'],
      ['con un salto de línea', 'Clave-con\nsalto-1'],
      ['con un tabulador', 'Clave-con\ttab-1'],
    ])(
      'criterio 23: una claveNueva %s responde 400 SOLICITUD_INVALIDA en el campo claveNueva, sin cambiar nada',
      async (_caso, claveNueva) => {
        const antes = await leerUsuario(e.A.id, e.secretariaA.id);

        const respuesta = await cambiar(cookieDe(e.secretariaA), { claveActual: CLAVE_COMUN, claveNueva });

        expect(respuesta.status).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        expect((respuesta.body as ErrorCuerpo).detalles?.errores?.map((error) => error.campo)).toContain('claveNueva');
        await NO_CAMBIA(e.secretariaA.id, antes?.clave_hash, antes?.version_token);
        expect(antes?.intentos_fallidos).toBe(0);
        expect((await leerUsuario(e.A.id, e.secretariaA.id))?.intentos_fallidos).toBe(0);
      },
    );

    it('criterio 23: una claveNueva igual al DNI del usuario responde 400 en el campo claveNueva, sin cambiar nada', async () => {
      const antes = await leerUsuario(e.A.id, e.secretariaA.id);

      const respuesta = await cambiar(cookieDe(e.secretariaA), {
        claveActual: CLAVE_COMUN,
        claveNueva: e.secretariaA.dni,
      });

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      expect((respuesta.body as ErrorCuerpo).detalles?.errores?.map((error) => error.campo)).toContain('claveNueva');
      await NO_CAMBIA(e.secretariaA.id, antes?.clave_hash, antes?.version_token);
    });

    it('criterio 23: en el cambio obligatorio (clave actual = DNI), la nueva no puede ser el DNI', async () => {
      const nuevo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', debeCambiarClave: true });
      const antes = await leerUsuario(e.A.id, nuevo.id);

      const respuesta = await cambiar(cookieDe(nuevo), { claveActual: nuevo.dni, claveNueva: nuevo.dni });

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).detalles?.errores?.map((error) => error.campo)).toContain('claveNueva');
      const despues = await leerUsuario(e.A.id, nuevo.id);
      expect(despues?.debe_cambiar_clave).toBe(true);
      expect(despues?.clave_hash).toBe(antes?.clave_hash);
    });

    it('criterio 23: una claveNueva igual a la clave actual responde 400 en el campo claveNueva, sin cambiar nada', async () => {
      const antes = await leerUsuario(e.A.id, e.secretariaA.id);

      const respuesta = await cambiar(cookieDe(e.secretariaA), { claveActual: CLAVE_COMUN, claveNueva: CLAVE_COMUN });

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      expect((respuesta.body as ErrorCuerpo).detalles?.errores?.map((error) => error.campo)).toContain('claveNueva');
      await NO_CAMBIA(e.secretariaA.id, antes?.clave_hash, antes?.version_token);
    });

    it.each([
      ['de exactamente 8 caracteres', 'Abcdefg8'],
      ['de exactamente 8 puntos de código (emojis, 16 unidades UTF-16)', '🏊'.repeat(8)],
      ['de exactamente 128 puntos de código (emojis)', '🏊'.repeat(128)],
      ['de exactamente 128 caracteres', 'x'.repeat(128)],
    ])(
      'criterio 23: una claveNueva %s se acepta (límites inclusivos, longitud por puntos de código)',
      async (_caso, claveNueva) => {
        const respuesta = await cambiar(cookieDe(e.secretariaA), { claveActual: CLAVE_COMUN, claveNueva });

        expect(respuesta.status).toBe(200);
      },
    );

    it.each([
      ['sin cuerpo', undefined],
      ['sin claveNueva', { claveActual: CLAVE_COMUN }],
      ['sin claveActual', { claveNueva: CLAVE_NUEVA }],
      ['con campos de más', { claveActual: CLAVE_COMUN, claveNueva: CLAVE_NUEVA, cerrarSesiones: true }],
      ['con una claveNueva que no es texto', { claveActual: CLAVE_COMUN, claveNueva: 12345678 }],
      ['con una claveActual vacía', { claveActual: '', claveNueva: CLAVE_NUEVA }],
      ['con una claveActual de más de 128 caracteres', { claveActual: 'x'.repeat(129), claveNueva: CLAVE_NUEVA }],
    ])(
      'criterio 23: un cuerpo %s responde 400 SOLICITUD_INVALIDA sin cambiar nada ni contar un fallo',
      async (_caso, cuerpo) => {
        const antes = await leerUsuario(e.A.id, e.secretariaA.id);

        const respuesta = await cambiar(cookieDe(e.secretariaA), cuerpo);

        expect(respuesta.status).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        await NO_CAMBIA(e.secretariaA.id, antes?.clave_hash, antes?.version_token);
        expect((await leerUsuario(e.A.id, e.secretariaA.id))?.intentos_fallidos).toBe(0);
      },
    );
  });

  describe('criterio 24: la contraseña actual', () => {
    const equivocada = (cookie: string) =>
      cambiar(cookie, { claveActual: 'clave-actual-equivocada', claveNueva: CLAVE_NUEVA });

    it('criterio 24: una claveActual equivocada responde 400 CLAVE_ACTUAL_INCORRECTA, cuenta un intento fallido y la sesión sigue valiendo', async () => {
      const cookie = cookieDe(e.secretariaA);
      const antes = await leerUsuario(e.A.id, e.secretariaA.id);

      const respuesta = await equivocada(cookie);

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CLAVE_ACTUAL_INCORRECTA');
      expect(respuesta.headers['set-cookie']).toBeUndefined();
      const despues = await leerUsuario(e.A.id, e.secretariaA.id);
      expect(despues?.intentos_fallidos).toBe(1);
      expect(despues?.clave_hash).toBe(antes?.clave_hash);
      expect(despues?.version_token).toBe(antes?.version_token);
      expect((await pedir(app, 'get', '/api/sesion', { cookie })).status).toBe(200);
      expect(await contarAuditoria(e.A.id, 'USUARIO_CLAVE_CAMBIADA')).toBe(0);
    });

    it('criterio 24: los 4 primeros fallos responden 400 y el 5.º responde 423 CUENTA_BLOQUEADA con bloqueado_hasta = ahora + 15 min', async () => {
      const cookie = cookieDe(e.secretariaA);

      for (let i = 1; i <= 4; i++) {
        const respuesta = await equivocada(cookie);
        expect(respuesta.status, `intento ${i}`).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('CLAVE_ACTUAL_INCORRECTA');
      }
      const quinto = await equivocada(cookie);

      expect(quinto.status).toBe(423);
      expect((quinto.body as ErrorCuerpo).codigo).toBe('CUENTA_BLOQUEADA');
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.bloqueado_hasta?.toISOString()).toBe(
        new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS).toISOString(),
      );
      expect((await pedir(app, 'get', '/api/sesion', { cookie })).status, 'la sesión sigue valiendo').toBe(200);
    });

    it('criterio 24: con la cuenta bloqueada responde 423 aunque la claveActual sea correcta, sin cambiar nada', async () => {
      const cookie = cookieDe(e.secretariaA);
      await actualizarUsuario(e.A.id, e.secretariaA.id, {
        intentos_fallidos: 5,
        bloqueado_hasta: new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS),
      });
      const antes = await leerUsuario(e.A.id, e.secretariaA.id);

      const respuesta = await cambiar(cookie, { claveActual: CLAVE_COMUN, claveNueva: CLAVE_NUEVA });

      expect(respuesta.status).toBe(423);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CUENTA_BLOQUEADA');
      const despues = await leerUsuario(e.A.id, e.secretariaA.id);
      expect(despues?.clave_hash).toBe(antes?.clave_hash);
      expect(despues?.version_token).toBe(antes?.version_token);
      expect(despues?.intentos_fallidos).toBe(antes?.intentos_fallidos);
    });

    it('criterio 24: cumplido el bloqueo, la claveActual correcta vuelve a permitir el cambio', async () => {
      const cookie = cookieDe(e.secretariaA);
      await actualizarUsuario(e.A.id, e.secretariaA.id, {
        intentos_fallidos: 5,
        bloqueado_hasta: new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS),
      });

      reloj.avanzar(QUINCE_MINUTOS);
      const respuesta = await cambiar(cookie, { claveActual: CLAVE_COMUN, claveNueva: CLAVE_NUEVA });

      expect(respuesta.status).toBe(200);
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.intentos_fallidos).toBe(0);
    });

    it('criterio 24: un cambio correcto pone el contador de fallos en 0', async () => {
      await equivocada(cookieDe(e.secretariaA));
      await equivocada(cookieDe(e.secretariaA));
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.intentos_fallidos).toBe(2);

      const respuesta = await cambiar(cookieDe(e.secretariaA), { claveActual: CLAVE_COMUN, claveNueva: CLAVE_NUEVA });

      expect(respuesta.status).toBe(200);
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.intentos_fallidos).toBe(0);
    });

    it('criterio 24: cambiar sin sesión responde 401 y no cuenta ningún fallo', async () => {
      const respuesta = await cambiar(undefined, { claveActual: CLAVE_COMUN, claveNueva: CLAVE_NUEVA });

      expect(respuesta.status).toBe(401);
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.intentos_fallidos).toBe(0);
    });
  });

  describe('criterio 25: dos cambios simultáneos', () => {
    it('criterio 25: con la misma claveActual correcta y claves nuevas distintas, uno responde 200 y el otro 400 CLAVE_ACTUAL_INCORRECTA o 401, y la clave que queda es la del 200', async () => {
      const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
      const cookie = cookieDe(usuario);
      const nuevas = ['Clave-Nueva-Uno-2026', 'Clave-Nueva-Dos-2026'];

      const respuestas = await Promise.all(
        nuevas.map((claveNueva) => cambiar(cookie, { claveActual: CLAVE_COMUN, claveNueva })),
      );

      const estados = respuestas.map((respuesta) => respuesta.status).sort();
      expect(estados[0], `estados: ${estados.join(',')}`).toBe(200);
      expect([400, 401]).toContain(estados[1]);
      const perdedora = respuestas.find((respuesta) => respuesta.status !== 200);
      if (perdedora?.status === 400) expect((perdedora.body as ErrorCuerpo).codigo).toBe('CLAVE_ACTUAL_INCORRECTA');
      const ganadora = nuevas[respuestas.findIndex((respuesta) => respuesta.status === 200)] ?? '';
      const perdida = nuevas.find((clave) => clave !== ganadora) ?? '';
      expect((await ingresar('academia-a', usuario.dni, ganadora)).status).toBe(200);
      expect((await ingresar('academia-a', usuario.dni, perdida)).status).toBe(401);
      expect((await leerUsuario(e.A.id, usuario.id))?.version_token).toBe(1);
      expect(await contarAuditoria(e.A.id, 'USUARIO_CLAVE_CAMBIADA')).toBe(1);
    });

    it('criterio 25: con cuatro cambios a la vez, exactamente uno responde 200', async () => {
      const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', clave: CLAVE_COMUN });
      const cookie = cookieDe(usuario);

      const respuestas = await Promise.all(
        ['Clave-Nueva-Uno-2026', 'Clave-Nueva-Dos-2026', 'Clave-Nueva-Tres-2026', 'Clave-Nueva-Cuatro-2026'].map(
          (claveNueva) => cambiar(cookie, { claveActual: CLAVE_COMUN, claveNueva }),
        ),
      );

      expect(respuestas.filter((respuesta) => respuesta.status === 200)).toHaveLength(1);
      expect(
        respuestas.filter((respuesta) => respuesta.status !== 200).every((r) => [400, 401, 423].includes(r.status)),
      ).toBe(true);
      expect((await leerUsuario(e.A.id, usuario.id))?.version_token).toBe(1);
    });
  });

  describe('criterio 22 y 21: la cookie nueva lleva la sesión al panel', () => {
    it('criterio 22: tras el cambio obligatorio, con la cookie nueva, las rutas que pedían el cambio ya responden', async () => {
      const nuevo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', debeCambiarClave: true });
      const antes = await pedir(app, 'get', '/api/usuarios', { cookie: cookieDe(nuevo) });
      const cambio = await cambiar(cookieDe(nuevo), { claveActual: nuevo.dni, claveNueva: CLAVE_NUEVA });
      const nueva = (cookieDeAcademia(cambio.headers) ?? '').split(';')[0] ?? '';

      const despues = await pedir(app, 'get', '/api/usuarios', { cookie: nueva });

      expect(antes.status).toBe(403);
      expect((antes.body as ErrorCuerpo).codigo).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
      expect(despues.status).toBe(200);
      expect(nueva.startsWith(`${NOMBRE_COOKIE_ACADEMIA}=`)).toBe(true);
    });
  });
});
