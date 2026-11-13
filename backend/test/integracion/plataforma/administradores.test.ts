// spec: 002-autenticacion-roles (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  cuerpoDe,
  contarAuditoria,
  cookieDeAcademia,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  fijarEstadoDeAcademia,
  instantaneaDeUsuarios,
  leerUsuario,
  leerUsuarioPorDni,
  pedir,
  QUINCE_MINUTOS,
} from '../../utilidades/usuarios';

// Criterios 38 a 41 (y 16): el Superadmin crea, lista y restablece la contraseña de los administradores de cada academia, y nada más
// (D-29, DR-1). Lo que hace queda en la auditoría de esa academia (criterio 42, probado en usuarios/auditoria-usuarios.test.ts).

interface AdministradorCuerpo {
  id: string;
  dni: string;
  nombres: string;
  apellidos: string;
  estado: string;
  debeCambiarClave: boolean;
  bloqueado: boolean;
}

const CAMPOS_DE_ADMINISTRADOR = ['apellidos', 'bloqueado', 'debeCambiarClave', 'dni', 'estado', 'id', 'nombres'];

describe('administradores de cada academia desde la plataforma', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let superadmin: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
    superadmin = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  const listar = (academiaId: string, cookie: string | undefined = superadmin) =>
    pedir(app, 'get', `/api/plataforma/academias/${academiaId}/administradores`, { cookie });
  const crear = (academiaId: string, cuerpo: unknown, cookie: string | undefined = superadmin) =>
    pedir(app, 'post', `/api/plataforma/academias/${academiaId}/administradores`, { cookie, cuerpo });
  const restablecer = (academiaId: string, usuarioId: string, cookie: string | undefined = superadmin) =>
    pedir(app, 'post', `/api/plataforma/academias/${academiaId}/administradores/${usuarioId}/restablecer-clave`, {
      cookie,
      cuerpo: {},
    });
  const datos = (sobrescribir: Record<string, unknown> = {}) => ({
    dni: '55555001',
    nombres: 'Pilar',
    apellidos: 'Quispe',
    ...sobrescribir,
  });

  describe('criterio 38: GET /api/plataforma/academias/{id}/administradores', () => {
    it('criterio 38: responde 200 con { administradores } con solo los ADMIN de esa academia y los campos del esquema estricto', async () => {
      const inactivo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', estado: 'INACTIVO' });

      const respuesta = await listar(e.A.id);

      expect(respuesta.status).toBe(200);
      const { administradores } = cuerpoDe(respuesta) as { administradores: AdministradorCuerpo[] };
      expect(administradores.map((admin) => admin.id).sort()).toEqual([e.adminA.id, inactivo.id].sort());
      for (const administrador of administradores) {
        expect(Object.keys(administrador).sort()).toEqual(CAMPOS_DE_ADMINISTRADOR);
      }
      expect(administradores.find((admin) => admin.id === e.adminA.id)).toEqual({
        id: e.adminA.id,
        dni: e.adminA.dni,
        nombres: 'Rosa',
        apellidos: 'Alvarez',
        estado: 'ACTIVO',
        debeCambiarClave: false,
        bloqueado: false,
      });
      expect(administradores.find((admin) => admin.id === inactivo.id)?.estado).toBe('INACTIVO');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 38: nunca muestra otros roles (secretaria, entrenador, alumno), otros campos (rol, ultimoAcceso, hash) ni administradores de otra academia', async () => {
      const respuesta = await listar(e.A.id);

      expect(respuesta.status).toBe(200);
      const cuerpo = JSON.stringify(respuesta.body);
      for (const otro of [e.secretariaA, e.entrenadorA, e.alumnoA, e.adminB, e.secretariaB, e.alumnoB]) {
        expect(cuerpo).not.toContain(otro.id);
        expect(cuerpo).not.toContain(otro.dni);
      }
      expect(cuerpo).not.toMatch(/"rol"|ultimoAcceso|argon2|clave_?hash|intentos|version/i);
    });

    it('criterio 38: la lista de B muestra solo a su administrador', async () => {
      const respuesta = await listar(e.B.id);

      const { administradores } = cuerpoDe(respuesta) as { administradores: AdministradorCuerpo[] };
      expect(administradores.map((admin) => admin.id)).toEqual([e.adminB.id]);
    });

    it('criterio 38: una academia sin administradores responde una lista vacía', async () => {
      const vacia = await crearAcademiaDePrueba({ nombreCorto: 'academia-vacia' });

      const respuesta = await listar(vacia.id);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({ administradores: [] });
    });

    it('criterio 38: bloqueado es verdadero mientras bloqueado_hasta es posterior a ahora', async () => {
      await actualizarUsuario(e.A.id, e.adminA.id, {
        bloqueado_hasta: new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS),
      });

      const respuesta = await listar(e.A.id);

      expect((cuerpoDe(respuesta) as { administradores: AdministradorCuerpo[] }).administradores[0]?.bloqueado).toBe(
        true,
      );
    });
  });

  describe('criterio 39: POST /api/plataforma/academias/{id}/administradores', () => {
    it('criterio 39: responde 201 con { administrador }; el usuario queda en esa academia con rol ADMIN, ACTIVO, clave igual a su DNI (argon2id) y debe_cambiar_clave = true', async () => {
      const respuesta = await crear(e.A.id, datos());

      expect(respuesta.status).toBe(201);
      const { administrador } = cuerpoDe(respuesta) as { administrador: AdministradorCuerpo };
      expect(Object.keys(administrador).sort()).toEqual(CAMPOS_DE_ADMINISTRADOR);
      expect(administrador).toMatchObject({
        dni: '55555001',
        nombres: 'Pilar',
        apellidos: 'Quispe',
        estado: 'ACTIVO',
        debeCambiarClave: true,
        bloqueado: false,
      });
      const fila = await leerUsuario(e.A.id, administrador.id);
      expect(fila).toMatchObject({
        academia_id: e.A.id,
        dni: '55555001',
        rol: 'ADMIN',
        estado: 'ACTIVO',
        debe_cambiar_clave: true,
      });
      expect(fila?.clave_hash.startsWith('$argon2id$')).toBe(true);
      expect(await leerUsuarioPorDni(e.B.id, '55555001')).toBeUndefined();
      expect(respuesta.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(respuesta.body)).not.toMatch(/argon2|clave_?hash/i);
    });

    it('criterio 39: el administrador nuevo entra por su academia con su DNI como contraseña y se le exige el cambio', async () => {
      await crear(e.A.id, datos());

      const ingreso = await pedir(app, 'post', '/api/a/academia-a/sesion', {
        cuerpo: { usuario: '55555001', clave: '55555001' },
      });

      expect(ingreso.status).toBe(200);
      expect((cuerpoDe(ingreso) as { usuario: { rol: string; debeCambiarClave: boolean } }).usuario).toMatchObject({
        rol: 'ADMIN',
        debeCambiarClave: true,
      });
      expect(cookieDeAcademia(ingreso.headers)).toBeDefined();
    });

    it('criterio 39: sirve para el primer administrador de una academia nueva y para los siguientes', async () => {
      const nueva = await crearAcademiaDePrueba({ nombreCorto: 'academia-nueva', nombre: 'Academia Nueva' });

      const primero = await crear(nueva.id, datos({ dni: '55555002' }));
      const segundo = await crear(nueva.id, datos({ dni: '55555003', nombres: 'Raúl' }));

      expect([primero.status, segundo.status]).toEqual([201, 201]);
      const lista = await listar(nueva.id);
      expect((cuerpoDe(lista) as { administradores: AdministradorCuerpo[] }).administradores).toHaveLength(2);
    });

    it('criterio 39: si el DNI ya existe en esa academia, con cualquier rol, responde 409 DNI_EN_USO sin crear nada', async () => {
      const antes = await instantaneaDeUsuarios(e.A.id);

      const respuestas = [
        await crear(e.A.id, datos({ dni: e.adminA.dni })),
        await crear(e.A.id, datos({ dni: e.secretariaA.dni })),
        await crear(e.A.id, datos({ dni: e.entrenadorA.dni })),
        await crear(e.A.id, datos({ dni: e.alumnoA.dni })),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(409);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('DNI_EN_USO');
      }
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id)).toBe(0);
    });

    it('criterio 39: el DNI de un usuario de otra academia no está en uso (D-28)', async () => {
      const respuesta = await crear(e.A.id, datos({ dni: e.adminB.dni }));

      expect(respuesta.status).toBe(201);
      expect((await leerUsuarioPorDni(e.A.id, e.adminB.dni))?.rol).toBe('ADMIN');
    });

    it('criterio 39: dos creaciones simultáneas con el mismo DNI: exactamente una responde 201 y la otra 409', async () => {
      const respuestas = await Promise.all([crear(e.A.id, datos()), crear(e.A.id, datos())]);

      expect(respuestas.map((respuesta) => respuesta.status).sort()).toEqual([201, 409]);
      expect(await contarAuditoria(e.A.id, 'USUARIO_CREADO')).toBe(1);
    });

    it.each([
      ['un DNI de 7 dígitos', datos({ dni: '5555500' })],
      ['un DNI con letras', datos({ dni: '5555500a' })],
      ['sin DNI', { nombres: 'Pilar', apellidos: 'Quispe' }],
      ['nombres de un solo carácter', datos({ nombres: 'P' })],
      ['apellidos vacíos', datos({ apellidos: '' })],
      ['nombres con un carácter de control', datos({ nombres: 'Pi\u0000lar' })],
      ['un campo rol de más', datos({ rol: 'ADMIN' })],
      ['un campo academiaId de más', datos({ academiaId: randomUUID() })],
      ['un campo clave de más', datos({ clave: 'Mi-Clave-2026' })],
      ['sin cuerpo', undefined],
    ])('criterio 39: %s responde 400 SOLICITUD_INVALIDA sin crear nada', async (_caso, cuerpo) => {
      const antes = await instantaneaDeUsuarios(e.A.id);

      const respuesta = await crear(e.A.id, cuerpo);

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id)).toBe(0);
    });
  });

  describe('criterio 40: POST /api/plataforma/academias/{id}/administradores/{usuarioId}/restablecer-clave', () => {
    it('criterio 40: hace lo del criterio 35: clave igual al DNI, cambio obligatorio, contador en 0, desbloquea y sube la versión; responde 200 con { administrador }', async () => {
      const admin = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: 'Clave-Propia-Del-Admin-1' });
      await actualizarUsuario(e.A.id, admin.id, {
        intentos_fallidos: 5,
        bloqueado_hasta: new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS),
        version_token: 2,
      });
      const antes = await leerUsuario(e.A.id, admin.id);

      const respuesta = await restablecer(e.A.id, admin.id);

      expect(respuesta.status).toBe(200);
      const { administrador } = cuerpoDe(respuesta) as { administrador: AdministradorCuerpo };
      expect(Object.keys(administrador).sort()).toEqual(CAMPOS_DE_ADMINISTRADOR);
      expect(administrador).toMatchObject({
        id: admin.id,
        dni: admin.dni,
        estado: 'ACTIVO',
        debeCambiarClave: true,
        bloqueado: false,
      });
      const despues = await leerUsuario(e.A.id, admin.id);
      expect(despues?.clave_hash.startsWith('$argon2id$')).toBe(true);
      expect(despues?.clave_hash).not.toBe(antes?.clave_hash);
      expect(despues).toMatchObject({
        debe_cambiar_clave: true,
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        version_token: 3,
      });
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 40 y 16: la sesión abierta del administrador responde 401 y entra de nuevo con su DNI', async () => {
      const abierta = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
      expect((await pedir(app, 'get', '/api/sesion', { cookie: abierta })).status).toBe(200);

      await restablecer(e.A.id, e.adminA.id);

      expect((await pedir(app, 'get', '/api/sesion', { cookie: abierta })).status).toBe(401);
      const ingreso = await pedir(app, 'post', '/api/a/academia-a/sesion', {
        cuerpo: { usuario: e.adminA.dni, clave: e.adminA.dni },
      });
      expect(ingreso.status).toBe(200);
      expect((cuerpoDe(ingreso) as { usuario: { debeCambiarClave: boolean } }).usuario.debeCambiarClave).toBe(true);
    });

    it('criterio 40: un usuarioId de otro rol, de otra academia, inexistente o que no es un UUID responde 404 NO_ENCONTRADO con el mismo cuerpo, sin cambios', async () => {
      const antes = await instantaneaDeUsuarios(e.A.id);
      const antesB = await instantaneaDeUsuarios(e.B.id);

      const respuestas = [
        await restablecer(e.A.id, e.secretariaA.id),
        await restablecer(e.A.id, e.entrenadorA.id),
        await restablecer(e.A.id, e.alumnoA.id),
        await restablecer(e.A.id, e.adminB.id),
        await restablecer(e.B.id, e.adminA.id),
        await restablecer(e.A.id, randomUUID()),
        await restablecer(e.A.id, 'abc'),
        await restablecer(e.A.id, '123'),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(404);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
        expect(respuesta.body).toEqual(respuestas[0]?.body);
      }
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
      expect(await contarAuditoria(e.A.id)).toBe(0);
      expect(await contarAuditoria(e.B.id)).toBe(0);
    });

    it('criterio 40: restablece también a un administrador inactivo sin reactivarlo', async () => {
      const inactivo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', estado: 'INACTIVO' });

      const respuesta = await restablecer(e.A.id, inactivo.id);

      expect(respuesta.status).toBe(200);
      expect((await leerUsuario(e.A.id, inactivo.id))?.estado).toBe('INACTIVO');
    });
  });

  describe('criterio 41: las tres rutas de la plataforma', () => {
    const TRES_RUTAS = [
      ['GET .../administradores', (id: string, cookie?: string) => listar(id, cookie)],
      ['POST .../administradores', (id: string, cookie?: string) => crear(id, datos({ dni: '55555009' }), cookie)],
      [
        'POST .../administradores/{usuarioId}/restablecer-clave',
        (id: string, cookie?: string) => restablecer(id, randomUUID(), cookie),
      ],
    ] as const;

    it.each(TRES_RUTAS)(
      'criterio 41: %s con una academia suspendida responde 403 ACADEMIA_SUSPENDIDA',
      async (_nombre, llamar) => {
        await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
        const antes = await instantaneaDeUsuarios(e.A.id);

        const respuesta = await llamar(e.A.id, superadmin);

        expect(respuesta.status).toBe(403);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_SUSPENDIDA');
        expect(respuesta.headers['cache-control']).toBe('no-store');
        expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
        expect(await contarAuditoria(e.A.id)).toBe(0);
      },
    );

    it.each(TRES_RUTAS)(
      'criterio 41: %s con un {id} inexistente o que no es un UUID responde 404 ACADEMIA_NO_ENCONTRADA',
      async (_nombre, llamar) => {
        for (const id of [randomUUID(), 'abc', '123', 'academia-a', 'no-es-un-uuid']) {
          const respuesta = await llamar(id, superadmin);

          expect(respuesta.status, id).toBe(404);
          expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_NO_ENCONTRADA');
        }
      },
    );

    it.each(TRES_RUTAS)(
      'criterio 41: %s sin sesión de superadmin responde 401 NO_AUTENTICADO',
      async (_nombre, llamar) => {
        const antes = await instantaneaDeUsuarios(e.A.id);

        const respuesta = await llamar(e.A.id, undefined);

        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
        expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      },
    );

    it.each(TRES_RUTAS)(
      'criterio 41: %s con la cookie aq_sesion de un administrador responde 401 NO_AUTENTICADO',
      async (_nombre, llamar) => {
        const sesionDeAdministrador = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
        const control = await pedir(app, 'get', '/api/sesion', { cookie: sesionDeAdministrador });
        expect(control.status, 'control: la cookie es una sesión de academia válida').toBe(200);
        const antes = await instantaneaDeUsuarios(e.A.id);

        const respuesta = await llamar(e.A.id, sesionDeAdministrador);

        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
        expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      },
    );

    it('criterio 41: la academia reactivada vuelve a aceptar las tres rutas', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      await fijarEstadoDeAcademia(e.A.id, 'ACTIVA');

      expect((await listar(e.A.id)).status).toBe(200);
      expect((await crear(e.A.id, datos())).status).toBe(201);
      expect((await restablecer(e.A.id, e.adminA.id)).status).toBe(200);
    });

    it('criterio 41: el Superadmin no ve ni toca otros datos internos de la academia: no hay rutas para listar sus usuarios ni su auditoría', async () => {
      const rutas = await Promise.all([
        pedir(app, 'get', `/api/plataforma/academias/${e.A.id}/usuarios`, { cookie: superadmin }),
        pedir(app, 'get', `/api/plataforma/academias/${e.A.id}/auditoria`, { cookie: superadmin }),
        pedir(app, 'post', `/api/plataforma/academias/${e.A.id}/administradores/${e.secretariaA.id}/desactivar`, {
          cookie: superadmin,
          cuerpo: {},
        }),
      ]);

      for (const respuesta of rutas) expect(respuesta.status).toBe(404);
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.estado).toBe('ACTIVO');
    });
  });
});
