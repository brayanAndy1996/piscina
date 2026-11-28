// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fijarConfiguracion } from '../../utilidades/configuracion';
import { en, enLima } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  consultarSolicitud,
  cotizarPublico,
  cuerpoDeCotizacion,
  cuerpoParaMes,
  cuposDe,
  enviarPublico,
  type EscenarioMesSiguiente,
  INSTANTE,
  MES_DIC,
  mesesDe,
  pedirFormulario,
  pedirMeses,
  prepararEscenarioDeMesSiguiente,
} from '../../utilidades/escenario-mes-siguiente';
import { instantaneaDeLaAcademia } from '../../utilidades/escenario-pagos';
import { DICIEMBRE, sembrarTitulares } from '../../utilidades/escenario-renovacion';
import {
  codigoDe,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  ocupacionDeClase,
  solicitudDe,
} from '../../utilidades/inscripciones';
import { dniInventado } from '../../utilidades/usuarios';

// Criterio 13 (crítico, D-23, D-27): con A y B, el mismo DNI y clases a la misma hora: `/a/{A}/inscripcion/meses` usa la configuración de A (A con N = 5 y B con N = 10: el 23/11 solo B ofrece diciembre); las reservas de prioridad y la ocupación de M+1 solo cuentan matrículas de A; un plan o una clase de B en la cotización o el envío para M+1 responde como inexistente
// (`PLAN_NO_DISPONIBLE`, `SELECCION_NO_VALIDA`) sin leer ni escribir nada de B; el token de una solicitud de M+1 de B no sirve en A; `?academiaId=` no cambia nada.

