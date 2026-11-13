// spec: 002-autenticacion-roles (pruebas protegidas)
import { randomBytes, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cookieDePlataforma, cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  atributosDeCookie,
  CLAVE_COMUN,
  claimsDeUsuario,
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
  firmarTokenAcademia,
  instantaneaDeUsuarios,
  leerUsuario,
  NOMBRE_COOKIE_ACADEMIA,
  pedir,
} from '../../utilidades/usuarios';
import type { RelojFijo } from '../../../src/infraestructura/reloj';

// Criterios 14 a 20: la sesión de academia (cookie `aq_sesion`), `GET` y `DELETE /api/sesion`, la protección de todas las rutas de
// academia, la separación de cookies con la plataforma y la academia que sale siempre de la sesión. Los tokens se firman con
// `firmarTokenAcademia` (sin pasar por el ingreso, que tiene un límite por IP), con la aplicación de pruebas compartida.

const OTRO_SECRETO_PRUEBAS = randomBytes(32).toString('base64url');
const AHORA_S = Math.floor(AHORA_PRUEBAS.getTime() / 1000);

describe('sesión de academia', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let e: Escenario;

  const sesion = (cookie?: string) => pedir(app, 'get', '/api/sesion', { cookie });
  const cookieDe = (usuario: {
    id: string;
    academiaId: string;
    rol: 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO';
  }) => cookieDeUsuario(usuario, AHORA_PRUEBAS);
  const token = (claims: Record<string, unknown>, opciones?: { secreto?: string; algoritmo?: 'HS256' | 'none' }) =>
    `${NOMBRE_COOKIE_ACADEMIA}=${firmarTokenAcademia(claims, opciones)}`;

  beforeAll(async () => {
    ({ app, reloj } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
    reloj.fijar(AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('criterio 14: GET /api/sesion', () => {
    it('criterio 14: con una cookie válida responde 200 con RespuestaSesionAcademia y Cache-Control: no-store', async () => {
      const respuesta = await sesion(cookieDe(e.secretariaA));

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        usuario: {
          id: e.secretariaA.id,
          nombres: e.secretariaA.nombres,
          apellidos: e.secretariaA.apellidos,
          rol: 'SECRETARIA',
          debeCambiarClave: false,
          academia: { nombreCorto: 'academia-a', nombre: 'Academia A' },
        },
      });
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 14: el rol y debeCambiarClave salen de la base en esa petición, no del token', async () => {
      const cookie = cookieDe(e.secretariaA);
      await actualizarUsuario(e.A.id, e.secretariaA.id, { rol: 'ENTRENADOR', debe_cambiar_clave: true });

      const respuesta = await sesion(cookie);

      expect(respuesta.status).toBe(200);
      expect((cuerpoDe(respuesta) as { usuario: Record<string, unknown> }).usuario).toMatchObject({
        rol: 'ENTRENADOR',
        debeCambiarClave: true,
      });
    });

    it.each([
      ['sin cookie', () => undefined],
      ['una cookie vacía', () => `${NOMBRE_COOKIE_ACADEMIA}=`],
      ['un valor que no es un token', () => `${NOMBRE_COOKIE_ACADEMIA}=esto-no-es-un-jwt`],
      [
        'una firma alterada',
        () => {
          const partes = firmarTokenAcademia(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS)).split('.');
          return `${NOMBRE_COOKIE_ACADEMIA}=${partes[0]}.${partes[1]}.${'A'.repeat(43)}`;
        },
      ],
      [
        'unos claims alterados con la firma original',
        () => {
          const valido = firmarTokenAcademia(claimsDeUsuario(e.alumnoA, AHORA_PRUEBAS)).split('.');
          const otros = Buffer.from(JSON.stringify(claimsDeUsuario(e.adminA, AHORA_PRUEBAS))).toString('base64url');
          return `${NOMBRE_COOKIE_ACADEMIA}=${valido[0]}.${otros}.${valido[2]}`;
        },
      ],
      [
        'un token firmado con otro secreto',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS), { secreto: OTRO_SECRETO_PRUEBAS }),
      ],
      ['un token con alg none', () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS), { algoritmo: 'none' })],
      [
        'un token vencido según RELOJ',
        () =>
          token(
            claimsDeUsuario(
              e.secretariaA,
              new Date(AHORA_PRUEBAS.getTime() - (DURACION_SESION_PERSONAL_SEGUNDOS + 60) * 1000),
            ),
          ),
      ],
      [
        'un token con exp igual a la hora actual',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { exp: AHORA_S })),
      ],
      [
        'un token de plataforma (tipo plataforma)',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { tipo: 'plataforma' })),
      ],
      [
        'un token con tipo distinto de academia',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { tipo: 'usuario' })),
      ],
      ['un token sin tipo', () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { tipo: undefined }))],
      ['un token sin aca', () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { aca: undefined }))],
      [
        'un token con aca que no es un UUID',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { aca: 'academia-a' })),
      ],
      [
        'un token con aca de otra academia que la del usuario',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { aca: e.B.id })),
      ],
      [
        'un token con aca de una academia que no existe',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { aca: randomUUID() })),
      ],
      [
        'un token con ver mayor que la version_token actual',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { ver: 1 })),
      ],
      ['un token sin ver', () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { ver: undefined }))],
      [
        'un token con ver que no es un número',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { ver: '0' })),
      ],
      [
        'un token con sub de un usuario que no existe',
        () => token(claimsDeUsuario({ ...e.secretariaA, id: randomUUID() }, AHORA_PRUEBAS)),
      ],
      [
        'un token con sub que no es un UUID',
        () => token(claimsDeUsuario({ ...e.secretariaA, id: 'no-es-un-uuid' }, AHORA_PRUEBAS)),
      ],
      ['un token sin sub', () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { sub: undefined }))],
      [
        'un token con sub de un usuario de B y aca de A',
        () => token(claimsDeUsuario({ ...e.secretariaB, academiaId: e.A.id }, AHORA_PRUEBAS)),
      ],
      [
        'un token con sub de un usuario de A y aca de B',
        () => token(claimsDeUsuario({ ...e.secretariaA, academiaId: e.B.id }, AHORA_PRUEBAS)),
      ],
    ])('criterio 14: responde 401 NO_AUTENTICADO con %s', async (_caso, cookie) => {
      const respuesta = await sesion(cookie());

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 14: un token con ver distinto de la version_token actual responde 401 (la base tiene una versión mayor)', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { version_token: 3 });

      const antiguo = await sesion(cookieDe(e.secretariaA));
      const actual = await sesion(cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS, {}, 3));

      expect(antiguo.status).toBe(401);
      expect(actual.status).toBe(200);
    });

    it('criterio 14: un usuario INACTIVO con un token válido responde 401', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { estado: 'INACTIVO' });

      const respuesta = await sesion(cookieDe(e.secretariaA));

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
    });

    it('criterio 14: un token válido en Authorization: Bearer, sin cookie, responde 401', async () => {
      const valido = firmarTokenAcademia(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS));

      const respuesta = await pedir(app, 'get', '/api/sesion').set('Authorization', `Bearer ${valido}`);

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
    });

    it('criterio 14: un token válido en Authorization junto con una cookie inválida responde 401', async () => {
      const valido = firmarTokenAcademia(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS));

      const respuesta = await pedir(app, 'get', '/api/sesion', { cookie: `${NOMBRE_COOKIE_ACADEMIA}=invalida` }).set(
        'Authorization',
        `Bearer ${valido}`,
      );

      expect(respuesta.status).toBe(401);
    });

    it('criterio 14: el token vale hasta exp y deja de valer después, según RELOJ (personal y alumno)', async () => {
      const personal = cookieDe(e.secretariaA);
      const alumno = cookieDe(e.alumnoA);

      reloj.avanzar((DURACION_SESION_PERSONAL_SEGUNDOS - 1) * 1000);
      const personalVigente = await sesion(personal);
      reloj.avanzar(2 * 1000);
      const personalVencido = await sesion(personal);
      const alumnoVigente = await sesion(alumno);
      reloj.avanzar((DURACION_SESION_ALUMNO_SEGUNDOS - DURACION_SESION_PERSONAL_SEGUNDOS - 1) * 1000);
      const alumnoVencido = await sesion(alumno);

      expect(personalVigente.status).toBe(200);
      expect(personalVencido.status).toBe(401);
      expect(alumnoVigente.status).toBe(200);
      expect(alumnoVencido.status).toBe(401);
    });
  });

  describe('criterio 15: academia suspendida', () => {
    const motivo = { motivo: 'Suspendida por la prueba' };

    it('criterio 15: al suspender A, toda ruta de academia responde 403 ACADEMIA_SUSPENDIDA sin ejecutar nada; al reactivarla vuelven a funcionar', async () => {
      const cookieAdmin = cookieDe(e.adminA);
      const cookieB = cookieDe(e.adminB);
      const superadmin = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
      expect((await sesion(cookieAdmin)).status).toBe(200);

      const suspension = await pedir(app, 'post', `/api/plataforma/academias/${e.A.id}/suspender`, {
        cookie: superadmin,
        cuerpo: motivo,
      });
      expect(suspension.status).toBe(200);
      const antes = await instantaneaDeUsuarios(e.A.id);
      const consultaDeSesion = await sesion(cookieAdmin);
      const listado = await pedir(app, 'get', '/api/usuarios', { cookie: cookieAdmin });
      const creacion = await pedir(app, 'post', '/api/usuarios', {
        cookie: cookieAdmin,
        cuerpo: { dni: '55550001', nombres: 'Nuevo', apellidos: 'Usuario', rol: 'SECRETARIA' },
      });
      const desactivar = await pedir(app, 'post', `/api/usuarios/${e.secretariaA.id}/desactivar`, {
        cookie: cookieAdmin,
        cuerpo: {},
      });
      const delOtraAcademia = await sesion(cookieB);

      for (const respuesta of [consultaDeSesion, listado, creacion, desactivar]) {
        expect(respuesta.status).toBe(403);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_SUSPENDIDA');
        expect(respuesta.headers['cache-control']).toBe('no-store');
      }
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id, 'USUARIO_CREADO')).toBe(0);
      expect(await contarAuditoria(e.A.id, 'USUARIO_DESACTIVADO')).toBe(0);
      expect(delOtraAcademia.status, 'la sesión de la academia B no cambia').toBe(200);

      const reactivacion = await pedir(app, 'post', `/api/plataforma/academias/${e.A.id}/reactivar`, {
        cookie: superadmin,
        cuerpo: {},
      });
      expect(reactivacion.status).toBe(200);
      expect((await sesion(cookieAdmin)).status).toBe(200);
      expect((await pedir(app, 'get', '/api/usuarios', { cookie: cookieAdmin })).status).toBe(200);
    });
  });

  describe('criterio 17: DELETE /api/sesion', () => {
    it('criterio 17: con una sesión válida responde 204, borra la cookie (Max-Age=0, Path=/api) e incrementa version_token', async () => {
      const cookie = cookieDe(e.secretariaA);
      const antes = await leerUsuario(e.A.id, e.secretariaA.id);

      const respuesta = await pedir(app, 'delete', '/api/sesion', { cookie });

      expect(respuesta.status).toBe(204);
      const borrada = cookieDeAcademia(respuesta.headers) ?? '';
      expect(borrada.startsWith(`${NOMBRE_COOKIE_ACADEMIA}=;`)).toBe(true);
      const atributos = atributosDeCookie(borrada);
      expect(atributos).toContain('max-age=0');
      expect(atributos).toContain('path=/api');
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.version_token).toBe((antes?.version_token ?? 0) + 1);
    });

    it('criterio 17: esa cookie y cualquier otra sesión de la misma cuenta dejan de valer (401)', async () => {
      const una = cookieDe(e.secretariaA);
      const otraSesionDeLaMismaCuenta = cookieDe(e.secretariaA);
      expect((await sesion(una)).status).toBe(200);
      expect((await sesion(otraSesionDeLaMismaCuenta)).status).toBe(200);

      await pedir(app, 'delete', '/api/sesion', { cookie: una });

      for (const cookie of [una, otraSesionDeLaMismaCuenta]) {
        const despues = await sesion(cookie);
        expect(despues.status).toBe(401);
        expect((despues.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      }
    });

    it('criterio 17: cerrar la sesión de una cuenta no afecta a otra cuenta ni a la del mismo DNI en otra academia', async () => {
      const mismoDniEnB = await crearUsuarioDePrueba({
        academiaId: e.B.id,
        rol: 'SECRETARIA',
        dni: e.secretariaA.dni,
        clave: CLAVE_COMUN,
      });
      const cookieB = cookieDe(mismoDniEnB);
      const cookieOtra = cookieDe(e.adminA);

      await pedir(app, 'delete', '/api/sesion', { cookie: cookieDe(e.secretariaA) });

      expect((await sesion(cookieB)).status).toBe(200);
      expect((await sesion(cookieOtra)).status).toBe(200);
      expect((await leerUsuario(e.B.id, mismoDniEnB.id))?.version_token).toBe(0);
    });

    it.each([
      ['sin cookie', () => undefined],
      ['con una cookie inválida', () => `${NOMBRE_COOKIE_ACADEMIA}=invalida`],
      [
        'con un token de otro secreto de un usuario real',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS), { secreto: OTRO_SECRETO_PRUEBAS }),
      ],
      [
        'con un token con alg none de un usuario real',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS), { algoritmo: 'none' }),
      ],
      [
        'con un token con una versión que ya no es la actual',
        () => cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS, {}, 5),
      ],
      [
        'con un token de plataforma',
        () => token(claimsDeUsuario(e.secretariaA, AHORA_PRUEBAS, { tipo: 'plataforma' })),
      ],
      [
        'con un token vencido',
        () => token(claimsDeUsuario(e.secretariaA, new Date(AHORA_PRUEBAS.getTime() - 86_400_000))),
      ],
    ])('criterio 17: %s también responde 204 y borra la cookie, sin cambiar nada más', async (_caso, cookie) => {
      const antes = await instantaneaDeUsuarios(e.A.id);
      const antesB = await instantaneaDeUsuarios(e.B.id);

      const respuesta = await pedir(app, 'delete', '/api/sesion', { cookie: cookie() });

      expect(respuesta.status).toBe(204);
      const borrada = atributosDeCookie(cookieDeAcademia(respuesta.headers) ?? '');
      expect(borrada[0]).toBe(`${NOMBRE_COOKIE_ACADEMIA}=`);
      expect(borrada).toContain('max-age=0');
      expect(borrada).toContain('path=/api');
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
    });

    it('criterio 17: cerrar dos veces seguidas con la misma cookie incrementa la versión una sola vez', async () => {
      const cookie = cookieDe(e.secretariaA);

      const primera = await pedir(app, 'delete', '/api/sesion', { cookie });
      const segunda = await pedir(app, 'delete', '/api/sesion', { cookie });

      expect([primera.status, segunda.status]).toEqual([204, 204]);
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.version_token).toBe(1);
    });

    it('criterio 17: con la academia suspendida también responde 204 y borra la cookie, sin cambiar la versión', async () => {
      const cookie = cookieDe(e.secretariaA);
      await pedir(app, 'post', `/api/plataforma/academias/${e.A.id}/suspender`, {
        cookie: cookieDeSesion(e.superadmin, AHORA_PRUEBAS),
        cuerpo: { motivo: 'Suspendida por la prueba' },
      });

      const respuesta = await pedir(app, 'delete', '/api/sesion', { cookie });

      expect(respuesta.status).toBe(204);
      expect(atributosDeCookie(cookieDeAcademia(respuesta.headers) ?? '')).toContain('max-age=0');
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.version_token).toBe(0);
    });

    it('criterio 17: no se audita (los inicios y cierres de sesión solo van al registro técnico)', async () => {
      const cierre = await pedir(app, 'delete', '/api/sesion', { cookie: cookieDe(e.secretariaA) });

      expect(cierre.status).toBe(204);
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.version_token, 'el cierre sí cambió la versión').toBe(1);
      expect(await contarAuditoria(e.A.id)).toBe(0);
    });
  });

  describe('criterio 18: toda ruta de academia exige sesión y no se cachea', () => {
    const ID = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';
    const RUTAS: [string, string][] = [
      ['GET', '/api/sesion'],
      ['GET', '/api/sesion/'],
      ['GET', '/api/Sesion'],
      ['POST', '/api/sesion/clave'],
      ['POST', '/api/sesion/clave/'],
      ['PUT', '/api/sesion'],
      ['PATCH', '/api/sesion'],
      ['GET', '/api/usuarios'],
      ['GET', '/api/usuarios/'],
      ['GET', '/api/USUARIOS'],
      ['POST', '/api/usuarios'],
      ['PUT', '/api/usuarios'],
      ['PATCH', '/api/usuarios'],
      ['DELETE', '/api/usuarios'],
      ['DELETE', `/api/usuarios/${ID}`],
      ['GET', `/api/usuarios/${ID}`],
      ['POST', `/api/usuarios/${ID}/desactivar`],
      ['POST', `/api/usuarios/${ID}/reactivar`],
      ['POST', `/api/usuarios/${ID}/restablecer-clave`],
      ['POST', '/api/usuarios/abc/restablecer-clave'],
      ['GET', '/api/usuarios/por-dni/12345678'],
      ['GET', '/api/usuarios/por-dni/no-es-un-dni'],
      ['GET', '/api/no-existe'],
      ['POST', '/api/no-existe'],
      ['DELETE', '/api/no-existe'],
      ['GET', '/api//usuarios'],
      ['GET', '/api/usuarios/%FF'],
    ];

    it.each(RUTAS)(
      'criterio 18: %s %s sin sesión responde 401 NO_AUTENTICADO con Cache-Control: no-store',
      async (metodo, ruta) => {
        const respuesta = await pedir(app, metodo.toLowerCase() as 'get', ruta).send(
          metodo === 'POST' || metodo === 'PUT' || metodo === 'PATCH'
            ? { dni: '55550001', nombres: 'Nuevo', apellidos: 'Usuario', rol: 'ADMIN' }
            : undefined,
        );

        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
        expect(respuesta.headers['cache-control']).toBe('no-store');
      },
    );

    it('criterio 18: sin sesión no se ejecuta nada y se rechaza antes de leer el cuerpo (un JSON roto responde 401 y no 400)', async () => {
      const antes = await instantaneaDeUsuarios(e.A.id);

      const roto = await pedir(app, 'post', '/api/usuarios').set('Content-Type', 'application/json').send('{"dni": ');
      const valido = await pedir(app, 'post', '/api/usuarios', {
        cuerpo: { dni: '55550001', nombres: 'Nuevo', apellidos: 'Usuario', rol: 'ADMIN' },
      });

      expect(roto.status).toBe(401);
      expect(valido.status).toBe(401);
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id)).toBe(0);
    });

    it('criterio 18: HEAD y OPTIONS sobre una ruta de academia sin sesión responden 401', async () => {
      expect((await pedir(app, 'head', '/api/usuarios')).status).toBe(401);
      expect((await pedir(app, 'options', '/api/usuarios')).status).toBe(401);
    });

    it('criterio 18: con sesión válida, una ruta inexistente responde 404 NO_ENCONTRADO', async () => {
      const cookie = cookieDe(e.adminA);

      const respuesta = await pedir(app, 'get', '/api/no-existe', { cookie });

      expect(respuesta.status).toBe(404);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 18: las respuestas de éxito y de error de las rutas de academia llevan Cache-Control: no-store', async () => {
      const cookie = cookieDe(e.adminA);

      const respuestas = [
        await pedir(app, 'get', '/api/sesion', { cookie }),
        await pedir(app, 'get', '/api/usuarios', { cookie }),
        await pedir(app, 'post', '/api/usuarios', {
          cookie,
          cuerpo: { dni: '55550001', nombres: 'Nuevo', apellidos: 'Usuario', rol: 'SECRETARIA' },
        }),
        await pedir(app, 'post', '/api/usuarios', {
          cookie,
          cuerpo: { dni: '55550001', nombres: 'Nuevo', apellidos: 'Usuario', rol: 'SECRETARIA' },
        }),
        await pedir(app, 'post', '/api/usuarios', { cookie, cuerpo: { dni: 'x' } }),
        await pedir(app, 'post', `/api/usuarios/${randomUUID()}/desactivar`, { cookie, cuerpo: {} }),
        await pedir(app, 'get', '/api/no-existe', { cookie }),
        await pedir(app, 'get', '/api/sesion'),
        await pedir(app, 'delete', '/api/sesion', { cookie: cookieDe(e.alumnoA) }),
      ];

      expect(respuestas.map((respuesta) => respuesta.status)).toEqual([200, 200, 201, 409, 400, 404, 404, 401, 204]);
      for (const respuesta of respuestas) expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 18: lo que no es de academia no cambia: /api/salud y GET /api/a/{nombreCorto} siguen siendo públicos', async () => {
      expect((await pedir(app, 'get', '/api/salud')).status).toBe(200);
      expect((await pedir(app, 'get', '/api/a/academia-a')).status).toBe(200);
      expect((await pedir(app, 'get', '/api/plataforma/academias')).status).toBe(401);
    });
  });

  describe('criterio 19: las cookies de academia y de plataforma no se mezclan', () => {
    it('criterio 19: una cookie aq_sesion válida en una ruta de /api/plataforma responde 401', async () => {
      const cookie = cookieDe(e.adminA);
      expect((await sesion(cookie)).status, 'control: la cookie es una sesión de academia válida').toBe(200);

      const rutas = await Promise.all([
        pedir(app, 'get', '/api/plataforma/academias', { cookie }),
        pedir(app, 'get', '/api/plataforma/sesion', { cookie }),
        pedir(app, 'get', `/api/plataforma/academias/${e.A.id}/administradores`, { cookie }),
        pedir(app, 'post', `/api/plataforma/academias/${e.A.id}/administradores`, {
          cookie,
          cuerpo: { dni: '55550002', nombres: 'Otro', apellidos: 'Administrador' },
        }),
      ]);

      for (const respuesta of rutas) {
        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      }
    });

    it('criterio 19: una cookie aq_plataforma válida en una ruta de academia responde 401', async () => {
      const cookie = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);

      const respuestas = await Promise.all([
        pedir(app, 'get', '/api/sesion', { cookie }),
        pedir(app, 'get', '/api/usuarios', { cookie }),
        pedir(app, 'post', '/api/usuarios', {
          cookie,
          cuerpo: { dni: '55550003', nombres: 'Nuevo', apellidos: 'Usuario', rol: 'ADMIN' },
        }),
        pedir(app, 'post', '/api/sesion/clave', {
          cookie,
          cuerpo: { claveActual: 'x', claveNueva: 'una-clave-larga-1' },
        }),
      ]);

      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      }
      expect(await instantaneaDeUsuarios(e.A.id)).not.toContain('55550003');
    });

    it('criterio 19: el token de plataforma puesto en la cookie aq_sesion, y el de academia puesto en aq_plataforma, no valen', async () => {
      const tokenPlataforma = cookieDeSesion(e.superadmin, AHORA_PRUEBAS).split('=')[1] ?? '';
      const tokenAcademia = cookieDe(e.adminA).split('=')[1] ?? '';

      const plataformaEnAcademia = await sesion(`${NOMBRE_COOKIE_ACADEMIA}=${tokenPlataforma}`);
      const academiaEnPlataforma = await pedir(app, 'get', '/api/plataforma/academias', {
        cookie: `aq_plataforma=${tokenAcademia}`,
      });
      const tokenFalsificado = await sesion(
        token({ sub: e.superadmin.id, tipo: 'academia', aca: e.A.id, ver: 0, iat: AHORA_S, exp: AHORA_S + 3600 }),
      );

      expect(plataformaEnAcademia.status).toBe(401);
      expect(academiaEnPlataforma.status).toBe(401);
      expect(tokenFalsificado.status, 'un id de superadmin no es un usuario de academia').toBe(401);
    });

    it('criterio 19: con las dos cookies a la vez, cada una vale solo en sus rutas', async () => {
      const ambas = `${cookieDe(e.adminA)}; ${cookieDeSesion(e.superadmin, AHORA_PRUEBAS)}`;

      const deAcademia = await pedir(app, 'get', '/api/usuarios', { cookie: ambas });
      const dePlataforma = await pedir(app, 'get', '/api/plataforma/academias', { cookie: ambas });

      expect(deAcademia.status).toBe(200);
      expect(dePlataforma.status).toBe(200);
    });

    it('criterio 19: el ingreso de academia pone aq_sesion y no la cookie de plataforma', async () => {
      const ingreso = await pedir(app, 'post', '/api/a/academia-a/sesion', {
        cuerpo: { usuario: e.adminA.dni, clave: CLAVE_COMUN },
      });

      expect(cookieDeAcademia(ingreso.headers)).toBeDefined();
      expect(cookieDePlataforma(ingreso.headers)).toBeUndefined();
    });
  });

  describe('criterio 20: la academia sale siempre de la sesión', () => {
    it('criterio 20: con sesión de A, pedir con ids de usuarios de B responde 404 y no cambia nada en B', async () => {
      const cookie = cookieDe(e.adminA);
      // Control: con la misma sesión, el id de un usuario de A sí se encuentra.
      expect((await pedir(app, 'get', `/api/usuarios/por-dni/${e.alumnoA.dni}`, { cookie })).status).toBe(200);
      const antesB = await instantaneaDeUsuarios(e.B.id);

      const respuestas = [
        await pedir(app, 'post', `/api/usuarios/${e.secretariaB.id}/desactivar`, { cookie, cuerpo: {} }),
        await pedir(app, 'post', `/api/usuarios/${e.adminB.id}/desactivar`, { cookie, cuerpo: {} }),
        await pedir(app, 'post', `/api/usuarios/${e.secretariaB.id}/reactivar`, { cookie, cuerpo: {} }),
        await pedir(app, 'post', `/api/usuarios/${e.secretariaB.id}/restablecer-clave`, { cookie, cuerpo: {} }),
        await pedir(app, 'post', `/api/usuarios/${e.alumnoB.id}/restablecer-clave`, { cookie, cuerpo: {} }),
        await pedir(app, 'get', `/api/usuarios/por-dni/${e.secretariaB.dni}`, { cookie }),
        await pedir(app, 'get', `/api/usuarios/por-dni/${e.alumnoB.dni}`, { cookie }),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(404);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
      }
      expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
      expect(await contarAuditoria(e.B.id)).toBe(0);
      expect(await contarAuditoria(e.A.id)).toBe(0);
    });

    it('criterio 20: un cuerpo con un campo academiaId responde 400 SOLICITUD_INVALIDA y no cambia nada', async () => {
      const cookie = cookieDe(e.adminA);
      const antes = await instantaneaDeUsuarios(e.A.id);
      const antesB = await instantaneaDeUsuarios(e.B.id);

      const respuestas = [
        await pedir(app, 'post', '/api/usuarios', {
          cookie,
          cuerpo: { dni: '55550004', nombres: 'Nuevo', apellidos: 'Usuario', rol: 'ADMIN', academiaId: e.B.id },
        }),
        await pedir(app, 'post', `/api/usuarios/${e.secretariaA.id}/desactivar`, {
          cookie,
          cuerpo: { academiaId: e.B.id },
        }),
        await pedir(app, 'post', `/api/usuarios/${e.secretariaA.id}/restablecer-clave`, {
          cookie,
          cuerpo: { academiaId: e.A.id },
        }),
        await pedir(app, 'post', '/api/sesion/clave', {
          cookie,
          cuerpo: { claveActual: CLAVE_COMUN, claveNueva: 'Una-Clave-Nueva-1', academiaId: e.B.id },
        }),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      }
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
    });

    it('criterio 20: una academia en la consulta o en una cabecera no cambia la academia de la petición', async () => {
      const cookie = cookieDe(e.adminA);

      const porConsulta = await pedir(app, 'get', `/api/usuarios?academiaId=${e.B.id}&nombreCorto=academia-b`, {
        cookie,
      });
      const porCabecera = await pedir(app, 'get', '/api/usuarios', { cookie })
        .set('X-Academia-Id', e.B.id)
        .set('X-Academia', 'academia-b');

      for (const respuesta of [porConsulta, porCabecera]) {
        expect(respuesta.status).toBe(200);
        const dnis = (cuerpoDe(respuesta) as { usuarios: { dni: string }[] }).usuarios.map((usuario) => usuario.dni);
        expect(dnis).toContain(e.adminA.dni);
        expect(dnis).not.toContain(e.adminB.dni);
        expect(dnis).not.toContain(e.secretariaB.dni);
      }
    });

    it('criterio 20: la sesión de B muestra siempre la academia B, aunque la dirección de la web sea la de A', async () => {
      const respuesta = await sesion(cookieDe(e.adminB));

      expect(
        (cuerpoDe(respuesta) as { usuario: { academia: { nombreCorto: string } } }).usuario.academia.nombreCorto,
      ).toBe('academia-b');
    });
  });
});
