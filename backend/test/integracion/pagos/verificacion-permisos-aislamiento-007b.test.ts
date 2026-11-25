// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conFilaRetenida } from '../../utilidades/carreras';
import { insertarAuditoria } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  type EscenarioPagos,
  exigirRutasDePagos,
  instantaneaDeLaAcademia,
  partesDeLaAcademia,
} from '../../utilidades/escenario-pagos';
import {
  exigirRutasDe007b,
  guardarComprobanteSembrado,
  instantaneaConArchivos,
  RUTA_PENDIENTES,
  rutaAprobacion,
  rutaComprobante,
  rutaRechazo,
  sembrarEnVerificacion,
  type SolicitudConPago,
} from '../../utilidades/escenario-pagos-007b';
import { codigoDe, type Objeto, type RespuestaApi, sembrarSolicitud, sinUuid } from '../../utilidades/inscripciones';
import { type AppConAlmacen, crearAppConAlmacen, exigirAlmacen } from '../../utilidades/inscripciones-005b';
import { filaPagoValida, insertarPago, leerPagos } from '../../utilidades/pagos';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, fijarEstadoDeAcademia, rutasRegistradas } from '../../utilidades/usuarios';

// Criterio 8, partes [007b] (crítico, sección 2.1, D-29): bandeja, comprobante, aprobación y rechazo: `VERIFICAR_PAGOS` (`ADMIN` y `SECRETARIA`). `ENTRENADOR` y `ALUMNO` reciben 403 `SIN_PERMISO` en todas, también con un id
// inválido; sin sesión, 401; con el cambio de contraseña pendiente o la academia suspendida, lo de 002 (sesión → academia activa → cambio obligatorio → permiso → cuerpo → operación). El Superadmin no tiene estas rutas (D-29).
// Criterio 9, partes [007b] (crítico, D-23, DT-5 de 002, AT-2 de 004): en toda ruta con `{id}`, un id que no es UUID, que no existe o que es de otra academia responde el mismo 404 `NO_ENCONTRADO`, con el mismo cuerpo y sin escribir
// ni auditar. La academia sale siempre de la sesión (`?academiaId=`, un `academiaId` en el cuerpo —400 por campo de más— o una cabecera no cambian nada). Toda escritura llama a `bloquearActorVigente` como primera sentencia
// de su transacción; un actor desactivado o con la versión de token cambiada responde 401 antes que cualquier 404 o 409, sin escribir.

type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';

interface RutaDelContrato {
  nombre: string;
  metodo: 'get' | 'post';
  exito: 200;
  /** Prepara lo que la ruta necesita y devuelve la dirección y el cuerpo válidos. */
  preparar: () => Promise<{ ruta: string; cuerpo?: Objeto }>;
  /** Una dirección y un cuerpo inválidos (el id no es UUID y el cuerpo no cumple el esquema). */
  invalida: { ruta: string; cuerpo?: Objeto };
}

