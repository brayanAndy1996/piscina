// spec: 011-panel-alumno (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet, RUTA_MI_CARNET } from '../../utilidades/escenario-carnet';
import {
  codigoDe,
  instantaneaDeTodasLasTablas,
  pedirCrudo,
  prepararEscenarioDelPanel,
  RUTA_MI_ASISTENCIA,
  RUTAS_DEL_PANEL,
} from '../../utilidades/escenario-panel';
import { AHORA_007 } from '../../utilidades/escenario-pagos';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  cookieDeAcademia,
  cookieDeUsuario,
  fijarEstadoDeAcademia,
  iniciarSesionAcademia,
  leerUsuario,
  pedir,
} from '../../utilidades/usuarios';

// Criterio 3 (crítico, sección 2.1, D-14, D-29): `GET /api/mi-panel` lleva `@Permiso('VER_CARNET')` y `GET /api/mi-panel/asistencias`, `@Permiso('VER_REPORTES_ASISTENCIA')`; las dos exigen el alcance `PROPIO` antes de leer nada. `ADMIN` y `SECRETARIA` reciben 403 `SIN_PERMISO` (su alcance
// es `TODO`); `ENTRENADOR`, 403 `SIN_PERMISO` (en `VER_REPORTES_ASISTENCIA` pasa el guard con `SUS_CLASES` y lo rechaza el alcance). Sin sesión, o con solo la sesión del Superadmin, 401 `NO_AUTENTICADO`. Con el cambio de contraseña pendiente (primer ingreso o clave restablecida),
// 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`. Una sesión que dejó de valer porque recepción restableció la clave (sube `version_token`) responde 401. Con la academia suspendida, lo mismo que `GET /api/mi-carnet`. Orden: sesión → academia → cambio obligatorio → permiso → alcance → `mes` →
// alumno de la sesión.
// Lecturas estrictas elegidas: «lo mismo que /api/mi-carnet» es el mismo estado y el mismo cuerpo con la misma cookie; los rechazos no escriben ni auditan nada (instantánea de todas las tablas de A y de B); el rol se lee de la base en cada petición.

