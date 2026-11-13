// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia, leerAuditoriaPlataforma, type FilaAuditoria } from '../../utilidades/datos';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cuerpoDe,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  type ErrorCuerpo,
  type Escenario,
  instantaneaDeUsuarios,
  leerUsuario,
  leerUsuarioPorDni,
  pedir,
} from '../../utilidades/usuarios';

// Criterio 42: las operaciones de esta historia quedan en `auditoria` de la academia afectada, con `entidad` = `usuario`, `entidad_id`,
// actor (USUARIO o SUPERADMIN y su id) e `ip`, sin contraseñas ni hashes; si la inserción de auditoría falla, la operación completa
// falla y no deja nada (criterio 30 de la 001); y los inicios y cierres de sesión no se auditan (DR-7).

const IP = /127\.0\.0\.1|::1/;

describe('criterio 42: auditoría de las cuentas', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let admin: string;
  let superadmin: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    superadmin = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  const sinSecretos = (filas: FilaAuditoria[]) => {
    const crudo = JSON.stringify(filas);
    expect(crudo).not.toMatch(/argon2|clave_?hash|claveHash|"clave"|claveNueva|claveActual|password/i);
    expect(crudo).not.toContain(CLAVE_COMUN);
  };

  it('criterio 42: USUARIO_CREADO (por el administrador) lleva datosDespues con id, dni, nombres, apellidos, rol y estado, el actor USUARIO y la ip', async () => {
    const respuesta = await pedir(app, 'post', '/api/usuarios', {
      cookie: admin,
      cuerpo: { dni: '55553001', nombres: 'Carla', apellidos: 'Mendoza', rol: 'SECRETARIA' },
    });
    const id = (cuerpoDe(respuesta) as { usuario: { id: string } }).usuario.id;

    const registros = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CREADO');

    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      actor_tipo: 'USUARIO',
      actor_id: e.adminA.id,
      entidad: 'usuario',
      entidad_id: id,
    });
    expect(registros[0]?.datos_despues).toEqual({
      id,
      dni: '55553001',
      nombres: 'Carla',
      apellidos: 'Mendoza',
      rol: 'SECRETARIA',
      estado: 'ACTIVO',
    });
    expect(registros[0]?.ip, 'falta la ip de la petición').toMatch(IP);
    expect(registros[0]?.fecha_hora.toISOString()).toBe(AHORA_PRUEBAS.toISOString());
    sinSecretos(registros);
  });

  it('criterio 42: USUARIO_DESACTIVADO y USUARIO_REACTIVADO llevan datosAntes y datosDespues con el estado, sin secretos', async () => {
    await pedir(app, 'post', `/api/usuarios/${e.secretariaA.id}/desactivar`, { cookie: admin, cuerpo: {} });
    await pedir(app, 'post', `/api/usuarios/${e.secretariaA.id}/reactivar`, { cookie: admin, cuerpo: {} });

    const desactivado = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_DESACTIVADO');
    const reactivado = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_REACTIVADO');

    expect(desactivado).toHaveLength(1);
    expect(reactivado).toHaveLength(1);
    expect(desactivado[0]).toMatchObject({
      actor_tipo: 'USUARIO',
      actor_id: e.adminA.id,
      entidad: 'usuario',
      entidad_id: e.secretariaA.id,
      datos_antes: { estado: 'ACTIVO' },
      datos_despues: { estado: 'INACTIVO' },
    });
    expect(reactivado[0]).toMatchObject({
      actor_tipo: 'USUARIO',
      actor_id: e.adminA.id,
      entidad: 'usuario',
      entidad_id: e.secretariaA.id,
      datos_antes: { estado: 'INACTIVO' },
      datos_despues: { estado: 'ACTIVO' },
    });
    expect(desactivado[0]?.ip).toMatch(IP);
    expect(reactivado[0]?.ip).toMatch(IP);
    sinSecretos([...desactivado, ...reactivado]);
  });

  it('criterio 42: USUARIO_CLAVE_RESTABLECIDA (por el administrador y por la secretaria) no lleva datos de la clave', async () => {
    await pedir(app, 'post', `/api/usuarios/${e.entrenadorA.id}/restablecer-clave`, { cookie: admin, cuerpo: {} });
    await pedir(app, 'post', `/api/usuarios/${e.alumnoA.id}/restablecer-clave`, {
      cookie: cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS),
      cuerpo: {},
    });

    const registros = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CLAVE_RESTABLECIDA');

    expect(registros).toHaveLength(2);
    expect(registros.find((r) => r.entidad_id === e.entrenadorA.id)).toMatchObject({
      actor_tipo: 'USUARIO',
      actor_id: e.adminA.id,
      entidad: 'usuario',
    });
    expect(registros.find((r) => r.entidad_id === e.alumnoA.id)).toMatchObject({
      actor_tipo: 'USUARIO',
      actor_id: e.secretariaA.id,
      entidad: 'usuario',
    });
    for (const registro of registros) expect(registro.ip).toMatch(IP);
    sinSecretos(registros);
    expect(JSON.stringify(registros)).not.toContain(e.alumnoA.dni);
    expect(JSON.stringify(registros)).not.toContain(e.entrenadorA.dni);
  });

  it('criterio 42: USUARIO_CLAVE_CAMBIADA (la propia contraseña) lleva el actor y la ip y ningún dato de la clave', async () => {
    await pedir(app, 'post', '/api/sesion/clave', {
      cookie: cookieDeUsuario(e.alumnoA, AHORA_PRUEBAS),
      cuerpo: { claveActual: CLAVE_COMUN, claveNueva: 'Clave-Nueva-Unica-2026' },
    });

    const registros = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CLAVE_CAMBIADA');

    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      actor_tipo: 'USUARIO',
      actor_id: e.alumnoA.id,
      entidad: 'usuario',
      entidad_id: e.alumnoA.id,
    });
    expect(registros[0]?.ip).toMatch(IP);
    sinSecretos(registros);
    expect(JSON.stringify(registros)).not.toContain('Clave-Nueva-Unica-2026');
  });

  it('criterio 42: lo que hace el Superadmin queda en la auditoría de esa academia con actor SUPERADMIN y su id, y no en auditoria_plataforma', async () => {
    const creado = await pedir(app, 'post', `/api/plataforma/academias/${e.A.id}/administradores`, {
      cookie: superadmin,
      cuerpo: { dni: '55553002', nombres: 'Pilar', apellidos: 'Quispe' },
    });
    const id = (cuerpoDe(creado) as { administrador: { id: string } }).administrador.id;
    await pedir(app, 'post', `/api/plataforma/academias/${e.A.id}/administradores/${e.adminA.id}/restablecer-clave`, {
      cookie: superadmin,
      cuerpo: {},
    });

    const creaciones = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CREADO');
    const restablecimientos = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CLAVE_RESTABLECIDA');

    expect(creaciones).toHaveLength(1);
    expect(creaciones[0]).toMatchObject({
      actor_tipo: 'SUPERADMIN',
      actor_id: e.superadmin.id,
      entidad: 'usuario',
      entidad_id: id,
    });
    expect(creaciones[0]?.datos_despues).toEqual({
      id,
      dni: '55553002',
      nombres: 'Pilar',
      apellidos: 'Quispe',
      rol: 'ADMIN',
      estado: 'ACTIVO',
    });
    expect(restablecimientos).toHaveLength(1);
    expect(restablecimientos[0]).toMatchObject({
      actor_tipo: 'SUPERADMIN',
      actor_id: e.superadmin.id,
      entidad: 'usuario',
      entidad_id: e.adminA.id,
    });
    for (const registro of [...creaciones, ...restablecimientos]) expect(registro.ip).toMatch(IP);
    sinSecretos([...creaciones, ...restablecimientos]);
    expect((await leerAuditoriaPlataforma()).filter((fila) => fila.accion.startsWith('USUARIO_'))).toEqual([]);
    expect(await contarAuditoria(e.B.id)).toBe(0);
  });

  it('criterio 42: los inicios y cierres de sesión, correctos o fallidos, no se auditan', async () => {
    const correcto = await pedir(app, 'post', '/api/a/academia-a/sesion', {
      cuerpo: { usuario: e.secretariaA.dni, clave: CLAVE_COMUN },
    });
    const fallido = await pedir(app, 'post', '/api/a/academia-a/sesion', {
      cuerpo: { usuario: e.secretariaA.dni, clave: 'clave-equivocada-123' },
    });
    const consulta = await pedir(app, 'get', '/api/sesion', { cookie: cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS) });
    const cierre = await pedir(app, 'delete', '/api/sesion', {
      cookie: cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS),
    });

    expect([correcto.status, fallido.status, consulta.status, cierre.status]).toEqual([200, 401, 200, 204]);
    expect(await contarAuditoria(e.A.id)).toBe(0);
    expect(await contarAuditoria(e.B.id)).toBe(0);
  });

  it('criterio 42: las operaciones rechazadas (403, 404, 409, 400) no dejan registros de auditoría', async () => {
    const respuestas = [
      await pedir(app, 'post', `/api/usuarios/${e.adminA.id}/desactivar`, { cookie: admin, cuerpo: {} }),
      await pedir(app, 'post', `/api/usuarios/${e.secretariaB.id}/desactivar`, { cookie: admin, cuerpo: {} }),
      await pedir(app, 'post', `/api/usuarios/${e.secretariaA.id}/reactivar`, { cookie: admin, cuerpo: {} }),
      await pedir(app, 'post', '/api/usuarios', {
        cookie: admin,
        cuerpo: { dni: e.alumnoA.dni, nombres: 'Otra', apellidos: 'Persona', rol: 'ADMIN' },
      }),
      await pedir(app, 'post', '/api/usuarios', { cookie: admin, cuerpo: { dni: 'x' } }),
      await pedir(app, 'post', `/api/usuarios/${e.alumnoA.id}/restablecer-clave`, {
        cookie: cookieDeUsuario(e.entrenadorA, AHORA_PRUEBAS),
        cuerpo: {},
      }),
      await pedir(app, 'post', '/api/sesion/clave', {
        cookie: admin,
        cuerpo: { claveActual: 'clave-actual-equivocada', claveNueva: 'Clave-Nueva-Unica-2026' },
      }),
    ];

    expect(respuestas.map((respuesta) => respuesta.status)).toEqual([409, 404, 409, 409, 400, 403, 400]);
    expect(await contarAuditoria(e.A.id)).toBe(0);
    expect(await contarAuditoria(e.B.id)).toBe(0);
  });
});

