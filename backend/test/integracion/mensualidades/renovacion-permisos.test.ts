// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AlumnoDeAsistencia, en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  abrirCajaPara,
  codigoDeRespuesta,
  cotizarRenovacion,
  crearAlumnoDeNoviembre,
  cuerpoCotizacionRenovacion,
  cuerpoEfectivoRenovacion,
  datosComprobanteRenovacion,
  INSTANTES,
  instantaneaDeRenovacion,
  pedirOferta,
  prepararEscenarioDeRenovacion,
  rutaCotizacionRenovacion,
  rutaOferta,
  rutaRenovacionComprobante,
  rutaRenovacionEfectivo,
  renovarConComprobante,
  renovarEnEfectivo,
  seleccionDeDiciembre,
} from '../../utilidades/escenario-renovacion';
import type { Objeto, RespuestaApi } from '../../utilidades/inscripciones';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 17 (crítico, sección 2.1, D-14, D-29): las rutas de la renovación son de `REGISTRAR_INSCRIPCION_Y_COBRO` (`ADMIN` y `SECRETARIA`, sección 2.1). `ENTRENADOR` y `ALUMNO` reciben 403 `SIN_PERMISO` (el alumno no renueva desde su cuenta: D-14 y DR-1); sin sesión o con
// solo la del Superadmin, 401; con el cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; con la academia suspendida, 403 `ACADEMIA_SUSPENDIDA`. Un cuerpo con campos de más (como `academiaId`, `montoAjustado` o `alumnoId`) responde 400 `SOLICITUD_INVALIDA`.
// `HEAD` sobre las rutas nuevas responde 404.
// Orden de las comprobaciones (002): sesión → academia activa → cambio de contraseña → permiso → cuerpo → operación. El 400 de un cuerpo con campos de más va antes que cualquier 404 o 409 de la operación pero después del permiso.
// Lecturas estrictas elegidas: (1) las cuatro rutas (la oferta, la cotización, el efectivo y el comprobante) llevan el mismo permiso, también las dos de lectura; (2) el rol se lee de la base en cada petición; (3) en el comprobante, los campos de más van en la cabecera
// `X-Renovacion-Datos` (estricta); (4) `HEAD` responde 404 `NO_ENCONTRADO` con la sesión de cualquier rol y sin sesión no se prueba aquí (lo decide el guardia global antes que la ruta).

type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';
type NombreDeRuta = 'oferta' | 'cotizacion' | 'efectivo' | 'comprobante';

interface Ruta {
  nombre: NombreDeRuta;
  /** El estado HTTP del éxito. */
  exito: number;
  /** La petición válida (o con los cambios dados) de un rol sobre un alumno. */
  enviar: (cookie: string | undefined, alumnoId: string, sobre?: Objeto) => Promise<RespuestaApi>;
  /** `false` si la ruta no lleva cuerpo que validar. */
  conCuerpo: boolean;
}

