// spec: 002-autenticacion-roles (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { Controller, Get, type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  type RolUsuario,
  ROLES,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  fijarEstadoDeAcademia,
  instantaneaDeUsuarios,
  type ModuloAutenticacion,
  cargarAutenticacion,
  pedir,
  rutasRegistradas,
} from '../../utilidades/usuarios';

// Criterios 27, 28 y 37: cada ruta de academia declara un permiso de la matriz (`@Permiso`) o que basta con la sesión (`@SoloSesion`);
// una ruta sin declaración responde 403 SIN_PERMISO a cualquier rol (falla cerrada); y cada ruta de esta historia con cada uno de los
// cuatro roles. Orden de las comprobaciones: sesión (401) → academia activa (403) → cambio obligatorio (403) → permiso (403 SIN_PERMISO)
// → validación del cuerpo (400) → operación.

// ---------------------------------------------------------------------------------------------------------------------
// Controladores de prueba que usan los decoradores del contrato (`backend/src/modulos/autenticacion/index.ts`)
// ---------------------------------------------------------------------------------------------------------------------

/** Aplica decoradores de método a mano (las pruebas no pueden escribir `@Permiso(...)` antes de que el módulo exista). */
function decorarMetodo(
  clase: Type<unknown>,
  nombre: string,
  ...decoradores: (MethodDecorator & ClassDecorator)[]
): void {
  const descriptor = Object.getOwnPropertyDescriptor(clase.prototype, nombre);
  if (!descriptor) throw new Error(`El método ${nombre} no existe en el controlador de prueba.`);
  for (const decorador of decoradores) decorador(clase.prototype as object, nombre, descriptor);
  Object.defineProperty(clase.prototype, nombre, descriptor);
}

function crearControladoresDePrueba(autenticacion: ModuloAutenticacion): Type<unknown>[] {
  const { Permiso, SoloSesion, UsuarioActual } = autenticacion;
  const get = (ruta: string) => Get(ruta) as unknown as MethodDecorator & ClassDecorator;

  class PorMetodo {
    sinDeclarar() {
      return { ok: true };
    }
    soloSesion() {
      return { ok: true };
    }
    gestionarUsuarios() {
      return { ok: true };
    }
    restablecerClave() {
      return { ok: true };
    }
    quien(usuario: unknown) {
      return { usuario };
    }
  }
  decorarMetodo(PorMetodo, 'sinDeclarar', get('sin-declarar'));
  decorarMetodo(PorMetodo, 'soloSesion', get('solo-sesion'), SoloSesion());
  decorarMetodo(PorMetodo, 'gestionarUsuarios', get('gestionar-usuarios'), Permiso('GESTIONAR_USUARIOS'));
  decorarMetodo(PorMetodo, 'restablecerClave', get('restablecer-clave'), Permiso('RESTABLECER_CLAVE'));
  decorarMetodo(PorMetodo, 'quien', get('quien'), SoloSesion());
  // El contrato escribe `UsuarioActual: ParameterDecorator`, pero se usa como `@UsuarioActual()` (como `SuperadminActual`, creado con
  // `createParamDecorator`): se acepta cualquiera de las dos formas.
  const decoradorDeParametro =
    UsuarioActual.length >= 3 ? UsuarioActual : (UsuarioActual as unknown as () => ParameterDecorator)();
  decoradorDeParametro(PorMetodo.prototype, 'quien', 0);
  Controller('prueba-002')(PorMetodo);

  class SoloSesionPorClase {
    uno() {
      return { ok: true };
    }
    otro() {
      return { ok: true };
    }
  }
  decorarMetodo(SoloSesionPorClase, 'uno', get('uno'));
  decorarMetodo(SoloSesionPorClase, 'otro', get('otro'));
  SoloSesion()(SoloSesionPorClase);
  Controller('prueba-002-clase-sesion')(SoloSesionPorClase);

  class PermisoPorClase {
    uno() {
      return { ok: true };
    }
  }
  decorarMetodo(PermisoPorClase, 'uno', get('uno'));
  Permiso('GESTIONAR_USUARIOS')(PermisoPorClase);
  Controller('prueba-002-clase-permiso')(PermisoPorClase);

  return [PorMetodo, SoloSesionPorClase, PermisoPorClase];
}

