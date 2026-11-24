// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoAjuste,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  instantaneaDeLaAcademia,
  rutaAjuste,
  rutaCobro,
  rutaTicket,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  codigoDe,
  crearAppInscripciones,
  type Objeto,
  type RespuestaApi,
} from '../../utilidades/inscripciones';
import { crearPagoConfirmadoConMovimiento } from '../../utilidades/pagos';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, fijarEstadoDeAcademia, rutasRegistradas } from '../../utilidades/usuarios';

// Criterio 8 (crítico, sección 2.1, RN-25, D-29): la matriz suma `AJUSTAR_MONTO_COBRO` con `ADMIN: 'TODO'` (la prueba de la matriz está en
// `packages/contratos/src/permisos.test.ts`). Rutas y permisos:
//   - cobro en efectivo (`POST /api/solicitudes/{id}/pago-efectivo`), ticket (`GET /api/pagos/{id}/ticket`) y panel de solicitudes:
//     `REGISTRAR_INSCRIPCION_Y_COBRO` (ADMIN y SECRETARIA);
//   - ajuste del monto (`POST /api/solicitudes/{id}/ajuste-monto`): `AJUSTAR_MONTO_COBRO` (solo ADMIN; la secretaria recibe 403 SIN_PERMISO, RN-25).
// ENTRENADOR y ALUMNO reciben 403 SIN_PERMISO en todas, también con un id inválido; sin sesión, 401; con el cambio de contraseña pendiente o la academia
// suspendida, lo de 002 (sesión -> academia activa -> cambio obligatorio -> permiso -> cuerpo -> operación). El Superadmin no tiene estas rutas (D-29).
// Ningún 403 escribe ni audita.

type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';

interface RutaDelContrato {
  nombre: string;
  metodo: 'get' | 'post';
  /** Los roles que sí pasan el permiso. */
  roles: readonly Rol[];
  exito: 200 | 201;
  /** Prepara lo que la ruta necesita (solicitud, caja, pago) y devuelve la dirección y el cuerpo válidos. */
  preparar: () => Promise<{ ruta: string; cuerpo?: Objeto }>;
  /** Una dirección y un cuerpo inválidos (el id no es UUID y el cuerpo no cumple el esquema). */
  invalida: { ruta: string; cuerpo?: Objeto };
}