describe('permisos de las rutas de la renovación (criterio 17)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;
  let galletas: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    alumno = await crearAlumnoDeNoviembre(ctx, esc);
    await abrirCajaPara(esc, INSTANTES.viernes27);
    galletas = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const cookieDe = (rol: Rol): string => (rol === 'alumno' ? alumno.cookie : galletas[rol]);
  const sel = () => seleccionDeDiciembre(esc);

  const RUTAS: Ruta[] = [
    { nombre: 'oferta', exito: 200, conCuerpo: false, enviar: (cookie, id) => pedirOferta(ctx, cookie, id) },
    {
      nombre: 'cotizacion',
      exito: 200,
      conCuerpo: true,
      enviar: (cookie, id, sobre = {}) => cotizarRenovacion(ctx, cookie, id, cuerpoCotizacionRenovacion(sel(), sobre)),
    },
    {
      nombre: 'efectivo',
      exito: 201,
      conCuerpo: true,
      enviar: (cookie, id, sobre = {}) =>
        renovarEnEfectivo(ctx, cookie, id, cuerpoEfectivoRenovacion(sel(), '120.00', sobre)),
    },
    {
      nombre: 'comprobante',
      exito: 201,
      conCuerpo: true,
      enviar: (cookie, id, sobre = {}) =>
        renovarConComprobante(ctx, id, {
          cookie,
          datos: datosComprobanteRenovacion(sel(), '120.00', '2026-11-27', sobre),
        }),
    },
  ];

  describe.each(RUTAS)('ruta $nombre', (ruta) => {
    it.each(['admin', 'secretaria'] as const)('el rol %s pasa el permiso y recibe su éxito', async (rol) => {
      const respuesta = await ruta.enviar(cookieDe(rol), alumno.alumnoId);

      expect(respuesta.status, respuesta.texto.slice(0, 400)).toBe(ruta.exito);
    });

    it.each(['entrenador', 'alumno'] as const)(
      'el rol %s recibe 403 SIN_PERMISO sin escribir ni auditar, con una petición válida, con un cuerpo con campos de más y con un alumno que no existe',
      async (rol) => {
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const respuestas = [
          await ruta.enviar(cookieDe(rol), alumno.alumnoId),
          await ruta.enviar(cookieDe(rol), alumno.alumnoId, { campoDeMas: true }),
          await ruta.enviar(cookieDe(rol), randomUUID()),
          await ruta.enviar(cookieDe(rol), 'no-es-un-uuid'),
        ];

        for (const respuesta of respuestas) {
          expect(respuesta.status, `${rol}: ${respuesta.texto.slice(0, 200)}`).toBe(403);
          expect(codigoDeRespuesta(respuesta), rol).toBe('SIN_PERMISO');
        }
        expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      },
    );

    it('el alumno no renueva ni cotiza ni ve la oferta de sí mismo desde su cuenta (D-14, DR-1): 403 SIN_PERMISO sobre su propio id', async () => {
      const respuesta = await ruta.enviar(alumno.cookie, alumno.alumnoId);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        403,
        'SIN_PERMISO',
      ]);
    });

    it('sin sesión, 401 NO_AUTENTICADO, aun con un cuerpo con campos de más o un alumno que no existe; el Superadmin y una cookie rota también reciben 401', async () => {
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const respuestas = [
        await ruta.enviar(undefined, alumno.alumnoId),
        await ruta.enviar(undefined, alumno.alumnoId, { campoDeMas: true }),
        await ruta.enviar(undefined, randomUUID()),
        await ruta.enviar(cookieDeSesion(esc.e.superadmin, INSTANTES.viernes27), alumno.alumnoId),
        await ruta.enviar('aq_sesion=no-es-un-token', alumno.alumnoId),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(401);
        expect(codigoDeRespuesta(respuesta)).toBe('NO_AUTENTICADO');
      }
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    it('con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso, el cuerpo y el alumno', async () => {
      await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(esc.e.A.id, esc.e.entrenadorA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(esc.e.A.id, alumno.usuarioId, { debe_cambiar_clave: true });

      for (const rol of ['secretaria', 'entrenador', 'alumno'] as const) {
        for (const respuesta of [
          await ruta.enviar(cookieDe(rol), alumno.alumnoId),
          await ruta.enviar(cookieDe(rol), randomUUID(), { campoDeMas: true }),
        ]) {
          expect(respuesta.status, rol).toBe(403);
          expect(codigoDeRespuesta(respuesta), rol).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
        }
      }
    });

    it('con la academia suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso, para todos los roles', async () => {
      await fijarEstadoDeAcademia(esc.e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        const respuesta = await ruta.enviar(cookieDe(rol), alumno.alumnoId);
        expect(respuesta.status, rol).toBe(403);
        expect(codigoDeRespuesta(respuesta), rol).toBe('ACADEMIA_SUSPENDIDA');
      }
    });

    it('el rol se lee de la base en cada petición: la secretaria que pasa a ENTRENADOR pierde el permiso al instante', async () => {
      await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { rol: 'ENTRENADOR' });

      const respuesta = await ruta.enviar(galletas.secretaria, alumno.alumnoId);

      expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(403);
      expect(codigoDeRespuesta(respuesta)).toBe('SIN_PERMISO');
    });

    it('HEAD sobre la ruta responde 404 con la sesión de cualquier rol y no escribe', async () => {
      const direccion = {
        oferta: rutaOferta(alumno.alumnoId),
        cotizacion: rutaCotizacionRenovacion(alumno.alumnoId),
        efectivo: rutaRenovacionEfectivo(alumno.alumnoId),
        comprobante: rutaRenovacionComprobante(alumno.alumnoId),
      }[ruta.nombre];
      const antes = await instantaneaDeRenovacion(ctx, esc);

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        const respuesta = await ctx.http.enviar('HEAD', direccion, { cookie: cookieDe(rol) });
        expect(respuesta.status, rol).toBe(404);
      }

      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    if (ruta.conCuerpo) {
      const CAMPOS_DE_MAS: [string, Objeto][] = [
        ['un campo de más (campoDeMas)', { campoDeMas: true }],
        ['un academiaId de B', { academiaId: '00000000-0000-4000-8000-00000000000b' }],
        ['un montoAjustado', { montoAjustado: '10' }],
        ['un alumnoId', { alumnoId: '00000000-0000-4000-8000-00000000000a' }],
      ];

      it.each(CAMPOS_DE_MAS)(
        'un cuerpo con %s responde 400 SOLICITUD_INVALIDA sin escribir ni auditar',
        async (_nombre, sobre) => {
          const antes = await instantaneaDeRenovacion(ctx, esc);

          const respuesta = await ruta.enviar(galletas.secretaria, alumno.alumnoId, sobre);

          expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(400);
          expect(codigoDeRespuesta(respuesta)).toBe('SOLICITUD_INVALIDA');
          expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
        },
      );

      it('el 400 de un cuerpo con campos de más gana al 404 de un alumno que no existe, pero pierde ante el 403 del permiso', async () => {
        const conCampoDeMas = await ruta.enviar(galletas.secretaria, randomUUID(), { campoDeMas: true });
        const sinPermiso = await ruta.enviar(galletas.entrenador, randomUUID(), { campoDeMas: true });

        expect([conCampoDeMas.status, codigoDeRespuesta(conCampoDeMas)]).toEqual([400, 'SOLICITUD_INVALIDA']);
        expect([sinPermiso.status, codigoDeRespuesta(sinPermiso)]).toEqual([403, 'SIN_PERMISO']);
      });
    }
  });

  it('la oferta y la cotización no escriben ni auditan con la sesión de un rol que pasa el permiso (son lecturas)', async () => {
    const antes = await instantaneaDeRenovacion(ctx, esc);

    const oferta = await pedirOferta(ctx, galletas.secretaria, alumno.alumnoId);
    const cotizacion = await cotizarRenovacion(ctx, galletas.admin, alumno.alumnoId, cuerpoCotizacionRenovacion(sel()));

    expect(oferta.status, oferta.texto.slice(0, 200)).toBe(200);
    expect(cotizacion.status, cotizacion.texto.slice(0, 200)).toBe(200);
    expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
  });
});
