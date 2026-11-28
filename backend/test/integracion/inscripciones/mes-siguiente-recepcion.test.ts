// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { cerrarCajaDePrueba, leerCajas } from '../../utilidades/caja';
import { conFilaRetenida } from '../../utilidades/carreras';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { en, enLima } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  cuerpoParaMes,
  cuposDe,
  enviarPublico,
  type EscenarioMesSiguiente,
  INSTANTE,
  MES_DIC,
  pedirFormulario,
  prepararEscenarioDeMesSiguiente,
  rutaMeses,
} from '../../utilidades/escenario-mes-siguiente';
import {
  codigoDeRespuesta,
  cuerpoCobro,
  detallesDeRespuesta,
  instantaneaDeLaAcademia,
  pagoDe,
  rutaCobro,
} from '../../utilidades/escenario-pagos';
import { abrirCajaPara, sembrarTitulares } from '../../utilidades/escenario-renovacion';
import {
  ACCION_SOLICITUD_CREADA,
  contarFilasDeInscripciones,
  IP_RE,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  type Objeto,
  solicitudDe,
} from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';
import { contarAuditoria } from '../../utilidades/usuarios';

// Criterio 15 (crítico, sección 2.1, criterio 34 de 007, DR-3): un envío para M+1 con la sesión de un `ADMIN` o una `SECRETARIA` de la academia (desde «Nueva inscripción», que es el mismo formulario) hace lo mismo que el público, con las reglas del criterio 34 de 007 (actor vigente como primera sentencia, sin el límite de 5 por conexión, auditoría con actor `USUARIO`), y los mismos
// cupos: tampoco toma un lugar apartado. El cobro en efectivo de esa solicitud exige la caja abierta de hoy (criterio 9).

