// spec: 008-carnet-qr (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria } from '../../utilidades/datos';
import { AHORA_007 } from '../../utilidades/escenario-pagos';
import {
  type AlumnoConQr,
  type AppCarnet,
  codigoDeRespuesta,
  crearAlumnoPorPago,
  crearAppCarnet,
  cuerpoBuscar,
  cuerpoRegenerar,
  type EscenarioDelCarnet,
  instantaneaDelCarnet,
  prepararEscenarioDelCarnet,
  RUTA_BUSCAR,
  RUTA_MI_CARNET,
  RUTA_MI_CARNET_PDF,
  rutaCarnet,
  rutaCarnetPdf,
  rutaRegenerarQr,
} from '../../utilidades/escenario-carnet';
import type { Objeto } from '../../utilidades/inscripciones';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, fijarEstadoDeAcademia, rutasRegistradas } from '../../utilidades/usuarios';

// Criterio 4 (crítico, sección 2.1, D-29): `GET /api/alumnos/{id}/carnet`, con `@Permiso('VER_CARNET')` y alcance `TODO` (`ADMIN` y `SECRETARIA`), responde 200. `ALUMNO` recibe 403 `SIN_PERMISO`, también con su propio id (su carnet está en
// `/api/mi-carnet`); `ENTRENADOR`, 403 `SIN_PERMISO`; sin sesión, o con solo la sesión del Superadmin, 401 `NO_AUTENTICADO`; con el cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`. La lectura no escribe, no bloquea y no audita.
// Criterio 6 (crítico, sección 2.1, D-14): `GET /api/mi-carnet`, con `@Permiso('VER_CARNET')` y alcance `PROPIO` (`ALUMNO`), responde 200. `ADMIN` y `SECRETARIA` reciben 403 `SIN_PERMISO`; `ENTRENADOR`, 403; sin sesión, 401.
// Criterio 11 (crítico en permisos, errores y aislamiento): las dos rutas del PDF tienen los permisos y los errores de los criterios 4 y 6.
// Criterio 13 y 15 (crítico, D-14): `POST /api/alumnos/{id}/carnet/qr` con `@Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')` (`ADMIN` y `SECRETARIA`); `ALUMNO` (también sobre sí mismo) y `ENTRENADOR` reciben 403 `SIN_PERMISO`; sin sesión, 401.
// Criterio 16 (crítico): `POST /api/alumnos/buscar` con `@Permiso('VER_CARNET')` y alcance `TODO` (`ALUMNO`, 403).
// Orden de las comprobaciones (002, recordado por el criterio 4): sesión → academia activa → cambio de contraseña obligatorio → permiso → cuerpo → operación. Ninguna respuesta rechazada escribe ni audita.

type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';

interface RutaDelContrato {
  nombre: string;
  metodo: 'GET' | 'POST';
  /** Los roles con permiso (el resto recibe 403 `SIN_PERMISO`). */
  permitidos: readonly Rol[];
  /** La dirección y el cuerpo válidos (con el alumno de la prueba). */
  valida: (alumno: AlumnoConQr) => { ruta: string; cuerpo?: Objeto };
  /** Una dirección y un cuerpo inválidos (el id no es UUID y el cuerpo no cumple el esquema). */
  invalida: { ruta: string; cuerpo?: Objeto };
}

const RUTAS: RutaDelContrato[] = [
  {
    nombre: 'GET /api/alumnos/{id}/carnet',
    metodo: 'GET',
    permitidos: ['admin', 'secretaria'],
    valida: (a) => ({ ruta: rutaCarnet(a.alumnoId) }),
    invalida: { ruta: rutaCarnet('no-es-un-uuid') },
  },
  {
    nombre: 'GET /api/alumnos/{id}/carnet/pdf',
    metodo: 'GET',
    permitidos: ['admin', 'secretaria'],
    valida: (a) => ({ ruta: rutaCarnetPdf(a.alumnoId) }),
    invalida: { ruta: rutaCarnetPdf('no-es-un-uuid') },
  },
  {
    nombre: 'POST /api/alumnos/{id}/carnet/qr',
    metodo: 'POST',
    permitidos: ['admin', 'secretaria'],
    valida: (a) => ({ ruta: rutaRegenerarQr(a.alumnoId), cuerpo: cuerpoRegenerar() }),
    invalida: { ruta: rutaRegenerarQr('no-es-un-uuid'), cuerpo: { motivo: 'ab', campoDeMas: true } },
  },
  {
    nombre: 'POST /api/alumnos/buscar',
    metodo: 'POST',
    permitidos: ['admin', 'secretaria'],
    valida: () => ({ ruta: RUTA_BUSCAR, cuerpo: cuerpoBuscar('Mendoza') }),
    invalida: { ruta: RUTA_BUSCAR, cuerpo: { texto: 'ab', campoDeMas: true } },
  },
  {
    nombre: 'GET /api/mi-carnet',
    metodo: 'GET',
    permitidos: ['alumno'],
    valida: () => ({ ruta: RUTA_MI_CARNET }),
    invalida: { ruta: `${RUTA_MI_CARNET}?id=no-es-un-uuid&alumnoId=${randomUUID()}` },
  },
  {
    nombre: 'GET /api/mi-carnet/pdf',
    metodo: 'GET',
    permitidos: ['alumno'],
    valida: () => ({ ruta: RUTA_MI_CARNET_PDF }),
    invalida: { ruta: `${RUTA_MI_CARNET_PDF}?id=no-es-un-uuid&alumnoId=${randomUUID()}` },
  },
];

