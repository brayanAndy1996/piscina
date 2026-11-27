// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, enLima } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  cotizarPublico,
  cuerpoDeCotizacion,
  type EscenarioMesSiguiente,
  INSTANTE,
  MES_DIC,
  MES_ENE_2027,
  MES_NOV,
  prepararEscenarioDeMesSiguiente,
} from '../../utilidades/escenario-mes-siguiente';
import { instantaneaDeLaAcademia } from '../../utilidades/escenario-pagos';
import { DICIEMBRE } from '../../utilidades/escenario-renovacion';
import {
  camposConError,
  codigoDe,
  conRetencion,
  cotizacionEsperada,
  detallesDe,
  llenarClase,
  retenerClases,
} from '../../utilidades/inscripciones';
import { crearPlanDePrueba } from '../../utilidades/planes-clases';
import { contarAuditoria } from '../../utilidades/usuarios';

// Criterio 3 (crítico, HU-34, RN-25, D-03, DR-1 y DR-3 de 010): `POST /api/a/{nombreCorto}/inscripcion/cotizacion` admite `mes` opcional (`{ planId, nivel, claseIds, mes? }`, estricto). Sin `mes`, o con `mes` igual a M, es el criterio 11 de 005. Con M+1 y la ventana
// abierta aplica el plan disponible para M+1 (409 `PLAN_NO_DISPONIBLE`), las reglas de selección (409 `SELECCION_NO_VALIDA`) y la cotización del mes siguiente (desde el día 1, tope del plan, redondeo hacia arriba una sola vez). Con otro mes, 409 `MES_CAMBIO` con
// `detalles.mes` igual a M. Ejemplos con `Decimal`: plan de S/ 120.00 y 12 clases, lunes, miércoles y viernes, para diciembre de 2026 (13 ocurrencias, tope 12): `clasesTotales` 12, S/ 120, no proporcional, `fechaInicio` `2026-12-01`; el 28/01/2027, plan de S/ 100.00 y
// 13 clases, lunes, miércoles y viernes, para febrero de 2027 (12 ocurrencias): `100 × 12 ÷ 13` = 92.31 → S/ 93, proporcional. No escribe, no bloquea y no comprueba el cupo.

