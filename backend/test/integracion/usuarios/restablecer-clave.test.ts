// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cuerpoDe,
  contarAuditoria,
  cookieDeAcademia,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  instantaneaDeUsuarios,
  leerUsuario,
  pedir,
  QUINCE_MINUTOS,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterios 34 a 36 (y 16): búsqueda por DNI y restablecimiento de la contraseña (HU-05) con el alcance provisional de la pregunta N4:
// la secretaria solo restablece a alumnos; el administrador, a cualquier usuario de su academia salvo a sí mismo.

interface UsuarioResumenCuerpo {
  id: string;
  dni: string;
  rol: string;
  estado: string;
  debeCambiarClave: boolean;
  bloqueado: boolean;
}

describe('restablecimiento de la contraseña', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let admin: string; // cookie del ADMIN de A
  let secretaria: string; // cookie de la SECRETARIA de A

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    secretaria = cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  const restablecer = (id: string, cookie: string | undefined) =>
    pedir(app, 'post', `/api/usuarios/${id}/restablecer-clave`, { cookie, cuerpo: {} });
  // Precisión del orquestador (13/11/2026), PO-3: el DNI va en el cuerpo, nunca en la dirección.
  const buscar = (dni: unknown, cookie: string | undefined) =>
    pedir(app, 'post', '/api/usuarios/buscar-por-dni', { cookie, cuerpo: { dni } });

  describe('criterio 34: POST /api/usuarios/buscar-por-dni con { dni }', () => {
    it('criterio 34: el administrador encuentra a cualquier usuario de su academia por DNI (200 con { usuario })', async () => {
      for (const objetivo of [e.secretariaA, e.entrenadorA, e.alumnoA]) {
        const respuesta = await buscar(objetivo.dni, admin);

        expect(respuesta.status, objetivo.rol).toBe(200);
        expect((cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo }).usuario).toMatchObject({
          id: objetivo.id,
          dni: objetivo.dni,
          rol: objetivo.rol,
        });
        expect(respuesta.headers['cache-control']).toBe('no-store');
      }
    });

    it('criterio 34: la secretaria encuentra a un alumno y el cuerpo es solo UsuarioResumen (sin hash ni contadores)', async () => {
      const respuesta = await buscar(e.alumnoA.dni, secretaria);

      expect(respuesta.status).toBe(200);
      const { usuario } = cuerpoDe(respuesta) as { usuario: Record<string, unknown> };
      expect(Object.keys(usuario).sort()).toEqual([
        'apellidos',
        'bloqueado',
        'debeCambiarClave',
        'dni',
        'estado',
        'id',
        'nombres',
        'rol',
        'ultimoAcceso',
      ]);
      expect(JSON.stringify(respuesta.body)).not.toMatch(/argon2|clave_?hash|claveHash|intentos|version/i);
    });

    it('criterio 34: la secretaria no ve a otro personal: ADMIN, SECRETARIA y ENTRENADOR responden 404 NO_ENCONTRADO', async () => {
      expect((await buscar(e.alumnoA.dni, secretaria)).status, 'control: sí encuentra a un alumno').toBe(200);
      const respuestas = [
        await buscar(e.adminA.dni, secretaria),
        await buscar(e.entrenadorA.dni, secretaria),
        await buscar(e.secretariaA.dni, secretaria),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(404);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
      }
    });

    it('criterio 34: un DNI inexistente, de otra academia o con formato inválido responde 404 NO_ENCONTRADO con el mismo cuerpo', async () => {
      expect((await buscar(e.alumnoA.dni, admin)).status, 'control: un DNI de A sí se encuentra').toBe(200);
      const respuestas = [
        await buscar('99999999', admin),
        await buscar(e.alumnoB.dni, admin),
        await buscar(e.adminB.dni, admin),
        await buscar('1234567', admin),
        await buscar('123456789', admin),
        await buscar('abcdefgh', admin),
        await buscar('1234-5678', admin),
        // Con un espacio inicial se recorta (criterio 34): 99999998 es un DNI con formato que no existe, y también responde 404.
        await buscar(' 99999998', admin),
        await buscar('x'.repeat(64), admin),
        await buscar('', admin),
        await buscar('   ', admin),
        await buscar(e.entrenadorA.dni, secretaria),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(404);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
        expect(respuesta.body).toEqual(respuestas[0]?.body);
      }
    });

    it('criterio 34: el DNI se recorta: con espacios en los extremos se encuentra igual (200)', async () => {
      const respuesta = await buscar(`  ${e.alumnoA.dni} \t`, secretaria);

      expect(respuesta.status).toBe(200);
      expect((cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo }).usuario.id).toBe(e.alumnoA.id);
    });

    it('criterio 34: es una consulta: no escribe ni audita nada', async () => {
      const antes = await instantaneaDeUsuarios(e.A.id);
      const antesB = await instantaneaDeUsuarios(e.B.id);

      await buscar(e.alumnoA.dni, secretaria);
      await buscar(e.entrenadorA.dni, admin);
      await buscar(e.alumnoB.dni, admin);

      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
      expect(await contarAuditoria(e.A.id)).toBe(0);
      expect(await contarAuditoria(e.B.id)).toBe(0);
    });

    it('criterio 34: un cuerpo inválido responde 400 SOLICITUD_INVALIDA: sin cuerpo, no JSON, campos de más, dni que no es texto o de más de 64 caracteres', async () => {
      expect((await buscar(e.alumnoA.dni, admin)).status, 'control: un cuerpo válido sí se atiende').toBe(200);
      const respuestas = [
        await pedir(app, 'post', '/api/usuarios/buscar-por-dni', { cookie: admin, cuerpo: {} }),
        await pedir(app, 'post', '/api/usuarios/buscar-por-dni', { cookie: admin })
          .set('Content-Type', 'application/json')
          .send('{"dni": '),
        await pedir(app, 'post', '/api/usuarios/buscar-por-dni', {
          cookie: admin,
          cuerpo: { dni: e.alumnoA.dni, rol: 'ADMIN' },
        }),
        await pedir(app, 'post', '/api/usuarios/buscar-por-dni', {
          cookie: admin,
          cuerpo: { dni: e.alumnoA.dni, academiaId: e.B.id },
        }),
        await buscar(Number(e.alumnoA.dni), admin),
        await buscar(null, admin),
        await buscar([e.alumnoA.dni], admin),
        await buscar({ dni: e.alumnoA.dni }, admin),
        await buscar('1'.repeat(65), admin),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        expect(respuesta.headers['cache-control']).toBe('no-store');
      }
    });

    it('criterio 34: el DNI no es una ruta: GET /api/usuarios/por-dni/{dni} no existe (404 NO_ENCONTRADO con sesión)', async () => {
      const respuesta = await pedir(app, 'get', `/api/usuarios/por-dni/${e.alumnoA.dni}`, { cookie: admin });

      expect(respuesta.status).toBe(404);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
    });

    it('criterio 34: un DNI que existe en A y en B devuelve el de la academia de quien pide', async () => {
      const dni = '20262026';
      const enA = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ALUMNO', dni, clave: CLAVE_COMUN });
      await crearUsuarioDePrueba({ academiaId: e.B.id, rol: 'ALUMNO', dni, clave: CLAVE_COMUN });

      const respuesta = await buscar(dni, secretaria);

      expect(respuesta.status).toBe(200);
      expect((cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo }).usuario.id).toBe(enA.id);
    });

    it('criterio 34: un usuario bloqueado se informa como bloqueado', async () => {
      await actualizarUsuario(e.A.id, e.alumnoA.id, { bloqueado_hasta: new Date(AHORA_PRUEBAS.getTime() + 60_000) });

      const respuesta = await buscar(e.alumnoA.dni, secretaria);

      expect((cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo }).usuario.bloqueado).toBe(true);
    });
  });

  describe('criterio 35: POST /api/usuarios/{id}/restablecer-clave', () => {
    let alumno: UsuarioDePrueba;

    beforeEach(async () => {
      alumno = await crearUsuarioDePrueba({
        academiaId: e.A.id,
        rol: 'ALUMNO',
        clave: 'Clave-Propia-Del-Alumno-1',
        debeCambiarClave: false,
      });
      await actualizarUsuario(e.A.id, alumno.id, {
        intentos_fallidos: 5,
        bloqueado_hasta: new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS),
        version_token: 3,
      });
    });

    it('criterio 35: la clave vuelve a ser el DNI (hash argon2id nuevo), debe cambiarla, el contador en 0, desbloquea y sube la versión de token', async () => {
      const antes = await leerUsuario(e.A.id, alumno.id);

      const respuesta = await restablecer(alumno.id, secretaria);

      expect(respuesta.status).toBe(200);
      const { usuario } = cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo };
      expect(usuario).toMatchObject({
        id: alumno.id,
        dni: alumno.dni,
        rol: 'ALUMNO',
        estado: 'ACTIVO',
        debeCambiarClave: true,
        bloqueado: false,
      });
      expect(respuesta.headers['cache-control']).toBe('no-store');
      const despues = await leerUsuario(e.A.id, alumno.id);
      expect(despues?.clave_hash.startsWith('$argon2id$')).toBe(true);
      expect(despues?.clave_hash).not.toBe(antes?.clave_hash);
      expect(despues?.debe_cambiar_clave).toBe(true);
      expect(despues?.intentos_fallidos).toBe(0);
      expect(despues?.bloqueado_hasta).toBeNull();
      expect(despues?.version_token).toBe(4);
      expect(JSON.stringify(respuesta.body)).not.toMatch(/argon2/);
    });

    it('criterio 35: después, el usuario entra con su DNI como contraseña (aunque estuviera bloqueado) y se le exige el cambio; la contraseña anterior ya no sirve', async () => {
      await restablecer(alumno.id, secretaria);

      const conLaAnterior = await pedir(app, 'post', '/api/a/academia-a/sesion', {
        cuerpo: { usuario: alumno.dni, clave: 'Clave-Propia-Del-Alumno-1' },
      });
      const conElDni = await pedir(app, 'post', '/api/a/academia-a/sesion', {
        cuerpo: { usuario: alumno.dni, clave: alumno.dni },
      });

      expect(conLaAnterior.status).toBe(401);
      expect(conElDni.status).toBe(200);
      expect((cuerpoDe(conElDni) as { usuario: { debeCambiarClave: boolean } }).usuario.debeCambiarClave).toBe(true);
      const sesion = (cookieDeAcademia(conElDni.headers) ?? '').split(';')[0] ?? '';
      const otraRuta = await pedir(app, 'get', '/api/usuarios', { cookie: sesion });
      expect(otraRuta.status).toBe(403);
      expect((otraRuta.body as ErrorCuerpo).codigo).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
    });

    it('criterio 35 y 16: la sesión que el usuario tenía abierta responde 401 en la siguiente petición', async () => {
      const abierta = cookieDeUsuario(alumno, AHORA_PRUEBAS, {}, 3);
      expect((await pedir(app, 'get', '/api/sesion', { cookie: abierta })).status).toBe(200);

      await restablecer(alumno.id, secretaria);

      const despues = await pedir(app, 'get', '/api/sesion', { cookie: abierta });
      expect(despues.status).toBe(401);
      expect((despues.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
    });

    it('criterio 35: no reactiva una cuenta inactiva: sigue INACTIVA y entrar con el DNI responde 403 USUARIO_INACTIVO', async () => {
      await actualizarUsuario(e.A.id, alumno.id, { estado: 'INACTIVO' });

      const respuesta = await restablecer(alumno.id, secretaria);

      expect(respuesta.status).toBe(200);
      expect((cuerpoDe(respuesta) as { usuario: UsuarioResumenCuerpo }).usuario.estado).toBe('INACTIVO');
      expect((await leerUsuario(e.A.id, alumno.id))?.estado).toBe('INACTIVO');
      const ingreso = await pedir(app, 'post', '/api/a/academia-a/sesion', {
        cuerpo: { usuario: alumno.dni, clave: alumno.dni },
      });
      expect(ingreso.status).toBe(403);
      expect((ingreso.body as ErrorCuerpo).codigo).toBe('USUARIO_INACTIVO');
    });

    it('criterio 35: restablecer dos veces seguidas (doble clic) responde 200 las dos veces, deja la clave igual al DNI y registra dos auditorías', async () => {
      const primera = await restablecer(alumno.id, secretaria);
      const segunda = await restablecer(alumno.id, secretaria);

      expect([primera.status, segunda.status]).toEqual([200, 200]);
      expect(await contarAuditoria(e.A.id, 'USUARIO_CLAVE_RESTABLECIDA')).toBe(2);
      const ingreso = await pedir(app, 'post', '/api/a/academia-a/sesion', {
        cuerpo: { usuario: alumno.dni, clave: alumno.dni },
      });
      expect(ingreso.status).toBe(200);
    });

    it('criterio 35: restablecer el DNI de un usuario no cambia a los demás usuarios de A ni de B', async () => {
      const antes = await leerUsuario(e.A.id, e.entrenadorA.id);
      const antesB = await instantaneaDeUsuarios(e.B.id);

      expect((await restablecer(alumno.id, secretaria)).status).toBe(200);

      expect(await leerUsuario(e.A.id, e.entrenadorA.id)).toEqual(antes);
      expect(await instantaneaDeUsuarios(e.B.id)).toBe(antesB);
    });
  });

  describe('criterio 36: alcance del restablecimiento', () => {
    it('criterio 36: la secretaria restablece a un alumno (200)', async () => {
      const respuesta = await restablecer(e.alumnoA.id, secretaria);

      expect(respuesta.status).toBe(200);
    });

    it.each([
      ['un ADMIN', () => e.adminA],
      ['un ENTRENADOR', () => e.entrenadorA],
      ['otra SECRETARIA', () => e.secretariaA],
    ])(
      'criterio 36: la secretaria sobre %s responde 404 NO_ENCONTRADO sin cambios ni auditoría',
      async (_caso, objetivo) => {
        const otraSecretaria = await crearUsuarioDePrueba({
          academiaId: e.A.id,
          rol: 'SECRETARIA',
          clave: CLAVE_COMUN,
        });
        const quien = objetivo() === e.secretariaA ? cookieDeUsuario(otraSecretaria, AHORA_PRUEBAS) : secretaria;
        // Control: la secretaria sí restablece a un alumno (así el 404 no es solo "la ruta no existe").
        expect((await restablecer(e.alumnoA.id, quien)).status).toBe(200);
        const antes = await instantaneaDeUsuarios(e.A.id);
        const auditoriaAntes = await contarAuditoria(e.A.id);

        const respuesta = await restablecer(objetivo().id, quien);

        expect(respuesta.status).toBe(404);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
        expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
        expect(await contarAuditoria(e.A.id)).toBe(auditoriaAntes);
      },
    );

    it('criterio 36: la secretaria sobre sí misma responde 404 (no es un alumno)', async () => {
      expect((await restablecer(e.alumnoA.id, secretaria)).status, 'control: sí restablece a un alumno').toBe(200);

      const respuesta = await restablecer(e.secretariaA.id, secretaria);

      expect(respuesta.status).toBe(404);
    });

    it.each([
      ['una SECRETARIA', () => e.secretariaA],
      ['un ENTRENADOR', () => e.entrenadorA],
      ['un ALUMNO', () => e.alumnoA],
    ])('criterio 36: el administrador restablece a %s de su academia (200)', async (_caso, objetivo) => {
      const respuesta = await restablecer(objetivo().id, admin);

      expect(respuesta.status).toBe(200);
      expect((await leerUsuario(e.A.id, objetivo().id))?.debe_cambiar_clave).toBe(true);
    });

    it('criterio 36: el administrador restablece a otro administrador de su academia (200)', async () => {
      const otroAdmin = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_COMUN });

      const respuesta = await restablecer(otroAdmin.id, admin);

      expect(respuesta.status).toBe(200);
    });

    it('criterio 36: el administrador sobre sí mismo responde 409 OPERACION_SOBRE_SI_MISMO sin cambios ni auditoría', async () => {
      expect((await restablecer(e.alumnoA.id, admin)).status, 'control: sí restablece a otro usuario').toBe(200);
      const antes = await instantaneaDeUsuarios(e.A.id);
      const auditoriaAntes = await contarAuditoria(e.A.id);

      const respuesta = await restablecer(e.adminA.id, admin);

      expect(respuesta.status).toBe(409);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('OPERACION_SOBRE_SI_MISMO');
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id)).toBe(auditoriaAntes);
    });

    it('criterio 36: el administrador de B no puede restablecer a un usuario de A (404), ni siquiera sabiendo su id', async () => {
      const cookieB = cookieDeUsuario(e.adminB, AHORA_PRUEBAS);
      expect((await restablecer(e.alumnoB.id, cookieB)).status, 'control: sí restablece a un usuario de B').toBe(200);
      const antes = await instantaneaDeUsuarios(e.A.id);

      const respuesta = await restablecer(e.alumnoA.id, cookieB);

      expect(respuesta.status).toBe(404);
      expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.A.id)).toBe(0);
      expect(await contarAuditoria(e.B.id)).toBe(1);
    });
  });
});
