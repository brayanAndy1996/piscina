// spec: 002-autenticacion-roles (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cuerpoDe,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  instantaneaDeUsuarios,
  leerUsuario,
  leerUsuarioPorDni,
  leerUsuarios,
  pedir,
} from '../../utilidades/usuarios';

// Criterios 29 a 33 (y 16): gestión del personal por el administrador: listar, crear, desactivar y reactivar, siempre dentro de su
// academia. Aplicación compartida con sesiones firmadas (sin pasar por el ingreso, que tiene un límite por IP).

interface UsuarioResumenCuerpo {
  id: string;
  dni: string;
  nombres: string;
  apellidos: string;
  rol: string;
  estado: string;
  debeCambiarClave: boolean;
  bloqueado: boolean;
  ultimoAcceso: string | null;
}

const CAMPOS_DE_USUARIO_RESUMEN = [
  'apellidos',
  'bloqueado',
  'debeCambiarClave',
  'dni',
  'estado',
  'id',
  'nombres',
  'rol',
  'ultimoAcceso',
];

describe('gestión del personal', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let cookie: string; // ADMIN de A

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
    cookie = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  const crear = (cuerpo: unknown, galleta: string | undefined = cookie) =>
    pedir(app, 'post', '/api/usuarios', { cookie: galleta, cuerpo });
  const accion = (id: string, nombre: 'desactivar' | 'reactivar' | 'restablecer-clave', galleta = cookie) =>
    pedir(app, 'post', `/api/usuarios/${id}/${nombre}`, { cookie: galleta, cuerpo: {} });

  describe('criterio 29: GET /api/usuarios', () => {
    it('criterio 29: lista el personal de A (ADMIN, SECRETARIA y ENTRENADOR, también los inactivos), sin alumnos ni usuarios de B', async () => {
      const inactivo = await crearUsuarioDePrueba({
        academiaId: e.A.id,
        rol: 'ENTRENADOR',
        estado: 'INACTIVO',
        nombres: 'Nora',
        apellidos: 'Zavala',
      });

      const respuesta = await pedir(app, 'get', '/api/usuarios', { cookie });

      expect(respuesta.status).toBe(200);
      const { usuarios } = cuerpoDe(respuesta) as { usuarios: UsuarioResumenCuerpo[] };
      expect(usuarios.map((usuario) => usuario.id).sort()).toEqual(
        [e.adminA.id, e.secretariaA.id, e.entrenadorA.id, inactivo.id].sort(),
      );
      expect(usuarios.find((usuario) => usuario.id === inactivo.id)?.estado).toBe('INACTIVO');
      expect(usuarios.map((usuario) => usuario.rol)).not.toContain('ALUMNO');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 29: cada elemento tiene exactamente los campos de UsuarioResumen, nunca el hash, la versión de token ni el contador de intentos', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, {
        intentos_fallidos: 3,
        version_token: 4,
        ultimo_acceso: new Date('2026-11-10T14:30:00.000Z'),
      });

      const respuesta = await pedir(app, 'get', '/api/usuarios', { cookie });

      const { usuarios } = cuerpoDe(respuesta) as { usuarios: UsuarioResumenCuerpo[] };
      for (const usuario of usuarios) expect(Object.keys(usuario).sort()).toEqual(CAMPOS_DE_USUARIO_RESUMEN);
      expect(JSON.stringify(respuesta.body)).not.toMatch(/argon2|clave_?hash|claveHash|version|intentos/i);
      expect(usuarios.find((usuario) => usuario.id === e.secretariaA.id)).toEqual({
        id: e.secretariaA.id,
        dni: e.secretariaA.dni,
        nombres: 'Lucia',
        apellidos: 'Benites',
        rol: 'SECRETARIA',
        estado: 'ACTIVO',
        debeCambiarClave: false,
        bloqueado: false,
        ultimoAcceso: '2026-11-10T14:30:00.000Z',
      });
      expect(usuarios.find((usuario) => usuario.id === e.adminA.id)?.ultimoAcceso).toBeNull();
    });

    it('criterio 29: bloqueado es verdadero solo mientras bloqueado_hasta es posterior a ahora (según RELOJ)', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, {
        bloqueado_hasta: new Date(AHORA_PRUEBAS.getTime() + 60_000),
      });
      await actualizarUsuario(e.A.id, e.entrenadorA.id, {
        bloqueado_hasta: new Date(AHORA_PRUEBAS.getTime() - 60_000),
      });

      const respuesta = await pedir(app, 'get', '/api/usuarios', { cookie });

      const { usuarios } = cuerpoDe(respuesta) as { usuarios: UsuarioResumenCuerpo[] };
      const bloqueado = (id: string) => usuarios.find((usuario) => usuario.id === id)?.bloqueado;
      expect(bloqueado(e.secretariaA.id)).toBe(true);
      expect(bloqueado(e.entrenadorA.id)).toBe(false);
      expect(bloqueado(e.adminA.id)).toBe(false);
    });

    it('criterio 29: ordena por apellidos y luego por nombres', async () => {
      await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA', nombres: 'Luis', apellidos: 'Castro' });
      await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', nombres: 'Ana', apellidos: 'Castro' });
      await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', nombres: 'Pedro', apellidos: 'Abanto' });

      const respuesta = await pedir(app, 'get', '/api/usuarios', { cookie });

      const { usuarios } = cuerpoDe(respuesta) as { usuarios: UsuarioResumenCuerpo[] };
      expect(usuarios.map((usuario) => `${usuario.apellidos} ${usuario.nombres}`)).toEqual([
        'Abanto Pedro',
        'Alvarez Rosa',
        'Benites Lucia',
        'Castro Ana',
        'Castro Luis',
        'Castro Mario',
      ]);
    });

    it('criterio 29: el administrador de B ve solo el personal de B', async () => {
      const respuesta = await pedir(app, 'get', '/api/usuarios', { cookie: cookieDeUsuario(e.adminB, AHORA_PRUEBAS) });

      const { usuarios } = cuerpoDe(respuesta) as { usuarios: UsuarioResumenCuerpo[] };
      expect(usuarios.map((usuario) => usuario.id).sort()).toEqual([e.adminB.id, e.secretariaB.id].sort());
    });
  });

  describe('criterio 30: POST /api/usuarios', () => {
    const datos = (sobrescribir: Record<string, unknown> = {}) => ({
      dni: '55551001',
      nombres: 'Carla',
      apellidos: 'Mendoza',
      rol: 'SECRETARIA',
      ...sobrescribir,
    });

    it.each(['ADMIN', 'SECRETARIA', 'ENTRENADOR'])(
      'criterio 30: crea un %s en A: 201 con { usuario }, ACTIVO, clave_hash argon2id del DNI y debe_cambiar_clave = true',
      async (rol) => {
        const respuesta = await crear(datos({ rol }));

        expect(respuesta.status).toBe(201);
        const { usuario } = cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo };
        expect(Object.keys(usuario).sort()).toEqual(CAMPOS_DE_USUARIO_RESUMEN);
        expect(usuario).toMatchObject({
          dni: '55551001',
          nombres: 'Carla',
          apellidos: 'Mendoza',
          rol,
          estado: 'ACTIVO',
          debeCambiarClave: true,
          bloqueado: false,
          ultimoAcceso: null,
        });
        const fila = await leerUsuario(e.A.id, usuario.id);
        expect(fila).toMatchObject({
          academia_id: e.A.id,
          dni: '55551001',
          rol,
          estado: 'ACTIVO',
          debe_cambiar_clave: true,
        });
        expect(fila?.clave_hash.startsWith('$argon2id$')).toBe(true);
        expect(fila?.clave_hash).not.toContain('55551001');
        expect(fila?.intentos_fallidos).toBe(0);
        expect(fila?.version_token).toBe(0);
        expect(JSON.stringify(respuesta.body)).not.toMatch(/argon2|clave_?hash/i);
        expect(respuesta.headers['cache-control']).toBe('no-store');
      },
    );

    it('criterio 30: la cuenta nueva entra con su DNI como contraseña y se le exige el cambio', async () => {
      await crear(datos());

      const ingreso = await pedir(app, 'post', '/api/a/academia-a/sesion', {
        cuerpo: { usuario: '55551001', clave: '55551001' },
      });

      expect(ingreso.status).toBe(200);
      expect((cuerpoDe(ingreso) as { usuario: { debeCambiarClave: boolean; rol: string } }).usuario).toMatchObject({
        debeCambiarClave: true,
        rol: 'SECRETARIA',
      });
    });

    it('criterio 30: el usuario creado aparece en la lista del administrador y no en la de B', async () => {
      const respuesta = await crear(datos());
      const id = (cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo }).usuario.id;

      const deA = await pedir(app, 'get', '/api/usuarios', { cookie });
      const deB = await pedir(app, 'get', '/api/usuarios', { cookie: cookieDeUsuario(e.adminB, AHORA_PRUEBAS) });

      expect((cuerpoDe(deA) as { usuarios: { id: string }[] }).usuarios.map((u) => u.id)).toContain(id);
      expect((cuerpoDe(deB) as { usuarios: { id: string }[] }).usuarios.map((u) => u.id)).not.toContain(id);
      expect(await leerUsuarioPorDni(e.B.id, '55551001')).toBeUndefined();
    });

    it('criterio 30: con rol ALUMNO responde 400 SOLICITUD_INVALIDA (las cuentas de alumno las crea el paso de cliente a alumno)', async () => {
      const antes = await instantaneaDeUsuarios(e.A.id);

      const respuesta = await crear(datos({ rol: 'ALUMNO' }));

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      expect((respuesta.body as ErrorCuerpo).detalles?.errores?.map((error) => error.campo)).toContain('rol');
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id)).toBe(0);
    });

    it.each([
      ['un rol que no existe', datos({ rol: 'SUPERADMIN' })],
      ['sin rol', { dni: '55551001', nombres: 'Carla', apellidos: 'Mendoza' }],
      ['un DNI de 7 dígitos', datos({ dni: '5555100' })],
      ['un DNI de 9 dígitos', datos({ dni: '555510011' })],
      ['un DNI con letras', datos({ dni: '5555100a' })],
      ['un DNI con guion', datos({ dni: '5555-1001' })],
      ['un DNI con espacio en medio', datos({ dni: '5555 1001' })],
      ['un DNI que es un número', datos({ dni: 55551001 })],
      ['nombres de un solo carácter', datos({ nombres: 'C' })],
      ['nombres de más de 100 caracteres', datos({ nombres: 'C'.repeat(101) })],
      ['apellidos vacíos', datos({ apellidos: '' })],
      ['apellidos solo con espacios', datos({ apellidos: '    ' })],
      ['nombres con un carácter de control', datos({ nombres: 'Car\u0000la' })],
      ['apellidos con un salto de línea', datos({ apellidos: 'Men\ndoza' })],
      ['un campo de más', datos({ estado: 'ACTIVO' })],
      ['un campo clave de más', datos({ clave: 'Mi-Clave-2026' })],
      ['un campo academiaId de más', datos({ academiaId: randomUUID() })],
      ['sin cuerpo', undefined],
    ])('criterio 30: %s responde 400 SOLICITUD_INVALIDA sin crear ni auditar nada', async (_caso, cuerpo) => {
      const antes = await instantaneaDeUsuarios(e.A.id);

      const respuesta = await crear(cuerpo);

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id)).toBe(0);
    });

    it('criterio 30: los nombres y apellidos se guardan recortados y el DNI con espacios en los extremos se recorta', async () => {
      const respuesta = await crear(datos({ dni: ' 55551002 ', nombres: '  Carla  ', apellidos: '  Mendoza Ríos ' }));

      expect(respuesta.status).toBe(201);
      const fila = await leerUsuarioPorDni(e.A.id, '55551002');
      expect(fila).toMatchObject({ nombres: 'Carla', apellidos: 'Mendoza Ríos' });
    });

    it('criterio 30: un DNI con ceros a la izquierda se guarda tal cual, como texto', async () => {
      const respuesta = await crear(datos({ dni: '01234567' }));

      expect(respuesta.status).toBe(201);
      expect((cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo }).usuario.dni).toBe('01234567');
      expect((await leerUsuarioPorDni(e.A.id, '01234567'))?.dni).toBe('01234567');
    });
  });

  describe('criterio 31: POST /api/usuarios/{id}/desactivar', () => {
    it('criterio 31: desactiva a un miembro del personal activo: 200 con el usuario INACTIVO e incrementa version_token', async () => {
      const antes = await leerUsuario(e.A.id, e.secretariaA.id);

      const respuesta = await accion(e.secretariaA.id, 'desactivar');

      expect(respuesta.status).toBe(200);
      const { usuario } = cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo };
      expect(Object.keys(usuario).sort()).toEqual(CAMPOS_DE_USUARIO_RESUMEN);
      expect(usuario).toMatchObject({ id: e.secretariaA.id, estado: 'INACTIVO', rol: 'SECRETARIA' });
      const despues = await leerUsuario(e.A.id, e.secretariaA.id);
      expect(despues?.estado).toBe('INACTIVO');
      expect(despues?.version_token).toBe((antes?.version_token ?? 0) + 1);
      expect(despues?.clave_hash).toBe(antes?.clave_hash);
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 31 y 16: la sesión del usuario desactivado responde 401 en la siguiente petición y ya no puede ingresar (403 USUARIO_INACTIVO)', async () => {
      const suya = cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS);
      expect((await pedir(app, 'get', '/api/sesion', { cookie: suya })).status).toBe(200);

      await accion(e.secretariaA.id, 'desactivar');

      const sesion = await pedir(app, 'get', '/api/sesion', { cookie: suya });
      const ingreso = await pedir(app, 'post', '/api/a/academia-a/sesion', {
        cuerpo: { usuario: e.secretariaA.dni, clave: CLAVE_COMUN },
      });
      expect(sesion.status).toBe(401);
      expect((sesion.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      expect(ingreso.status).toBe(403);
      expect((ingreso.body as ErrorCuerpo).codigo).toBe('USUARIO_INACTIVO');
    });

    it('criterio 31: sobre sí mismo responde 409 OPERACION_SOBRE_SI_MISMO sin cambios ni auditoría', async () => {
      const antes = await instantaneaDeUsuarios(e.A.id);

      const respuesta = await accion(e.adminA.id, 'desactivar');

      expect(respuesta.status).toBe(409);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('OPERACION_SOBRE_SI_MISMO');
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id)).toBe(0);
      expect((await pedir(app, 'get', '/api/sesion', { cookie })).status, 'su sesión sigue valiendo').toBe(200);
    });

    it('criterio 31: sobre uno ya inactivo responde 409 USUARIO_YA_INACTIVO sin cambios ni auditoría', async () => {
      await accion(e.entrenadorA.id, 'desactivar');
      const antes = await instantaneaDeUsuarios(e.A.id);
      const auditoriaAntes = await contarAuditoria(e.A.id);

      const respuesta = await accion(e.entrenadorA.id, 'desactivar');

      expect(respuesta.status).toBe(409);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('USUARIO_YA_INACTIVO');
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id)).toBe(auditoriaAntes);
    });

    it('criterio 31: sobre un alumno responde 404 NO_ENCONTRADO (su estado lo maneja la historia 010)', async () => {
      // Control: la misma ruta sí desactiva a un miembro del personal (así el 404 no es solo "la ruta no existe").
      expect((await accion(e.entrenadorA.id, 'desactivar')).status).toBe(200);
      const antes = await instantaneaDeUsuarios(e.A.id);

      const respuesta = await accion(e.alumnoA.id, 'desactivar');

      expect(respuesta.status).toBe(404);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
    });

    it('criterio 31: un administrador puede desactivar a otro administrador de su academia', async () => {
      const otroAdmin = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN' });

      const respuesta = await accion(otroAdmin.id, 'desactivar');

      expect(respuesta.status).toBe(200);
      expect((await leerUsuario(e.A.id, otroAdmin.id))?.estado).toBe('INACTIVO');
    });

    it('criterio 31: doble clic: desactivar dos veces seguidas responde 200 y luego 409, con una sola auditoría y una sola subida de versión', async () => {
      const primera = await accion(e.secretariaA.id, 'desactivar');
      const segunda = await accion(e.secretariaA.id, 'desactivar');

      expect([primera.status, segunda.status]).toEqual([200, 409]);
      expect(await contarAuditoria(e.A.id, 'USUARIO_DESACTIVADO')).toBe(1);
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.version_token).toBe(1);
    });

    it('criterio 31: dos desactivaciones simultáneas: exactamente una responde 200 y la otra 409', async () => {
      const respuestas = await Promise.all([
        accion(e.secretariaA.id, 'desactivar'),
        accion(e.secretariaA.id, 'desactivar'),
      ]);

      expect(respuestas.map((respuesta) => respuesta.status).sort()).toEqual([200, 409]);
      expect(await contarAuditoria(e.A.id, 'USUARIO_DESACTIVADO')).toBe(1);
      expect((await leerUsuario(e.A.id, e.secretariaA.id))?.version_token).toBe(1);
    });
  });

  describe('criterio 32: POST /api/usuarios/{id}/reactivar', () => {
    it('criterio 32: reactiva a un miembro del personal inactivo: 200 con el usuario ACTIVO, sin cambiar la contraseña', async () => {
      await accion(e.secretariaA.id, 'desactivar');
      const antes = await leerUsuario(e.A.id, e.secretariaA.id);

      const respuesta = await accion(e.secretariaA.id, 'reactivar');

      expect(respuesta.status).toBe(200);
      expect((cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo }).usuario).toMatchObject({
        id: e.secretariaA.id,
        estado: 'ACTIVO',
      });
      const despues = await leerUsuario(e.A.id, e.secretariaA.id);
      expect(despues?.estado).toBe('ACTIVO');
      expect(despues?.clave_hash).toBe(antes?.clave_hash);
      expect(despues?.debe_cambiar_clave).toBe(antes?.debe_cambiar_clave);
    });

    it('criterio 32: tras reactivar, la persona entra con su misma contraseña, pero la sesión anterior no revive', async () => {
      const anterior = cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS);
      await accion(e.secretariaA.id, 'desactivar');
      await accion(e.secretariaA.id, 'reactivar');

      const sesionAnterior = await pedir(app, 'get', '/api/sesion', { cookie: anterior });
      const ingreso = await pedir(app, 'post', '/api/a/academia-a/sesion', {
        cuerpo: { usuario: e.secretariaA.dni, clave: CLAVE_COMUN },
      });

      expect(sesionAnterior.status).toBe(401);
      expect(ingreso.status).toBe(200);
    });

    it('criterio 32: sobre uno activo responde 409 USUARIO_YA_ACTIVO sin cambios ni auditoría', async () => {
      const antes = await instantaneaDeUsuarios(e.A.id);

      const respuesta = await accion(e.secretariaA.id, 'reactivar');

      expect(respuesta.status).toBe(409);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('USUARIO_YA_ACTIVO');
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id)).toBe(0);
    });

    it('criterio 32: sobre un alumno responde 404 NO_ENCONTRADO (los alumnos no se gestionan aquí)', async () => {
      await actualizarUsuario(e.A.id, e.alumnoA.id, { estado: 'INACTIVO' });
      // Control: la misma ruta sí reactiva a un miembro del personal.
      await actualizarUsuario(e.A.id, e.entrenadorA.id, { estado: 'INACTIVO' });
      expect((await accion(e.entrenadorA.id, 'reactivar')).status).toBe(200);
      const antes = await instantaneaDeUsuarios(e.A.id);

      const respuesta = await accion(e.alumnoA.id, 'reactivar');

      expect(respuesta.status).toBe(404);
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
    });
  });

  describe('criterio 33: ids que no son de la academia', () => {
    const IDS_INVALIDOS = ['abc', '123', 'no-es-un-uuid', '00000000-0000-0000-0000-00000000000g', `${randomUUID()}x`];

    it.each(['desactivar', 'reactivar', 'restablecer-clave'] as const)(
      'criterio 33: %s con un id que no es UUID, que no existe o que es de otra academia responde 404 NO_ENCONTRADO con el mismo cuerpo, sin cambios ni auditoría',
      async (nombre) => {
        // Control: la misma acción sobre un usuario de la propia academia funciona (el 404 de abajo no es "la ruta no existe").
        const control = await crearUsuarioDePrueba({
          academiaId: e.A.id,
          rol: 'ENTRENADOR',
          clave: CLAVE_COMUN,
          estado: nombre === 'reactivar' ? 'INACTIVO' : 'ACTIVO',
        });
        expect((await accion(control.id, nombre)).status).toBe(200);
        const antes = await instantaneaDeUsuarios(e.A.id);
        const antesB = await instantaneaDeUsuarios(e.B.id);
        const auditoriaAntes = await contarAuditoria(e.A.id);

        const respuestas = [
          ...(await Promise.all(IDS_INVALIDOS.map((id) => accion(id, nombre)))),
          await accion(randomUUID(), nombre),
          await accion(e.secretariaB.id, nombre),
          await accion(e.alumnoB.id, nombre),
          await accion(e.adminB.id, nombre),
        ];

        for (const respuesta of respuestas) {
          expect(respuesta.status).toBe(404);
          expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
        }
        for (const respuesta of respuestas) expect(respuesta.body).toEqual(respuestas[0]?.body);
        expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
        expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
        expect(await contarAuditoria(e.A.id)).toBe(auditoriaAntes);
        expect(await contarAuditoria(e.B.id)).toBe(0);
      },
    );

    it('criterio 33: el mismo usuario de B no se puede desactivar ni siquiera sabiendo su id exacto, y sigue activo', async () => {
      expect((await accion(e.secretariaA.id, 'desactivar')).status, 'control: un usuario de A sí se desactiva').toBe(
        200,
      );

      const respuesta = await accion(e.secretariaB.id, 'desactivar');

      expect(respuesta.status).toBe(404);
      expect((await leerUsuario(e.B.id, e.secretariaB.id))?.estado).toBe('ACTIVO');
      expect((await leerUsuario(e.B.id, e.secretariaB.id))?.version_token).toBe(0);
    });

    it('criterio 33: la lista de usuarios de A nunca devuelve a un usuario de B, también si comparten DNI', async () => {
      const mismoDni = await crearUsuarioDePrueba({
        academiaId: e.B.id,
        rol: 'SECRETARIA',
        dni: e.secretariaA.dni,
        clave: CLAVE_COMUN,
      });

      const respuesta = await pedir(app, 'get', '/api/usuarios', { cookie });

      const ids = (cuerpoDe(respuesta) as { usuarios: { id: string }[] }).usuarios.map((usuario) => usuario.id);
      expect(ids).toContain(e.secretariaA.id);
      expect(ids).not.toContain(mismoDni.id);
      expect((await leerUsuarios(e.B.id)).length).toBeGreaterThan(0);
    });
  });
});