describe('la cotización del mes siguiente (criterio 3)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioMesSiguiente;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeMesSiguiente(ctx);
    en(ctx, esc, INSTANTE.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const clasesDeLaSemana = () => [esc.e.lunes, esc.e.miercoles, esc.e.viernes];
  const cuerpo = (mes?: unknown, sobre: Record<string, unknown> = {}) =>
    cuerpoDeCotizacion({ planId: esc.e.plan.id, claseIds: clasesDeLaSemana().map((c) => c.id), mes }, sobre);
  const cotizacionDe = (respuesta: { status: number; body: Record<string, unknown> | null; texto: string }) => {
    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(Object.keys(respuesta.body ?? {})).toEqual(['cotizacion']);
    return respuesta.body?.['cotizacion'] as Record<string, unknown>;
  };

  describe('diciembre con el plan de S/ 120.00 (13 ocurrencias, tope 12)', () => {
    it('criterio 3: el 27/11 con `mes: 2026-12` cotiza desde el día 1: 12 clases, S/ 120.00, no proporcional, fechaInicio 2026-12-01 y fechaFin 2026-12-31', async () => {
      const respuesta = await cotizarPublico(ctx, cuerpo(MES_DIC));

      expect(cotizacionDe(respuesta)).toEqual({
        mes: '2026-12',
        fechaInicio: '2026-12-01',
        fechaFin: '2026-12-31',
        clasesRestantes: 13,
        clasesTotales: 12,
        clasesPorMes: 12,
        precioPlan: '120.00',
        monto: '120.00',
        esProporcional: false,
      });
    });

    it('criterio 3: el resultado no depende del instante dentro de la ventana: el 26/11 a las 00:00:00.000 y el 30/11 a las 23:59:59.999 dan la misma cotización de diciembre', async () => {
      const esperada = {
        mes: '2026-12',
        fechaInicio: '2026-12-01',
        clasesRestantes: 13,
        clasesTotales: 12,
        monto: '120.00',
        esProporcional: false,
      };
      for (const instante of [INSTANTE.primeroDeLaVentana, INSTANTE.ultimoDeLaVentana]) {
        en(ctx, esc, instante);
        const respuesta = await cotizarPublico(ctx, cuerpo(MES_DIC));
        expect(cotizacionDe(respuesta), instante.toISOString()).toMatchObject(esperada);
      }
    });

    it('criterio 3: sin `mes` y con `mes` igual a M es la cotización de la 005 (desde hoy: el viernes 27 a las 10:00 quedan el viernes 27 y el lunes 30)', async () => {
      const sin = await cotizarPublico(ctx, cuerpo());
      const conM = await cotizarPublico(ctx, cuerpo(MES_NOV));

      const esperada = cotizacionEsperada(esc.e.plan, clasesDeLaSemana(), INSTANTE.viernes27);
      expect(esperada).toMatchObject({ mes: '2026-11', clasesRestantes: 2, clasesTotales: 2, monto: '20.00' });
      expect(cotizacionDe(sin)).toEqual(esperada);
      expect(cotizacionDe(conM)).toEqual(esperada);
    });
  });

  describe('el tope del plan y el redondeo hacia arriba una sola vez (D-03)', () => {
    it('criterio 3: el 28/01/2027, plan de S/ 100.00 y 13 clases, lunes, miércoles y viernes, para febrero de 2027 (12 ocurrencias): 100 × 12 ÷ 13 = 92.31 → S/ 93.00 proporcional', async () => {
      const plan = await crearPlanDePrueba(A(), {
        nombre: 'Plan de 13 clases',
        veces_por_semana: 3,
        clases_por_mes: 13,
        precio: '100.00',
        dias_permitidos: [1, 3, 5],
        franjas_permitidas: ['18:00'],
        niveles_aplicables: ['BASICO'],
      });
      en(ctx, esc, enLima('2027-01-28', '10:00'));

      const respuesta = await cotizarPublico(
        ctx,
        cuerpoDeCotizacion({ planId: plan.id, claseIds: clasesDeLaSemana().map((c) => c.id), mes: '2027-02' }),
      );

      expect(cotizacionDe(respuesta)).toEqual({
        mes: '2027-02',
        fechaInicio: '2027-02-01',
        fechaFin: '2027-02-28',
        clasesRestantes: 12,
        clasesTotales: 12,
        clasesPorMes: 13,
        precioPlan: '100.00',
        monto: '93.00',
        esProporcional: true,
      });
    });

    it('criterio 3: un precio con céntimos se redondea hacia arriba al sol una sola vez (S/ 120.50 con el mes completo → S/ 121.00)', async () => {
      const plan = await crearPlanDePrueba(A(), {
        nombre: 'Plan con céntimos',
        veces_por_semana: 3,
        clases_por_mes: 12,
        precio: '120.50',
        dias_permitidos: [1, 3, 5],
        franjas_permitidas: ['18:00'],
        niveles_aplicables: ['BASICO'],
      });

      const respuesta = await cotizarPublico(
        ctx,
        cuerpoDeCotizacion({ planId: plan.id, claseIds: clasesDeLaSemana().map((c) => c.id), mes: MES_DIC }),
      );

      expect(cotizacionDe(respuesta)).toMatchObject({ precioPlan: '120.50', monto: '121.00', esProporcional: false });
    });

    it('criterio 3: el monto es texto con dos decimales (`Decimal`), nunca un número de coma flotante', async () => {
      const respuesta = await cotizarPublico(ctx, cuerpo(MES_DIC));

      const cotizacion = cotizacionDe(respuesta);
      for (const clave of ['precioPlan', 'monto']) expect(typeof cotizacion[clave], clave).toBe('string');
      expect(cotizacion['monto']).toMatch(/^[0-9]+\.[0-9]{2}$/);
    });
  });

  describe('el plan, la selección y los meses que no son de inscripción', () => {
    it('criterio 3: un plan que vence el 30/11 está disponible para M pero no para M+1 (409 PLAN_NO_DISPONIBLE); uno que empieza el 1/12 al revés', async () => {
      const venceElTreinta = await crearPlanDePrueba(A(), {
        nombre: 'Vence el 30/11',
        veces_por_semana: 3,
        clases_por_mes: 12,
        precio: '120.00',
        dias_permitidos: [1, 3, 5],
        franjas_permitidas: ['18:00'],
        niveles_aplicables: ['BASICO'],
        vigencia_fin: '2026-11-30',
      });
      const empiezaElPrimero = await crearPlanDePrueba(A(), {
        nombre: 'Empieza el 1/12',
        veces_por_semana: 3,
        clases_por_mes: 12,
        precio: '130.00',
        dias_permitidos: [1, 3, 5],
        franjas_permitidas: ['18:00'],
        niveles_aplicables: ['BASICO'],
        vigencia_inicio: '2026-12-01',
      });
      const ids = clasesDeLaSemana().map((c) => c.id);
      const pedir = (planId: string, mes: string) =>
        cotizarPublico(ctx, cuerpoDeCotizacion({ planId, claseIds: ids, mes }));

      const venceEnDic = await pedir(venceElTreinta.id, MES_DIC);
      const venceEnNov = await pedir(venceElTreinta.id, MES_NOV);
      const empiezaEnDic = await pedir(empiezaElPrimero.id, MES_DIC);
      const empiezaEnNov = await pedir(empiezaElPrimero.id, MES_NOV);

      expect([venceEnDic.status, codigoDe(venceEnDic)], venceEnDic.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
      expect(venceEnNov.status, venceEnNov.texto).toBe(200);
      expect(empiezaEnDic.status, empiezaEnDic.texto).toBe(200);
      expect(cotizacionDe(empiezaEnDic)).toMatchObject({ precioPlan: '130.00', monto: '130.00' });
      expect([empiezaEnNov.status, codigoDe(empiezaEnNov)], empiezaEnNov.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
    });

    it('criterio 3: un plan que no existe, el de otra academia o uno desactivado responde 409 PLAN_NO_DISPONIBLE para M+1', async () => {
      const desactivado = await crearPlanDePrueba(A(), {
        nombre: 'Desactivado',
        activo: false,
        dias_permitidos: [1, 3, 5],
      });
      const ids = clasesDeLaSemana().map((c) => c.id);
      for (const planId of ['3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f', esc.e.planB.id, desactivado.id]) {
        const respuesta = await cotizarPublico(ctx, cuerpoDeCotizacion({ planId, claseIds: ids, mes: MES_DIC }));

        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
      }
    });

    it.each([
      ['un día que el plan no permite (martes)', () => [esc.e.martes.id]],
      [
        'una franja que el plan no permite (lunes a las 08:00)',
        () => [esc.e.lunes08.id, esc.e.miercoles.id, esc.e.viernes.id],
      ],
      ['otro nivel (lunes INTERMEDIO)', () => [esc.e.intermedioLunes.id, esc.e.miercoles.id, esc.e.viernes.id]],
      ['menos clases que las veces por semana', () => [esc.e.lunes.id]],
      ['una clase de otra academia', () => [esc.e.lunesB.id, esc.e.miercoles.id, esc.e.viernes.id]],
      ['una clase que no existe', () => ['3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f', esc.e.miercoles.id, esc.e.viernes.id]],
    ])('criterio 3: %s responde 409 SELECCION_NO_VALIDA para M+1', async (_nombre, claseIds) => {
      const respuesta = await cotizarPublico(
        ctx,
        cuerpoDeCotizacion({ planId: esc.e.plan.id, claseIds: claseIds(), mes: MES_DIC }),
      );

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
    });

    it.each([
      ['M+2 (enero de 2027) con la ventana abierta', MES_ENE_2027, INSTANTE.viernes27],
      ['un mes pasado (octubre)', '2026-10', INSTANTE.viernes27],
      ['el mes del año siguiente', '2027-11', INSTANTE.viernes27],
      ['M+1 con la ventana cerrada (el 25/11 a las 23:59:59.999)', MES_DIC, INSTANTE.antesDeLaVentana],
    ])('criterio 3: %s responde 409 MES_CAMBIO con `detalles.mes` igual a M', async (_nombre, mes, instante) => {
      en(ctx, esc, instante);

      const respuesta = await cotizarPublico(ctx, cuerpo(mes));

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MES_CAMBIO']);
      expect(detallesDe(respuesta)['mes']).toBe(MES_NOV);
    });

    it('criterio 3: el 1/12 a las 00:00:00.000 diciembre ya es M (cotiza desde hoy) y noviembre ya no es de inscripción (MES_CAMBIO con `detalles.mes` 2026-12)', async () => {
      en(ctx, esc, INSTANTE.martes1);

      const diciembre = await cotizarPublico(ctx, cuerpo(MES_DIC));
      const noviembre = await cotizarPublico(ctx, cuerpo(MES_NOV));

      expect(cotizacionDe(diciembre)).toEqual(cotizacionEsperada(esc.e.plan, clasesDeLaSemana(), INSTANTE.martes1));
      expect([noviembre.status, codigoDe(noviembre)], noviembre.texto).toEqual([409, 'MES_CAMBIO']);
      expect(detallesDe(noviembre)['mes']).toBe(MES_DIC);
    });

    it('criterio 3: el 31/12/2026 la cotización de enero de 2027 es la del mes siguiente en el cambio de año (13 ocurrencias, tope 12 → S/ 120.00, desde 2027-01-01)', async () => {
      en(ctx, esc, INSTANTE.jueves31dic);

      const respuesta = await cotizarPublico(ctx, cuerpo(MES_ENE_2027));

      expect(cotizacionDe(respuesta)).toMatchObject({
        mes: '2027-01',
        fechaInicio: '2027-01-01',
        fechaFin: '2027-01-31',
        clasesTotales: 12,
        monto: '120.00',
        esProporcional: false,
      });
    });
  });

  describe('el cuerpo es estricto', () => {
    it.each([
      ['sin guion', '202612'],
      ['mes 13', '2026-13'],
      ['mes de un dígito', '2026-1'],
      ['con día', '2026-12-01'],
      ['texto', 'diciembre'],
      ['un número', 202612],
      ['nulo', null],
      ['una lista', ['2026-12']],
    ])('criterio 3: `mes` %s responde 400 SOLICITUD_INVALIDA con el campo `mes` y no escribe', async (_nombre, mes) => {
      const antes = await instantaneaDeLaAcademia(A());

      const respuesta = await cotizarPublico(ctx, { ...cuerpo(), mes });

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
      expect(camposConError(respuesta)).toContain('mes');
      expect(await instantaneaDeLaAcademia(A())).toBe(antes);
    });

    it('criterio 3: una clave desconocida sigue siendo 400 (el cuerpo es estricto), también junto a un `mes` válido', async () => {
      const respuesta = await cotizarPublico(ctx, { ...cuerpo(MES_DIC), academiaId: esc.e.B.id });

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
    });
  });

  describe('no escribe, no bloquea y no comprueba el cupo', () => {
    it('criterio 3: con todos los lugares de diciembre ocupados (las tres clases llenas) la cotización de diciembre responde 200 igual, y no escribe, no audita y no envía correo', async () => {
      for (const clase of clasesDeLaSemana()) await llenarClase(A(), clase.id, esc.e.plan.id, 20, { mes: DICIEMBRE });
      const antes = await instantaneaDeLaAcademia(A());
      const auditoria = await contarAuditoria(A());

      const respuesta = await cotizarPublico(ctx, cuerpo(MES_DIC));

      expect(cotizacionDe(respuesta)).toMatchObject({ mes: '2026-12', monto: '120.00' });
      expect(await instantaneaDeLaAcademia(A())).toBe(antes);
      expect(await contarAuditoria(A())).toBe(auditoria);
      expect(ctx.correo.mensajes).toEqual([]);
    });

    it('criterio 3: la cotización de diciembre no espera el bloqueo de las clases que retiene otra transacción', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: A(),
        retener: retenerClases(
          clasesDeLaSemana().map((c) => c.id),
          A(),
        ),
        enviar: [() => cotizarPublico(ctx, cuerpo(MES_DIC))],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'la cotización no debe esperar a las clases').toBe(false);
      expect(resultados[0]?.status, resultados[0]?.texto).toBe(200);
      expect(resultados[0]?.body?.['cotizacion']).toMatchObject({ mes: '2026-12' });
    });
  });
});
