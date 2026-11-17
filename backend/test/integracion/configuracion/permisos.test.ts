// spec: 003-configuracion-academia (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCION_AUDITORIA,
  exigirRutasDeConfiguracion,
  fijarConfiguracion,
  instantaneaDeConfiguracion,
  POR_DEFECTO,
} from '../../utilidades/configuracion';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  fijarEstadoDeAcademia,
  pedir,
  type RolUsuario,
  rutasRegistradas,
} from '../../utilidades/usuarios';

// Criterio 5 (crítico, sección 2.1, D-11, D-29): GET y PATCH /api/configuracion responden 200 al ADMIN y 403 SIN_PERMISO a SECRETARIA,
// ENTRENADOR y ALUMNO, sin escribir ni auditar nada; sin sesión, 401 NO_AUTENTICADO; con el cambio de contraseña pendiente, 403
// CAMBIO_DE_CLAVE_OBLIGATORIO; con A suspendida, 403 ACADEMIA_SUSPENDIDA; en el orden de comprobaciones de la 002 (sesión → academia
// activa → cambio obligatorio → permiso → cuerpo → operación). El Superadmin no tiene ruta para ver ni cambiar la configuración de una
// academia (D-29). La matriz (CONFIGURAR_ACADEMIA, solo ADMIN, 24 filas) la prueba packages/contratos/src/permisos.test.ts.

const CUERPO_VALIDO = { toleranciaTardanzaMinutos: 20 };

