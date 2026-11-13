// spec: 002-autenticacion-roles (pruebas protegidas)
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { obtenerBaseDatos } from '../../utilidades/modulos';
import {
  AHORA_PRUEBAS,
  cargarFuncionalidad002,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  dniInventado,
  type ErrorCuerpo,
  type Escenario,
  hashDeClave,
  instantaneaDeUsuarios,
  leerUsuarioPorDni,
  leerUsuarios,
  pedir,
} from '../../utilidades/usuarios';

// Criterio 3: el DNI es único dentro de cada academia (D-28, RN-03), también con dos creaciones simultáneas; y el contrato de
// `UsuariosService.crearEnTransaccion` (lo usará la historia 007 para crear la cuenta del alumno).

interface UsuariosServicePrueba {
  crearEnTransaccion(
    tx: unknown,
    datos: { dni: string; nombres: string; apellidos: string; rol: string; claveHash: string },
    actor: { tipo: 'USUARIO' | 'SUPERADMIN' | 'SISTEMA'; id: string | null },
    ip: string | null,
  ): Promise<{ id: string; dni: string; nombres: string; apellidos: string; rol: string; estado: string }>;
}

describe('criterio 3: DNI único por academia', () => {
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

  const crear = (dni: string, rol = 'SECRETARIA', galleta = cookie) =>
    pedir(app, 'post', '/api/usuarios', {
      cookie: galleta,
      cuerpo: { dni, nombres: 'Persona', apellidos: 'De Prueba', rol },
    });

  it('criterio 3: crear otro usuario con el DNI de uno existente de A responde 409 DNI_EN_USO sin crear ni auditar nada', async () => {
    const antes = await instantaneaDeUsuarios(e.A.id);

    const respuesta = await crear(e.secretariaA.dni);

    expect(respuesta.status).toBe(409);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('DNI_EN_USO');
    expect(respuesta.headers['cache-control']).toBe('no-store');
    expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
    expect(await contarAuditoria(e.A.id)).toBe(0);
  });

  it.each([
    ['un alumno', () => e.alumnoA.dni],
    ['un administrador', () => e.adminA.dni],
  ])('criterio 3: el DNI de %s de A también está en uso, cualquiera sea el rol que se crea', async (_caso, dni) => {
    const respuesta = await crear(dni(), 'ENTRENADOR');

    expect(respuesta.status).toBe(409);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('DNI_EN_USO');
  });

  it('criterio 3: el DNI de un usuario INACTIVO sigue en uso', async () => {
    const inactivo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', estado: 'INACTIVO' });

    const respuesta = await crear(inactivo.dni);

    expect(respuesta.status).toBe(409);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('DNI_EN_USO');
  });

  it('criterio 3: crear un usuario con el DNI de uno que existe solo en B responde 201 en A (D-28) y no toca a B', async () => {
    const antesB = await instantaneaDeUsuarios(e.B.id);

    const respuesta = await crear(e.secretariaB.dni);

    expect(respuesta.status).toBe(201);
    expect(await leerUsuarioPorDni(e.A.id, e.secretariaB.dni)).toMatchObject({
      academia_id: e.A.id,
      rol: 'SECRETARIA',
    });
    expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
    expect((await leerUsuarioPorDni(e.B.id, e.secretariaB.dni))?.id).toBe(e.secretariaB.id);
  });

  it('criterio 3: la misma persona en dos academias es dos cuentas independientes, cada una con su clave', async () => {
    const dni = '20262026';
    await crear(dni);
    const enB = await pedir(app, 'post', '/api/usuarios', {
      cookie: cookieDeUsuario(e.adminB, AHORA_PRUEBAS),
      cuerpo: { dni, nombres: 'Persona', apellidos: 'De Prueba', rol: 'SECRETARIA' },
    });

    expect(enB.status).toBe(201);
    const deA = await leerUsuarioPorDni(e.A.id, dni);
    const deB = await leerUsuarioPorDni(e.B.id, dni);
    expect(deA?.id).not.toBe(deB?.id);
    expect(deA?.academia_id).toBe(e.A.id);
    expect(deB?.academia_id).toBe(e.B.id);
  });

  it('criterio 3: dos creaciones simultáneas con el mismo DNI en A: exactamente una responde 201 y la otra 409, y queda una fila y un registro de auditoría', async () => {
    const dni = dniInventado();

    const respuestas = await Promise.all([crear(dni), crear(dni, 'ENTRENADOR')]);

    expect(respuestas.map((respuesta) => respuesta.status).sort()).toEqual([201, 409]);
    expect((respuestas.find((respuesta) => respuesta.status === 409)?.body as ErrorCuerpo).codigo).toBe('DNI_EN_USO');
    expect((await leerUsuarios(e.A.id)).filter((fila) => fila.dni === dni)).toHaveLength(1);
    expect(await contarAuditoria(e.A.id, 'USUARIO_CREADO')).toBe(1);
  });

  it('criterio 3: con cinco creaciones simultáneas del mismo DNI, exactamente una responde 201 y las demás 409', async () => {
    const dni = dniInventado();

    const respuestas = await Promise.all(Array.from({ length: 5 }, () => crear(dni)));

    const estados = respuestas.map((respuesta) => respuesta.status);
    expect(
      estados.filter((estado) => estado === 201),
      `estados: ${estados.join(',')}`,
    ).toHaveLength(1);
    expect(estados.filter((estado) => estado === 409)).toHaveLength(4);
    expect((await leerUsuarios(e.A.id)).filter((fila) => fila.dni === dni)).toHaveLength(1);
    expect(await contarAuditoria(e.A.id, 'USUARIO_CREADO')).toBe(1);
  });

  it('criterio 3: creaciones simultáneas del mismo DNI en A y en B: las dos responden 201 (cuentas distintas)', async () => {
    const dni = dniInventado();

    const respuestas = await Promise.all([
      crear(dni),
      crear(dni, 'SECRETARIA', cookieDeUsuario(e.adminB, AHORA_PRUEBAS)),
    ]);

    expect(respuestas.map((respuesta) => respuesta.status)).toEqual([201, 201]);
  });
});