describe('permisos de las rutas del carnet (criterios 4, 6, 11, 13, 15 y 16)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let propio: AlumnoConQr;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
    propio = await crearAlumnoPorPago(ctx, esc);
    // Auditoría previa en A: «no audita nada» tiene que poder verse.
    await insertarAuditoria(esc.e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const cookieDe = (rol: Rol): string => (rol === 'alumno' ? propio.cookie : esc.cookies[rol]);
  const enviar = (def: RutaDelContrato, ruta: string, cuerpo: Objeto | undefined, cookie?: string) =>
    ctx.http.enviar(def.metodo, ruta, { cookie, cuerpo });

  describe.each(RUTAS)('$nombre', (def) => {
    it.each(def.permitidos)('el rol %s pasa el permiso y recibe 200 con Cache-Control: no-store', async (rol) => {
      const { ruta, cuerpo } = def.valida(propio);

      const respuesta = await enviar(def, ruta, cuerpo, cookieDe(rol));

      expect(respuesta.status, respuesta.texto.slice(0, 400)).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
    });

    const denegados = (['admin', 'secretaria', 'entrenador', 'alumno'] as const).filter(
      (r) => !def.permitidos.includes(r),
    );
    it.each(denegados)(
      'el rol %s recibe 403 SIN_PERMISO sin escribir ni auditar, con una dirección válida, con un id inválido y con uno inexistente',
      async (rol) => {
        const { ruta, cuerpo } = def.valida(propio);
        const antes = await instantaneaDelCarnet(esc.e);

        for (const [r, c] of [
          [ruta, cuerpo],
          [def.invalida.ruta, def.invalida.cuerpo],
          [ruta.replace(propio.alumnoId, randomUUID()), cuerpo],
        ] as const) {
          const respuesta = await enviar(def, r, c, cookieDe(rol));
          expect(respuesta.status, `${rol} ${r}: ${respuesta.texto.slice(0, 200)}`).toBe(403);
          expect(codigoDeRespuesta(respuesta), `${rol} ${r}`).toBe('SIN_PERMISO');
          expect(respuesta.cacheControl).toBe('no-store');
        }
        expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
      },
    );

    it('sin sesión, 401 NO_AUTENTICADO, aun con un id y un cuerpo inválidos; el Superadmin (aq_plataforma) y una cookie rota también reciben 401', async () => {
      const { ruta, cuerpo } = def.valida(propio);
      const antes = await instantaneaDelCarnet(esc.e);

      const respuestas = [
        await enviar(def, ruta, cuerpo),
        await enviar(def, def.invalida.ruta, def.invalida.cuerpo),
        await enviar(def, ruta, cuerpo, cookieDeSesion(esc.e.superadmin, AHORA_007)),
        await enviar(def, ruta, cuerpo, 'aq_sesion=no-es-un-token'),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(401);
        expect(codigoDeRespuesta(respuesta)).toBe('NO_AUTENTICADO');
      }
      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    });

    it('con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso y el cuerpo (para un rol con permiso y para uno sin él)', async () => {
      const { ruta, cuerpo } = def.valida(propio);
      await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(esc.e.A.id, esc.e.entrenadorA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(esc.e.A.id, propio.usuarioId, { debe_cambiar_clave: true });
      const antes = await instantaneaDelCarnet(esc.e);

      for (const rol of ['secretaria', 'entrenador', 'alumno'] as const) {
        for (const [r, c] of [
          [ruta, cuerpo],
          [def.invalida.ruta, def.invalida.cuerpo],
        ] as const) {
          const respuesta = await enviar(def, r, c, cookieDe(rol));
          expect(respuesta.status, rol).toBe(403);
          expect(codigoDeRespuesta(respuesta), rol).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
        }
      }
      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    });

    it('con A suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso', async () => {
      const { ruta, cuerpo } = def.valida(propio);
      await fijarEstadoDeAcademia(esc.e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });
      const antes = await instantaneaDelCarnet(esc.e);

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        const respuesta = await enviar(def, ruta, cuerpo, cookieDe(rol));
        expect(respuesta.status, rol).toBe(403);
        expect(codigoDeRespuesta(respuesta), rol).toBe('ACADEMIA_SUSPENDIDA');
      }
      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    });

    it('el rol se lee de la base en cada petición: el usuario con permiso que pasa a ENTRENADOR lo pierde al instante', async () => {
      const { ruta, cuerpo } = def.valida(propio);
      const rol = def.permitidos[0] as Rol;
      const usuarioId = rol === 'alumno' ? propio.usuarioId : rol === 'admin' ? esc.e.adminA.id : esc.e.secretariaA.id;
      await actualizarUsuario(esc.e.A.id, usuarioId, { rol: 'ENTRENADOR' });

      const respuesta = await enviar(def, ruta, cuerpo, cookieDe(rol));

      expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(403);
      expect(codigoDeRespuesta(respuesta)).toBe('SIN_PERMISO');
    });
  });

  it('criterio 4: el entrenador no ve ningún carnet, tampoco el de un alumno suyo (sección 2.1: el cliente y el entrenador no ven el carnet)', async () => {
    const respuestas = await Promise.all([
      ctx.http.get(rutaCarnet(propio.alumnoId), { cookie: esc.cookies.entrenador }),
      ctx.http.get(rutaCarnetPdf(propio.alumnoId), { cookie: esc.cookies.entrenador }),
      ctx.http.get(RUTA_MI_CARNET, { cookie: esc.cookies.entrenador }),
      ctx.http.get(RUTA_MI_CARNET_PDF, { cookie: esc.cookies.entrenador }),
      ctx.http.post(RUTA_BUSCAR, cuerpoBuscar('Mendoza'), { cookie: esc.cookies.entrenador }),
    ]);

    for (const respuesta of respuestas) {
      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        403,
        'SIN_PERMISO',
      ]);
      expect(respuesta.texto, 'ni un dato del alumno en el rechazo').not.toContain(propio.dni);
    }
  });

  it('criterio 4: el alumno con su propio id recibe 403 en las rutas del personal (su carnet es /api/mi-carnet), sin dar ningún dato', async () => {
    const respuestas = await Promise.all([
      ctx.http.get(rutaCarnet(propio.alumnoId), { cookie: propio.cookie }),
      ctx.http.get(rutaCarnetPdf(propio.alumnoId), { cookie: propio.cookie }),
      ctx.http.post(rutaRegenerarQr(propio.alumnoId), cuerpoRegenerar(), { cookie: propio.cookie }),
    ]);

    for (const respuesta of respuestas) {
      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        403,
        'SIN_PERMISO',
      ]);
      expect(respuesta.texto).not.toContain(propio.dni);
      expect(respuesta.texto).not.toContain('AQ1:');
    }
  });

  it('criterio 6: el personal con permisos de recepción recibe 403 en /api/mi-carnet (no tiene carnet propio) aunque envíe un id', async () => {
    const respuestas = await Promise.all([
      ctx.http.get(`${RUTA_MI_CARNET}?id=${propio.alumnoId}&alumnoId=${propio.alumnoId}`, {
        cookie: esc.cookies.secretaria,
      }),
      ctx.http.get(`${RUTA_MI_CARNET}?id=${propio.alumnoId}`, { cookie: esc.cookies.admin }),
      ctx.http.get(RUTA_MI_CARNET_PDF, { cookie: esc.cookies.secretaria }),
    ]);

    for (const respuesta of respuestas) {
      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        403,
        'SIN_PERMISO',
      ]);
    }
  });

  it('D-29: el Superadmin no tiene estas rutas: ninguna ruta de plataforma menciona alumnos, carnets ni QR', () => {
    const rutas = rutasRegistradas(ctx.app).map(([metodo, ruta]) => `${metodo} ${ruta}`);

    expect(rutas.filter((ruta) => /^[A-Z]+ \/api\/plataforma/.test(ruta) && /alumno|carnet|qr/i.test(ruta))).toEqual(
      [],
    );
  });

  it('criterio 4: las rutas del carnet no reciben la academia ni ningún token en la dirección: sin :academiaId, :token, :qr ni :contenido', () => {
    const rutas = rutasRegistradas(ctx.app)
      .map(([metodo, ruta]) => `${metodo} ${ruta}`)
      .filter((ruta) => /\/api\/(alumnos|mi-carnet)/.test(ruta));

    expect(rutas.length, 'las seis rutas de la 008a').toBeGreaterThanOrEqual(6);
    for (const ruta of rutas)
      expect(ruta, ruta).not.toMatch(/:(academia|academiaId|token|qr|contenido|nombreCorto)\b/i);
  });
});