describe('la inscripción desde recepción para el mes siguiente (criterio 15)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioMesSiguiente;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeMesSiguiente(ctx);
    ctx.correo.mensajes.length = 0;
    cookies = en(ctx, esc, INSTANTE.viernes27);
    await abrirCajaPara(esc, INSTANTE.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const origenes = async () =>
    (
      await ejecutarComo(
        'propietario',
        'SELECT id, registrada_por, host(ip_origen) AS ip_origen FROM solicitudes_inscripcion WHERE academia_id = $1::uuid ORDER BY creado_en, id',
        [A()],
        { academiaId: A() },
      )
    ).rows as { id: string; registrada_por: string | null; ip_origen: string | null }[];
  const paraDiciembre = () => cuerpoParaMes(esc.e, MES_DIC);

  describe('quién inscribe', () => {
    it.each([
      ['la secretaria', 'secretaria'],
      ['el administrador', 'admin'],
    ] as const)(
      'criterio 15: con la sesión de %s, el envío para diciembre responde 201 igual que el público, con registrada_por del actor y la auditoría SOLICITUD_INSCRIPCION_CREADA de un USUARIO (no PUBLICO) con el mes de diciembre',
      async (_nombre, rol) => {
        const respuesta = await enviarPublico(ctx, await paraDiciembre(), { cookie: cookies[rol] });

        expect(respuesta.status, respuesta.texto).toBe(201);
        const solicitud = solicitudDe(respuesta);
        expect(solicitud.cotizacion).toMatchObject({
          mes: '2026-12',
          fechaInicio: '2026-12-01',
          clasesTotales: 12,
          monto: '120.00',
        });
        expect(new Date(solicitud.reservaVenceEn).toISOString()).toBe('2026-11-28T15:00:00.000Z');
        const [fila] = await origenes();
        const actor = rol === 'secretaria' ? esc.e.secretariaA.id : esc.e.adminA.id;
        expect(fila?.registrada_por).toBe(actor);
        expect(fila?.ip_origen, 'la IP de origen se guarda igual').toMatch(IP_RE);
        const [auditoria] = await leerAuditoriaDeAcademia(A(), ACCION_SOLICITUD_CREADA);
        expect(auditoria).toMatchObject({ actor_tipo: 'USUARIO', actor_id: actor, entidad: 'solicitud_inscripcion' });
        expect((auditoria?.datos_despues as Objeto)['mes']).toBe('2026-12');
        expect((await leerMatriculas(A()))[0]).toMatchObject({ anio: 2026, mes: 12, estado: 'RESERVADA' });
      },
    );

    it.each([
      ['un ENTRENADOR', 'entrenador'],
      ['un ALUMNO', 'alumno'],
      ['la secretaria de B (otra academia)', 'secretariaB'],
    ] as const)(
      'criterio 15: con la sesión de %s el envío para diciembre se trata como anónimo (201, registrada_por nula, actor PUBLICO), sin 401 ni 403 por la cookie',
      async (_nombre, rol) => {
        const respuesta = await enviarPublico(ctx, await paraDiciembre(), { cookie: cookies[rol] });

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect((await origenes())[0]?.registrada_por).toBeNull();
        expect((await leerAuditoriaDeAcademia(A(), ACCION_SOLICITUD_CREADA))[0]).toMatchObject({
          actor_tipo: 'PUBLICO',
          actor_id: null,
        });
      },
    );

    it('criterio 15: la recepción también lee los meses de inscripción con su sesión (la misma respuesta que el público)', async () => {
      const publico = await ctx.http.get(rutaMeses());
      const conSesion = await ctx.http.get(rutaMeses(), { cookie: cookies.secretaria });

      expect(conSesion.status, conSesion.texto).toBe(200);
      expect(conSesion.body).toEqual(publico.body);
      expect((conSesion.body?.['meses'] as { mes: string }[]).map((m) => m.mes)).toEqual(['2026-11', '2026-12']);
    });
  });

  describe('sin el límite de 5 por conexión', () => {
    it('criterio 15: la recepción envía 7 solicitudes de diciembre seguidas desde la misma conexión (todas 201, todas con registrada_por) y no cuentan en el límite: un anónimo todavía envía 5 y recién la sexta responde 409 LIMITE_DE_RESERVAS_PENDIENTES', async () => {
      for (let i = 0; i < 7; i++) {
        const respuesta = await enviarPublico(ctx, await paraDiciembre(), { cookie: cookies.secretaria });
        expect(respuesta.status, `recepción ${i + 1}: ${respuesta.texto}`).toBe(201);
      }
      expect((await origenes()).filter((fila) => fila.registrada_por === esc.e.secretariaA.id)).toHaveLength(7);

      for (let i = 0; i < 5; i++)
        expect((await enviarPublico(ctx, await paraDiciembre())).status, `anónimo ${i + 1}`).toBe(201);
      const sexta = await enviarPublico(ctx, await paraDiciembre());

      expect([sexta.status, codigoDeRespuesta(sexta)], sexta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
    });
  });

  describe('el actor sigue vigente dentro de la transacción', () => {
    it.each([
      ['desactivado', 'desactivar'],
      ['con la versión de token cambiada', 'solo-version'],
    ] as const)(
      'criterio 15: si la secretaria deja de estar vigente (%s) mientras el envío para diciembre espera, responde 401 NO_AUTENTICADO y no escribe nada',
      async (_nombre, cambio) => {
        const cuerpo = await paraDiciembre();
        const auditoriaAntes = await contarAuditoria(A());

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: A(),
          actorId: esc.e.secretariaA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => enviarPublico(ctx, cuerpo, { cookie: cookies.secretaria }),
        });

        expect(
          esperoElBloqueo,
          'el envío de recepción debía quedar esperando la fila del actor (primera sentencia)',
        ).toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        expect(await contarFilasDeInscripciones(A())).toMatchObject({
          alumnos: 0,
          solicitudes_inscripcion: 0,
          matriculas: 0,
        });
        expect(await contarAuditoria(A())).toBe(auditoriaAntes);
      },
    );

    it('criterio 15 (control): si la prueba solo bloquea la fila del actor, el envío para diciembre espera y luego se acepta', async () => {
      const cuerpo = await paraDiciembre();

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: A(),
        actorId: esc.e.secretariaA.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'COMMIT',
        enviar: () => enviarPublico(ctx, cuerpo, { cookie: cookies.secretaria }),
      });

      expect(esperoElBloqueo).toBe(true);
      expect(resultado.status, resultado.texto).toBe(201);
    });
  });

  describe('los mismos cupos', () => {
    it('criterio 15: la recepción tampoco toma un lugar apartado para un titular: con 20 titulares en c, el envío de la secretaria y el del administrador para diciembre responden 409 SIN_CUPO con `detalles.clasesSinCupo` y no escriben', async () => {
      await sembrarTitulares(A(), esc.planUnDia.id, 20, { claseIds: [esc.c.id] });
      const cuerpoDeC = () => cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDia, clases: [esc.c] });
      const antes = await instantaneaDeLaAcademia(A());

      const porSecretaria = await enviarPublico(ctx, await cuerpoDeC(), { cookie: cookies.secretaria });
      const porAdmin = await enviarPublico(ctx, await cuerpoDeC(), { cookie: cookies.admin });

      for (const respuesta of [porSecretaria, porAdmin]) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SIN_CUPO']);
        expect(detallesDeRespuesta(respuesta)['clasesSinCupo']).toEqual([esc.c.id]);
      }
      expect(await instantaneaDeLaAcademia(A())).toBe(antes);
      expect(
        cuposDe(await pedirFormulario(ctx, `?mes=${MES_DIC}`), esc.c.id),
        'el formulario de recepción es el mismo y no la ofrece',
      ).toBeUndefined();
    });

    it('criterio 15: con un lugar libre (19 titulares) la recepción lo toma (201) y, ocupado, el siguiente (de recepción o público) recibe SIN_CUPO', async () => {
      await sembrarTitulares(A(), esc.planUnDia.id, 19, { claseIds: [esc.c.id] });
      const cuerpoDeC = () => cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDia, clases: [esc.c] });

      const primera = await enviarPublico(ctx, await cuerpoDeC(), { cookie: cookies.secretaria });
      const segunda = await enviarPublico(ctx, await cuerpoDeC(), { cookie: cookies.secretaria });
      const publica = await enviarPublico(ctx, await cuerpoDeC());

      expect(primera.status, primera.texto).toBe(201);
      expect([segunda.status, codigoDeRespuesta(segunda)]).toEqual([409, 'SIN_CUPO']);
      expect([publica.status, codigoDeRespuesta(publica)]).toEqual([409, 'SIN_CUPO']);
    });
  });

  describe('el cobro en efectivo de esa solicitud exige la caja abierta de hoy', () => {
    it('criterio 15: sin caja abierta, 409 SIN_CAJA_ABIERTA y sin ella nada se escribe; con la caja de hoy abierta, 201 y la matrícula de diciembre pasa a VIGENTE con la persona como ALUMNO_ACTIVO', async () => {
      const respuesta = await enviarPublico(ctx, await paraDiciembre(), { cookie: cookies.secretaria });
      expect(respuesta.status, respuesta.texto).toBe(201);
      const solicitud = (await leerSolicitudes(A()))[0];
      for (const caja of (await leerCajas(A())).filter((fila) => fila.estado === 'ABIERTA')) {
        await cerrarCajaDePrueba(A(), caja.id, esc.e.secretariaA.id);
      }
      const antes = await instantaneaDeLaAcademia(A());

      const sinCaja = await ctx.http.post(rutaCobro(solicitud?.id as string), cuerpoCobro('120.00'), {
        cookie: cookies.secretaria,
      });
      expect([sinCaja.status, codigoDeRespuesta(sinCaja)], sinCaja.texto).toEqual([409, 'SIN_CAJA_ABIERTA']);
      expect(await instantaneaDeLaAcademia(A())).toBe(antes);

      // Una caja por día: se abre la del día siguiente (28/11 a las 09:00, antes de que venza la reserva de las 10:00) y el cobro se hace ese día.
      const el28 = enLima('2026-11-28', '09:00');
      const cookiesDel28 = en(ctx, esc, el28);
      await abrirCajaPara(esc, el28);
      const conCaja = await ctx.http.post(rutaCobro(solicitud?.id as string), cuerpoCobro('120.00'), {
        cookie: cookiesDel28.secretaria,
      });

      expect(conCaja.status, conCaja.texto).toBe(201);
      expect(pagoDe(conCaja)).toMatchObject({ estado: 'CONFIRMADO', concepto: 'INSCRIPCION', monto: '120.00' });
      expect((await leerMatriculas(A()))[0]).toMatchObject({ mes: 12, estado: 'VIGENTE' });
      expect((await leerAlumnos(A()))[0]?.estado).toBe('ALUMNO_ACTIVO');
      expect(await leerPagos(A())).toHaveLength(1);
    });
  });
});