describe('permisos y aislamiento de las rutas de verificación de pagos (criterios 8 y 9, partes de la 007b)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;
  let cajaId: string | undefined;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ ahora: AHORA_007 });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
    cookies = cookiesDePagos(e);
    cajaId = undefined;
    // Auditoría previa en A: «no audita nada» tiene que poder verse.
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const conCaja = async (): Promise<string> => (cajaId ??= (await abrirCajaDeHoy(e)).id);
  const enRevision = async (): Promise<SolicitudConPago> => {
    const cliente = await sembrarEnVerificacion(e);
    await guardarComprobanteSembrado(ctx, e.A.id, cliente.comprobanteClave);
    return cliente;
  };

  const RUTAS: RutaDelContrato[] = [
    {
      nombre: 'GET /api/pagos/pendientes',
      metodo: 'get',
      exito: 200,
      preparar: async () => {
        await enRevision();
        return { ruta: RUTA_PENDIENTES };
      },
      invalida: { ruta: `${RUTA_PENDIENTES}?x=1` },
    },
    {
      nombre: 'GET /api/pagos/{id}/comprobante',
      metodo: 'get',
      exito: 200,
      preparar: async () => ({ ruta: rutaComprobante((await enRevision()).pagoId) }),
      invalida: { ruta: rutaComprobante('no-es-un-uuid') },
    },
    {
      nombre: 'POST /api/pagos/{id}/aprobacion',
      metodo: 'post',
      exito: 200,
      preparar: async () => {
        await conCaja();
        return { ruta: rutaAprobacion((await enRevision()).pagoId), cuerpo: {} };
      },
      invalida: { ruta: rutaAprobacion('no-es-un-uuid'), cuerpo: { campoDeMas: true } },
    },
    {
      nombre: 'POST /api/pagos/{id}/rechazo',
      metodo: 'post',
      exito: 200,
      preparar: async () => ({
        ruta: rutaRechazo((await enRevision()).pagoId),
        cuerpo: { motivo: 'La imagen no se lee' },
      }),
      invalida: { ruta: rutaRechazo('no-es-un-uuid'), cuerpo: { motivo: 'ab' } },
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
    a: await instantaneaConArchivos(ctx, e),
    b: await instantaneaDeLaAcademia(e.B.id),
  });

  describe.each(RUTAS)('$nombre', (def) => {
    it.each(['admin', 'secretaria'] as const)(
      'criterio 8: %s de A pasa el permiso y recibe su éxito con Cache-Control: no-store',
      async (rol) => {
        const { ruta, cuerpo } = await def.preparar();

        const respuesta = await enviar(def, ruta, cuerpo, cookies[rol]);

        expect(respuesta.status, respuesta.texto).toBe(def.exito);
        expect(respuesta.cacheControl).toBe('no-store');
      },
    );

    it.each(['entrenador', 'alumno'] as const)(
      'criterio 8: %s recibe 403 SIN_PERMISO sin escribir ni auditar, aun con un id inválido, uno inexistente y con un cuerpo inválido',
      async (rol: Rol) => {
        const { ruta, cuerpo } = await def.preparar();
        const antes = await estadoDeLasAcademias();

        for (const [r, c] of [
          [ruta, cuerpo],
          [def.invalida.ruta, def.invalida.cuerpo],
          [ruta.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, randomUUID()), cuerpo],
        ] as const) {
          const respuesta = await enviar(def, r, c, cookies[rol]);
          expect(respuesta.status, `${rol} ${r}`).toBe(403);
          expect(codigoDe(respuesta), `${rol} ${r}`).toBe('SIN_PERMISO');
          expect(respuesta.cacheControl).toBe('no-store');
        }
        expect(await estadoDeLasAcademias()).toEqual(antes);
      },
    );

    it('criterio 8: sin sesión, 401 NO_AUTENTICADO, aun con un id y un cuerpo inválidos; el Superadmin (aq_plataforma) y una cookie rota también reciben 401', async () => {
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

    it('criterio 8: con A suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso; B sigue sirviendo (el id es de A: para B no existe, 404)', async () => {
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
      if (def.nombre !== 'GET /api/pagos/pendientes') {
        const deB = await enviar(def, ruta, cuerpo, cookies.adminB);
        expect(deB.status, 'el id es de A: para B no existe').toBe(404);
      }
    });

    it('criterio 8: el rol se lee de la base en cada petición: un ADMIN que pasa a ENTRENADOR pierde el permiso al instante', async () => {
      const { ruta, cuerpo } = await def.preparar();
      await actualizarUsuario(e.A.id, e.adminA.id, { rol: 'ENTRENADOR' });

      const respuesta = await enviar(def, ruta, cuerpo, cookies.admin);

      expect(respuesta.status, respuesta.texto).toBe(403);
      expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
    });
  });

  it('criterio 8: el Superadmin no tiene estas rutas: ninguna ruta de plataforma menciona pagos, aprobaciones, rechazos ni comprobantes (D-29)', () => {
    const rutas = rutasRegistradas(ctx.app).map(([metodo, ruta]) => `${metodo} ${ruta}`);

    expect(
      rutas.filter((ruta) => /^[A-Z]+ \/api\/plataforma/.test(ruta) && /pago|aprobaci|rechazo|comprobante/i.test(ruta)),
    ).toEqual([]);
  });

  describe('criterio 9: un id que no es UUID, que no existe o que es de otra academia: el mismo 404 NO_ENCONTRADO', () => {
    const IDS_INVALIDOS = ['no-es-un-uuid', '123', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', `${randomUUID()}x`];

    async function pagoDeB(): Promise<string> {
      const solicitud = await sembrarSolicitud(e.B.id, {
        planId: e.planB.id,
        claseIds: [e.lunesB.id],
        clasesTotales: 5,
        clasesPorMesPlan: 12,
        precioPlan: '100.00',
        monto: '42.00',
        reservaVenceEn: null,
      });
      const fila = filaPagoValida(
        e.B.id,
        { alumnoId: solicitud.alumnoId, matriculaId: solicitud.matriculaId },
        { metodo: 'YAPE' },
      );
      await insertarPago('propietario', e.B.id, fila);
      await guardarComprobanteSembrado(ctx, e.B.id, fila['comprobante_clave'] as string);
      return fila['id'] as string;
    }

    it('criterio 9: comprobante, aprobación y rechazo responden el mismo 404 (mismo cuerpo, sin el id) para un id inválido, uno inexistente y uno de B, sin escribir ni auditar', async () => {
      await conCaja();
      const ajeno = await pagoDeB();
      const antes = await estadoDeLasAcademias();
      const casos: [string, (id: string) => Promise<RespuestaApi>][] = [
        ['comprobante', (id) => ctx.http.get(rutaComprobante(id), { cookie: cookies.secretaria })],
        ['aprobación', (id) => ctx.http.post(rutaAprobacion(id), {}, { cookie: cookies.secretaria })],
        [
          'rechazo',
          (id) => ctx.http.post(rutaRechazo(id), { motivo: 'La imagen no se lee' }, { cookie: cookies.secretaria }),
        ],
      ];

      for (const [nombre, hacer] of casos) {
        const ids = [...IDS_INVALIDOS, randomUUID(), ajeno];
        const respuestas = await Promise.all(ids.map((id) => hacer(id)));
        for (const [i, respuesta] of respuestas.entries()) {
          expect([respuesta.status, codigoDeRespuesta(respuesta)], `${nombre} ${ids[i]}: ${respuesta.texto}`).toEqual([
            404,
            'NO_ENCONTRADO',
          ]);
        }
        expect(new Set(respuestas.map((r) => sinUuid(r.texto))).size, `${nombre}: el mismo cuerpo para todos`).toBe(1);
        for (const [i, id] of ids.entries()) {
          expect(respuestas[i]?.texto, `${nombre}: sin el id en el cuerpo`).not.toContain(id);
        }
      }
      expect(await estadoDeLasAcademias()).toEqual(antes);
    });

    it('criterio 9: lo mismo desde B: el pago de A no existe para B, con el mismo 404, y no se toca', async () => {
      await conCaja();
      const cliente = await enRevision();
      const antes = await estadoDeLasAcademias();

      const comprobante = await ctx.http.get(rutaComprobante(cliente.pagoId), { cookie: cookies.secretariaB });
      const aprobacion = await ctx.http.post(rutaAprobacion(cliente.pagoId), {}, { cookie: cookies.adminB });
      const rechazo = await ctx.http.post(
        rutaRechazo(cliente.pagoId),
        { motivo: 'La imagen no se lee' },
        { cookie: cookies.adminB },
      );

      for (const respuesta of [comprobante, aprobacion, rechazo]) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([404, 'NO_ENCONTRADO']);
      }
      expect(await estadoDeLasAcademias()).toEqual(antes);
      expect((await leerPagos(e.A.id))[0]?.estado).toBe('PENDIENTE_VERIFICACION');
    });

    it('criterio 9: el 400 del cuerpo va antes que el 404 del id (orden de 002): un id inexistente con un cuerpo inválido responde 400; con un cuerpo válido, 404', async () => {
      const inexistente = randomUUID();

      const aprobacionMala = await ctx.http.post(
        rutaAprobacion(inexistente),
        { campoDeMas: 1 },
        { cookie: cookies.admin },
      );
      const rechazoMalo = await ctx.http.post(rutaRechazo(inexistente), { motivo: 'ab' }, { cookie: cookies.admin });
      const rechazoSinMotivo = await ctx.http.post(rutaRechazo(inexistente), {}, { cookie: cookies.admin });
      const aprobacion = await ctx.http.post(rutaAprobacion(inexistente), {}, { cookie: cookies.admin });
      const rechazo = await ctx.http.post(
        rutaRechazo(inexistente),
        { motivo: 'La imagen no se lee' },
        { cookie: cookies.admin },
      );

      expect([aprobacionMala.status, rechazoMalo.status, rechazoSinMotivo.status]).toEqual([400, 400, 400]);
      expect([aprobacion.status, rechazo.status]).toEqual([404, 404]);
    });
  });

  describe('la academia sale siempre de la sesión', () => {
    it('criterio 9: ?academiaId=<B> en la dirección no cambia nada: la aprobación de un pago de A sigue siendo de A y no toca a B', async () => {
      await conCaja();
      const cliente = await enRevision();
      const antesB = await instantaneaDeLaAcademia(e.B.id);

      const respuesta = await ctx.http.post(
        `${rutaAprobacion(cliente.pagoId)}?academiaId=${e.B.id}`,
        {},
        {
          cookie: cookies.secretaria,
        },
      );

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(await instantaneaDeLaAcademia(e.B.id)).toBe(antesB);
    });

    it.each([
      ['aprobación', (id: string) => ({ ruta: rutaAprobacion(id), cuerpo: { academiaId: 'cualquiera' } })],
      [
        'rechazo',
        (id: string) => ({
          ruta: rutaRechazo(id),
          cuerpo: { motivo: 'La imagen no se lee', academiaId: 'cualquiera' },
        }),
      ],
    ])(
      'criterio 9: un academiaId en el cuerpo de la %s responde 400 por campo de más, sin escribir',
      async (_nombre, armar) => {
        await conCaja();
        const cliente = await enRevision();
        const antes = await estadoDeLasAcademias();
        const { ruta, cuerpo } = armar(cliente.pagoId);

        const respuesta = await ctx.http.post(ruta, cuerpo, { cookie: cookies.secretaria });

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(await estadoDeLasAcademias()).toEqual(antes);
      },
    );

    it('criterio 9: una cabecera con la academia (X-Academia-Id, X-Academia) no cambia nada: el pago de B sigue siendo un 404 para la sesión de A', async () => {
      const ajeno = await sembrarSolicitud(e.B.id, {
        planId: e.planB.id,
        claseIds: [e.lunesB.id],
        clasesTotales: 5,
        clasesPorMesPlan: 12,
        precioPlan: '100.00',
        monto: '42.00',
        reservaVenceEn: null,
      });
      const fila = filaPagoValida(
        e.B.id,
        { alumnoId: ajeno.alumnoId, matriculaId: ajeno.matriculaId },
        { metodo: 'YAPE' },
      );
      await insertarPago('propietario', e.B.id, fila);

      for (const cabecera of <Record<string, string>[]>[{ 'x-academia-id': e.B.id }, { 'x-academia': 'academia-b' }]) {
        const respuesta = await ctx.http.post(
          rutaRechazo(fila['id'] as string),
          { motivo: 'La imagen no se lee' },
          { cookie: cookies.secretaria, headers: cabecera },
        );
        expect(respuesta.status, JSON.stringify(cabecera)).toBe(404);
      }
    });
  });

  describe('el actor deja de estar vigente mientras la petición espera: 401 NO_AUTENTICADO antes que cualquier 404 o 409, sin escribir', () => {
    const CAMBIOS = [
      ['desactivado', 'desactivar'],
      ['con la versión de token cambiada', 'solo-version'],
    ] as const;

    describe.each(CAMBIOS)('el actor %s', (_nombre, cambio) => {
      it('criterio 9: una aprobación que habría dado 200 responde 401 y no escribe', async () => {
        await conCaja();
        const cliente = await enRevision();
        const antes = await partesDeLaAcademia(e.A.id);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: e.secretariaA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => ctx.http.post(rutaAprobacion(cliente.pagoId), {}, { cookie: cookies.secretaria }),
        });

        expect(
          esperoElBloqueo,
          'la aprobación debía quedar esperando la fila del actor: bloquearActorVigente es su primera sentencia',
        ).toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        const despues = await partesDeLaAcademia(e.A.id);
        expect(despues.pagos).toEqual(antes.pagos);
        expect(despues.auditoria).toEqual(antes.auditoria);
        expect(despues.caja).toBe(antes.caja);
        expect(despues.inscripciones).toBe(antes.inscripciones);
      });

      it('criterio 9: una aprobación que habría dado 409 (sin caja) responde 401, no el 409', async () => {
        const cliente = await enRevision();

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: e.secretariaA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => ctx.http.post(rutaAprobacion(cliente.pagoId), {}, { cookie: cookies.secretaria }),
        });

        expect(esperoElBloqueo).toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
      });

      it('criterio 9: un rechazo que habría dado 200 responde 401 y no escribe', async () => {
        const cliente = await enRevision();
        const antes = await partesDeLaAcademia(e.A.id);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: e.adminA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () =>
            ctx.http.post(rutaRechazo(cliente.pagoId), { motivo: 'La imagen no se lee' }, { cookie: cookies.admin }),
        });

        expect(esperoElBloqueo, 'el rechazo debía quedar esperando la fila del actor').toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        const despues = await partesDeLaAcademia(e.A.id);
        expect(despues.pagos).toEqual(antes.pagos);
        expect(despues.auditoria).toEqual(antes.auditoria);
        expect(despues.inscripciones).toBe(antes.inscripciones);
      });

      it.each([
        ['un rechazo', () => rutaRechazo(randomUUID()), { motivo: 'La imagen no se lee' }],
        ['una aprobación', () => rutaAprobacion(randomUUID()), {}],
      ])('criterio 9: %s de un id que no existe responde 401, no el 404', async (_nombre, ruta, cuerpo) => {
        await conCaja();

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: e.secretariaA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => ctx.http.post(ruta(), cuerpo, { cookie: cookies.secretaria }),
        });

        expect(esperoElBloqueo).toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
      });
    });

    it('criterio 9 (control): si la prueba solo bloquea la fila del actor sin cambiarla, la aprobación espera y luego se acepta (200)', async () => {
      await conCaja();
      const cliente = await enRevision();

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: e.A.id,
        actorId: e.secretariaA.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'COMMIT',
        enviar: () => ctx.http.post(rutaAprobacion(cliente.pagoId), {}, { cookie: cookies.secretaria }),
      });

      expect(esperoElBloqueo).toBe(true);
      expect(resultado.status, resultado.texto).toBe(200);
    });
  });
});
