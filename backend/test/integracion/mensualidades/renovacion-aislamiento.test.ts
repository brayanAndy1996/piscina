// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AlumnoDeAsistencia, en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { instantaneaDeLaAcademia } from '../../utilidades/escenario-pagos';
import { pagosPendientesDe, RUTA_PENDIENTES } from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  ACCION_RENOVACION,
  codigoDeRespuesta,
  cotizarRenovacion,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  cuantasDelMes,
  cuerpoCotizacionRenovacion,
  cuerpoEfectivoRenovacion,
  DICIEMBRE,
  INSTANTES,
  instantaneaDeRenovacion,
  pedirOferta,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
  renovarConComprobante,
  renovarEnEfectivo,
  resumen,
  rutaRenovacionComprobante,
  sembrarTitulares,
  seleccionDeDiciembre,
  datosComprobanteRenovacion,
  type OpcionesDeRegistro,
  type Via,
} from '../../utilidades/escenario-renovacion';
import { type RespuestaApi, sinUuid } from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 18 (crítico, D-23): con A y B con el mismo DNI y clases a la misma hora: el alumno de B con la sesión de A responde 404; una clase o un plan de B en la petición responden como inexistentes (`SELECCION_NO_VALIDA`, `PLAN_NO_DISPONIBLE`); la ocupación y las
// reservas de prioridad solo cuentan matrículas de la academia de la sesión; la bandeja de A no muestra renovaciones de B; un número de operación de B no choca en A; `?academiaId=` no cambia nada.
// Lecturas estrictas elegidas: (1) el 404 de un alumno de otra academia es el mismo (el mismo cuerpo, sin ids) que el de un id inexistente, en las cuatro rutas y con la sesión de A y de B; (2) «como inexistentes» es el mismo código y los mismos errores por campo que
// con ids que no existen en ninguna academia; (3) la clave de idempotencia es única por academia: la misma clave en A y en B no choca; (4) un cobro en efectivo de A no escribe nada en B (ni caja, ni pagos, ni auditoría).

const VIAS: Via[] = ['EFECTIVO', 'YAPE'];
const DNI_COMUN = '45612378';