describe('criterio 42: si la inserción de auditoría falla, la operación completa falla y no deja nada', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let admin: string;
  let superadmin: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    superadmin = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
    await ejecutarComo(
      'propietario',
      `CREATE OR REPLACE FUNCTION public.prueba_002_falla_auditoria() RETURNS trigger LANGUAGE plpgsql AS
         $$ BEGIN RAISE EXCEPTION 'falla de auditoría provocada por la prueba'; END $$`,
    );
    // La API rechaza un rol con EXECUTE sobre funciones de `public` concedido a PUBLIC (criterio 130 de la 001): se revoca para que
    // el 500 venga de la auditoría y no de la comprobación del rol.
    await ejecutarComo('propietario', 'REVOKE EXECUTE ON FUNCTION public.prueba_002_falla_auditoria() FROM PUBLIC');
    await ejecutarComo(
      'propietario',
      `CREATE TRIGGER prueba_002_falla BEFORE INSERT ON auditoria
         FOR EACH ROW EXECUTE FUNCTION public.prueba_002_falla_auditoria()`,
    );
  });
  afterEach(async () => {
    await ejecutarComo('propietario', 'DROP TRIGGER IF EXISTS prueba_002_falla ON auditoria');
    await ejecutarComo('propietario', 'DROP FUNCTION IF EXISTS public.prueba_002_falla_auditoria()');
  });
  afterAll(async () => {
    await app?.close();
  });

  const sinProvocada = (cuerpo: unknown) => expect(JSON.stringify(cuerpo)).not.toContain('provocada por la prueba');

  it('criterio 42: crear un usuario responde 500 ERROR_INTERNO y el usuario no existe', async () => {
    const antes = await instantaneaDeUsuarios(e.A.id);

    const respuesta = await pedir(app, 'post', '/api/usuarios', {
      cookie: admin,
      cuerpo: { dni: '55554001', nombres: 'Carla', apellidos: 'Mendoza', rol: 'SECRETARIA' },
    });

    expect(respuesta.status).toBe(500);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('ERROR_INTERNO');
    sinProvocada(respuesta.body);
    expect(await leerUsuarioPorDni(e.A.id, '55554001')).toBeUndefined();
    expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
  });

  it('criterio 42: desactivar responde 500 y el usuario sigue ACTIVO con la misma versión de token', async () => {
    const antes = await leerUsuario(e.A.id, e.secretariaA.id);

    const respuesta = await pedir(app, 'post', `/api/usuarios/${e.secretariaA.id}/desactivar`, {
      cookie: admin,
      cuerpo: {},
    });

    expect(respuesta.status).toBe(500);
    expect(await leerUsuario(e.A.id, e.secretariaA.id)).toEqual(antes);
  });

  it('criterio 42: reactivar responde 500 y el usuario sigue INACTIVO', async () => {
    await actualizarUsuario(e.A.id, e.secretariaA.id, { estado: 'INACTIVO' });
    const antes = await leerUsuario(e.A.id, e.secretariaA.id);

    const respuesta = await pedir(app, 'post', `/api/usuarios/${e.secretariaA.id}/reactivar`, {
      cookie: admin,
      cuerpo: {},
    });

    expect(respuesta.status).toBe(500);
    expect(await leerUsuario(e.A.id, e.secretariaA.id)).toEqual(antes);
  });

  it('criterio 42: restablecer la clave responde 500 y la clave, el bloqueo y la versión no cambian', async () => {
    await actualizarUsuario(e.A.id, e.alumnoA.id, { intentos_fallidos: 3 });
    const antes = await leerUsuario(e.A.id, e.alumnoA.id);

    const respuesta = await pedir(app, 'post', `/api/usuarios/${e.alumnoA.id}/restablecer-clave`, {
      cookie: admin,
      cuerpo: {},
    });

    expect(respuesta.status).toBe(500);
    expect(await leerUsuario(e.A.id, e.alumnoA.id)).toEqual(antes);
  });

  it('criterio 42: cambiar la propia clave responde 500 y la clave y la versión no cambian (la sesión sigue valiendo)', async () => {
    const cookie = cookieDeUsuario(e.alumnoA, AHORA_PRUEBAS);
    const antes = await leerUsuario(e.A.id, e.alumnoA.id);

    const respuesta = await pedir(app, 'post', '/api/sesion/clave', {
      cookie,
      cuerpo: { claveActual: CLAVE_COMUN, claveNueva: 'Clave-Nueva-Unica-2026' },
    });

    expect(respuesta.status).toBe(500);
    expect(respuesta.headers['set-cookie']).toBeUndefined();
    expect(await leerUsuario(e.A.id, e.alumnoA.id)).toEqual(antes);
    expect((await pedir(app, 'get', '/api/sesion', { cookie })).status).toBe(200);
  });

  it('criterio 42: crear un administrador desde la plataforma responde 500 y no existe', async () => {
    const antes = await instantaneaDeUsuarios(e.A.id);

    const respuesta = await pedir(app, 'post', `/api/plataforma/academias/${e.A.id}/administradores`, {
      cookie: superadmin,
      cuerpo: { dni: '55554002', nombres: 'Pilar', apellidos: 'Quispe' },
    });

    expect(respuesta.status).toBe(500);
    expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
  });

  it('criterio 42: restablecer la clave de un administrador desde la plataforma responde 500 y no cambia nada', async () => {
    const antes = await leerUsuario(e.A.id, e.adminA.id);

    const respuesta = await pedir(
      app,
      'post',
      `/api/plataforma/academias/${e.A.id}/administradores/${e.adminA.id}/restablecer-clave`,
      { cookie: superadmin, cuerpo: {} },
    );

    expect(respuesta.status).toBe(500);
    expect(await leerUsuario(e.A.id, e.adminA.id)).toEqual(antes);
  });
});
