// spec: 002-autenticacion-roles (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type CambioDelActor, type ClienteHttp, conFilaRetenida, escucharAplicacion } from '../../utilidades/carreras';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  dniInventado,
  type Escenario,
  actualizarUsuario,
  leerUsuario,
  leerUsuarioPorDni,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 56 (ataque ronda 2, R2-F1): el actor sigue vigente dentro de la transacción que escribe. Carreras deterministas: la prueba abre
// su propia transacción sobre la fila del administrador X, la deja sin confirmar, envía la petición de X (que pasa el middleware porque
// su lectura no ve lo no confirmado), detecta con `pg_blocking_pids` que la conexión de la API quedó esperando (o que llegó la
// respuesta) y entonces confirma o revierte. Sin tiempos ni esperas fijas; el límite de seguridad solo evita colgarse.

const CLAVE_DE_X = CLAVE_COMUN;

describe('criterio 56: el actor sigue vigente dentro de la transacción que escribe', () => {
  let http: ClienteHttp;
  let e: Escenario;
  let x: UsuarioDePrueba; // ADMIN de A que hace las peticiones
  let cookieX: string;

  beforeAll(async () => {
    const { app } = await crearAppConReloj();
    http = await escucharAplicacion(app);
  });
  beforeEach(async () => {
    e = await crearEscenario();
    x = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_DE_X });
    cookieX = cookieDeUsuario(x, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  const personalNuevo = () => ({ dni: dniInventado(), nombres: 'Respaldo', apellidos: 'De X', rol: 'ADMIN' });

  /** Lanza la carrera: la prueba retiene la fila de X con `cambio` y libera con `liberar` cuando la API espera o responde. */
  const carrera = (
    cambio: CambioDelActor,
    liberar: 'COMMIT' | 'ROLLBACK',
    ruta: string,
    cuerpo: unknown,
    cookie: string = cookieX,
  ) =>
    conFilaRetenida({
      academiaId: e.A.id,
      actorId: x.id,
      cambio,
      liberar,
      enviar: () => http.post(ruta, cookie, cuerpo),
    });

  const accionesDe = async (actorId: string) =>
    (await leerAuditoriaDeAcademia(e.A.id)).filter((fila) => fila.actor_id === actorId);

  /** X quedó como la prueba lo dejó: `INACTIVO` con una versión más (como una desactivación). */
  async function esperarXDesactivadoPorLaPrueba(versionAntes: number) {
    const fila = await leerUsuario(e.A.id, x.id);
    expect(fila?.estado).toBe('INACTIVO');
    expect(fila?.version_token).toBe(versionAntes + 1);
  }

  describe('(i) reactivación propia', () => {
    it('criterio 56 (i): X envía POST /api/usuarios/{X}/reactivar mientras la prueba lo desactiva: responde 401 o 409 OPERACION_SOBRE_SI_MISMO y X queda INACTIVO sin USUARIO_REACTIVADO', async () => {
      const antes = await leerUsuario(e.A.id, x.id);

      const { resultado } = await carrera('desactivar', 'COMMIT', `/api/usuarios/${x.id}/reactivar`, {});

      expect([401, 409], `respondió ${resultado.status}: ${JSON.stringify(resultado.body)}`).toContain(
        resultado.status,
      );
      expect(resultado.body?.codigo).toBe(resultado.status === 401 ? 'NO_AUTENTICADO' : 'OPERACION_SOBRE_SI_MISMO');
      await esperarXDesactivadoPorLaPrueba(antes?.version_token ?? 0);
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_REACTIVADO');
      expect(auditoria.filter((fila) => fila.entidad_id === x.id || fila.actor_id === x.id)).toHaveLength(0);
    });
  });

  describe('(ii) crear tras la desactivación', () => {
    it('criterio 56 (ii): X envía POST /api/usuarios con un ADMIN nuevo mientras la prueba lo desactiva: la petición espera el bloqueo, responde 401 y no se crea nada', async () => {
      const antes = await leerUsuario(e.A.id, x.id);
      const cuerpo = personalNuevo();

      const { resultado, esperoElBloqueo } = await carrera('desactivar', 'COMMIT', '/api/usuarios', cuerpo);

      expect.soft(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
      expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(401);
      expect.soft(resultado.body?.codigo).toBe('NO_AUTENTICADO');
      await esperarXDesactivadoPorLaPrueba(antes?.version_token ?? 0);
      expect(await leerUsuarioPorDni(e.A.id, cuerpo.dni), 'el DNI enviado no debe existir en A').toBeUndefined();
      expect(await leerUsuarioPorDni(e.B.id, cuerpo.dni), 'el DNI enviado no debe existir en B').toBeUndefined();
      expect(await contarAuditoria(e.A.id, 'USUARIO_CREADO')).toBe(0);
      expect(await accionesDe(x.id)).toHaveLength(0);
    });
  });

  describe('(iii) desactivar, reactivar y restablecer a otro miembro del personal', () => {
    const casos: {
      nombre: string;
      accion: 'desactivar' | 'reactivar' | 'restablecer-clave';
      crear: (e: Escenario) => Promise<UsuarioDePrueba>;
    }[] = [
      {
        nombre: 'desactivar a un Z activo',
        accion: 'desactivar',
        crear: (esc) => crearUsuarioDePrueba({ academiaId: esc.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN }),
      },
      {
        nombre: 'reactivar a un Z inactivo',
        accion: 'reactivar',
        crear: (esc) =>
          crearUsuarioDePrueba({ academiaId: esc.A.id, rol: 'ENTRENADOR', clave: CLAVE_COMUN, estado: 'INACTIVO' }),
      },
      {
        nombre: 'restablecer la clave de Z (con 2 intentos fallidos)',
        accion: 'restablecer-clave',
        crear: async (esc) => {
          const z = await crearUsuarioDePrueba({ academiaId: esc.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
          await actualizarUsuario(esc.A.id, z.id, { intentos_fallidos: 2 });
          return z;
        },
      },
    ];

    it.each(casos)(
      'criterio 56 (iii): X intenta $nombre mientras la prueba lo desactiva: espera el bloqueo, responde 401 y Z queda como estaba, sin auditoría de X',
      async ({ accion, crear }) => {
        const z = await crear(e);
        const zAntes = await leerUsuario(e.A.id, z.id);
        const auditoriaAntes = await contarAuditoria(e.A.id);
        const versionDeX = (await leerUsuario(e.A.id, x.id))?.version_token ?? 0;

        const { resultado, esperoElBloqueo } = await carrera(
          'desactivar',
          'COMMIT',
          `/api/usuarios/${z.id}/${accion}`,
          {},
        );

        expect.soft(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
        expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(401);
        expect.soft(resultado.body?.codigo).toBe('NO_AUTENTICADO');
        expect(
          await leerUsuario(e.A.id, z.id),
          'Z debe quedar como estaba (estado, clave_hash, versión, contador)',
        ).toEqual(zAntes);
        await esperarXDesactivadoPorLaPrueba(versionDeX);
        expect(await accionesDe(x.id)).toHaveLength(0);
        expect(await contarAuditoria(e.A.id)).toBe(auditoriaAntes);
      },
    );

    const prioridad: {
      nombre: string;
      accion: 'desactivar' | 'reactivar' | 'restablecer-clave';
      objetivo: (esc: Escenario) => Promise<string> | string;
    }[] = [
      {
        nombre: 'desactivar a uno que ya está inactivo (409 USUARIO_YA_INACTIVO)',
        accion: 'desactivar',
        objetivo: async (esc) =>
          (await crearUsuarioDePrueba({ academiaId: esc.A.id, rol: 'ENTRENADOR', estado: 'INACTIVO' })).id,
      },
      {
        nombre: 'reactivar a uno que ya está activo (409 USUARIO_YA_ACTIVO)',
        accion: 'reactivar',
        objetivo: (esc) => esc.secretariaA.id,
      },
      {
        nombre: 'desactivar a un alumno (404 NO_ENCONTRADO)',
        accion: 'desactivar',
        objetivo: (esc) => esc.alumnoA.id,
      },
      {
        nombre: 'restablecer a un id que no existe (404 NO_ENCONTRADO)',
        accion: 'restablecer-clave',
        objetivo: () => randomUUID(),
      },
      {
        nombre: 'desactivar a un usuario de otra academia (404 NO_ENCONTRADO)',
        accion: 'desactivar',
        objetivo: (esc) => esc.secretariaB.id,
      },
    ];

    it.each(prioridad)(
      'criterio 56 (iii): el 401 tiene prioridad sobre el 404 y el 409 del objetivo: X intenta $nombre y responde 401',
      async ({ accion, objetivo }) => {
        const idObjetivo = await objetivo(e);
        const auditoriaAntes = await contarAuditoria(e.A.id);

        const { resultado, esperoElBloqueo } = await carrera(
          'desactivar',
          'COMMIT',
          `/api/usuarios/${idObjetivo}/${accion}`,
          {},
        );

        expect.soft(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
        expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(401);
        expect.soft(resultado.body?.codigo).toBe('NO_AUTENTICADO');
        expect(await contarAuditoria(e.A.id)).toBe(auditoriaAntes);
      },
    );
  });

  describe('(iv) cambio de la propia clave', () => {
    const NUEVA = 'Una-Clave-Nueva-2026';

    it('criterio 56 (iv): POST /api/sesion/clave de X mientras la prueba lo desactiva: responde 401 y la clave de X no cambia', async () => {
      const antes = await leerUsuario(e.A.id, x.id);

      const { resultado, esperoElBloqueo } = await carrera('desactivar', 'COMMIT', '/api/sesion/clave', {
        claveActual: CLAVE_DE_X,
        claveNueva: NUEVA,
      });

      expect.soft(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
      expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(401);
      expect.soft(resultado.body?.codigo).toBe('NO_AUTENTICADO');
      const despues = await leerUsuario(e.A.id, x.id);
      expect(despues?.clave_hash).toBe(antes?.clave_hash);
      expect(despues?.estado).toBe('INACTIVO');
      expect(despues?.version_token).toBe((antes?.version_token ?? 0) + 1);
      expect(await contarAuditoria(e.A.id, 'USUARIO_CLAVE_CAMBIADA')).toBe(0);
    });

    it('criterio 56 (iv): si la sesión se cerró en otro dispositivo (solo version_token + 1), el cambio de clave responde 401 y no cambia nada', async () => {
      const antes = await leerUsuario(e.A.id, x.id);

      const { resultado } = await carrera('solo-version', 'COMMIT', '/api/sesion/clave', {
        claveActual: CLAVE_DE_X,
        claveNueva: NUEVA,
      });

      expect(resultado.status, JSON.stringify(resultado.body)).toBe(401);
      expect(resultado.body?.codigo).toBe('NO_AUTENTICADO');
      const despues = await leerUsuario(e.A.id, x.id);
      expect(despues?.clave_hash).toBe(antes?.clave_hash);
      expect(await contarAuditoria(e.A.id, 'USUARIO_CLAVE_CAMBIADA')).toBe(0);
    });

    it('criterio 56 (a): en POST /api/sesion/clave no se exige debe_cambiar_clave = false: con el cambio obligatorio pendiente y la fila bloqueada sin cambiarla, responde 200', async () => {
      const nuevo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA', debeCambiarClave: true });
      const antes = await leerUsuario(e.A.id, nuevo.id);

      const { resultado } = await conFilaRetenida({
        academiaId: e.A.id,
        actorId: nuevo.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'ROLLBACK',
        enviar: () =>
          http.post('/api/sesion/clave', cookieDeUsuario(nuevo, AHORA_PRUEBAS), {
            claveActual: nuevo.dni,
            claveNueva: NUEVA,
          }),
      });

      expect(resultado.status, JSON.stringify(resultado.body)).toBe(200);
      const despues = await leerUsuario(e.A.id, nuevo.id);
      expect(despues?.debe_cambiar_clave).toBe(false);
      expect(despues?.clave_hash).not.toBe(antes?.clave_hash);
    });
  });

  describe('(v) otros cambios de la fila del actor', () => {
    it('criterio 56 (v): solo version_token + 1 (cierre de sesión en otro dispositivo): POST /api/usuarios espera el bloqueo, responde 401 y no crea nada', async () => {
      const cuerpo = personalNuevo();
      const antes = await leerUsuario(e.A.id, x.id);

      const { resultado, esperoElBloqueo } = await carrera('solo-version', 'COMMIT', '/api/usuarios', cuerpo);

      expect.soft(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
      expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(401);
      expect.soft(resultado.body?.codigo).toBe('NO_AUTENTICADO');
      const despues = await leerUsuario(e.A.id, x.id);
      expect(despues?.estado).toBe('ACTIVO');
      expect(despues?.version_token).toBe((antes?.version_token ?? 0) + 1);
      expect(await leerUsuarioPorDni(e.A.id, cuerpo.dni)).toBeUndefined();
      expect(await contarAuditoria(e.A.id, 'USUARIO_CREADO')).toBe(0);
    });

    it('criterio 56 (v): solo debe_cambiar_clave = true: POST /api/usuarios espera el bloqueo, responde 401 y no crea nada', async () => {
      const cuerpo = personalNuevo();

      const { resultado, esperoElBloqueo } = await carrera('solo-cambio-pendiente', 'COMMIT', '/api/usuarios', cuerpo);

      expect.soft(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
      expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(401);
      expect.soft(resultado.body?.codigo).toBe('NO_AUTENTICADO');
      const despues = await leerUsuario(e.A.id, x.id);
      expect(despues?.debe_cambiar_clave).toBe(true);
      expect(await leerUsuarioPorDni(e.A.id, cuerpo.dni)).toBeUndefined();
      expect(await contarAuditoria(e.A.id, 'USUARIO_CREADO')).toBe(0);
    });

    it('criterio 56 (v): solo version_token + 1 también detiene a desactivar, reactivar y restablecer a otro', async () => {
      const z = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
      const inactivo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', estado: 'INACTIVO' });
      const objetivos: [string, string][] = [
        [z.id, 'desactivar'],
        [inactivo.id, 'reactivar'],
        [z.id, 'restablecer-clave'],
      ];
      const zAntes = await leerUsuario(e.A.id, z.id);
      const inactivoAntes = await leerUsuario(e.A.id, inactivo.id);

      for (const [id, accion] of objetivos) {
        // Cada ronda deja a X con una versión más: se vuelve a firmar la cookie con la versión confirmada.
        const version = (await leerUsuario(e.A.id, x.id))?.version_token ?? 0;
        const cookie = cookieDeUsuario(x, AHORA_PRUEBAS, {}, version);
        const { resultado, esperoElBloqueo } = await carrera(
          'solo-version',
          'COMMIT',
          `/api/usuarios/${id}/${accion}`,
          {},
          cookie,
        );
        expect.soft(esperoElBloqueo, `${accion}: debía quedar esperando el bloqueo`).toBe(true);
        expect.soft(resultado.status, `${accion}: ${JSON.stringify(resultado.body)}`).toBe(401);
        expect.soft(resultado.body?.codigo, accion).toBe('NO_AUTENTICADO');
      }

      expect(await leerUsuario(e.A.id, z.id)).toEqual(zAntes);
      expect(await leerUsuario(e.A.id, inactivo.id)).toEqual(inactivoAntes);
      expect(await accionesDe(x.id)).toHaveLength(0);
    });
  });

  describe('(vi) control: la prueba bloquea la fila sin cambiarla', () => {
    it('criterio 56 (vi): SELECT … FOR UPDATE sin cambiar y ROLLBACK: POST /api/usuarios queda esperando el bloqueo y, al liberarlo, responde 201', async () => {
      const cuerpo = personalNuevo();

      const { resultado, esperoElBloqueo } = await carrera('bloquear-sin-cambiar', 'ROLLBACK', '/api/usuarios', cuerpo);

      expect.soft(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
      expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(201);
      const creado = await leerUsuarioPorDni(e.A.id, cuerpo.dni);
      expect(creado?.rol).toBe('ADMIN');
      expect(creado?.estado).toBe('ACTIVO');
      const creaciones = (await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CREADO')).filter(
        (fila) => fila.actor_id === x.id,
      );
      expect(creaciones).toHaveLength(1);
      const sinCambio = await leerUsuario(e.A.id, x.id);
      expect(sinCambio?.estado).toBe('ACTIVO');
      expect(sinCambio?.version_token).toBe(0);
    });
  });
});