describe('aislamiento entre academias en la renovación (criterio 18)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let deA: AlumnoDeAsistencia;
  let deB: AlumnoDeAsistencia;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    deA = await crearAlumnoDeNoviembre(ctx, esc, { dni: DNI_COMUN });
    deB = await crearAlumnoDeNoviembre(ctx, esc, { academia: 'B', dni: DNI_COMUN });
    await abrirCajaPara(esc, INSTANTES.viernes27);
    cookies = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const seleccionDeB = (): OpcionesDeRegistro['seleccion'] => ({
    planId: esc.e.planB.id,
    claseIds: [esc.e.lunesB.id, esc.e.miercolesB.id, esc.e.viernesB.id],
  });
  const sinIds = (respuesta: RespuestaApi) => sinUuid(respuesta.texto);

  it('criterio 18: el escenario tiene el mismo DNI en A y en B y clases a la misma hora', () => {
    expect(deA.dni).toBe(DNI_COMUN);
    expect(deB.dni).toBe(DNI_COMUN);
    expect([esc.e.lunes.hora_inicio, esc.e.lunes.dia_semana]).toEqual([
      esc.e.lunesB.hora_inicio,
      esc.e.lunesB.dia_semana,
    ]);
  });

  describe('el alumno de otra academia es un alumno que no existe (404 NO_ENCONTRADO)', () => {
    it('criterio 18: con la sesión de A, las cuatro rutas sobre el alumno de B responden el mismo 404 que sobre un id inexistente y no escriben ni auditan en ninguna academia', async () => {
      const antes = await instantaneaDeRenovacion(ctx, esc);
      const inexistente = randomUUID();

      const delOtro = [
        await pedirOferta(ctx, cookies.secretaria, deB.alumnoId),
        await cotizarRenovacion(
          ctx,
          cookies.secretaria,
          deB.alumnoId,
          cuerpoCotizacionRenovacion(seleccionDeDiciembre(esc)),
        ),
        await renovarEnEfectivo(
          ctx,
          cookies.secretaria,
          deB.alumnoId,
          cuerpoEfectivoRenovacion(seleccionDeDiciembre(esc), '120.00'),
        ),
        await renovarConComprobante(ctx, deB.alumnoId, {
          cookie: cookies.secretaria,
          datos: datosComprobanteRenovacion(seleccionDeDiciembre(esc), '120.00', '2026-11-27'),
        }),
      ];
      const delInexistente = [
        await pedirOferta(ctx, cookies.secretaria, inexistente),
        await cotizarRenovacion(
          ctx,
          cookies.secretaria,
          inexistente,
          cuerpoCotizacionRenovacion(seleccionDeDiciembre(esc)),
        ),
        await renovarEnEfectivo(
          ctx,
          cookies.secretaria,
          inexistente,
          cuerpoEfectivoRenovacion(seleccionDeDiciembre(esc), '120.00'),
        ),
        await renovarConComprobante(ctx, inexistente, {
          cookie: cookies.secretaria,
          datos: datosComprobanteRenovacion(seleccionDeDiciembre(esc), '120.00', '2026-11-27'),
        }),
      ];

      for (const [i, respuesta] of delOtro.entries()) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], `ruta ${i}: ${respuesta.texto.slice(0, 200)}`).toEqual(
          [404, 'NO_ENCONTRADO'],
        );
        expect(sinIds(respuesta), `ruta ${i}`).toBe(sinIds(delInexistente[i] as RespuestaApi));
      }
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    it('criterio 18: con la sesión de B, el alumno de A también es un 404 (y el de B se renueva con las clases y el plan de B)', async () => {
      const deLaOtra = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretariaB, deA.alumnoId, {
        seleccion: seleccionDeB(),
      });
      const propia = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretariaB, deB.alumnoId, {
        seleccion: seleccionDeB(),
      });

      expect(resumen(deLaOtra.respuesta), deLaOtra.respuesta.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(propia.respuesta.status, propia.respuesta.texto).toBe(201);
      expect(await cuantasDelMes(esc.e.B.id, deB.alumnoId, DICIEMBRE)).toBe(1);
      expect(await cuantasDelMes(esc.e.A.id, deA.alumnoId, DICIEMBRE)).toBe(0);
    });

    it('criterio 18: la renovación del alumno de A (mismo DNI que el de B) se hace en A y no toca nada de B', async () => {
      const antesDeB = await instantaneaDeLaAcademia(esc.e.B.id);

      const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, deA.alumnoId);

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(
        await instantaneaDeLaAcademia(esc.e.B.id),
        'B no cambia (ni caja, ni pagos, ni matrículas, ni auditoría)',
      ).toBe(antesDeB);
      expect(await cuantasDelMes(esc.e.B.id, deB.alumnoId, DICIEMBRE)).toBe(0);
    });
  });

  describe('una clase o un plan de B en la petición de A responden como inexistentes', () => {
    it.each(VIAS)(
      'criterio 18 (%s): las tres clases de B responden SELECCION_NO_VALIDA, igual que tres clases que no existen en ninguna academia',
      async (via) => {
        const deOtra = await registrarRenovacion(ctx, esc, via, cookies.secretaria, deA.alumnoId, {
          seleccion: { claseIds: [esc.e.lunesB.id, esc.e.miercolesB.id, esc.e.viernesB.id] },
        });
        const inexistentes = await registrarRenovacion(ctx, esc, via, cookies.secretaria, deA.alumnoId, {
          seleccion: { claseIds: [randomUUID(), randomUUID(), randomUUID()] },
        });

        expect(resumen(deOtra.respuesta), deOtra.respuesta.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
        expect(sinIds(deOtra.respuesta)).toBe(sinIds(inexistentes.respuesta));
        expect(await cuantasDelMes(esc.e.A.id, deA.alumnoId, DICIEMBRE)).toBe(0);
      },
    );

    it.each(VIAS)(
      'criterio 18 (%s): una sola clase de B entre las de A también responde SELECCION_NO_VALIDA, sin escribir',
      async (via) => {
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const { respuesta } = await registrarRenovacion(ctx, esc, via, cookies.secretaria, deA.alumnoId, {
          seleccion: { claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernesB.id] },
        });

        expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
        expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      },
    );

    it.each(VIAS)(
      'criterio 18 (%s): el plan de B responde PLAN_NO_DISPONIBLE, igual que un plan que no existe',
      async (via) => {
        const deOtra = await registrarRenovacion(ctx, esc, via, cookies.secretaria, deA.alumnoId, {
          seleccion: { planId: esc.e.planB.id },
        });
        const inexistente = await registrarRenovacion(ctx, esc, via, cookies.secretaria, deA.alumnoId, {
          seleccion: { planId: randomUUID() },
        });

        expect(resumen(deOtra.respuesta), deOtra.respuesta.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
        expect(sinIds(deOtra.respuesta)).toBe(sinIds(inexistente.respuesta));
      },
    );

    it('criterio 18: la oferta de A solo trae los planes y las clases de A', async () => {
      const respuesta = await pedirOferta(ctx, cookies.secretaria, deA.alumnoId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const ids = (lista: unknown) => (lista as { id: string }[]).map((x) => x.id);
      expect(ids(respuesta.body?.['planes'])).not.toContain(esc.e.planB.id);
      for (const claseDeB of [esc.e.lunesB.id, esc.e.miercolesB.id, esc.e.viernesB.id]) {
        expect(ids(respuesta.body?.['clases'])).not.toContain(claseDeB);
      }
      expect(ids(respuesta.body?.['clases'])).toContain(esc.e.lunes.id);
    });
  });

  describe('la ocupación y las reservas de prioridad solo cuentan la academia de la sesión', () => {
    it('criterio 18: con la clase de B llena de titulares (20 de 20), la misma hora en A sigue libre: el alumno de A renueva (201)', async () => {
      await sembrarTitulares(esc.e.B.id, esc.e.planB.id, 20, {
        claseIds: [esc.e.lunesB.id, esc.e.miercolesB.id, esc.e.viernesB.id],
      });
      const vencido = await crearAlumnoVencido(ctx, esc);

      const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, vencido.alumnoId);

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 18: con la clase de A llena de titulares (20 de 20), el alumno de B renueva en la de B (201); y uno sin prioridad de A recibe SIN_CUPO', async () => {
      await sembrarTitulares(esc.e.A.id, esc.e.plan.id, 20, {
        claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
      });
      const vencidoDeA = await crearAlumnoVencido(ctx, esc);

      const delB = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretariaB, deB.alumnoId, {
        seleccion: seleccionDeB(),
      });
      const delA = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, vencidoDeA.alumnoId);

      expect(delB.respuesta.status, delB.respuesta.texto).toBe(201);
      expect(resumen(delA.respuesta), delA.respuesta.texto).toEqual([409, 'SIN_CUPO']);
    });

    it('criterio 18: las matrículas de diciembre de B no ocupan cupo en A: con 20 matrículas de diciembre en la clase de B, la de A no pierde cupo en la oferta', async () => {
      await sembrarTitulares(esc.e.B.id, esc.e.planB.id, 20, {
        claseIds: [esc.e.lunesB.id],
        mes: DICIEMBRE,
      });

      const respuesta = await pedirOferta(ctx, cookies.secretaria, deA.alumnoId, '2026-12');

      expect(respuesta.status, respuesta.texto).toBe(200);
      const lunes = (respuesta.body?.['clases'] as { id: string; cuposRestantes: number }[]).find(
        (c) => c.id === esc.e.lunes.id,
      );
      // 20 de aforo, ninguna matrícula de diciembre en A y el propio lugar del alumno (es el único titular de A en el lunes): 20 − 0 − 1 + 1 = 20.
      expect(lunes?.cuposRestantes).toBe(20);
    });
  });

  describe('la bandeja de verificación', () => {
    it('criterio 18: la bandeja de A no muestra las renovaciones de B y la de B no muestra las de A', async () => {
      const deAYape = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, deA.alumnoId);
      const deBYape = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretariaB, deB.alumnoId, {
        seleccion: seleccionDeB(),
      });
      const pagoDeA = renovacionDe(deAYape.respuesta, 201).pago.id;
      const pagoDeB = renovacionDe(deBYape.respuesta, 201).pago.id;

      const bandejaA = pagosPendientesDe(await ctx.http.get(RUTA_PENDIENTES, { cookie: cookies.secretaria }));
      const bandejaB = pagosPendientesDe(await ctx.http.get(RUTA_PENDIENTES, { cookie: cookies.secretariaB }));

      expect(bandejaA.map((p) => p.id)).toEqual([pagoDeA]);
      expect(bandejaB.map((p) => p.id)).toEqual([pagoDeB]);
      expect(await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(esc.e.B.id, ACCION_RENOVACION)).toHaveLength(1);
    });
  });

  describe('números de operación y claves de idempotencia por academia', () => {
    it('criterio 18: el número de operación de una renovación de B no choca en A (ni al revés) y la misma clave de idempotencia sirve en las dos', async () => {
      const clave = randomUUID();
      const enB = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretariaB, deB.alumnoId, {
        seleccion: seleccionDeB(),
        sobre: { numeroOperacion: '8080808', claveIdempotencia: clave },
      });
      const enA = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, deA.alumnoId, {
        sobre: { numeroOperacion: '0808-0808', claveIdempotencia: clave },
      });
      const otroA = await crearAlumnoDeNoviembre(ctx, esc);
      const chocaEnA = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, otroA.alumnoId, {
        sobre: { numeroOperacion: '8080808' },
      });

      expect(enB.respuesta.status, enB.respuesta.texto).toBe(201);
      expect(
        enA.respuesta.status,
        'el 08080808 y el 8080808 son el mismo número normalizado, pero de otra academia',
      ).toBe(201);
      expect(resumen(chocaEnA.respuesta), chocaEnA.respuesta.texto).toEqual([409, 'NUMERO_OPERACION_YA_USADO']);
      expect((await leerPagos(esc.e.A.id)).filter((p) => p.clave_idempotencia === clave)).toHaveLength(1);
      expect((await leerPagos(esc.e.B.id)).filter((p) => p.clave_idempotencia === clave)).toHaveLength(1);
    });
  });

  describe('la academia sale de la sesión', () => {
    it('criterio 18: ?academiaId=<B> en la dirección no cambia nada: la renovación se hace en A, con los datos de A, y B no cambia', async () => {
      const antesDeB = await instantaneaDeLaAcademia(esc.e.B.id);
      const direccion = (ruta: string) => `${ruta}?academiaId=${esc.e.B.id}`;
      const cuerpo = cuerpoEfectivoRenovacion(seleccionDeDiciembre(esc), '120.00');

      const oferta = await ctx.http.get(direccion(`/api/alumnos/${deA.alumnoId}/renovacion`), {
        cookie: cookies.secretaria,
      });
      const efectivo = await ctx.http.post(direccion(`/api/alumnos/${deA.alumnoId}/renovacion/efectivo`), cuerpo, {
        cookie: cookies.secretaria,
      });
      const deBConParametro = await ctx.http.post(
        direccion(`/api/alumnos/${deB.alumnoId}/renovacion/cotizacion`),
        cuerpoCotizacionRenovacion(seleccionDeDiciembre(esc)),
        { cookie: cookies.secretaria },
      );

      expect(oferta.status, oferta.texto).toBe(200);
      expect(efectivo.status, efectivo.texto).toBe(201);
      expect(resumen(deBConParametro), deBConParametro.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(await cuantasDelMes(esc.e.A.id, deA.alumnoId, DICIEMBRE)).toBe(1);
      expect(await instantaneaDeLaAcademia(esc.e.B.id)).toBe(antesDeB);
    });

    it('criterio 18: ?academiaId=<B> en el comprobante tampoco cambia nada: se registra en A', async () => {
      const antesDeB = await instantaneaDeLaAcademia(esc.e.B.id);

      const respuesta = await renovarConComprobante(ctx, deA.alumnoId, {
        cookie: cookies.secretaria,
        ruta: `${rutaRenovacionComprobante(deA.alumnoId)}?academiaId=${esc.e.B.id}`,
        datos: datosComprobanteRenovacion(seleccionDeDiciembre(esc), '120.00', '2026-11-27'),
      });

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await cuantasDelMes(esc.e.A.id, deA.alumnoId, DICIEMBRE)).toBe(1);
      expect(await instantaneaDeLaAcademia(esc.e.B.id)).toBe(antesDeB);
    });

    it('criterio 18: una cabecera X-Academia-Id o un academiaId en el cuerpo no cambia la academia: el cuerpo con academiaId responde 400 y el de la cabecera se ignora', async () => {
      const sinCampo = await ctx.http.post(
        `/api/alumnos/${deA.alumnoId}/renovacion/efectivo`,
        cuerpoEfectivoRenovacion(seleccionDeDiciembre(esc), '120.00', { academiaId: esc.e.B.id }),
        { cookie: cookies.secretaria },
      );
      const conCabecera = await ctx.http.post(
        `/api/alumnos/${deA.alumnoId}/renovacion/efectivo`,
        cuerpoEfectivoRenovacion(seleccionDeDiciembre(esc), '120.00'),
        { cookie: cookies.secretaria, headers: { 'x-academia-id': esc.e.B.id } },
      );

      expect(resumen(sinCampo), sinCampo.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
      expect(conCabecera.status, conCabecera.texto).toBe(201);
      expect(await cuantasDelMes(esc.e.A.id, deA.alumnoId, DICIEMBRE)).toBe(1);
      expect(await cuantasDelMes(esc.e.B.id, deB.alumnoId, DICIEMBRE)).toBe(0);
    });
  });
});
