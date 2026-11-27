// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enLima } from '../../utilidades/caja';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  cotizarRenovacion,
  crearAlumnoVencido,
  cuerpoCotizacionRenovacion,
  detallesDe,
  INSTANTES,
  instantaneaDeRenovacion,
  MES_DICIEMBRE,
  MES_NOVIEMBRE,
  prepararEscenarioDeRenovacion,
  resumen,
  seleccionDeDiciembre,
} from '../../utilidades/escenario-renovacion';
import { crearPlanYClaseSabado, llenarClase, retenerClases } from '../../utilidades/inscripciones';
import { abrirRetenedor, conLimite, crearPlanDePrueba, type PlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 5 (crítico, RN-25, HU-34, D-03, DR-3): `POST /api/alumnos/{id}/renovacion/cotizacion` con `{ mes, planId, claseIds }` responde `{ cotizacion }` (`cotizacionSchema` de 005): `clasesTotales = min(clasesRestantes(clases, desde), clasesPorMes)`,
// con `desde` igual a las 00:00 de Lima del día 1 de M+1 o a «ahora» para M (la clase de hoy cuenta si todavía no empezó, como en la 005); `monto = montoProporcional(precio, clasesPorMes, clasesTotales)` redondeado hacia arriba al sol entero, una sola vez,
// al final; `esProporcional` es `clasesRestantes < clasesPorMes`; `fechaInicio` es el día 1 de M+1, u hoy para M; `fechaFin`, el último día del mes. No bloquea, no comprueba el cupo y no escribe (DT-21). Ejemplos: plan de S/ 120.00 y 12 clases,
// lunes, miércoles y viernes, para diciembre de 2026 (13 ocurrencias, tope 12): S/ 120, no proporcional; renovación tardía el jueves 26/11/2026 a las 10:00 con esas clases a las 18:00 (quedan el viernes 27 y el lunes 30): `120 ÷ 12 × 2` = S/ 20; plan de
// S/ 100 y 12 clases con 5 restantes: S/ 42. Sin clases restantes en M: 409 `SIN_CLASES_EN_EL_MES`. La matrícula guarda `precio_plan`, `clases_por_mes_plan`, `clases_totales`, `monto_calculado` y `es_proporcional` y el pago y la caja usan el total de lo
// guardado: eso se prueba en `renovacion-efectivo.test.ts` y `renovacion-comprobante.test.ts`.
// Lecturas estrictas elegidas: (1) `clasesRestantes` de la cotización es el conteo sin el tope (13 en diciembre, como en la cotización de la 005) y `clasesTotales` el conteo con el tope (12); (2) una clase que empieza exactamente en «ahora» ya no cuenta
// (la 005: empieza después de «ahora»); (3) la cotización de diciembre con un plan de más clases que ocurrencias (5 clases, 4 sábados) es proporcional desde el día 1 (DR-3); (4) la cotización no comprueba `MENSUALIDAD_YA_REGISTRADA` ni el cupo: es informativa.

const CLAVES_DE_LA_COTIZACION = [
  'clasesPorMes',
  'clasesRestantes',
  'clasesTotales',
  'esProporcional',
  'fechaFin',
  'fechaInicio',
  'mes',
  'monto',
  'precioPlan',
];

describe('la cotización de la renovación (criterio 5)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let plan100: PlanDePrueba;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    plan100 = await crearPlanDePrueba(esc.e.A.id, {
      nombre: 'Plan de S/ 100',
      veces_por_semana: 3,
      clases_por_mes: 12,
      precio: '100.00',
      dias_permitidos: [1, 3, 5],
      franjas_permitidas: ['17:00', '18:00', '19:00'],
      niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
    });
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const cotizar = async (instante: Date, sel: Parameters<typeof cuerpoCotizacionRenovacion>[0], alumnoId: string) => {
    const cookies = en(ctx, esc, instante);
    return cotizarRenovacion(ctx, cookies.secretaria, alumnoId, cuerpoCotizacionRenovacion(sel));
  };

  /** La cotización de una respuesta 200: `{ cotizacion }` y nada más. */
  function cotizacionDe(respuesta: { status: number; body: Record<string, unknown> | null; texto: string }) {
    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(Object.keys(respuesta.body ?? {}), 'el cuerpo es solo { cotizacion }').toEqual(['cotizacion']);
    const cotizacion = respuesta.body?.['cotizacion'] as Record<string, unknown>;
    expect(Object.keys(cotizacion).sort()).toEqual(CLAVES_DE_LA_COTIZACION);
    return cotizacion;
  }

  it('criterio 5: diciembre de 2026 con el plan de S/ 120.00 y los lunes, miércoles y viernes: 13 ocurrencias, tope 12, S/ 120.00 y no proporcional', async () => {
    const alumno = await crearAlumnoVencido(ctx, esc);

    const respuesta = await cotizar(INSTANTES.jueves26, seleccionDeDiciembre(esc), alumno.alumnoId);

    expect(cotizacionDe(respuesta)).toEqual({
      mes: MES_DICIEMBRE,
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

  it('criterio 5: renovación tardía el jueves 26/11 a las 10:00 con las clases de las 18:00 (quedan el viernes 27 y el lunes 30): 120 ÷ 12 × 2 = S/ 20.00, proporcional, desde hoy', async () => {
    const alumno = await crearAlumnoVencido(ctx, esc);

    const respuesta = await cotizar(
      INSTANTES.jueves26,
      seleccionDeDiciembre(esc, { mes: MES_NOVIEMBRE }),
      alumno.alumnoId,
    );

    expect(cotizacionDe(respuesta)).toEqual({
      mes: MES_NOVIEMBRE,
      fechaInicio: '2026-11-26',
      fechaFin: '2026-11-30',
      clasesRestantes: 2,
      clasesTotales: 2,
      clasesPorMes: 12,
      precioPlan: '120.00',
      monto: '20.00',
      esProporcional: true,
    });
  });

  it('criterio 5: plan de S/ 100.00 y 12 clases con 5 restantes (viernes 20/11 a las 10:00: 20, 23, 25, 27 y 30): 100 ÷ 12 × 5 = 41.67, hacia arriba al sol entero, una vez: S/ 42.00', async () => {
    const alumno = await crearAlumnoVencido(ctx, esc);
    const viernes20 = enLima('2026-11-20', '10:00');

    const respuesta = await cotizar(
      viernes20,
      seleccionDeDiciembre(esc, { mes: MES_NOVIEMBRE, planId: plan100.id }),
      alumno.alumnoId,
    );

    expect(cotizacionDe(respuesta)).toMatchObject({
      clasesRestantes: 5,
      clasesTotales: 5,
      precioPlan: '100.00',
      monto: '42.00',
      esProporcional: true,
      fechaInicio: '2026-11-20',
    });
  });

  it('criterio 5: el redondeo es hacia arriba al sol entero y una sola vez: S/ 100.00 con 1 de 12 clases son S/ 9.00 (8.33) y con 7 de 12, S/ 59.00 (58.33)', async () => {
    const alumno = await crearAlumnoVencido(ctx, esc);
    // El lunes 30/11 a las 10:00 solo queda la clase de ese lunes (1); el lunes 16/11 a las 10:00 quedan 16, 18, 20, 23, 25, 27 y 30 (7).
    const unaSola = await cotizar(
      enLima('2026-11-30', '10:00'),
      seleccionDeDiciembre(esc, { mes: MES_NOVIEMBRE, planId: plan100.id }),
      alumno.alumnoId,
    );
    const siete = await cotizar(
      enLima('2026-11-16', '10:00'),
      seleccionDeDiciembre(esc, { mes: MES_NOVIEMBRE, planId: plan100.id }),
      alumno.alumnoId,
    );

    expect(cotizacionDe(unaSola)).toMatchObject({ clasesTotales: 1, monto: '9.00' });
    expect(cotizacionDe(siete)).toMatchObject({ clasesTotales: 7, monto: '59.00' });
  });

  it('criterio 5: la clase de hoy cuenta si todavía no empezó (sábado 28/11 a las 17:59:59.999, clase de las 18:00: 1 restante, S/ 10.00) y ya no cuenta si empieza en «ahora» (409 SIN_CLASES_EN_EL_MES)', async () => {
    const { plan, clase } = await crearPlanYClaseSabado(esc.e);
    const alumno = await crearAlumnoVencido(ctx, esc);
    const sel = { mes: MES_NOVIEMBRE, planId: plan.id, claseIds: [clase.id] };

    const antes = await cotizar(enLima('2026-11-28', '17:59:59.999'), sel, alumno.alumnoId);
    const justo = await cotizar(enLima('2026-11-28', '18:00:00.000'), sel, alumno.alumnoId);

    expect(cotizacionDe(antes)).toMatchObject({
      clasesRestantes: 1,
      clasesTotales: 1,
      monto: '10.00',
      esProporcional: true,
    });
    expect(resumen(justo), justo.texto).toEqual([409, 'SIN_CLASES_EN_EL_MES']);
  });

  it('criterio 5: sin clases restantes en M (lunes 30/11 a las 19:00, después de la última clase de las 18:00): 409 SIN_CLASES_EN_EL_MES', async () => {
    const alumno = await crearAlumnoVencido(ctx, esc);
    const antes = await instantaneaDeRenovacion(ctx, esc);

    const respuesta = await cotizar(
      enLima('2026-11-30', '19:00'),
      seleccionDeDiciembre(esc, { mes: MES_NOVIEMBRE }),
      alumno.alumnoId,
    );

    expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SIN_CLASES_EN_EL_MES']);
    expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
  });

  it('criterio 5 y DR-3: el mes siguiente se cotiza desde el día 1 aunque hoy sea 30/11 a las 23:59:59.999: diciembre con un plan de 5 clases y 4 sábados es proporcional (4 de 5 = S/ 40.00 con S/ 50.00)', async () => {
    const { clase } = await crearPlanYClaseSabado(esc.e);
    const planDeCinco = await crearPlanDePrueba(esc.e.A.id, {
      nombre: 'Plan de los sábados, 5 clases',
      veces_por_semana: 1,
      clases_por_mes: 5,
      precio: '50.00',
      dias_permitidos: [6],
      franjas_permitidas: ['18:00'],
      niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
    });
    const alumno = await crearAlumnoVencido(ctx, esc);

    const respuesta = await cotizar(
      INSTANTES.ultimoDeLaVentana,
      { mes: MES_DICIEMBRE, planId: planDeCinco.id, claseIds: [clase.id] },
      alumno.alumnoId,
    );

    expect(cotizacionDe(respuesta)).toEqual({
      mes: MES_DICIEMBRE,
      fechaInicio: '2026-12-01',
      fechaFin: '2026-12-31',
      clasesRestantes: 4,
      clasesTotales: 4,
      clasesPorMes: 5,
      precioPlan: '50.00',
      monto: '40.00',
      esProporcional: true,
    });
  });

  it('criterio 5 (DT-21): no escribe ni audita, no necesita la caja abierta, no comprueba el cupo (una clase llena se cotiza igual) y no bloquea (con las clases y la fila del alumno retenidas responde sin esperar)', async () => {
    await llenarClase(esc.e.A.id, esc.e.lunes.id, esc.e.plan.id, 20, { mes: { anio: 2026, mes: 12 } });
    const alumno = await crearAlumnoVencido(ctx, esc);
    const cookies = en(ctx, esc, INSTANTES.jueves26);
    const antes = await instantaneaDeRenovacion(ctx, esc);
    const retenedor = await abrirRetenedor(esc.e.A.id);
    try {
      await retenerClases([esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id], esc.e.A.id)(retenedor);
      await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
        esc.e.A.id,
        alumno.alumnoId,
      ]);

      const respuesta = await conLimite(
        cotizarRenovacion(
          ctx,
          cookies.secretaria,
          alumno.alumnoId,
          cuerpoCotizacionRenovacion(seleccionDeDiciembre(esc)),
        ),
        'la cotización esperó un bloqueo: no debe bloquear nada',
      );

      expect(cotizacionDe(respuesta)).toMatchObject({ monto: '120.00' });
    } finally {
      await retenedor.liberar('ROLLBACK');
    }
    expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
  });

  it('criterio 5: una cotización con una selección que no cumple el plan responde SELECCION_NO_VALIDA y con un plan que no existe, PLAN_NO_DISPONIBLE (las mismas reglas del registro); un mes que no se permite, MES_NO_PERMITIDO', async () => {
    const alumno = await crearAlumnoVencido(ctx, esc);

    const dosEnElMismoDia = await cotizar(
      INSTANTES.jueves26,
      seleccionDeDiciembre(esc, { claseIds: [esc.e.lunes.id, esc.e.lunes17.id, esc.e.viernes.id] }),
      alumno.alumnoId,
    );
    const sinPlan = await cotizar(
      INSTANTES.jueves26,
      seleccionDeDiciembre(esc, { planId: '00000000-0000-4000-8000-000000000000' }),
      alumno.alumnoId,
    );
    const enero = await cotizar(INSTANTES.jueves26, seleccionDeDiciembre(esc, { mes: '2027-01' }), alumno.alumnoId);

    expect(resumen(dosEnElMismoDia), dosEnElMismoDia.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
    expect(resumen(sinPlan), sinPlan.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
    expect(resumen(enero), enero.texto).toEqual([409, 'MES_NO_PERMITIDO']);
    expect(detallesDe(enero)['mesesPermitidos']).toEqual([MES_NOVIEMBRE, MES_DICIEMBRE]);
  });
});