describe('el aislamiento entre academias en la inscripción al mes siguiente (criterio 13)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioMesSiguiente;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeMesSiguiente(ctx);
    ctx.correo.mensajes.length = 0;
    en(ctx, esc, INSTANTE.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const B = () => esc.e.B.id;
  const clasesDeB = () => [esc.e.lunesB, esc.e.miercolesB, esc.e.viernesB];
  const ambas = async () => ({ a: await instantaneaDeLaAcademia(A()), b: await instantaneaDeLaAcademia(B()) });

  it('criterio 13: A con N = 5 y B con N = 10: el 23/11 solo B ofrece diciembre; cada una con su propia configuración, también en la petición siguiente a un cambio', async () => {
    await fijarConfiguracion(B(), { diasPrioridadRenovacion: 10 });
    en(ctx, esc, enLima('2026-11-23', '10:00'));

    const deA = mesesDe(await pedirMeses(ctx, 'academia-a'));
    const deB = mesesDe(await pedirMeses(ctx, 'academia-b'));

    expect(deA.meses.map((m) => m.mes)).toEqual(['2026-11']);
    expect(deA.aperturaMesSiguiente).toBe('2026-11-26');
    expect(deB.meses.map((m) => m.mes)).toEqual(['2026-11', '2026-12']);
    expect(deB.aperturaMesSiguiente).toBeNull();
  });

  it('criterio 13: el 23/11 el formulario y el envío para diciembre de B funcionan y los de A responden como fuera de la ventana (200 vacío y 409 MES_CAMBIO)', async () => {
    await fijarConfiguracion(B(), { diasPrioridadRenovacion: 10 });
    en(ctx, esc, enLima('2026-11-23', '10:00'));

    const formularioA = await pedirFormulario(ctx, `?mes=${MES_DIC}`, 'academia-a');
    const formularioB = await pedirFormulario(ctx, `?mes=${MES_DIC}`, 'academia-b');
    const envioA = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC));
    const envioB = await enviarPublico(
      ctx,
      await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.e.planB, clases: clasesDeB() }),
      { nombreCorto: 'academia-b' },
    );

    expect(formularioA.body?.['clases']).toEqual([]);
    expect(formularioB.body?.['mes']).toBe(MES_DIC);
    expect(cuposDe(formularioB, esc.e.lunesB.id)).toBe(20);
    expect([envioA.status, codigoDe(envioA)], envioA.texto).toEqual([409, 'MES_CAMBIO']);
    expect(envioB.status, envioB.texto).toBe(201);
  });

  it('criterio 13: las reservas de prioridad y la ocupación de diciembre solo cuentan matrículas de A: con 20 titulares y diciembre ocupado en la clase de B, la misma clase de A (sábado 10:00) solo descuenta lo suyo', async () => {
    await sembrarTitulares(B(), esc.planUnDiaB.id, 20, { claseIds: [esc.cB.id] });
    await sembrarTitulares(B(), esc.planUnDiaB.id, 5, { claseIds: [esc.cB.id], mes: DICIEMBRE });
    await sembrarTitulares(A(), esc.planUnDia.id, 3, { claseIds: [esc.c.id] });
    await sembrarTitulares(A(), esc.planUnDia.id, 2, { claseIds: [esc.c.id], mes: DICIEMBRE });

    const deA = await pedirFormulario(ctx, `?mes=${MES_DIC}`, 'academia-a');
    const deB = await pedirFormulario(ctx, `?mes=${MES_DIC}`, 'academia-b');

    expect(cuposDe(deA, esc.c.id), '20 − 2 de diciembre − 3 titulares de A').toBe(15);
    expect(cuposDe(deB, esc.cB.id), 'B: 20 titulares y 5 de diciembre: sin lugar').toBeUndefined();
    expect(await ocupacionDeClase(A(), esc.c.id, DICIEMBRE, INSTANTE.viernes27)).toBe(2);
    expect(await ocupacionDeClase(B(), esc.cB.id, DICIEMBRE, INSTANTE.viernes27)).toBe(5);
  });

  it('criterio 13: la clase de B a la misma hora con todos sus lugares apartados no afecta a A: el mismo DNI se inscribe para diciembre en A (201) y en B recibe SIN_CUPO, sin que se toquen', async () => {
    const dni = dniInventado();
    await sembrarTitulares(B(), esc.planUnDiaB.id, 20, { claseIds: [esc.cB.id] });
    const deA = await enviarPublico(
      ctx,
      await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDia, clases: [esc.c], sobre: { alumno: { dni } } }),
    );
    const deB = await enviarPublico(
      ctx,
      await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDiaB, clases: [esc.cB], sobre: { alumno: { dni } } }),
      { nombreCorto: 'academia-b' },
    );

    expect(deA.status, deA.texto).toBe(201);
    expect([deB.status, codigoDe(deB)], deB.texto).toEqual([409, 'SIN_CUPO']);
    expect((await leerAlumnos(A())).filter((a) => a.dni === dni)).toHaveLength(1);
    expect((await leerAlumnos(B())).filter((a) => a.dni === dni)).toEqual([]);
  });

  describe('un plan o una clase de B en la cotización o el envío para M+1 de A', () => {
    it('criterio 13: la cotización con el plan de B responde 409 PLAN_NO_DISPONIBLE y con una clase de B, 409 SELECCION_NO_VALIDA, sin leer ni escribir nada de B', async () => {
      const antes = await ambas();

      const conPlanDeB = await cotizarPublico(
        ctx,
        cuerpoDeCotizacion({
          planId: esc.e.planB.id,
          claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
          mes: MES_DIC,
        }),
      );
      const conClaseDeB = await cotizarPublico(
        ctx,
        cuerpoDeCotizacion({
          planId: esc.e.plan.id,
          claseIds: [esc.e.lunesB.id, esc.e.miercoles.id, esc.e.viernes.id],
          mes: MES_DIC,
        }),
      );

      expect([conPlanDeB.status, codigoDe(conPlanDeB)], conPlanDeB.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
      expect([conClaseDeB.status, codigoDe(conClaseDeB)], conClaseDeB.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
      expect(await ambas()).toEqual(antes);
    });

    it('criterio 13: el envío con el plan de B responde 409 PLAN_NO_DISPONIBLE, con una clase de B 409 SELECCION_NO_VALIDA y con un plan inexistente lo mismo que con el de B (el mismo cuerpo), sin escribir nada', async () => {
      const antes = await ambas();

      const conPlanDeB = await enviarPublico(
        ctx,
        await cuerpoParaMes(esc.e, MES_DIC, { sobre: { inscripcion: { planId: esc.e.planB.id } } }),
      );
      const conPlanInexistente = await enviarPublico(
        ctx,
        await cuerpoParaMes(esc.e, MES_DIC, {
          sobre: { inscripcion: { planId: '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f' } },
        }),
      );
      const conClaseDeB = await enviarPublico(
        ctx,
        await cuerpoParaMes(esc.e, MES_DIC, { clases: [esc.e.lunesB, esc.e.miercoles, esc.e.viernes] }),
      );

      expect([conPlanDeB.status, codigoDe(conPlanDeB)], conPlanDeB.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
      expect(conPlanInexistente.texto.replaceAll(/[0-9a-f-]{36}/g, '<id>')).toBe(
        conPlanDeB.texto.replaceAll(/[0-9a-f-]{36}/g, '<id>'),
      );
      expect([conClaseDeB.status, codigoDe(conClaseDeB)], conClaseDeB.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
      expect(await ambas()).toEqual(antes);
    });

    it('criterio 13: la lista de clases de diciembre de A no menciona ninguna clase ni plan de B', async () => {
      const respuesta = await pedirFormulario(ctx, `?mes=${MES_DIC}`, 'academia-a');

      for (const id of [esc.e.planB.id, esc.planUnDiaB.id, esc.cB.id, esc.e.lunesB.id])
        expect(respuesta.texto).not.toContain(id);
    });
  });

  describe('el token de una solicitud de M+1', () => {
    it('criterio 13: el token de una solicitud de diciembre de B no sirve en A: 404 SOLICITUD_NO_ENCONTRADA igual que un token inexistente; en B sí se ve', async () => {
      const deB = await enviarPublico(
        ctx,
        await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.e.planB, clases: clasesDeB() }),
        { nombreCorto: 'academia-b' },
      );
      expect(deB.status, deB.texto).toBe(201);
      const token = solicitudDe(deB).token;

      const enA = await consultarSolicitud(ctx, token, 'academia-a');
      const inexistente = await consultarSolicitud(ctx, 'A'.repeat(43), 'academia-a');
      const enB = await consultarSolicitud(ctx, token, 'academia-b');

      expect([enA.status, codigoDe(enA)], enA.texto).toEqual([404, 'SOLICITUD_NO_ENCONTRADA']);
      expect(enA.texto).toBe(inexistente.texto);
      expect(enB.status, enB.texto).toBe(200);
      expect(await leerSolicitudes(A())).toEqual([]);
      expect(await leerMatriculas(A())).toEqual([]);
      expect((await leerMatriculas(B())).filter((m) => m.mes === 12)).toHaveLength(1);
    });
  });

  describe('`?academiaId=` no cambia nada', () => {
    it('criterio 13: en la lectura de los meses, el formulario con `?mes=` y la cotización, un `academiaId` (o un nombre corto) en la consulta se ignora: la academia es la de la dirección', async () => {
      await fijarConfiguracion(B(), { diasPrioridadRenovacion: 10 });
      en(ctx, esc, enLima('2026-11-23', '10:00'));

      const meses = await ctx.http.get(`/api/a/academia-a/inscripcion/meses?academiaId=${B()}&nombreCorto=academia-b`);
      const formulario = await ctx.http.get(`/api/a/academia-a/inscripcion?mes=${MES_DIC}&academiaId=${B()}`);
      const cotizacion = await ctx.http.post(
        `/api/a/academia-a/inscripcion/cotizacion?academiaId=${B()}`,
        cuerpoDeCotizacion({ planId: esc.e.planB.id, claseIds: clasesDeB().map((c) => c.id), mes: '2026-11' }),
      );

      expect(
        mesesDe(meses).meses.map((m) => m.mes),
        'la configuración es la de A',
      ).toEqual(['2026-11']);
      expect(formulario.status, formulario.texto).toBe(200);
      expect(formulario.body?.['clases']).toEqual([]);
      expect([cotizacion.status, codigoDe(cotizacion)], cotizacion.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
    });

    it('criterio 13: un `academiaId` en el cuerpo de la cotización o del envío es 400 SOLICITUD_INVALIDA, también con `mes` de diciembre', async () => {
      const cotizacion = await cotizarPublico(
        ctx,
        cuerpoDeCotizacion(
          { planId: esc.e.plan.id, claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id], mes: MES_DIC },
          { academiaId: B() },
        ),
      );
      const envio = await enviarPublico(ctx, { ...(await cuerpoParaMes(esc.e, MES_DIC)), academiaId: B() });

      for (const respuesta of [cotizacion, envio]) {
        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
      }
    });
  });
});
