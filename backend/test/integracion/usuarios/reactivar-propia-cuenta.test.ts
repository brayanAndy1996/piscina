// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AHORA_PRUEBAS,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  instantaneaDeUsuarios,
  pedir,
} from '../../utilidades/usuarios';

// Criterio 55 (ataque ronda 2, R2-F1): un ADMIN que reactiva su propia cuenta recibe 409 OPERACION_SOBRE_SI_MISMO (no USUARIO_YA_ACTIVO),
// sin cambiar ninguna fila ni auditar nada. "Sobre sí mismo" se decide antes que "ya activo", igual que en desactivar (criterio 31).

describe('criterio 55: reactivar la propia cuenta', () => {
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

  const accion = (id: string, nombre: 'desactivar' | 'reactivar', galleta: string | undefined = cookie) =>
    pedir(app, 'post', `/api/usuarios/${id}/${nombre}`, { cookie: galleta, cuerpo: {} });

  it('criterio 55: un ADMIN que reactiva su propia cuenta responde 409 OPERACION_SOBRE_SI_MISMO y no USUARIO_YA_ACTIVO', async () => {
    const respuesta = await accion(e.adminA.id, 'reactivar');

    expect(respuesta.status).toBe(409);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('OPERACION_SOBRE_SI_MISMO');
  });

  it('criterio 55: no cambia ninguna fila (de A ni de B) ni registra auditoría', async () => {
    const antesA = await instantaneaDeUsuarios(e.A.id);
    const antesB = await instantaneaDeUsuarios(e.B.id);
    const auditoriaA = await contarAuditoria(e.A.id);
    const auditoriaB = await contarAuditoria(e.B.id);

    const respuesta = await accion(e.adminA.id, 'reactivar');

    expect(respuesta.status).toBe(409);
    expect(await instantaneaDeUsuarios(e.A.id)).toBe(antesA);
    expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
    expect(await contarAuditoria(e.A.id)).toBe(auditoriaA);
    expect(await contarAuditoria(e.A.id, 'USUARIO_REACTIVADO')).toBe(0);
    expect(await contarAuditoria(e.B.id)).toBe(auditoriaB);
  });

  it('criterio 55: repetirla (doble clic) responde lo mismo las dos veces, sin cambios ni auditoría', async () => {
    const antes = await instantaneaDeUsuarios(e.A.id);

    for (const intento of [1, 2]) {
      const respuesta = await accion(e.adminA.id, 'reactivar');
      expect(respuesta.status, `intento ${intento}`).toBe(409);
      expect((respuesta.body as ErrorCuerpo).codigo, `intento ${intento}`).toBe('OPERACION_SOBRE_SI_MISMO');
    }

    expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
    expect(await contarAuditoria(e.A.id, 'USUARIO_REACTIVADO')).toBe(0);
  });

  it('criterio 55: vale para cualquiera de los administradores de la academia (no solo el primero)', async () => {
    const otro = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN' });

    const respuesta = await accion(otro.id, 'reactivar', cookieDeUsuario(otro, AHORA_PRUEBAS));

    expect(respuesta.status).toBe(409);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('OPERACION_SOBRE_SI_MISMO');
  });

  it('criterio 55: sobre sí mismo desactivar y reactivar responden lo mismo (409 OPERACION_SOBRE_SI_MISMO)', async () => {
    const desactivar = await accion(e.adminA.id, 'desactivar');
    const reactivar = await accion(e.adminA.id, 'reactivar');

    expect(desactivar.status).toBe(409);
    expect(reactivar.status).toBe(409);
    expect((reactivar.body as ErrorCuerpo).codigo).toBe((desactivar.body as ErrorCuerpo).codigo);
  });

  it('criterio 55 (control): reactivar a otro miembro del personal inactivo sigue respondiendo 200 y a uno activo, 409 USUARIO_YA_ACTIVO', async () => {
    const inactivo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', estado: 'INACTIVO' });

    const reactivado = await accion(inactivo.id, 'reactivar');
    const yaActivo = await accion(e.secretariaA.id, 'reactivar');

    expect(reactivado.status).toBe(200);
    expect(yaActivo.status).toBe(409);
    expect((yaActivo.body as ErrorCuerpo).codigo).toBe('USUARIO_YA_ACTIVO');
  });
});
