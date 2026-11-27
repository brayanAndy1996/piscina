// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AlumnoDeAsistencia,
  codigoDeRespuesta,
  en,
  type EscenarioDeAsistencia,
  prepararEscenarioDeAsistencia,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { exigirRutasDe010b, listadoDe, rutaListado } from '../../utilidades/escenario-cierre';
import { crearAlumnoDeNoviembre, INSTANTES, instantaneaDeRenovacion } from '../../utilidades/escenario-renovacion';
import type { RespuestaApi } from '../../utilidades/inscripciones';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 26 (crítico, sección 2.1, D-23, Ley 29733), la parte de los permisos: `GET /api/mensualidades` es de `REGISTRAR_INSCRIPCION_Y_COBRO` (DT-9: `ADMIN` y `SECRETARIA`). `ENTRENADOR` y `ALUMNO` reciben 403 `SIN_PERMISO`; sin sesión o con solo la del Superadmin, 401; con el
// cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; con la academia suspendida, 403 `ACADEMIA_SUSPENDIDA` (las demás respuestas de acceso del criterio 17). `HEAD` responde 404.
// Orden de las comprobaciones (002): sesión → academia activa → cambio de contraseña → permiso → parámetros → listado. El 400 de un parámetro con otra forma va después del permiso.
// Lecturas estrictas elegidas: (1) el rol se lee de la base en cada petición; (2) `HEAD` responde 404 `NO_ENCONTRADO` con la sesión de cualquier rol, con y sin parámetros, y no escribe; (3) un listado que responde 200 no escribe, no bloquea y no audita (criterio 25): la instantánea de las dos
// academias, la auditoría y los archivos no cambia; (4) el alumno no ve ni su propia mensualidad por esta ruta (D-14: el panel del alumno es otra historia, la 011).

type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';

describe('permisos del listado de mensualidades (criterio 26)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;
  let galletas: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    exigirRutasDe010b(ctx.app);
    alumno = await crearAlumnoDeNoviembre(ctx, esc);
    galletas = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const cookieDe = (rol: Rol): string => (rol === 'alumno' ? alumno.cookie : galletas[rol]);
  const pedir = (cookie: string | undefined, consulta: Record<string, string> = {}): Promise<RespuestaApi> =>
    ctx.http.get(rutaListado(consulta), { cookie });

  it.each(['admin', 'secretaria'] as const)(
    'el rol %s pasa el permiso y recibe el listado (200) con el alumno de noviembre',
    async (rol) => {
      const respuesta = await pedir(cookieDe(rol), { mes: '2026-11' });

      const listado = listadoDe(respuesta);
      expect(listado.alumnos.map((fila) => fila.alumnoId)).toEqual([alumno.alumnoId]);
    },
  );

  it.each(['entrenador', 'alumno'] as const)(
    'el rol %s recibe 403 SIN_PERMISO sin escribir, con y sin parámetros, también con un parámetro que no sirve (el permiso va antes que el 400)',
    async (rol) => {
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const respuestas = [
        await pedir(cookieDe(rol)),
        await pedir(cookieDe(rol), { mes: '2026-11' }),
        await pedir(cookieDe(rol), { mes: 'no-es-un-mes' }),
        await pedir(cookieDe(rol), { planId: 'no-es-un-uuid' }),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status, `${rol}: ${respuesta.texto.slice(0, 200)}`).toBe(403);
        expect(codigoDeRespuesta(respuesta), rol).toBe('SIN_PERMISO');
        expect(respuesta.texto, 'el 403 no revela alumnos').not.toContain(alumno.alumnoId);
      }
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    },
  );

  it('sin sesión, 401 NO_AUTENTICADO, aun con un parámetro que no sirve; el Superadmin y una cookie rota también reciben 401', async () => {
    const respuestas = [
      await pedir(undefined),
      await pedir(undefined, { mes: 'no-es-un-mes' }),
      await pedir(cookieDeSesion(esc.e.superadmin, INSTANTES.viernes27)),
      await pedir('aq_sesion=no-es-un-token'),
    ];

    for (const respuesta of respuestas) {
      expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(401);
      expect(codigoDeRespuesta(respuesta)).toBe('NO_AUTENTICADO');
    }
  });

  it('con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso y los parámetros', async () => {
    await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });
    await actualizarUsuario(esc.e.A.id, esc.e.entrenadorA.id, { debe_cambiar_clave: true });
    await actualizarUsuario(esc.e.A.id, alumno.usuarioId, { debe_cambiar_clave: true });

    for (const rol of ['secretaria', 'entrenador', 'alumno'] as const) {
      for (const respuesta of [await pedir(cookieDe(rol)), await pedir(cookieDe(rol), { mes: 'no-es-un-mes' })]) {
        expect(respuesta.status, rol).toBe(403);
        expect(codigoDeRespuesta(respuesta), rol).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
      }
    }
  });

  it('con la academia suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso, para todos los roles', async () => {
    await fijarEstadoDeAcademia(esc.e.A.id, 'SUSPENDIDA');
    await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });

    for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
      const respuesta = await pedir(cookieDe(rol));
      expect(respuesta.status, rol).toBe(403);
      expect(codigoDeRespuesta(respuesta), rol).toBe('ACADEMIA_SUSPENDIDA');
    }
  });

  it('el rol se lee de la base en cada petición: la secretaria que pasa a ENTRENADOR pierde el permiso al instante, y el entrenador que pasa a ADMIN lo gana', async () => {
    await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { rol: 'ENTRENADOR' });
    await actualizarUsuario(esc.e.A.id, esc.e.entrenadorA.id, { rol: 'ADMIN' });

    const perdio = await pedir(galletas.secretaria);
    const gano = await pedir(galletas.entrenador);

    expect([perdio.status, codigoDeRespuesta(perdio)]).toEqual([403, 'SIN_PERMISO']);
    expect(gano.status, gano.texto.slice(0, 200)).toBe(200);
  });

  it('HEAD sobre la ruta responde 404 con la sesión de cualquier rol, con y sin parámetros, y no escribe', async () => {
    const antes = await instantaneaDeRenovacion(ctx, esc);

    for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
      for (const direccion of [rutaListado(), rutaListado({ mes: '2026-11' })]) {
        const respuesta = await ctx.http.enviar('HEAD', direccion, { cookie: cookieDe(rol) });
        expect(respuesta.status, `${rol} ${direccion}`).toBe(404);
      }
    }

    expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
  });

  it('un listado que responde 200 no escribe ni audita: la instantánea de las dos academias, la auditoría y los archivos no cambia', async () => {
    const antes = await instantaneaDeRenovacion(ctx, esc);

    const respuestas = [
      await pedir(galletas.secretaria),
      await pedir(galletas.admin, { mes: '2026-11' }),
      await pedir(galletas.secretaria, { mes: '2026-10', estado: 'VENCIDO' }),
    ];

    for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(200);
    expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
  });
});