describe('criterio 27: una ruta sin declaración falla cerrada y los decoradores del contrato funcionan', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  const cookies = {} as Record<RolUsuario, string>;

  beforeAll(async () => {
    const autenticacion = await cargarAutenticacion();
    ({ app } = await crearAppConReloj(AHORA_PRUEBAS, { controladores: crearControladoresDePrueba(autenticacion) }));
  });
  beforeEach(async () => {
    e = await crearEscenario();
    cookies.ADMIN = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    cookies.SECRETARIA = cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS);
    cookies.ENTRENADOR = cookieDeUsuario(e.entrenadorA, AHORA_PRUEBAS);
    cookies.ALUMNO = cookieDeUsuario(e.alumnoA, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each(ROLES.map((rol) => [rol]))(
    'criterio 27: una ruta sin @Permiso ni @SoloSesion responde 403 SIN_PERMISO a un %s con sesión válida',
    async (rol) => {
      const respuesta = await pedir(app, 'get', '/api/prueba-002/sin-declarar', { cookie: cookies[rol] });

      expect(respuesta.status).toBe(403);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SIN_PERMISO');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    },
  );

  it.each(ROLES.map((rol) => [rol]))('criterio 27: @SoloSesion deja pasar a un %s con sesión válida', async (rol) => {
    const respuesta = await pedir(app, 'get', '/api/prueba-002/solo-sesion', { cookie: cookies[rol] });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ ok: true });
  });

  it.each([
    ['ADMIN', 200],
    ['SECRETARIA', 403],
    ['ENTRENADOR', 403],
    ['ALUMNO', 403],
  ] as const)(
    'criterio 27: @Permiso("GESTIONAR_USUARIOS") con un %s responde %s según la matriz',
    async (rol, estado) => {
      const respuesta = await pedir(app, 'get', '/api/prueba-002/gestionar-usuarios', { cookie: cookies[rol] });

      expect(respuesta.status).toBe(estado);
      if (estado === 403) expect((respuesta.body as ErrorCuerpo).codigo).toBe('SIN_PERMISO');
    },
  );

  it.each([
    ['ADMIN', 200],
    ['SECRETARIA', 200],
    ['ENTRENADOR', 403],
    ['ALUMNO', 403],
  ] as const)(
    'criterio 27: @Permiso("RESTABLECER_CLAVE") con un %s responde %s según la matriz',
    async (rol, estado) => {
      const respuesta = await pedir(app, 'get', '/api/prueba-002/restablecer-clave', { cookie: cookies[rol] });

      expect(respuesta.status).toBe(estado);
      if (estado === 403) expect((respuesta.body as ErrorCuerpo).codigo).toBe('SIN_PERMISO');
    },
  );

  it('criterio 27: la declaración puede ir en la clase: @SoloSesion en la clase vale para todos sus manejadores y @Permiso en la clase aplica la matriz', async () => {
    const porClaseSesion = await Promise.all(
      ROLES.flatMap((rol) =>
        ['uno', 'otro'].map((ruta) =>
          pedir(app, 'get', `/api/prueba-002-clase-sesion/${ruta}`, { cookie: cookies[rol] }),
        ),
      ),
    );
    const alumnoPorClasePermiso = await pedir(app, 'get', '/api/prueba-002-clase-permiso/uno', {
      cookie: cookies.ALUMNO,
    });
    const adminPorClasePermiso = await pedir(app, 'get', '/api/prueba-002-clase-permiso/uno', {
      cookie: cookies.ADMIN,
    });

    expect(porClaseSesion.map((respuesta) => respuesta.status)).toEqual(Array(8).fill(200));
    expect(alumnoPorClasePermiso.status).toBe(403);
    expect((alumnoPorClasePermiso.body as ErrorCuerpo).codigo).toBe('SIN_PERMISO');
    expect(adminPorClasePermiso.status).toBe(200);
  });

  it('criterio 27: @UsuarioActual entrega el usuario autenticado (id, academiaId, rol, nombres, apellidos y debeCambiarClave) leído de la base', async () => {
    const respuesta = await pedir(app, 'get', '/api/prueba-002/quien', { cookie: cookies.ENTRENADOR });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({
      usuario: {
        id: e.entrenadorA.id,
        academiaId: e.A.id,
        rol: 'ENTRENADOR',
        nombres: e.entrenadorA.nombres,
        apellidos: e.entrenadorA.apellidos,
        debeCambiarClave: false,
      },
    });
  });

  it('criterio 27: sin sesión, las rutas declaradas y las no declaradas responden 401 (la sesión se comprueba antes que el permiso)', async () => {
    for (const ruta of ['sin-declarar', 'solo-sesion', 'gestionar-usuarios', 'restablecer-clave', 'quien']) {
      const respuesta = await pedir(app, 'get', `/api/prueba-002/${ruta}`);

      expect(respuesta.status, ruta).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
    }
  });

  it('criterio 27: la academia suspendida (403 ACADEMIA_SUSPENDIDA) y el cambio obligatorio (403 CAMBIO_DE_CLAVE_OBLIGATORIO) se comprueban antes que el permiso', async () => {
    const pendiente = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ALUMNO', debeCambiarClave: true });
    const conCambioPendiente = await pedir(app, 'get', '/api/prueba-002/gestionar-usuarios', {
      cookie: cookieDeUsuario(pendiente, AHORA_PRUEBAS),
    });
    await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
    const suspendida = await pedir(app, 'get', '/api/prueba-002/gestionar-usuarios', { cookie: cookies.ALUMNO });

    expect((conCambioPendiente.body as ErrorCuerpo).codigo).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
    expect(suspendida.status).toBe(403);
    expect((suspendida.body as ErrorCuerpo).codigo).toBe('ACADEMIA_SUSPENDIDA');
  });

  it('criterio 27: el rol se lee de la base en cada petición: al bajar de ADMIN a ENTRENADOR se pierde el permiso al instante', async () => {
    const antes = await pedir(app, 'get', '/api/prueba-002/gestionar-usuarios', { cookie: cookies.ADMIN });
    await actualizarUsuario(e.A.id, e.adminA.id, { rol: 'ENTRENADOR' });

    const despues = await pedir(app, 'get', '/api/prueba-002/gestionar-usuarios', { cookie: cookies.ADMIN });

    expect(antes.status).toBe(200);
    expect(despues.status).toBe(403);
    expect((despues.body as ErrorCuerpo).codigo).toBe('SIN_PERMISO');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Recorrido de todas las rutas registradas (criterio 27)
// ---------------------------------------------------------------------------------------------------------------------

describe('criterio 27: ninguna ruta de academia de la aplicación está sin declarar', () => {
  let app: NestExpressApplication;
  let e: Escenario;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
  });
  afterAll(async () => {
    await app?.close();
  });

  /** `/api/...` que no es de salud, de plataforma ni pública de academia (`/api/a/...`): las rutas de academia del contrato. */
  const esRutaDeAcademia = ([, ruta]: readonly [string, string]) =>
    ruta.startsWith('/api/') && !/^\/api\/(salud|plataforma|a)(\/|$)/.test(ruta);

  /** Sustituye los parámetros de la ruta por valores inofensivos: un UUID inexistente o un DNI inexistente. */
  const concreta = (ruta: string) =>
    ruta
      .replace(/:dni\b/g, '99999999')
      .replace(/:[a-zA-Z]*[iI]d\b/g, randomUUID())
      .replace(/:[a-zA-Z]+/g, 'x');

  it('criterio 27: las rutas de esta historia están registradas (el recorrido no pasa en vacío)', () => {
    const rutas = rutasRegistradas(app)
      .filter(esRutaDeAcademia)
      .map(([metodo, ruta]) => `${metodo} ${ruta}`);

    for (const esperada of [
      'GET /api/sesion',
      'DELETE /api/sesion',
      'POST /api/sesion/clave',
      'GET /api/usuarios',
      'POST /api/usuarios',
      'POST /api/usuarios/:id/desactivar',
      'POST /api/usuarios/:id/reactivar',
      'POST /api/usuarios/:id/restablecer-clave',
      'GET /api/usuarios/por-dni/:dni',
    ]) {
      expect(rutas, `falta la ruta ${esperada}`).toContain(esperada);
    }
  });

  it('criterio 27: ninguna ruta de academia responde 403 SIN_PERMISO a los cuatro roles: toda ruta declara un permiso de la matriz o @SoloSesion', async () => {
    const cookies = {
      ADMIN: cookieDeUsuario(e.adminA, AHORA_PRUEBAS),
      SECRETARIA: cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS),
      ENTRENADOR: cookieDeUsuario(e.entrenadorA, AHORA_PRUEBAS),
      ALUMNO: cookieDeUsuario(e.alumnoA, AHORA_PRUEBAS),
    } satisfies Record<RolUsuario, string>;
    const rutas = rutasRegistradas(app)
      .filter(esRutaDeAcademia)
      // Cerrar sesión no exige sesión: no tiene permiso que comprobar (criterio 17) y cambiaría la versión de la cuenta.
      .filter(([metodo, ruta]) => !(metodo === 'DELETE' && ruta === '/api/sesion'));
    expect(rutas.length).toBeGreaterThan(0);

    // Una ruta declarada deja pasar al menos a un rol (todas las filas de la matriz tienen alguno); una sin declarar responde
    // SIN_PERMISO a todos. Los cuerpos vacíos y los ids inexistentes hacen que ninguna ruta cambie datos.
    const sinDeclarar: string[] = [];
    for (const [metodo, ruta] of rutas) {
      let pasoAlguno = false;
      for (const rol of ROLES) {
        const respuesta = await pedir(app, metodo.toLowerCase() as 'get', concreta(ruta), {
          cookie: cookies[rol],
          cuerpo: {},
        });
        const codigo = (respuesta.body as Partial<ErrorCuerpo> | undefined)?.codigo;
        if (!(respuesta.status === 403 && codigo === 'SIN_PERMISO')) {
          pasoAlguno = true;
          break;
        }
      }
      if (!pasoAlguno) sinDeclarar.push(`${metodo} ${ruta}`);
    }

    expect(sinDeclarar, `rutas de academia sin @Permiso ni @SoloSesion: ${sinDeclarar.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Cada ruta de esta historia con cada uno de los cuatro roles (criterios 28 y 37)
// ---------------------------------------------------------------------------------------------------------------------

interface RutaDeLaHistoria {
  readonly nombre: string;
  readonly metodo: 'get' | 'post';
  /** Dirección y cuerpo de una petición válida para esa ruta, según el escenario (el objetivo es siempre un alumno de A). */
  readonly peticion: (e: Escenario) => { ruta: string; cuerpo?: unknown };
  readonly roles: readonly RolUsuario[];
  readonly exito: 200 | 201;
}

const RUTAS_DE_LA_HISTORIA: readonly RutaDeLaHistoria[] = [
  { nombre: 'GET /api/sesion', metodo: 'get', peticion: () => ({ ruta: '/api/sesion' }), roles: ROLES, exito: 200 },
  {
    nombre: 'POST /api/sesion/clave',
    metodo: 'post',
    peticion: () => ({
      ruta: '/api/sesion/clave',
      cuerpo: { claveActual: CLAVE_COMUN, claveNueva: 'Una-Clave-Nueva-2026' },
    }),
    roles: ROLES,
    exito: 200,
  },
  {
    nombre: 'GET /api/usuarios',
    metodo: 'get',
    peticion: () => ({ ruta: '/api/usuarios' }),
    roles: ['ADMIN'],
    exito: 200,
  },
  {
    nombre: 'POST /api/usuarios',
    metodo: 'post',
    peticion: () => ({
      ruta: '/api/usuarios',
      cuerpo: { dni: '55552001', nombres: 'Nuevo', apellidos: 'Usuario', rol: 'ENTRENADOR' },
    }),
    roles: ['ADMIN'],
    exito: 201,
  },
  {
    nombre: 'POST /api/usuarios/{id}/desactivar',
    metodo: 'post',
    peticion: (e) => ({ ruta: `/api/usuarios/${e.entrenadorA.id}/desactivar`, cuerpo: {} }),
    roles: ['ADMIN'],
    exito: 200,
  },
  {
    nombre: 'POST /api/usuarios/{id}/reactivar',
    metodo: 'post',
    peticion: (e) => ({ ruta: `/api/usuarios/${e.entrenadorA.id}/reactivar`, cuerpo: {} }),
    roles: ['ADMIN'],
    exito: 200,
  },
  {
    nombre: 'GET /api/usuarios/por-dni/{dni}',
    metodo: 'get',
    peticion: (e) => ({ ruta: `/api/usuarios/por-dni/${e.alumnoA.dni}` }),
    roles: ['ADMIN', 'SECRETARIA'],
    exito: 200,
  },
  {
    nombre: 'POST /api/usuarios/{id}/restablecer-clave',
    metodo: 'post',
    peticion: (e) => ({ ruta: `/api/usuarios/${e.alumnoA.id}/restablecer-clave`, cuerpo: {} }),
    roles: ['ADMIN', 'SECRETARIA'],
    exito: 200,
  },
];

describe('criterios 28 y 37: cada ruta de la historia con cada uno de los cuatro roles', () => {
  let app: NestExpressApplication;
  let e: Escenario;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
  });
  afterAll(async () => {
    await app?.close();
  });

  const usuarioDe = (rol: RolUsuario) =>
    ({ ADMIN: e.adminA, SECRETARIA: e.secretariaA, ENTRENADOR: e.entrenadorA, ALUMNO: e.alumnoA })[rol];

  describe.each(RUTAS_DE_LA_HISTORIA)('$nombre', (ruta) => {
    const permitidos = ROLES.filter((rol) => ruta.roles.includes(rol));
    const denegados = ROLES.filter((rol) => !ruta.roles.includes(rol));

    // Una ruta que todos los roles permiten (`GET /api/sesion`) no tiene casos de rol denegado.
    if (denegados.length > 0)
      it.each(denegados.map((rol) => [rol]))(
        'criterio 28: un %s responde 403 SIN_PERMISO sin escribir nada ni auditar',
        async (rol) => {
          const antes = await instantaneaDeUsuarios(e.A.id);
          const antesB = await instantaneaDeUsuarios(e.B.id);
          const { ruta: direccion, cuerpo } = ruta.peticion(e);

          const respuesta = await pedir(app, ruta.metodo, direccion, {
            cookie: cookieDeUsuario(usuarioDe(rol), AHORA_PRUEBAS),
            cuerpo,
          });

          expect(respuesta.status).toBe(403);
          expect((respuesta.body as ErrorCuerpo).codigo).toBe('SIN_PERMISO');
          expect(respuesta.headers['cache-control']).toBe('no-store');
          expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
          expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
          expect(await contarAuditoria(e.A.id)).toBe(0);
        },
      );

    it.each(permitidos.map((rol) => [rol]))(
      'criterio 28: un %s sí pasa (responde el éxito de la ruta)',
      async (rol) => {
        const { ruta: direccion, cuerpo } = ruta.peticion(e);
        if (ruta.nombre.endsWith('/reactivar')) {
          await actualizarUsuario(e.A.id, e.entrenadorA.id, { estado: 'INACTIVO' });
        }

        const respuesta = await pedir(app, ruta.metodo, direccion, {
          cookie: cookieDeUsuario(usuarioDe(rol), AHORA_PRUEBAS),
          cuerpo,
        });

        expect(respuesta.status).toBe(ruta.exito);
      },
    );
  });

  it('criterio 28: el permiso se comprueba antes que la validación del cuerpo: un ENTRENADOR o un ALUMNO con un cuerpo inválido recibe 403 y no 400', async () => {
    for (const rol of ['ENTRENADOR', 'ALUMNO'] as const) {
      const cookie = cookieDeUsuario(usuarioDe(rol), AHORA_PRUEBAS);

      const respuestas = [
        await pedir(app, 'post', '/api/usuarios', { cookie, cuerpo: { dni: 'x' } }),
        await pedir(app, 'post', '/api/usuarios', { cookie }).set('Content-Type', 'application/json').send('{"dni": '),
        await pedir(app, 'post', `/api/usuarios/${e.alumnoA.id}/desactivar`, { cookie, cuerpo: { extra: 1 } }),
        await pedir(app, 'post', `/api/usuarios/${e.alumnoA.id}/restablecer-clave`, { cookie, cuerpo: { extra: 1 } }),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status, rol).toBe(403);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SIN_PERMISO');
      }
    }
  });

  it('criterio 28: la SECRETARIA no puede gestionar usuarios aunque el objetivo sea un alumno de su academia', async () => {
    const cookie = cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS);

    const respuestas = [
      await pedir(app, 'get', '/api/usuarios', { cookie }),
      await pedir(app, 'post', `/api/usuarios/${e.alumnoA.id}/desactivar`, { cookie, cuerpo: {} }),
    ];

    for (const respuesta of respuestas) expect((respuesta.body as ErrorCuerpo).codigo).toBe('SIN_PERMISO');
  });

  it('criterio 37: un ENTRENADOR o un ALUMNO no puede usar ninguna de las rutas de los criterios 29 a 35 (403 SIN_PERMISO)', async () => {
    const delCriterio29a35 = RUTAS_DE_LA_HISTORIA.filter((ruta) => !ruta.roles.includes('ENTRENADOR'));
    expect(delCriterio29a35.map((ruta) => ruta.nombre)).toHaveLength(6);

    for (const rol of ['ENTRENADOR', 'ALUMNO'] as const) {
      for (const ruta of delCriterio29a35) {
        const { ruta: direccion, cuerpo } = ruta.peticion(e);

        const respuesta = await pedir(app, ruta.metodo, direccion, {
          cookie: cookieDeUsuario(usuarioDe(rol), AHORA_PRUEBAS),
          cuerpo,
        });

        expect(respuesta.status, `${rol} ${ruta.nombre}`).toBe(403);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SIN_PERMISO');
      }
    }
  });
});