describe('criterio 5: permisos de la configuración', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  const cookies = {} as Record<RolUsuario, string>;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    exigirRutasDeConfiguracion(app);
    e = await crearEscenario();
    cookies.ADMIN = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    cookies.SECRETARIA = cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS);
    cookies.ENTRENADOR = cookieDeUsuario(e.entrenadorA, AHORA_PRUEBAS);
    cookies.ALUMNO = cookieDeUsuario(e.alumnoA, AHORA_PRUEBAS);
    // Filas y auditoría previas en A y en B: "no escribe ni audita nada" tiene que poder verse.
    await fijarConfiguracion(e.A.id, { diasPorVencer: 7 });
    await fijarConfiguracion(e.B.id, { diasPorVencer: 9 });
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await app?.close();
  });

  async function estado() {
    return {
      filasA: await instantaneaDeConfiguracion(e.A.id),
      filasB: await instantaneaDeConfiguracion(e.B.id),
      auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
      auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
    };
  }
  const codigoDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).codigo;

  describe('cada rol de A', () => {
    it('criterio 5: GET /api/configuracion con el ADMIN responde 200 con { configuracion } y Cache-Control: no-store', async () => {
      const respuesta = await pedir(app, 'get', '/api/configuracion', { cookie: cookies.ADMIN });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(respuesta.body).toEqual({ configuracion: { ...POR_DEFECTO, diasPorVencer: 7 } });
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 5: PATCH /api/configuracion con el ADMIN responde 200 y escribe y audita el cambio', async () => {
      const respuesta = await pedir(app, 'patch', '/api/configuracion', {
        cookie: cookies.ADMIN,
        cuerpo: CUERPO_VALIDO,
      });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(respuesta.body).toEqual({
        configuracion: { ...POR_DEFECTO, diasPorVencer: 7, toleranciaTardanzaMinutos: 20 },
      });
      expect(respuesta.headers['cache-control']).toBe('no-store');
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_AUDITORIA)).toHaveLength(1);
    });

    it.each(['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const)(
      'criterio 5: GET /api/configuracion con %s responde 403 SIN_PERMISO sin cuerpo con datos',
      async (rol) => {
        const respuesta = await pedir(app, 'get', '/api/configuracion', { cookie: cookies[rol] });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(403);
        expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
        expect(respuesta.headers['cache-control']).toBe('no-store');
        expect(JSON.stringify(respuesta.body)).not.toMatch(/configuracion"|tolerancia|telefono/i);
      },
    );

    it.each(['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const)(
      'criterio 5: PATCH /api/configuracion con %s responde 403 SIN_PERMISO sin escribir ni auditar nada',
      async (rol) => {
        const antes = await estado();

        const respuesta = await pedir(app, 'patch', '/api/configuracion', {
          cookie: cookies[rol],
          cuerpo: CUERPO_VALIDO,
        });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(403);
        expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
        expect(respuesta.headers['cache-control']).toBe('no-store');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 5: una secretaria no puede aflojar el bloqueo (intentosInicioSesion y minutosBloqueo) ni quitar el teléfono: 403 y nada cambia', async () => {
      await fijarConfiguracion(e.A.id, { telefono: '999 000 111', intentosInicioSesion: 4, minutosBloqueo: 30 });
      const antes = await estado();

      for (const cuerpo of [{ intentosInicioSesion: 10 }, { minutosBloqueo: 5 }, { telefono: null }]) {
        const respuesta = await pedir(app, 'patch', '/api/configuracion', { cookie: cookies.SECRETARIA, cuerpo });

        expect(respuesta.status, JSON.stringify(cuerpo)).toBe(403);
        expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
      }
      expect(await estado()).toEqual(antes);
    });

    it('criterio 5: el permiso se comprueba antes que el cuerpo: con un cuerpo inválido, un rol sin permiso responde 403 y el ADMIN 400', async () => {
      for (const cuerpo of [{}, { academiaId: e.B.id }, { minutosBloqueo: 'x' }, { telefono: 'abc' }]) {
        for (const rol of ['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const) {
          const sinPermiso = await pedir(app, 'patch', '/api/configuracion', { cookie: cookies[rol], cuerpo });
          expect(sinPermiso.status, `${rol} con ${JSON.stringify(cuerpo)}`).toBe(403);
          expect(codigoDe(sinPermiso)).toBe('SIN_PERMISO');
        }
        const admin = await pedir(app, 'patch', '/api/configuracion', { cookie: cookies.ADMIN, cuerpo });
        expect(admin.status, `ADMIN con ${JSON.stringify(cuerpo)}`).toBe(400);
        expect(codigoDe(admin)).toBe('SOLICITUD_INVALIDA');
      }
    });

    it('criterio 5: el rol se lee de la base en cada petición: un ADMIN que pasa a SECRETARIA pierde el permiso al instante', async () => {
      const antes = await pedir(app, 'get', '/api/configuracion', { cookie: cookies.ADMIN });
      await actualizarUsuario(e.A.id, e.adminA.id, { rol: 'SECRETARIA' });

      const lectura = await pedir(app, 'get', '/api/configuracion', { cookie: cookies.ADMIN });
      const escritura = await pedir(app, 'patch', '/api/configuracion', {
        cookie: cookies.ADMIN,
        cuerpo: CUERPO_VALIDO,
      });

      expect(antes.status).toBe(200);
      expect(lectura.status).toBe(403);
      expect(codigoDe(lectura)).toBe('SIN_PERMISO');
      expect(escritura.status).toBe(403);
      expect(codigoDe(escritura)).toBe('SIN_PERMISO');
    });

    it('criterio 5: un ADMIN de otra academia no tiene permiso sobre la configuración de A: solo ve la suya', async () => {
      const respuesta = await pedir(app, 'get', '/api/configuracion', {
        cookie: cookieDeUsuario(e.adminB, AHORA_PRUEBAS),
      });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({ configuracion: { ...POR_DEFECTO, diasPorVencer: 9 } });
    });
  });

  describe('sin sesión', () => {
    it('criterio 5: GET y PATCH sin sesión responden 401 NO_AUTENTICADO y PATCH no escribe nada, ni con un cuerpo inválido', async () => {
      const antes = await estado();

      const lectura = await pedir(app, 'get', '/api/configuracion');
      const escritura = await pedir(app, 'patch', '/api/configuracion', { cuerpo: CUERPO_VALIDO });
      const invalido = await pedir(app, 'patch', '/api/configuracion', { cuerpo: {} });

      for (const respuesta of [lectura, escritura, invalido]) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
      }
      expect(await estado()).toEqual(antes);
    });

    it('criterio 5: una cookie con un token que no es válido responde 401 NO_AUTENTICADO', async () => {
      const respuesta = await pedir(app, 'get', '/api/configuracion', { cookie: 'aq_sesion=no-es-un-token' });
      const escritura = await pedir(app, 'patch', '/api/configuracion', {
        cookie: 'aq_sesion=no-es-un-token',
        cuerpo: CUERPO_VALIDO,
      });

      expect(respuesta.status).toBe(401);
      expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
      expect(escritura.status).toBe(401);
      expect(codigoDe(escritura)).toBe('NO_AUTENTICADO');
    });
  });

  describe('cambio de contraseña pendiente', () => {
    it('criterio 5: un ADMIN con el cambio pendiente recibe 403 CAMBIO_DE_CLAVE_OBLIGATORIO en GET y PATCH, y no se escribe nada', async () => {
      const pendiente = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', debeCambiarClave: true });
      const cookie = cookieDeUsuario(pendiente, AHORA_PRUEBAS);
      const antes = await estado();

      const lectura = await pedir(app, 'get', '/api/configuracion', { cookie });
      const escritura = await pedir(app, 'patch', '/api/configuracion', { cookie, cuerpo: CUERPO_VALIDO });
      const invalido = await pedir(app, 'patch', '/api/configuracion', { cookie, cuerpo: {} });

      for (const respuesta of [lectura, escritura, invalido]) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(403);
        expect(codigoDe(respuesta)).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
      }
      expect(await estado()).toEqual(antes);
    });

    it('criterio 5: el cambio pendiente se comprueba antes que el permiso: una secretaria con el cambio pendiente recibe CAMBIO_DE_CLAVE_OBLIGATORIO, no SIN_PERMISO', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });

      const lectura = await pedir(app, 'get', '/api/configuracion', { cookie: cookies.SECRETARIA });
      const escritura = await pedir(app, 'patch', '/api/configuracion', {
        cookie: cookies.SECRETARIA,
        cuerpo: CUERPO_VALIDO,
      });

      for (const respuesta of [lectura, escritura]) {
        expect(respuesta.status).toBe(403);
        expect(codigoDe(respuesta)).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
      }
    });
  });

  describe('academia suspendida', () => {
    it('criterio 5: con A suspendida, GET y PATCH responden 403 ACADEMIA_SUSPENDIDA a su ADMIN y no se escribe nada; B sigue sirviendo', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      const antes = await estado();

      const lectura = await pedir(app, 'get', '/api/configuracion', { cookie: cookies.ADMIN });
      const escritura = await pedir(app, 'patch', '/api/configuracion', {
        cookie: cookies.ADMIN,
        cuerpo: CUERPO_VALIDO,
      });
      const deB = await pedir(app, 'get', '/api/configuracion', { cookie: cookieDeUsuario(e.adminB, AHORA_PRUEBAS) });

      for (const respuesta of [lectura, escritura]) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(403);
        expect(codigoDe(respuesta)).toBe('ACADEMIA_SUSPENDIDA');
      }
      expect(deB.status).toBe(200);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 5: la academia suspendida se comprueba antes que el cambio pendiente y que el permiso', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });

      for (const cookie of [cookies.SECRETARIA, cookies.ALUMNO]) {
        const respuesta = await pedir(app, 'patch', '/api/configuracion', { cookie, cuerpo: CUERPO_VALIDO });
        expect(respuesta.status).toBe(403);
        expect(codigoDe(respuesta)).toBe('ACADEMIA_SUSPENDIDA');
      }
    });
  });

  describe('Superadmin (D-29)', () => {
    it('criterio 5: las rutas de la configuración están registradas, y ninguna ruta de plataforma ve ni cambia la configuración de una academia', () => {
      const rutas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);

      expect(rutas).toContain('GET /api/configuracion');
      expect(rutas).toContain('PATCH /api/configuracion');
      expect(
        rutas.filter((ruta) => /^[A-Z]+ \/api\/plataforma/.test(ruta) && /configuraci|telefono/i.test(ruta)),
        'una ruta de plataforma toca la configuración de las academias',
      ).toEqual([]);
    });

    it('criterio 5: la sesión de plataforma del Superadmin no abre GET ni PATCH /api/configuracion (401 NO_AUTENTICADO) y no escribe nada', async () => {
      const cookie = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
      const antes = await estado();

      const lectura = await pedir(app, 'get', '/api/configuracion', { cookie });
      const escritura = await pedir(app, 'patch', '/api/configuracion', { cookie, cuerpo: CUERPO_VALIDO });
      const identidad = await pedir(app, 'get', '/api/mi-academia', { cookie });

      for (const respuesta of [lectura, escritura, identidad]) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
      }
      expect(await estado()).toEqual(antes);
    });

    it.each([
      ['GET', (id: string) => `/api/plataforma/academias/${id}/configuracion`],
      ['PATCH', (id: string) => `/api/plataforma/academias/${id}/configuracion`],
      ['GET', () => '/api/plataforma/configuracion'],
    ] as const)(
      'criterio 5: %s %#: el Superadmin no tiene ninguna ruta de plataforma con la configuración de una academia (404) y no se escribe nada',
      async (metodo, ruta) => {
        const cookie = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
        const antes = await estado();

        const respuesta = await pedir(app, metodo === 'GET' ? 'get' : 'patch', ruta(e.A.id), {
          cookie,
          cuerpo: metodo === 'GET' ? undefined : CUERPO_VALIDO,
        });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(404);
        expect(JSON.stringify(respuesta.body)).not.toMatch(/diasPorVencer|dias_por_vencer/);
        expect(await estado()).toEqual(antes);
      },
    );
  });
});
