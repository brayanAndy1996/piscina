// spec: 002-autenticacion-roles (pruebas protegidas)
import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodificarToken } from '../../utilidades/superadmins';
import {
  AHORA_PRUEBAS,
  actualizarUsuario,
  atributosDeCookie,
  CLAVE_COMUN,
  cookieDeAcademia,
  cuerpoDe,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  DURACION_SESION_ALUMNO_SEGUNDOS,
  DURACION_SESION_PERSONAL_SEGUNDOS,
  type ErrorCuerpo,
  type Escenario,
  fijarEstadoDeAcademia,
  iniciarSesionAcademia,
  leerUsuario,
  NOMBRE_COOKIE_ACADEMIA,
  pedir,
  tokenDeCookie,
} from '../../utilidades/usuarios';
import type { RelojFijo } from '../../../src/infraestructura/reloj';

// Criterios 5 a 8, 10, 11 y 13: inicio de sesión en una academia (`POST /api/a/{nombreCorto}/sesion`). Cada prueba crea su
// aplicación: el límite por IP (10 por minuto, criterio 12) arranca en cero y ninguna prueba pasa de 10 peticiones de ingreso.

/** Un secreto que producción acepta (criterio 79 de la 001): se genera al ejecutar. */
const JWT_SECRETO_PRODUCCION_PRUEBAS = randomBytes(32).toString('base64url');