describe('criterio 8: permisos de las rutas de pagos de la 007a', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;
  let cajaId: string | undefined;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
    cajaId = undefined;
    // Auditoría previa en A: «no audita nada» tiene que poder verse.
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const conCaja = async (): Promise<string> => (cajaId ??= (await abrirCajaDeHoy(e)).id);

  const RUTAS: RutaDelContrato[] = [
    {
      nombre: 'POST /api/solicitudes/{id}/pago-efectivo',
      metodo: 'post',
      roles: ['admin', 'secretaria'],
      exito: 201,
      preparar: async () => {
        await conCaja();
        const cliente = await sembrarCobrable(e);
        return { ruta: rutaCobro(cliente.solicitudId), cuerpo: cuerpoCobro('42.00') };
      },
      invalida: { ruta: rutaCobro('no-es-un-uuid'), cuerpo: { montoMostrado: 'abc' } },
    },
    {
      nombre: 'POST /api/solicitudes/{id}/ajuste-monto',
      metodo: 'post',
      roles: ['admin'],
      exito: 200,
      preparar: async () => {
        const cliente = await sembrarCobrable(e);
        return { ruta: rutaAjuste(cliente.solicitudId), cuerpo: cuerpoAjuste('35') };
      },
      invalida: { ruta: rutaAjuste('no-es-un-uuid'), cuerpo: { montoAjustado: '0' } },
    },
    {
      nombre: 'GET /api/pagos/{id}/ticket',
      metodo: 'get',
      roles: ['admin', 'secretaria'],
      exito: 200,
      preparar: async () => {
        const cajaDeHoy = await conCaja();
        const cliente = await sembrarCobrable(e);
        const { pagoId } = await crearPagoConfirmadoConMovimiento(e.A.id, {
          cajaId: cajaDeHoy,
          alumnoId: cliente.alumnoId,
          matriculaId: cliente.matriculaId,
          usuarioId: e.secretariaA.id,
          numeroTicket: 1,
        });
        return { ruta: rutaTicket(pagoId) };
      },
      invalida: { ruta: rutaTicket('no-es-un-uuid') },
    },
  ];

  const enviar = (
    def: RutaDelContrato,
    ruta: string,
    cuerpo: Objeto | undefined,
    cookie?: string,
  ): Promise<RespuestaApi> =>
    def.metodo === 'get' ? ctx.http.get(ruta, { cookie }) : ctx.http.post(ruta, cuerpo ?? {}, { cookie });

  const estadoDeLasAcademias = async () => ({
    a: await instantaneaDeLaAcademia(e.A.id),
    b: await instantaneaDeLaAcademia(e.B.id),
  });

  describe.each(RUTAS)('$nombre', (def) => {
    it.each(def.roles.map((rol) => [rol]))('criterio 8: %s de A pasa el permiso y recibe su éxito', async (rol) => {
      const { ruta, cuerpo } = await def.preparar();

      const respuesta = await enviar(def, ruta, cuerpo, cookies[rol]);

      expect(respuesta.status, respuesta.texto).toBe(def.exito);
      expect(respuesta.cacheControl).toBe('no-store');
    });

    const SIN_PERMISO = (['admin', 'secretaria', 'entrenador', 'alumno'] as const).filter(
      (rol) => !def.roles.includes(rol),
    );
    it.each(SIN_PERMISO.map((rol) => [rol]))(
      'criterio 8: %s recibe 403 SIN_PERMISO sin escribir ni auditar, aun con un id inválido y con un cuerpo inválido',
      async (rol) => {
        const { ruta, cuerpo } = await def.preparar();
        const antes = await estadoDeLasAcademias();

        for (const [r, c] of [
          [ruta, cuerpo],
          [def.invalida.ruta, def.invalida.cuerpo],
          [ruta.replace(/[0-9a-f-]{36}/, randomUUID()), cuerpo],
        ] as const) {
          const respuesta = await enviar(def, r, c, cookies[rol]);
          expect(respuesta.status, `${rol} ${r}`).toBe(403);
          expect(codigoDe(respuesta), `${rol} ${r}`).toBe('SIN_PERMISO');
          expect(respuesta.cacheControl).toBe('no-store');
        }
        expect(await estadoDeLasAcademias()).toEqual(antes);
      },
    );

    it('criterio 8: sin sesión, 401 NO_AUTENTICADO, aun con un id y un cuerpo inválidos; el Superadmin (aq_plataforma) también recibe 401', async () => {
      const { ruta, cuerpo } = await def.preparar();
      const antes = await estadoDeLasAcademias();

      const respuestas = [
        await enviar(def, ruta, cuerpo),
        await enviar(def, def.invalida.ruta, def.invalida.cuerpo),
        await enviar(def, ruta, cuerpo, cookieDeSesion(e.superadmin, AHORA_007)),
        await enviar(def, ruta, cuerpo, 'aq_sesion=no-es-un-token'),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status, respuesta.texto).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
      }
      expect(await estadoDeLasAcademias()).toEqual(antes);
    });

    it('criterio 8: con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso y el cuerpo', async () => {
      const { ruta, cuerpo } = await def.preparar();
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(e.A.id, e.entrenadorA.id, { debe_cambiar_clave: true });
      const antes = await estadoDeLasAcademias();

      for (const rol of ['secretaria', 'entrenador'] as const) {
        for (const [r, c] of [
          [ruta, cuerpo],
          [def.invalida.ruta, def.invalida.cuerpo],
        ] as const) {
          const respuesta = await enviar(def, r, c, cookies[rol]);
          expect(respuesta.status, rol).toBe(403);
          expect(codigoDe(respuesta), rol).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
        }
      }
      expect(await estadoDeLasAcademias()).toEqual(antes);
    });

    it('criterio 8: con A suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso; B sigue sirviendo (sus solicitudes no son de A: 404)', async () => {
      const { ruta, cuerpo } = await def.preparar();
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });
      const antes = await estadoDeLasAcademias();

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        const respuesta = await enviar(def, ruta, cuerpo, cookies[rol]);
        expect(respuesta.status, rol).toBe(403);
        expect(codigoDe(respuesta), rol).toBe('ACADEMIA_SUSPENDIDA');
      }
      expect(await estadoDeLasAcademias()).toEqual(antes);
      const deB = await enviar(def, ruta, cuerpo, cookies.adminB);
      expect(deB.status, 'el id es de A: para B no existe').toBe(404);
    });

    it('criterio 8: el rol se lee de la base en cada petición: un ADMIN que pasa a ENTRENADOR pierde el permiso al instante', async () => {
      const { ruta, cuerpo } = await def.preparar();
      await actualizarUsuario(e.A.id, e.adminA.id, { rol: 'ENTRENADOR' });

      const respuesta = await enviar(def, ruta, cuerpo, cookies.admin);

      expect(respuesta.status, respuesta.texto).toBe(403);
      expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
    });
  });

  it('criterio 8: la secretaria no ajusta montos (RN-25): su 403 no cambia ni la matrícula ni la auditoría, y el administrador sí lo hace', async () => {
    const cliente = await sembrarCobrable(e);
    const antes = await estadoDeLasAcademias();

    const secretaria = await ctx.http.post(rutaAjuste(cliente.solicitudId), cuerpoAjuste('35'), {
      cookie: cookies.secretaria,
    });

    expect([secretaria.status, codigoDe(secretaria)]).toEqual([403, 'SIN_PERMISO']);
    expect(await estadoDeLasAcademias()).toEqual(antes);
    const admin = await ctx.http.post(rutaAjuste(cliente.solicitudId), cuerpoAjuste('35'), { cookie: cookies.admin });
    expect(admin.status, admin.texto).toBe(200);
  });

  it('criterio 8: el Superadmin no tiene estas rutas: ninguna ruta de plataforma menciona pagos, cobros, tickets ni ajustes (D-29), y las tres rutas son de academia', () => {
    const rutas = rutasRegistradas(ctx.app).map(([metodo, ruta]) => `${metodo} ${ruta}`);

    expect(
      rutas.filter(
        (ruta) => /^[A-Z]+ \/api\/plataforma/.test(ruta) && /pago|cobro|ticket|ajuste|solicitud/i.test(ruta),
      ),
    ).toEqual([]);
    exigirRutasDePagos(ctx.app);
  });
});