describe('UsuariosService.crearEnTransaccion (contrato para la historia 007)', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let servicio: UsuariosServicePrueba;
  let claveHash: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    const { UsuariosService } = await cargarFuncionalidad002<{ UsuariosService: Type<UsuariosServicePrueba> }>(
      'modulos/usuarios/index.ts',
      ['UsuariosService'],
    );
    servicio = app.get(UsuariosService, { strict: false });
    claveHash = await hashDeClave('99887766');
  });
  beforeEach(async () => {
    e = await crearEscenario();
  });
  afterAll(async () => {
    await app?.close();
  });

  const datos = (dni: string, rol = 'ALUMNO') => ({ dni, nombres: 'Alumna', apellidos: 'Nueva', rol, claveHash });

  it('crea el usuario en la academia de la transacción, devuelve el resumen y audita USUARIO_CREADO con el actor indicado en la misma transacción', async () => {
    const base = await obtenerBaseDatos(app);

    const resumen = await base.conAcademia(e.A.id, (tx) =>
      servicio.crearEnTransaccion(tx, datos('77665544'), { tipo: 'SISTEMA', id: null }, '203.0.113.7'),
    );

    expect(resumen).toMatchObject({
      dni: '77665544',
      nombres: 'Alumna',
      apellidos: 'Nueva',
      rol: 'ALUMNO',
      estado: 'ACTIVO',
    });
    const fila = await leerUsuarioPorDni(e.A.id, '77665544');
    expect(fila).toMatchObject({ id: resumen.id, academia_id: e.A.id, clave_hash: claveHash, estado: 'ACTIVO' });
    const registros = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CREADO');
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      actor_tipo: 'SISTEMA',
      actor_id: null,
      entidad: 'usuario',
      entidad_id: resumen.id,
      ip: '203.0.113.7',
    });
    expect(registros[0]?.datos_despues).toEqual({
      id: resumen.id,
      dni: '77665544',
      nombres: 'Alumna',
      apellidos: 'Nueva',
      rol: 'ALUMNO',
      estado: 'ACTIVO',
    });
  });

  it('con un DNI en uso en esa academia rechaza con 409 DNI_EN_USO y no crea ni audita nada', async () => {
    const base = await obtenerBaseDatos(app);
    const antes = await instantaneaDeUsuarios(e.A.id);

    await expect(
      base.conAcademia(e.A.id, (tx) =>
        servicio.crearEnTransaccion(tx, datos(e.secretariaA.dni), { tipo: 'USUARIO', id: e.adminA.id }, null),
      ),
    ).rejects.toMatchObject({ estado: 409, codigo: 'DNI_EN_USO' });

    expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
    expect(await contarAuditoria(e.A.id)).toBe(0);
  });

  it('con el DNI de un usuario de otra academia crea el usuario (D-28)', async () => {
    const base = await obtenerBaseDatos(app);

    const resumen = await base.conAcademia(e.A.id, (tx) =>
      servicio.crearEnTransaccion(tx, datos(e.alumnoB.dni), { tipo: 'USUARIO', id: e.adminA.id }, null),
    );

    expect((await leerUsuarioPorDni(e.A.id, e.alumnoB.dni))?.id).toBe(resumen.id);
  });

  it('si la transacción que lo contiene falla después, no queda ni el usuario ni su auditoría (la auditoría va en la misma transacción)', async () => {
    const base = await obtenerBaseDatos(app);

    await expect(
      base.conAcademia(e.A.id, async (tx) => {
        await servicio.crearEnTransaccion(tx, datos('77665545'), { tipo: 'SISTEMA', id: null }, null);
        throw new Error('falla posterior provocada por la prueba');
      }),
    ).rejects.toThrow('falla posterior provocada por la prueba');

    expect(await leerUsuarioPorDni(e.A.id, '77665545')).toBeUndefined();
    expect(await contarAuditoria(e.A.id, 'USUARIO_CREADO')).toBe(0);
  });

  it('el usuario creado con claveHash entra con la clave de ese hash', async () => {
    const base = await obtenerBaseDatos(app);
    await base.conAcademia(e.A.id, (tx) =>
      servicio.crearEnTransaccion(tx, datos('77665546'), { tipo: 'SISTEMA', id: null }, null),
    );

    const ingreso = await pedir(app, 'post', '/api/a/academia-a/sesion', {
      cuerpo: { usuario: '77665546', clave: '99887766' },
    });

    expect(ingreso.status).toBe(200);
  });
});
