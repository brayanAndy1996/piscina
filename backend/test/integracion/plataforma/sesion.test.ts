// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { leerSuperadmin } from '../../utilidades/datos';
import {
  CLAVE_SUPERADMIN_PRUEBAS,
  DURACION_SESION_SEGUNDOS,
  NOMBRE_COOKIE_PLATAFORMA,
  claimsDeSesion,
  cookieDePlataforma,
  cookieDeSesion,
  crearSuperadminDePrueba,
  decodificarToken,
  firmarTokenPlataforma,
  iniciarSesionPlataforma,
  type SuperadminDePrueba,
} from '../../utilidades/superadmins';

const AHORA = new Date('2026-11-11T15:00:00.000Z'); // 10:00 en America/Lima
const QUINCE_MINUTOS = 15 * 60 * 1000;

interface ErrorCuerpo {
  codigo: string;
  mensaje: string;
  detalles?: unknown;
}

describe('sesión del superadmin', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let superadmin: SuperadminDePrueba;

  const servidor = () => app.getHttpServer();
  const iniciar = (correo: string, clave: string) =>
    request(servidor()).post('/api/plataforma/sesion').send({ correo, clave });
  const fallar = () => iniciar(superadmin.correo, 'clave-equivocada-123');
  const entrar = () => iniciar(superadmin.correo, superadmin.clave);

  async function crearApp(variables?: Record<string, string | undefined>): Promise<NestExpressApplication> {
    return crearAppDePruebas({
      variables,
      nivelRegistro: 'silent',
      ajustar: (constructor) => constructor.overrideProvider(RELOJ).useValue(reloj),
    });
  }

  // Cada prueba crea su aplicación: así el límite por IP (10 por minuto) arranca en cero.
  beforeEach(async () => {
    await limpiarBase();
    reloj = new RelojFijo(AHORA);
    superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test', nombre: 'Dueño' });
    app = await crearApp();
  });
  afterEach(async () => {
    await app.close();
  });

  describe('criterio 36: iniciar sesión', () => {
    it('criterio 36: con credenciales correctas responde 200 con { superadmin: { id, correo, nombre } } sin token ni hash', async () => {
      const respuesta = await entrar();

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        superadmin: { id: superadmin.id, correo: 'dueno@aquagestion.test', nombre: 'Dueño' },
      });
      expect(JSON.stringify(respuesta.body)).not.toMatch(/argon2|hash|token/i);
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 36: la cookie aq_plataforma es HttpOnly, SameSite=Strict, Path=/api/plataforma y Max-Age=28800, sin Secure', async () => {
      const respuesta = await entrar();

      const cookie = cookieDePlataforma(respuesta.headers);
      expect(cookie, 'falta la cabecera Set-Cookie con aq_plataforma').toBeDefined();
      const [par, ...atributos] = (cookie ?? '').split(';').map((parte) => parte.trim());
      expect(par).toMatch(new RegExp(`^${NOMBRE_COOKIE_PLATAFORMA}=[^=;\\s]+`));
      const minusculas = atributos.map((atributo) => atributo.toLowerCase());
      expect(minusculas).toContain('httponly');
      expect(minusculas).toContain('samesite=strict');
      expect(minusculas).toContain('path=/api/plataforma');
      expect(minusculas).toContain('max-age=28800');
      expect(minusculas).not.toContain('secure');
    });

    it('criterio 36: con NODE_ENV=production la cookie lleva Secure', async () => {
      await app.close();
      app = await crearApp({ NODE_ENV: 'production' });

      const respuesta = await entrar();

      expect(respuesta.status).toBe(200);
      const atributos = (cookieDePlataforma(respuesta.headers) ?? '')
        .split(';')
        .map((parte) => parte.trim().toLowerCase());
      expect(atributos).toContain('secure');
      expect(atributos).toContain('httponly');
      expect(atributos).toContain('samesite=strict');
    });

    it('criterio 36: pone intentos_fallidos en 0 y ultimo_acceso en RELOJ.ahora()', async () => {
      await ejecutarComo(
        'propietario',
        'UPDATE superadmins SET intentos_fallidos = 3 WHERE id = $1::uuid',
        [superadmin.id],
        { plataforma: true },
      );

      const respuesta = await entrar();

      expect(respuesta.status).toBe(200);
      const fila = await leerSuperadmin(superadmin.id);
      expect(fila?.intentos_fallidos).toBe(0);
      expect(fila?.ultimo_acceso?.toISOString()).toBe(AHORA.toISOString());
    });

    it('criterio 36: acepta el correo con espacios en los extremos y con mayúsculas', async () => {
      const respuesta = await iniciar(`  ${superadmin.correo.toUpperCase()}  `, superadmin.clave);

      expect(respuesta.status).toBe(200);
      expect((respuesta.body as { superadmin: { correo: string } }).superadmin.correo).toBe('dueno@aquagestion.test');
    });

    it('criterio 36: iniciarSesionPlataforma devuelve el valor para la cabecera Cookie', async () => {
      const cookie = await iniciarSesionPlataforma(app, { correo: superadmin.correo, clave: superadmin.clave });

      expect(cookie).toMatch(new RegExp(`^${NOMBRE_COOKIE_PLATAFORMA}=[\\w-]+\\.[\\w-]+\\.[\\w-]+$`));
    });
  });

  describe('criterio 37: el token de sesión', () => {
    it('criterio 37: es un JWT HS256 firmado con JWT_SECRETO con sub, tipo, ver, iat y exp tomados de RELOJ', async () => {
      const respuesta = await entrar();
      const token = (cookieDePlataforma(respuesta.headers) ?? '').split(';')[0]?.split('=')[1] ?? '';

      const { cabecera, claims, firmaValida } = decodificarToken(token);

      expect(cabecera['alg']).toBe('HS256');
      expect(firmaValida, 'la firma no corresponde a HS256 con JWT_SECRETO').toBe(true);
      const iat = Math.floor(AHORA.getTime() / 1000);
      expect(claims).toMatchObject({ sub: superadmin.id, tipo: 'plataforma', ver: 0, iat });
      expect(claims['exp']).toBe(iat + DURACION_SESION_SEGUNDOS);
      expect(DURACION_SESION_SEGUNDOS).toBe(28_800);
    });

    it('criterio 37: el token lleva la version_token actual del superadmin', async () => {
      await ejecutarComo(
        'propietario',
        'UPDATE superadmins SET version_token = 7 WHERE id = $1::uuid',
        [superadmin.id],
        {
          plataforma: true,
        },
      );

      const respuesta = await entrar();
      const token = (cookieDePlataforma(respuesta.headers) ?? '').split(';')[0]?.split('=')[1] ?? '';

      expect(decodificarToken(token).claims['ver']).toBe(7);
    });

    it('criterio 37: la sesión vale hasta exp y deja de valer después, según RELOJ', async () => {
      const cookie = await iniciarSesionPlataforma(app, { correo: superadmin.correo, clave: superadmin.clave });

      reloj.avanzar((DURACION_SESION_SEGUNDOS - 1) * 1000);
      const vigente = await request(servidor()).get('/api/plataforma/sesion').set('Cookie', cookie);
      reloj.avanzar(2 * 1000);
      const vencida = await request(servidor()).get('/api/plataforma/sesion').set('Cookie', cookie);

      expect(vigente.status).toBe(200);
      expect(vencida.status).toBe(401);
      expect((vencida.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
    });
  });

  describe('criterio 38: credenciales inválidas', () => {
    it('criterio 38: clave equivocada y correo inexistente responden 401 CREDENCIALES_INVALIDAS con el mismo cuerpo y sin cookie', async () => {
      const clave = await fallar();
      const correo = await iniciar('nadie@aquagestion.test', 'clave-equivocada-123');

      for (const respuesta of [clave, correo]) {
        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('CREDENCIALES_INVALIDAS');
        expect(respuesta.headers['set-cookie']).toBeUndefined();
      }
      expect(clave.body).toEqual(correo.body);
    });

    it('criterio 38: un correo inexistente no cuenta intentos de ningún superadmin', async () => {
      for (let i = 0; i < 3; i++) await iniciar('nadie@aquagestion.test', 'clave-equivocada-123');

      expect((await leerSuperadmin(superadmin.id))?.intentos_fallidos).toBe(0);
    });
  });

  describe('criterio 39: bloqueo', () => {
    it('criterio 39: los 4 primeros fallos responden 401 y el 5.º responde 423 CUENTA_BLOQUEADA con bloqueado_hasta = ahora + 15 min', async () => {
      for (let i = 1; i <= 4; i++) {
        const respuesta = await fallar();
        expect(respuesta.status, `intento ${i}`).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('CREDENCIALES_INVALIDAS');
      }

      const quinto = await fallar();

      expect(quinto.status).toBe(423);
      expect((quinto.body as ErrorCuerpo).codigo).toBe('CUENTA_BLOQUEADA');
      expect(quinto.headers['set-cookie']).toBeUndefined();
      const fila = await leerSuperadmin(superadmin.id);
      expect(fila?.bloqueado_hasta?.toISOString()).toBe(new Date(AHORA.getTime() + QUINCE_MINUTOS).toISOString());
    });

    it('criterio 39: mientras dura el bloqueo, incluso la clave correcta responde 423 sin cookie ni cambiar el contador', async () => {
      for (let i = 0; i < 5; i++) await fallar();
      const antes = await leerSuperadmin(superadmin.id);

      reloj.avanzar(14 * 60 * 1000 + 59_000);
      const conClaveCorrecta = await entrar();
      const conClaveEquivocada = await fallar();

      for (const respuesta of [conClaveCorrecta, conClaveEquivocada]) {
        expect(respuesta.status).toBe(423);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('CUENTA_BLOQUEADA');
        expect(respuesta.headers['set-cookie']).toBeUndefined();
      }
      const despues = await leerSuperadmin(superadmin.id);
      expect(despues?.intentos_fallidos).toBe(antes?.intentos_fallidos);
      expect(despues?.bloqueado_hasta?.toISOString()).toBe(antes?.bloqueado_hasta?.toISOString());
    });

    it('criterio 39: cumplidos los 15 minutos, la clave correcta entra y deja el contador en 0', async () => {
      for (let i = 0; i < 5; i++) await fallar();

      reloj.avanzar(QUINCE_MINUTOS);
      const respuesta = await entrar();

      expect(respuesta.status).toBe(200);
      expect(cookieDePlataforma(respuesta.headers)).toBeDefined();
      const fila = await leerSuperadmin(superadmin.id);
      expect(fila?.intentos_fallidos).toBe(0);
      expect(fila?.bloqueado_hasta).toBeNull();
    });

    it('criterio 39: cumplidos los 15 minutos, una clave equivocada vuelve a contar desde 1', async () => {
      for (let i = 0; i < 5; i++) await fallar();

      reloj.avanzar(QUINCE_MINUTOS);
      const respuesta = await fallar();

      expect(respuesta.status).toBe(401);
      expect((await leerSuperadmin(superadmin.id))?.intentos_fallidos).toBe(1);
    });

    it('criterio 39: un ingreso correcto antes del 5.º fallo pone el contador en 0', async () => {
      for (let i = 0; i < 4; i++) await fallar();
      expect((await leerSuperadmin(superadmin.id))?.intentos_fallidos).toBe(4);

      const ingreso = await entrar();
      expect(ingreso.status).toBe(200);
      expect((await leerSuperadmin(superadmin.id))?.intentos_fallidos).toBe(0);

      for (let i = 1; i <= 4; i++) expect((await fallar()).status, `intento ${i} tras el ingreso`).toBe(401);
    });
  });

  describe('criterio 42: entradas inválidas', () => {
    it.each([
      ['un cuerpo que no es JSON (texto plano)', (r: request.Test) => r.set('Content-Type', 'text/plain').send('hola')],
      ['un JSON roto', (r: request.Test) => r.set('Content-Type', 'application/json').send('{"correo": ')],
      ['sin cuerpo', (r: request.Test) => r],
      [
        'campos de más',
        (r: request.Test) => r.send({ correo: 'dueno@aquagestion.test', clave: CLAVE_SUPERADMIN_PRUEBAS, extra: 1 }),
      ],
      [
        'un correo de más de 254 caracteres',
        (r: request.Test) => r.send({ correo: `${'a'.repeat(250)}@aquagestion.test`, clave: CLAVE_SUPERADMIN_PRUEBAS }),
      ],
      ['una clave vacía', (r: request.Test) => r.send({ correo: 'dueno@aquagestion.test', clave: '' })],
      [
        'una clave de más de 128 caracteres',
        (r: request.Test) => r.send({ correo: 'dueno@aquagestion.test', clave: 'x'.repeat(129) }),
      ],
      ['una clave que no es texto', (r: request.Test) => r.send({ correo: 'dueno@aquagestion.test', clave: 12345 })],
      [
        'un correo que no es un correo',
        (r: request.Test) => r.send({ correo: 'dueno', clave: CLAVE_SUPERADMIN_PRUEBAS }),
      ],
      ['sin la clave', (r: request.Test) => r.send({ correo: 'dueno@aquagestion.test' })],
    ])('criterio 42: %s responde 400 SOLICITUD_INVALIDA y no cuenta un intento', async (_caso, preparar) => {
      const respuesta = await preparar(request(servidor()).post('/api/plataforma/sesion'));

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      expect(respuesta.headers['set-cookie']).toBeUndefined();
      expect((await leerSuperadmin(superadmin.id))?.intentos_fallidos).toBe(0);
    });
  });

  describe('criterio 43: GET /api/plataforma/sesion', () => {
    const consultar = (cookie?: string) => {
      const peticion = request(servidor()).get('/api/plataforma/sesion');
      return cookie ? peticion.set('Cookie', cookie) : peticion;
    };

    it('criterio 43: con una cookie válida responde 200 con { superadmin }', async () => {
      const respuesta = await consultar(cookieDeSesion(superadmin, AHORA));

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        superadmin: { id: superadmin.id, correo: 'dueno@aquagestion.test', nombre: 'Dueño' },
      });
    });

    it('criterio 43: la cookie que entrega el inicio de sesión también sirve', async () => {
      const cookie = await iniciarSesionPlataforma(app, { correo: superadmin.correo, clave: superadmin.clave });

      expect((await consultar(cookie)).status).toBe(200);
    });

    const token = (claims: Record<string, unknown>, opciones?: Parameters<typeof firmarTokenPlataforma>[1]) =>
      `${NOMBRE_COOKIE_PLATAFORMA}=${firmarTokenPlataforma(claims, opciones)}`;

    it.each([
      ['sin cookie', () => undefined],
      ['una cookie vacía', () => `${NOMBRE_COOKIE_PLATAFORMA}=`],
      ['un valor que no es un token', () => `${NOMBRE_COOKIE_PLATAFORMA}=esto-no-es-un-jwt`],
      [
        'una firma alterada',
        () => {
          const valido = firmarTokenPlataforma(claimsDeSesion(superadmin, AHORA));
          const partes = valido.split('.');
          return `${NOMBRE_COOKIE_PLATAFORMA}=${partes[0]}.${partes[1]}.${'A'.repeat(43)}`;
        },
      ],
      [
        'unos claims alterados con la firma original',
        () => {
          const valido = firmarTokenPlataforma(claimsDeSesion(superadmin, AHORA)).split('.');
          const otros = Buffer.from(JSON.stringify(claimsDeSesion({ id: randomUUID() }, AHORA))).toString('base64url');
          return `${NOMBRE_COOKIE_PLATAFORMA}=${valido[0]}.${otros}.${valido[2]}`;
        },
      ],
      [
        'un token firmado con otro secreto',
        () => token(claimsDeSesion(superadmin, AHORA), { secreto: 'otro-secreto-distinto-de-32-o-mas-caracteres-xyz' }),
      ],
      ['un token con alg none', () => token(claimsDeSesion(superadmin, AHORA), { algoritmo: 'none' })],
      [
        'un token vencido según RELOJ',
        () => token(claimsDeSesion(superadmin, new Date(AHORA.getTime() - (DURACION_SESION_SEGUNDOS + 60) * 1000))),
      ],
      [
        'un token con exp igual a la hora actual',
        () => token(claimsDeSesion(superadmin, AHORA, { exp: Math.floor(AHORA.getTime() / 1000) })),
      ],
      ['un token con tipo distinto de plataforma', () => token(claimsDeSesion(superadmin, AHORA, { tipo: 'usuario' }))],
      ['un token sin tipo', () => token(claimsDeSesion(superadmin, AHORA, { tipo: undefined }))],
      [
        'un token con ver distinto del version_token actual',
        () => token(claimsDeSesion(superadmin, AHORA, { ver: 1 })),
      ],
      ['un token sin ver', () => token(claimsDeSesion(superadmin, AHORA, { ver: undefined }))],
      ['un token con sub de un superadmin que no existe', () => token(claimsDeSesion({ id: randomUUID() }, AHORA))],
      ['un token con sub que no es un UUID', () => token(claimsDeSesion({ id: 'no-es-un-uuid' }, AHORA))],
    ])('criterio 43: responde 401 NO_AUTENTICADO con %s', async (_caso, cookie) => {
      const respuesta = await consultar(cookie());

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
    });

    it('criterio 43: un token válido en Authorization: Bearer, sin cookie, responde 401', async () => {
      const valido = firmarTokenPlataforma(claimsDeSesion(superadmin, AHORA));

      const respuesta = await request(servidor())
        .get('/api/plataforma/sesion')
        .set('Authorization', `Bearer ${valido}`);

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
    });

    it('criterio 43: un token válido en Authorization junto con una cookie inválida responde 401', async () => {
      const valido = firmarTokenPlataforma(claimsDeSesion(superadmin, AHORA));

      const respuesta = await request(servidor())
        .get('/api/plataforma/sesion')
        .set('Authorization', `Bearer ${valido}`)
        .set('Cookie', `${NOMBRE_COOKIE_PLATAFORMA}=invalida`);

      expect(respuesta.status).toBe(401);
    });
  });

  describe('criterio 44: DELETE /api/plataforma/sesion', () => {
    it('criterio 44: con una sesión válida responde 204, borra la cookie e incrementa version_token', async () => {
      const cookie = await iniciarSesionPlataforma(app, { correo: superadmin.correo, clave: superadmin.clave });
      const antes = await leerSuperadmin(superadmin.id);

      const respuesta = await request(servidor()).delete('/api/plataforma/sesion').set('Cookie', cookie);

      expect(respuesta.status).toBe(204);
      const borrada = cookieDePlataforma(respuesta.headers) ?? '';
      expect(borrada.startsWith(`${NOMBRE_COOKIE_PLATAFORMA}=;`)).toBe(true);
      const atributos = borrada.split(';').map((parte) => parte.trim().toLowerCase());
      expect(atributos).toContain('max-age=0');
      expect(atributos).toContain('path=/api/plataforma');
      expect((await leerSuperadmin(superadmin.id))?.version_token).toBe((antes?.version_token ?? 0) + 1);
    });

    it('criterio 44: la cookie anterior ya no sirve (401)', async () => {
      const cookie = await iniciarSesionPlataforma(app, { correo: superadmin.correo, clave: superadmin.clave });
      expect((await request(servidor()).get('/api/plataforma/sesion').set('Cookie', cookie)).status).toBe(200);

      await request(servidor()).delete('/api/plataforma/sesion').set('Cookie', cookie);

      const despues = await request(servidor()).get('/api/plataforma/sesion').set('Cookie', cookie);
      expect(despues.status).toBe(401);
      expect((despues.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
    });

    it.each([
      ['sin cookie', () => undefined],
      ['con una cookie inválida', () => `${NOMBRE_COOKIE_PLATAFORMA}=invalida`],
      [
        'con un token de otro secreto',
        () =>
          `${NOMBRE_COOKIE_PLATAFORMA}=${firmarTokenPlataforma(claimsDeSesion(superadmin, AHORA), { secreto: 'otro-secreto-distinto-de-32-o-mas-caracteres-xyz' })}`,
      ],
    ])('criterio 44: %s también responde 204 y borra la cookie, sin cambiar nada más', async (_caso, cookie) => {
      const antes = await leerSuperadmin(superadmin.id);
      const peticion = request(servidor()).delete('/api/plataforma/sesion');
      const valor = cookie();

      const respuesta = await (valor ? peticion.set('Cookie', valor) : peticion);

      expect(respuesta.status).toBe(204);
      const borrada = (cookieDePlataforma(respuesta.headers) ?? '')
        .split(';')
        .map((parte) => parte.trim().toLowerCase());
      expect(borrada[0]).toBe(`${NOMBRE_COOKIE_PLATAFORMA}=`);
      expect(borrada).toContain('max-age=0');
      expect(borrada).toContain('path=/api/plataforma');
      expect(await leerSuperadmin(superadmin.id)).toEqual(antes);
    });
  });

  describe('criterio 45: todo lo demás bajo /api/plataforma/ exige sesión', () => {
    const RUTAS: [string, string][] = [
      ['GET', '/api/plataforma/sesion'],
      ['PUT', '/api/plataforma/sesion'],
      ['PATCH', '/api/plataforma/sesion'],
      ['GET', '/api/plataforma/academias'],
      ['POST', '/api/plataforma/academias'],
      ['DELETE', '/api/plataforma/academias'],
      ['GET', `/api/plataforma/academias/${randomUUID()}`],
      ['DELETE', `/api/plataforma/academias/${randomUUID()}`],
      ['POST', `/api/plataforma/academias/${randomUUID()}/suspender`],
      ['POST', `/api/plataforma/academias/${randomUUID()}/reactivar`],
      ['POST', '/api/plataforma/academias/abc/suspender'],
      ['GET', '/api/plataforma/'],
      ['GET', '/api/plataforma/no-existe'],
      ['POST', '/api/plataforma/no-existe'],
      ['GET', '/api/plataforma/superadmins'],
    ];

    it.each(RUTAS)('criterio 45: %s %s sin sesión responde 401 NO_AUTENTICADO', async (metodo, ruta) => {
      const peticion = request(servidor())[metodo.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](ruta);

      const respuesta = await peticion.send(
        metodo === 'POST' || metodo === 'PUT' || metodo === 'PATCH'
          ? { nombre: 'Academia nueva', nombreCorto: 'academia-nueva', motivo: 'Motivo de prueba' }
          : undefined,
      );

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
    });

    it('criterio 45: sin sesión no se ejecuta nada: POST /api/plataforma/academias no crea la academia', async () => {
      const respuesta = await request(servidor())
        .post('/api/plataforma/academias')
        .send({ nombre: 'Academia sin sesión', nombreCorto: 'sin-sesion' });

      expect(respuesta.status).toBe(401);
      const { rows } = await ejecutarComo('propietario', 'SELECT count(*)::int AS n FROM academias', [], {
        plataforma: true,
      });
      expect((rows[0] as { n: number }).n).toBe(0);
    });

    it('criterio 45: con una cookie de sesión válida, una ruta que no existe ya no responde 401', async () => {
      const respuesta = await request(servidor())
        .get('/api/plataforma/no-existe')
        .set('Cookie', cookieDeSesion(superadmin, AHORA));

      expect(respuesta.status).toBe(404);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
    });
  });
});