describe('inicio de sesión de una academia', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let e: Escenario;

  const ingresar = (nombreCorto: string, cuerpo: unknown) =>
    pedir(app, 'post', `/api/a/${nombreCorto}/sesion`, { cuerpo });

  beforeEach(async () => {
    e = await crearEscenario();
    ({ app, reloj } = await crearAppConReloj());
  });
  afterEach(async () => {
    await app?.close();
  });

  describe('criterio 5: ingreso correcto', () => {
    it('criterio 5: responde 200 con RespuestaSesionAcademia, sin token ni hash en el cuerpo, y Cache-Control: no-store', async () => {
      const respuesta = await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: CLAVE_COMUN });

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
      expect(JSON.stringify(respuesta.body)).not.toMatch(/argon2|hash|token/i);
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 5: la respuesta indica debeCambiarClave = true cuando la cuenta debe cambiarla', async () => {
      const nuevo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', debeCambiarClave: true });

      const respuesta = await ingresar('academia-a', { usuario: nuevo.dni, clave: nuevo.dni });

      expect(respuesta.status).toBe(200);
      expect((cuerpoDe(respuesta) as { usuario: { debeCambiarClave: boolean } }).usuario.debeCambiarClave).toBe(true);
    });

    it('criterio 5: la cookie aq_sesion es HttpOnly, SameSite=Strict, Path=/api y Max-Age=43200 para el personal, sin Secure', async () => {
      const respuesta = await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: CLAVE_COMUN });

      const cookie = cookieDeAcademia(respuesta.headers);
      expect(cookie, 'falta la cabecera Set-Cookie con aq_sesion').toBeDefined();
      const [par, ...atributos] = atributosDeCookie(cookie ?? '');
      expect(par).toMatch(new RegExp(`^${NOMBRE_COOKIE_ACADEMIA}=[^=;\\s]+`));
      expect(atributos).toContain('httponly');
      expect(atributos).toContain('samesite=strict');
      expect(atributos).toContain('path=/api');
      expect(atributos).toContain(`max-age=${DURACION_SESION_PERSONAL_SEGUNDOS}`);
      expect(atributos).not.toContain('secure');
    });

    it.each([
      ['ADMIN', DURACION_SESION_PERSONAL_SEGUNDOS],
      ['ENTRENADOR', DURACION_SESION_PERSONAL_SEGUNDOS],
      ['ALUMNO', DURACION_SESION_ALUMNO_SEGUNDOS],
    ] as const)('criterio 5: la duración de la sesión de un %s es %s segundos', async (rol, segundos) => {
      const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol });

      const respuesta = await ingresar('academia-a', { usuario: usuario.dni, clave: usuario.clave });

      expect(respuesta.status).toBe(200);
      expect(atributosDeCookie(cookieDeAcademia(respuesta.headers) ?? '')).toContain(`max-age=${segundos}`);
    });

    it('criterio 5: con NODE_ENV=production la cookie lleva Secure', async () => {
      await app.close();
      // En producción rige el criterio 79 de la 001: el secreto público de las pruebas no arranca; se usa uno robusto.
      ({ app, reloj } = await crearAppConReloj(AHORA_PRUEBAS, {
        variables: { NODE_ENV: 'production', JWT_SECRETO: JWT_SECRETO_PRODUCCION_PRUEBAS },
      }));

      const respuesta = await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: CLAVE_COMUN });

      expect(respuesta.status).toBe(200);
      const atributos = atributosDeCookie(cookieDeAcademia(respuesta.headers) ?? '');
      expect(atributos).toContain('secure');
      expect(atributos).toContain('httponly');
      expect(atributos).toContain('samesite=strict');
      expect(atributos).toContain('path=/api');
    });

    it('criterio 5: pone intentos_fallidos en 0 y ultimo_acceso en RELOJ.ahora()', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { intentos_fallidos: 3 });

      const respuesta = await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: CLAVE_COMUN });

      expect(respuesta.status).toBe(200);
      const fila = await leerUsuario(e.A.id, e.secretariaA.id);
      expect(fila?.intentos_fallidos).toBe(0);
      expect(fila?.ultimo_acceso?.toISOString()).toBe(AHORA_PRUEBAS.toISOString());
      expect(reloj.ahora().toISOString()).toBe(AHORA_PRUEBAS.toISOString());
    });

    it('criterio 5: el DNI se acepta con espacios en los extremos', async () => {
      const respuesta = await ingresar('academia-a', { usuario: `  ${e.secretariaA.dni}  `, clave: CLAVE_COMUN });

      expect(respuesta.status).toBe(200);
      expect((cuerpoDe(respuesta) as { usuario: { id: string } }).usuario.id).toBe(e.secretariaA.id);
    });

    it('criterio 5: un DNI con ceros a la izquierda es texto y se compara tal cual', async () => {
      const conCeros = await crearUsuarioDePrueba({
        academiaId: e.A.id,
        rol: 'ENTRENADOR',
        dni: '01234567',
        clave: 'Clave-Con-Ceros-1',
      });

      const respuesta = await ingresar('academia-a', { usuario: conCeros.dni, clave: conCeros.clave });

      expect(respuesta.status).toBe(200);
      expect((cuerpoDe(respuesta) as { usuario: { id: string } }).usuario.id).toBe(conCeros.id);
    });

    it('criterio 5: iniciarSesionAcademia devuelve el valor para la cabecera Cookie', async () => {
      const cookie = await iniciarSesionAcademia(app, 'academia-a', { usuario: e.adminA.dni, clave: CLAVE_COMUN });

      expect(cookie).toMatch(new RegExp(`^${NOMBRE_COOKIE_ACADEMIA}=[\\w-]+\\.[\\w-]+\\.[\\w-]+$`));
    });
  });

  describe('criterio 6: el token de sesión', () => {
    it('criterio 6: es un JWT HS256 firmado con JWT_SECRETO con sub, tipo, aca, ver, iat y exp tomados de RELOJ', async () => {
      const respuesta = await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: CLAVE_COMUN });
      const token = tokenDeCookie(cookieDeAcademia(respuesta.headers) ?? '');

      const { cabecera, claims, firmaValida } = decodificarToken(token);

      expect(cabecera['alg']).toBe('HS256');
      expect(firmaValida, 'la firma no corresponde a HS256 con JWT_SECRETO').toBe(true);
      const iat = Math.floor(AHORA_PRUEBAS.getTime() / 1000);
      expect(claims).toMatchObject({ sub: e.secretariaA.id, tipo: 'academia', aca: e.A.id, ver: 0, iat });
      expect(claims['exp']).toBe(iat + DURACION_SESION_PERSONAL_SEGUNDOS);
    });

    it('criterio 6: la duración del alumno es de 30 días', async () => {
      const respuesta = await ingresar('academia-a', { usuario: e.alumnoA.dni, clave: CLAVE_COMUN });
      const { claims } = decodificarToken(tokenDeCookie(cookieDeAcademia(respuesta.headers) ?? ''));

      const iat = Math.floor(AHORA_PRUEBAS.getTime() / 1000);
      expect(claims['exp']).toBe(iat + DURACION_SESION_ALUMNO_SEGUNDOS);
    });

    it('criterio 6: no lleva el DNI, el nombre ni el rol', async () => {
      const respuesta = await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: CLAVE_COMUN });
      const token = tokenDeCookie(cookieDeAcademia(respuesta.headers) ?? '');

      const { claims } = decodificarToken(token);

      for (const prohibido of ['dni', 'usuario', 'nombres', 'apellidos', 'nombre', 'rol', 'clave']) {
        expect(Object.keys(claims), `claim ${prohibido}`).not.toContain(prohibido);
      }
      const crudo = JSON.stringify(claims);
      expect(crudo).not.toContain(e.secretariaA.dni);
      expect(crudo).not.toContain(e.secretariaA.nombres);
      expect(crudo).not.toContain('SECRETARIA');
    });

    it('criterio 6: el token lleva la version_token actual del usuario', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { version_token: 7 });

      const respuesta = await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: CLAVE_COMUN });
      const { claims } = decodificarToken(tokenDeCookie(cookieDeAcademia(respuesta.headers) ?? ''));

      expect(claims['ver']).toBe(7);
    });

    it('criterio 6: la sesión vale hasta exp y deja de valer después, según RELOJ', async () => {
      const cookie = await iniciarSesionAcademia(app, 'academia-a', { usuario: e.secretariaA.dni, clave: CLAVE_COMUN });

      reloj.avanzar((DURACION_SESION_PERSONAL_SEGUNDOS - 1) * 1000);
      const vigente = await pedir(app, 'get', '/api/sesion', { cookie });
      reloj.avanzar(2 * 1000);
      const vencida = await pedir(app, 'get', '/api/sesion', { cookie });

      expect(vigente.status).toBe(200);
      expect(vencida.status).toBe(401);
      expect((vencida.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
    });
  });

  describe('criterio 7: credenciales inválidas', () => {
    it('criterio 7: clave equivocada, DNI inexistente en A y DNI que existe solo en B responden 401 CREDENCIALES_INVALIDAS con el mismo cuerpo y sin cookie', async () => {
      const claveEquivocada = await ingresar('academia-a', {
        usuario: e.secretariaA.dni,
        clave: 'clave-equivocada-123',
      });
      const inexistente = await ingresar('academia-a', { usuario: '99999999', clave: CLAVE_COMUN });
      const soloEnB = await ingresar('academia-a', { usuario: e.secretariaB.dni, clave: CLAVE_COMUN });

      for (const respuesta of [claveEquivocada, inexistente, soloEnB]) {
        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('CREDENCIALES_INVALIDAS');
        expect(respuesta.headers['set-cookie']).toBeUndefined();
        expect(respuesta.headers['cache-control']).toBe('no-store');
      }
      expect(claveEquivocada.body).toEqual(inexistente.body);
      expect(claveEquivocada.body).toEqual(soloEnB.body);
    });

    it('criterio 7: un DNI que existe solo en B no cuenta intentos en B ni en A', async () => {
      for (let i = 0; i < 3; i++) {
        const respuesta = await ingresar('academia-a', { usuario: e.secretariaB.dni, clave: CLAVE_COMUN });
        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('CREDENCIALES_INVALIDAS');
      }

      expect((await leerUsuario(e.B.id, e.secretariaB.id))?.intentos_fallidos).toBe(0);
    });

    it('criterio 7: una clave equivocada cuenta un intento fallido del usuario; un DNI inexistente no cuenta nada', async () => {
      await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: 'clave-equivocada-123' });
      await ingresar('academia-a', { usuario: '99999999', clave: 'clave-equivocada-123' });

      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.intentos_fallidos).toBe(1);
      expect((await leerUsuario(e.A.id, e.adminA.id))?.intentos_fallidos).toBe(0);
    });

    it('criterio 7: un DNI inexistente nunca responde 423, por muchos intentos que se hagan', async () => {
      for (let i = 1; i <= 7; i++) {
        const respuesta = await ingresar('academia-a', { usuario: '99999999', clave: 'clave-equivocada-123' });
        expect(respuesta.status, `intento ${i}`).toBe(401);
      }
    });
  });

  describe('criterio 8: el mismo DNI en dos academias (D-28)', () => {
    it('criterio 8: cada cuenta entra solo con su propia clave y la sesión lleva la academia correcta', async () => {
      const dni = '20262026';
      const enA = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', dni, clave: 'Clave-De-A-2026' });
      const enB = await crearUsuarioDePrueba({ academiaId: e.B.id, rol: 'ENTRENADOR', dni, clave: 'Clave-De-B-2026' });

      const aConClaveDeB = await ingresar('academia-a', { usuario: dni, clave: 'Clave-De-B-2026' });
      const aConClaveDeA = await ingresar('academia-a', { usuario: dni, clave: 'Clave-De-A-2026' });
      const bConClaveDeA = await ingresar('academia-b', { usuario: dni, clave: 'Clave-De-A-2026' });
      const bConClaveDeB = await ingresar('academia-b', { usuario: dni, clave: 'Clave-De-B-2026' });

      expect(aConClaveDeB.status).toBe(401);
      expect(bConClaveDeA.status).toBe(401);
      expect(aConClaveDeA.status).toBe(200);
      expect(bConClaveDeB.status).toBe(200);
      const tokenA = tokenDeCookie(cookieDeAcademia(aConClaveDeA.headers) ?? '');
      const tokenB = tokenDeCookie(cookieDeAcademia(bConClaveDeB.headers) ?? '');
      expect(decodificarToken(tokenA).claims).toMatchObject({ sub: enA.id, aca: e.A.id });
      expect(decodificarToken(tokenB).claims).toMatchObject({ sub: enB.id, aca: e.B.id });
      const sesionA = await pedir(app, 'get', '/api/sesion', { cookie: `${NOMBRE_COOKIE_ACADEMIA}=${tokenA}` });
      expect(sesionA.status).toBe(200);
      expect(
        (cuerpoDe(sesionA) as { usuario: { id: string; academia: { nombreCorto: string } } }).usuario,
      ).toMatchObject({
        id: enA.id,
        academia: { nombreCorto: 'academia-a' },
      });
    });
  });

  describe('criterio 10: usuario INACTIVO', () => {
    it('criterio 10: con la clave correcta responde 403 USUARIO_INACTIVO sin cookie', async () => {
      const inactivo = await crearUsuarioDePrueba({
        academiaId: e.A.id,
        rol: 'ENTRENADOR',
        clave: CLAVE_COMUN,
        estado: 'INACTIVO',
      });

      const respuesta = await ingresar('academia-a', { usuario: inactivo.dni, clave: CLAVE_COMUN });

      expect(respuesta.status).toBe(403);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('USUARIO_INACTIVO');
      expect(respuesta.headers['set-cookie']).toBeUndefined();
      expect((await leerUsuario(e.A.id, inactivo.id))?.ultimo_acceso).toBeNull();
    });

    it('criterio 10: con una clave equivocada responde 401 y cuenta el fallo', async () => {
      const inactivo = await crearUsuarioDePrueba({
        academiaId: e.A.id,
        rol: 'ENTRENADOR',
        clave: CLAVE_COMUN,
        estado: 'INACTIVO',
      });

      const respuesta = await ingresar('academia-a', { usuario: inactivo.dni, clave: 'clave-equivocada-123' });

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CREDENCIALES_INVALIDAS');
      expect((await leerUsuario(e.A.id, inactivo.id))?.intentos_fallidos).toBe(1);
    });
  });

  describe('criterio 11: la academia de la dirección', () => {
    it.each(['no-existe', 'academia-c', 'AB', 'a_b', 'academia a', '..', 'x'.repeat(40), '-academia-a', 'academia-a-'])(
      'criterio 11: el nombre corto %j responde 404 ACADEMIA_NO_ENCONTRADA sin cookie',
      async (nombreCorto) => {
        const respuesta = await ingresar(encodeURIComponent(nombreCorto), {
          usuario: e.secretariaA.dni,
          clave: CLAVE_COMUN,
        });

        expect(respuesta.status).toBe(404);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_NO_ENCONTRADA');
        expect(respuesta.headers['set-cookie']).toBeUndefined();
      },
    );

    it('criterio 11: una academia suspendida responde 403 ACADEMIA_SUSPENDIDA, aunque la clave sea correcta, y no cuenta ningún intento', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');

      const correcta = await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: CLAVE_COMUN });
      const equivocada = await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: 'clave-equivocada-123' });

      for (const respuesta of [correcta, equivocada]) {
        expect(respuesta.status).toBe(403);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_SUSPENDIDA');
        expect(respuesta.headers['set-cookie']).toBeUndefined();
      }
      const fila = await leerUsuario(e.A.id, e.secretariaA.id);
      expect(fila?.intentos_fallidos).toBe(0);
      expect(fila?.ultimo_acceso).toBeNull();
    });

    it('criterio 11: una academia reactivada vuelve a aceptar el ingreso', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      await fijarEstadoDeAcademia(e.A.id, 'ACTIVA');

      const respuesta = await ingresar('academia-a', { usuario: e.secretariaA.dni, clave: CLAVE_COMUN });

      expect(respuesta.status).toBe(200);
    });
  });

  describe('criterio 13: entradas inválidas', () => {
    const dni = () => e.secretariaA.dni;

    it.each([
      [
        'un cuerpo que no es JSON (texto plano)',
        (r: ReturnType<typeof pedirIngreso>) => r.set('Content-Type', 'text/plain').send('hola'),
      ],
      [
        'un JSON roto',
        (r: ReturnType<typeof pedirIngreso>) => r.set('Content-Type', 'application/json').send('{"usuario": '),
      ],
      ['sin cuerpo', (r: ReturnType<typeof pedirIngreso>) => r],
      [
        'campos de más',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: dni(), clave: CLAVE_COMUN, recordarme: true }),
      ],
      [
        'un campo academiaId de más',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: dni(), clave: CLAVE_COMUN, academiaId: e.B.id }),
      ],
      ['sin la clave', (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: dni() })],
      ['sin el usuario', (r: ReturnType<typeof pedirIngreso>) => r.send({ clave: CLAVE_COMUN })],
      [
        'un usuario de 7 dígitos',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: '1234567', clave: CLAVE_COMUN }),
      ],
      [
        'un usuario de 9 dígitos',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: '123456789', clave: CLAVE_COMUN }),
      ],
      [
        'un usuario con letras',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: '1234567a', clave: CLAVE_COMUN }),
      ],
      [
        'un usuario con guion',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: '1234-5678', clave: CLAVE_COMUN }),
      ],
      [
        'un usuario con un espacio en medio',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: '1234 5678', clave: CLAVE_COMUN }),
      ],
      [
        'un usuario con un carácter de control en medio',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: '1234\u00005678', clave: CLAVE_COMUN }),
      ],
      ['un usuario vacío', (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: '', clave: CLAVE_COMUN })],
      [
        'un usuario que es un número',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: 12345678, clave: CLAVE_COMUN }),
      ],
      ['una clave vacía', (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: dni(), clave: '' })],
      [
        'una clave de más de 128 caracteres',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: dni(), clave: 'x'.repeat(129) }),
      ],
      [
        'una clave con un carácter de control',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: dni(), clave: 'clave\u0000mala' }),
      ],
      [
        'una clave con un salto de línea',
        (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: dni(), clave: 'clave\nmala' }),
      ],
      ['una clave que no es texto', (r: ReturnType<typeof pedirIngreso>) => r.send({ usuario: dni(), clave: 12345 })],
    ])(
      'criterio 13: %s responde 400 SOLICITUD_INVALIDA, sin cookie y sin contar un intento',
      async (_caso, preparar) => {
        // Control: la misma ruta acepta un ingreso válido (así el 400 no viene de que la ruta no exista).
        const control = await ingresar('academia-a', { usuario: e.adminA.dni, clave: CLAVE_COMUN });
        expect(control.status).toBe(200);

        const respuesta = await preparar(pedirIngreso());

        expect(respuesta.status).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        expect(respuesta.headers['set-cookie']).toBeUndefined();
        expect((await leerUsuario(e.A.id, e.secretariaA.id))?.intentos_fallidos).toBe(0);
      },
    );

    /** `POST /api/a/academia-a/sesion` (la aplicación se lee al ejecutar la prueba, no al definirla). */
    function pedirIngreso() {
      return pedir(app, 'post', '/api/a/academia-a/sesion');
    }

    it('criterio 13: un usuario inválido se informa en el campo usuario y una clave inválida en el campo clave', async () => {
      const usuario = await ingresar('academia-a', { usuario: '1234567', clave: CLAVE_COMUN });
      const clave = await ingresar('academia-a', { usuario: dni(), clave: '' });

      expect([usuario.status, clave.status]).toEqual([400, 400]);

      expect((usuario.body as ErrorCuerpo).detalles?.errores?.map((error) => error.campo)).toContain('usuario');
      expect((clave.body as ErrorCuerpo).detalles?.errores?.map((error) => error.campo)).toContain('clave');
    });

    it('criterio 13: una clave de exactamente 128 caracteres se acepta como entrada (responde 401 por ser incorrecta, no 400)', async () => {
      const respuesta = await ingresar('academia-a', { usuario: dni(), clave: 'x'.repeat(128) });

      expect(respuesta.status).toBe(401);
    });

    it('criterio 13: la clave no se recorta ni se normaliza: con espacios al final no es la misma clave', async () => {
      const respuesta = await ingresar('academia-a', { usuario: dni(), clave: `${CLAVE_COMUN} ` });

      expect(respuesta.status).toBe(401);
    });
  });
});