describe('permisos y orden de las respuestas de acceso de las dos rutas del panel (criterio 3)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelPanel(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';
  const cookieDe = (rol: Rol): string => (rol === 'alumno' ? alumno.cookie : esc.cookies[rol]);
  const pedirRuta = (ruta: string, cookie?: string) => pedirCrudo(ctx.app, 'GET', ruta, { cookie });
  const instantanea = () => instantaneaDeTodasLasTablas([esc.e.A, esc.e.B]);

  describe.each(RUTAS_DEL_PANEL)('$nombre', ({ ruta }) => {
    it('el alumno pasa el permiso y el alcance: 200', async () => {
      const respuesta = await pedirRuta(ruta, alumno.cookie);

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
    });

    it.each(['admin', 'secretaria', 'entrenador'] as const)(
      'el rol %s recibe 403 SIN_PERMISO (con y sin ids en la dirección y con un mes inválido), sin escribir ni auditar',
      async (rol) => {
        const antes = await instantanea();

        for (const camino of [
          ruta,
          `${ruta}${ruta.includes('?') ? '&' : '?'}id=${alumno.alumnoId}&alumnoId=${alumno.alumnoId}&usuarioId=${alumno.usuarioId}`,
          `${RUTA_MI_ASISTENCIA}?mes=no-es-un-mes`,
        ]) {
          const respuesta = await pedirRuta(camino, cookieDe(rol));

          expect([respuesta.status, codigoDe(respuesta)], `${rol} ${camino}: ${respuesta.texto.slice(0, 200)}`).toEqual(
            [403, 'SIN_PERMISO'],
          );
          expect(respuesta.texto, 'ni un dato del alumno en el rechazo').not.toContain(alumno.dni);
        }

        expect(await instantanea()).toEqual(antes);
      },
    );

    it('sin sesión, 401 NO_AUTENTICADO (también con un mes inválido); el Superadmin y una cookie rota también reciben 401', async () => {
      const respuestas = [
        await pedirRuta(ruta),
        await pedirRuta(`${RUTA_MI_ASISTENCIA}?mes=no-es-un-mes`),
        await pedirRuta(ruta, cookieDeSesion(esc.e.superadmin, AHORA_007)),
        await pedirRuta(ruta, 'aq_sesion=no-es-un-token'),
      ];

      for (const respuesta of respuestas) {
        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto.slice(0, 200)).toEqual([401, 'NO_AUTENTICADO']);
      }
    });

    it('con el cambio de contraseña pendiente (primer ingreso), 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso y el mes, para el alumno y para quien no tiene permiso', async () => {
      await actualizarUsuario(A(), alumno.usuarioId, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), esc.e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), esc.e.entrenadorA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), esc.e.adminA.id, { debe_cambiar_clave: true });

      for (const rol of ['alumno', 'secretaria', 'entrenador', 'admin'] as const) {
        for (const camino of [ruta, `${RUTA_MI_ASISTENCIA}?mes=no-es-un-mes`]) {
          const respuesta = await pedirRuta(camino, cookieDe(rol));

          expect([respuesta.status, codigoDe(respuesta)], `${rol} ${camino}`).toEqual([
            403,
            'CAMBIO_DE_CLAVE_OBLIGATORIO',
          ]);
        }
      }
    });

    it('con la academia suspendida responde lo mismo que GET /api/mi-carnet, antes que el cambio pendiente y el permiso', async () => {
      await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');
      await actualizarUsuario(A(), esc.e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), alumno.usuarioId, { debe_cambiar_clave: true });

      for (const rol of ['alumno', 'admin', 'secretaria', 'entrenador'] as const) {
        const delCarnet = await pedirRuta(RUTA_MI_CARNET, cookieDe(rol));
        const respuesta = await pedirRuta(ruta, cookieDe(rol));

        expect([delCarnet.status, codigoDe(delCarnet)], `control: ${rol}`).toEqual([403, 'ACADEMIA_SUSPENDIDA']);
        expect([respuesta.status, respuesta.texto], rol).toEqual([delCarnet.status, delCarnet.texto]);
      }
    });

    it('el rol se lee de la base en cada petición: el alumno que pasa a ENTRENADOR pierde el panel al instante y, al volver a ALUMNO, lo recupera', async () => {
      await actualizarUsuario(A(), alumno.usuarioId, { rol: 'ENTRENADOR' });
      const comoEntrenador = await pedirRuta(ruta, alumno.cookie);
      await actualizarUsuario(A(), alumno.usuarioId, { rol: 'ALUMNO' });
      const deNuevoAlumno = await pedirRuta(ruta, alumno.cookie);

      expect([comoEntrenador.status, codigoDe(comoEntrenador)]).toEqual([403, 'SIN_PERMISO']);
      expect(deNuevoAlumno.status, deNuevoAlumno.texto.slice(0, 200)).toBe(200);
    });
  });

  describe('el orden de las comprobaciones: sesión → academia → cambio obligatorio → permiso → alcance → mes → alumno de la sesión', () => {
    it('el alcance va antes que el mes: el personal con un mes inválido o posterior recibe 403 SIN_PERMISO y no 400', async () => {
      for (const rol of ['admin', 'secretaria', 'entrenador'] as const) {
        for (const mes of ['no-es-un-mes', '2026-13', '2030-01', '1999-12']) {
          const respuesta = await pedirRuta(`${RUTA_MI_ASISTENCIA}?mes=${mes}`, cookieDe(rol));

          expect([respuesta.status, codigoDe(respuesta)], `${rol} ${mes}`).toEqual([403, 'SIN_PERMISO']);
        }
      }
    });

    it('el cambio pendiente va antes que el alcance y el mes: la secretaria con el cambio pendiente recibe CAMBIO_DE_CLAVE_OBLIGATORIO y no SIN_PERMISO', async () => {
      await actualizarUsuario(A(), esc.e.secretariaA.id, { debe_cambiar_clave: true });

      const respuesta = await pedirRuta(`${RUTA_MI_ASISTENCIA}?mes=no-es-un-mes`, esc.cookies.secretaria);

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([403, 'CAMBIO_DE_CLAVE_OBLIGATORIO']);
    });

    it('la sesión va antes que todo: una cookie de un usuario que ya no existe recibe 401 aunque la academia esté suspendida', async () => {
      await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');

      const respuesta = await pedirRuta(RUTAS_DEL_PANEL[0].ruta, 'aq_sesion=no-es-un-token');

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([401, 'NO_AUTENTICADO']);
    });
  });

  describe('la clave restablecida por recepción', () => {
    it('la sesión anterior responde 401; con la clave restablecida se entra con el DNI, el panel exige el cambio (403) y, hecho el cambio, responde 200', async () => {
      const restablecer = await ctx.http.post(
        `/api/usuarios/${alumno.usuarioId}/restablecer-clave`,
        {},
        { cookie: esc.cookies.secretaria },
      );
      expect(restablecer.status, restablecer.texto.slice(0, 300)).toBeLessThan(300);
      const fila = await leerUsuario(A(), alumno.usuarioId);
      expect(fila?.debe_cambiar_clave, 'la clave restablecida exige el cambio').toBe(true);
      expect(fila?.version_token, 'restablecer sube la versión del token').toBeGreaterThan(0);

      for (const { nombre, ruta } of RUTAS_DEL_PANEL) {
        const antigua = await pedirRuta(ruta, alumno.cookie);
        expect([antigua.status, codigoDe(antigua)], `${nombre}: la sesión anterior`).toEqual([401, 'NO_AUTENTICADO']);
      }

      const nueva = await iniciarSesionAcademia(ctx.app, 'academia-a', { usuario: alumno.dni, clave: alumno.dni });
      for (const { nombre, ruta } of RUTAS_DEL_PANEL) {
        const pendiente = await pedirRuta(ruta, nueva);
        expect([pendiente.status, codigoDe(pendiente)], `${nombre}: con el cambio pendiente`).toEqual([
          403,
          'CAMBIO_DE_CLAVE_OBLIGATORIO',
        ]);
      }

      const cambio = await pedir(ctx.app, 'post', '/api/sesion/clave', {
        cookie: nueva,
        cuerpo: { claveActual: alumno.dni, claveNueva: 'Una-Clave-Nueva-2026' },
      });
      expect(cambio.status).toBe(200);
      const despues = (cookieDeAcademia(cambio.headers) ?? '').split(';')[0] ?? '';
      expect(despues, 'el cambio de clave deja la cookie nueva').not.toBe('');
      for (const { nombre, ruta } of RUTAS_DEL_PANEL) {
        const respuesta = await pedirRuta(ruta, despues);
        expect(respuesta.status, `${nombre}: ${respuesta.texto.slice(0, 200)}`).toBe(200);
      }
    });

    it('subir la versión del token en la base (otro dispositivo, otra clave) deja sin valor la sesión anterior: 401, y una sesión con la versión nueva vuelve a entrar', async () => {
      await actualizarUsuario(A(), alumno.usuarioId, { version_token: 3 });

      for (const { nombre, ruta } of RUTAS_DEL_PANEL) {
        const antigua = await pedirRuta(ruta, alumno.cookie);
        const vigente = await pedirRuta(
          ruta,
          cookieDeUsuario({ id: alumno.usuarioId, academiaId: A(), rol: 'ALUMNO' }, AHORA_007, {}, 3),
        );

        expect([antigua.status, codigoDe(antigua)], `${nombre}: la anterior`).toEqual([401, 'NO_AUTENTICADO']);
        expect(vigente.status, `${nombre}: la nueva: ${vigente.texto.slice(0, 200)}`).toBe(200);
      }
    });
  });
});
