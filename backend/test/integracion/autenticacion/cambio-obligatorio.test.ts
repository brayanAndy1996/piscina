// spec: 002-autenticacion-roles (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
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
  leerUsuarios,
  pedir,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 21: con `debe_cambiar_clave = true`, toda ruta de academia salvo `GET /api/sesion`, `DELETE /api/sesion` y
// `POST /api/sesion/clave` responde 403 CAMBIO_DE_CLAVE_OBLIGATORIO sin ejecutar nada (RN-02, RNF-04).

describe('criterio 21: cambio de contraseña obligatorio', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let pendiente: UsuarioDePrueba; // ADMIN de A que debe cambiar la contraseña
  let cookie: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
    pendiente = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', debeCambiarClave: true });
    cookie = cookieDeUsuario(pendiente, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('criterio 21: GET /api/sesion, DELETE /api/sesion y POST /api/sesion/clave siguen permitidos', async () => {
    const sesion = await pedir(app, 'get', '/api/sesion', { cookie });
    const clave = await pedir(app, 'post', '/api/sesion/clave', {
      cookie,
      cuerpo: { claveActual: pendiente.dni, claveNueva: 'Una-Clave-Nueva-2026' },
    });
    const cierre = await pedir(app, 'delete', '/api/sesion', {
      cookie: cookieDeUsuario(pendiente, AHORA_PRUEBAS, {}, 1),
    });

    expect(sesion.status).toBe(200);
    expect((cuerpoDe(sesion) as { usuario: { debeCambiarClave: boolean } }).usuario.debeCambiarClave).toBe(true);
    expect(clave.status).toBe(200);
    expect(cierre.status).toBe(204);
  });

  it('criterio 21: POST /api/sesion/clave con un cuerpo inválido pasa el filtro del cambio obligatorio (responde 400, no 403)', async () => {
    const respuesta = await pedir(app, 'post', '/api/sesion/clave', { cookie, cuerpo: { claveActual: pendiente.dni } });

    expect(respuesta.status).toBe(400);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
  });

  it('criterio 21: cualquier otra ruta de academia responde 403 CAMBIO_DE_CLAVE_OBLIGATORIO sin ejecutar nada ni auditar', async () => {
    const antes = await instantaneaDeUsuarios(e.A.id);
    const antesB = await instantaneaDeUsuarios(e.B.id);

    const respuestas = [
      await pedir(app, 'get', '/api/usuarios', { cookie }),
      await pedir(app, 'post', '/api/usuarios', {
        cookie,
        cuerpo: { dni: '55550005', nombres: 'Nuevo', apellidos: 'Usuario', rol: 'SECRETARIA' },
      }),
      await pedir(app, 'post', `/api/usuarios/${e.secretariaA.id}/desactivar`, { cookie, cuerpo: {} }),
      await pedir(app, 'post', `/api/usuarios/${e.secretariaA.id}/reactivar`, { cookie, cuerpo: {} }),
      await pedir(app, 'post', `/api/usuarios/${e.alumnoA.id}/restablecer-clave`, { cookie, cuerpo: {} }),
      await pedir(app, 'get', `/api/usuarios/por-dni/${e.alumnoA.dni}`, { cookie }),
      await pedir(app, 'post', `/api/usuarios/${randomUUID()}/desactivar`, { cookie, cuerpo: {} }),
    ];

    for (const respuesta of respuestas) {
      expect(respuesta.status).toBe(403);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    }
    expect((await leerUsuarios(e.A.id)).map((fila) => fila.dni)).not.toContain('55550005');
    expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
    expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
    expect(await contarAuditoria(e.A.id)).toBe(0);
  });

  it('criterio 21: el cambio obligatorio se comprueba antes que el permiso: un ALUMNO con el cambio pendiente recibe CAMBIO_DE_CLAVE_OBLIGATORIO y no SIN_PERMISO', async () => {
    const alumno = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ALUMNO', debeCambiarClave: true });

    const respuesta = await pedir(app, 'get', '/api/usuarios', { cookie: cookieDeUsuario(alumno, AHORA_PRUEBAS) });

    expect(respuesta.status).toBe(403);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
  });

  it('criterio 21: la sesión se comprueba antes que el cambio obligatorio (sin sesión, 401) y la academia suspendida antes que el cambio (403 ACADEMIA_SUSPENDIDA)', async () => {
    const sinSesion = await pedir(app, 'get', '/api/usuarios');
    await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
    const suspendida = await pedir(app, 'get', '/api/usuarios', { cookie });

    expect(sinSesion.status).toBe(401);
    expect(suspendida.status).toBe(403);
    expect((suspendida.body as ErrorCuerpo).codigo).toBe('ACADEMIA_SUSPENDIDA');
  });

  it('criterio 21: un usuario recién creado (clave = DNI) que entra por el formulario queda obligado a cambiarla antes de usar cualquier ruta', async () => {
    const ingreso = await pedir(app, 'post', '/api/a/academia-a/sesion', {
      cuerpo: { usuario: pendiente.dni, clave: pendiente.dni },
    });
    const sesion = (cookieDeAcademia(ingreso.headers) ?? '').split(';')[0] ?? '';

    const listado = await pedir(app, 'get', '/api/usuarios', { cookie: sesion });

    expect(ingreso.status).toBe(200);
    expect((cuerpoDe(ingreso) as { usuario: { debeCambiarClave: boolean } }).usuario.debeCambiarClave).toBe(true);
    expect(listado.status).toBe(403);
    expect((listado.body as ErrorCuerpo).codigo).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
  });

  it('criterio 21: una cuenta sin cambio pendiente no se ve afectada', async () => {
    const respuesta = await pedir(app, 'get', '/api/usuarios', { cookie: cookieDeUsuario(e.adminA, AHORA_PRUEBAS) });

    expect(respuesta.status).toBe(200);
  });
});
