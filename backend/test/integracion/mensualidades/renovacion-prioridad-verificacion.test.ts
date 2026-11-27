// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { rutaAprobacion, rutaRechazo } from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  cotizarRenovacion,
  crearAlumnoVencido,
  cuerpoCotizacionRenovacion,
  detallesDe,
  DICIEMBRE,
  fijarAforo,
  INSTANTES,
  instantaneaDeRenovacion,
  matriculaDelMes,
  MES_DICIEMBRE,
  MES_NOVIEMBRE,
  NOVIEMBRE,
  pedirOferta,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
  resumen,
  sembrarTitulares,
  type OpcionesDeRegistro,
} from '../../utilidades/escenario-renovacion';
import { crearPlanYClaseSabado, ocupacionDeClase } from '../../utilidades/inscripciones';
import type { ClaseDePrueba, PlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 45 (crítico, ronda adversarial 2 de la 010a, R2-1; DR-12; D-06, RN-11, RN-28, HU-12, DT-3, DT-4): la matrícula del mes en curso en verificación no da prioridad. Solo es titular de c en M+1 quien tiene la matrícula de M `VIGENTE`, con el pago confirmado; una
// matrícula de M `RESERVADA` que espera la verificación de su pago no aparta lugar en M+1 ni cuenta en `reservas(c)`, y su alumno pide c en M+1 con el cupo libre de quien no es titular hasta que se apruebe ese pago. Una renovación de M+1 en verificación sigue ocupando cupo en M+1 y
// su alumno deja de ser titular. Escenario común (RELOJ fijo en la ventana, 27/11/2026, N = 5; caja abierta de hoy; c de los sábados con aforo 20): 18 titulares (noviembre `VIGENTE` en c); X1 y X2, sin prioridad, que ya renovaron diciembre en c (2 de 20); e Y, `ALUMNO_VENCIDO` sin
// matrícula de noviembre, que registra la renovación tardía de noviembre en c por Yape (201, `EN_VERIFICACION`; noviembre en 19 de 20). Casos: (a) Y no es titular mientras se verifica su pago; (b) al aprobarse el pago de noviembre, Y pasa a ser titular; (c) una renovación de diciembre en
// verificación cuenta para diciembre. En cada caso la ocupación de c en noviembre y en diciembre nunca pasa de 20.
// Lecturas estrictas elegidas: (1) «los 18 titulares renuevan c uno tras otro, cada uno con 201, también el último» (a) y «los primeros 17 con 201 y el último `SIN_CUPO`» (b) se prueban en el orden en que se sembraron los titulares; (2) en (c) las reservas de c (17) no se pueden leer
// directamente: se comprueban con la oferta de diciembre (el titular ve `aforo − ocupación(c, M+1)` = 17 y quien no es titular, 0) y con el SIN_CUPO de Y; (3) «no escribe nada» en el 409 de (a) es la instantánea completa de las academias y del almacén antes y después.

describe('la matrícula del mes en curso en verificación no da prioridad (criterio 45, DR-12)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let plan: PlanDePrueba;
  let clase: ClaseDePrueba;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    ({ plan, clase } = await crearPlanYClaseSabado(esc.e));
    await abrirCajaPara(esc, INSTANTES.viernes27);
    ctx.reloj.fijar(INSTANTES.viernes27);
    cookies = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  /** Una renovación de la clase c (plan de los sábados, S/ 40.00). */
  const delSabado = (via: 'EFECTIVO' | 'YAPE', alumnoId: string, opciones: OpcionesDeRegistro = {}) =>
    registrarRenovacion(ctx, esc, via, cookies.secretaria, alumnoId, {
      total: '40.00',
      fechaOperacion: '2026-11-27',
      ...opciones,
      seleccion: { planId: plan.id, claseIds: [clase.id], ...opciones.seleccion },
    });
  const ocupacion = (mes: { anio: number; mes: number }) =>
    ocupacionDeClase(esc.e.A.id, clase.id, mes, INSTANTES.viernes27);
  const cuposDe = async (alumnoId: string): Promise<{ cuposRestantes: number; conPrioridad: boolean } | undefined> => {
    const oferta = await pedirOferta(ctx, cookies.secretaria, alumnoId, MES_DICIEMBRE);
    expect(oferta.status, oferta.texto).toBe(200);
    return (
      oferta.body?.['clases'] as { id: string; cuposRestantes: number; conPrioridad: boolean }[] | undefined
    )?.find((c) => c.id === clase.id);
  };
  const renovarUnoTrasOtro = async (alumnoIds: readonly string[]): Promise<[number, string | undefined][]> => {
    const resultados: [number, string | undefined][] = [];
    for (const id of alumnoIds) resultados.push(resumen((await delSabado('EFECTIVO', id)).respuesta));
    return resultados;
  };
  const ok = (n: number): [number, string | undefined][] => Array.from({ length: n }, () => [201, undefined]);

  /**
   * El escenario común: c de aforo 20 con 18 titulares; X1 y X2 renuevan diciembre en efectivo sin prioridad (2 de 20); Y, vencido y sin noviembre,
   * registra la renovación tardía de noviembre en c por Yape (en verificación).
   */
  async function prepararEscenario() {
    await fijarAforo(esc.e.A.id, clase.id, 20);
    const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 18, { claseIds: [clase.id] });
    const x1 = await crearAlumnoVencido(ctx, esc);
    const x2 = await crearAlumnoVencido(ctx, esc);
    const y = await crearAlumnoVencido(ctx, esc);
    const sinPrioridad = await crearAlumnoVencido(ctx, esc);

    for (const x of [x1, x2]) {
      const deX = await delSabado('EFECTIVO', x.alumnoId);
      expect(deX.respuesta.status, deX.respuesta.texto).toBe(201);
    }
    expect(await ocupacion(DICIEMBRE)).toBe(2);

    const cotizacion = await cotizarRenovacion(
      ctx,
      cookies.secretaria,
      y.alumnoId,
      cuerpoCotizacionRenovacion({ mes: MES_NOVIEMBRE, planId: plan.id, claseIds: [clase.id] }),
    );
    expect(cotizacion.status, cotizacion.texto).toBe(200);
    const total = (cotizacion.body?.['cotizacion'] as { monto: string }).monto;
    const deY = await delSabado('YAPE', y.alumnoId, { total, seleccion: { mes: MES_NOVIEMBRE } });
    expect(deY.respuesta.status, deY.respuesta.texto).toBe(201);
    const renovacionY = renovacionDe(deY.respuesta, 201);
    expect(renovacionY.pago.estado).toBe('PENDIENTE_VERIFICACION');
    expect(await matriculaDelMes(esc.e.A.id, y.alumnoId, NOVIEMBRE)).toMatchObject({ estado: 'RESERVADA' });
    expect(await ocupacion(NOVIEMBRE)).toBe(19);
    return {
      titulares,
      x1: x1.alumnoId,
      x2: x2.alumnoId,
      y: y.alumnoId,
      sinPrioridad: sinPrioridad.alumnoId,
      pagoY: renovacionY.pago.id,
    };
  }

  describe('a) Y no es titular mientras se verifica su pago de noviembre', () => {
    it('criterio 45: la oferta de diciembre muestra c a Y sin prioridad y con 0 cupos (20 − 2 − 18), y a un titular con prioridad y 18 cupos', async () => {
      const { titulares, y } = await prepararEscenario();

      expect(await cuposDe(y)).toMatchObject({ conPrioridad: false, cuposRestantes: 0 });
      expect(await cuposDe(titulares[0] ?? '')).toMatchObject({ conPrioridad: true, cuposRestantes: 18 });
      expect(await ocupacion(NOVIEMBRE)).toBe(19);
      expect(await ocupacion(DICIEMBRE)).toBe(2);
    });

    it('criterio 45: Y renueva diciembre en c en efectivo y recibe 409 SIN_CUPO para [c], sin matrícula, pago, movimiento de caja ni auditoría', async () => {
      const { y } = await prepararEscenario();
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const { respuesta } = await delSabado('EFECTIVO', y);

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDe(respuesta)['claseIds']).toEqual([clase.id]);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      expect(await ocupacion(DICIEMBRE)).toBe(2);
    });

    it('criterio 45: se rechaza el Yape de noviembre de Y (noviembre CANCELADA) y los 18 titulares renuevan c uno tras otro, cada uno con 201, también el último; diciembre queda en 20 de 20', async () => {
      const { titulares, y, pagoY } = await prepararEscenario();
      const sinCupo = await delSabado('EFECTIVO', y);
      expect(resumen(sinCupo.respuesta), sinCupo.respuesta.texto).toEqual([409, 'SIN_CUPO']);

      const rechazo = await ctx.http.post(
        rutaRechazo(pagoY),
        { motivo: 'El comprobante no corresponde al pago' },
        { cookie: cookies.secretaria },
      );
      expect(rechazo.status, rechazo.texto).toBe(200);
      expect(await matriculaDelMes(esc.e.A.id, y, NOVIEMBRE)).toMatchObject({ estado: 'CANCELADA' });
      expect(await ocupacion(NOVIEMBRE)).toBe(18);

      const deLosTitulares = await renovarUnoTrasOtro(titulares);

      expect(deLosTitulares).toEqual(ok(18));
      expect(await ocupacion(DICIEMBRE)).toBe(20);
      expect(await ocupacion(NOVIEMBRE)).toBe(18);
    });
  });

  describe('b) al aprobarse el pago de noviembre, Y pasa a ser titular', () => {
    it('criterio 45: tras el 409, se aprueba el Yape de noviembre de Y (VIGENTE); la oferta de diciembre muestra c a Y con prioridad y 18 cupos (20 − 2), y a un alumno sin prioridad, con 0', async () => {
      const { y, sinPrioridad, pagoY } = await prepararEscenario();
      const sinCupo = await delSabado('EFECTIVO', y);
      expect(resumen(sinCupo.respuesta), sinCupo.respuesta.texto).toEqual([409, 'SIN_CUPO']);

      const aprobacion = await ctx.http.post(rutaAprobacion(pagoY), {}, { cookie: cookies.secretaria });

      expect(aprobacion.status, aprobacion.texto).toBe(200);
      expect(await matriculaDelMes(esc.e.A.id, y, NOVIEMBRE)).toMatchObject({ estado: 'VIGENTE' });
      expect(await cuposDe(y)).toMatchObject({ conPrioridad: true, cuposRestantes: 18 });
      expect(await cuposDe(sinPrioridad)).toMatchObject({ conPrioridad: false, cuposRestantes: 0 });
      expect(await ocupacion(NOVIEMBRE)).toBe(19);
    });

    it('criterio 45: Y renueva c en efectivo con 201 y conPrioridad [c]; después los 18 titulares renuevan uno tras otro: los primeros 17 con 201 y el último SIN_CUPO; diciembre queda en 20 de 20', async () => {
      const { titulares, y, pagoY } = await prepararEscenario();
      const sinCupo = await delSabado('EFECTIVO', y);
      expect(resumen(sinCupo.respuesta), sinCupo.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      const aprobacion = await ctx.http.post(rutaAprobacion(pagoY), {}, { cookie: cookies.secretaria });
      expect(aprobacion.status, aprobacion.texto).toBe(200);

      const deY = await delSabado('EFECTIVO', y);
      const deLosTitulares = await renovarUnoTrasOtro(titulares);

      expect(deY.respuesta.status, deY.respuesta.texto).toBe(201);
      expect(renovacionDe(deY.respuesta, 201).renovacion.conPrioridad).toEqual([clase.id]);
      // Y ya pagó y compite como titular (criterio 44): 20 − 3 (diciembre) = 17 lugares para 18 titulares.
      expect(deLosTitulares).toEqual([...ok(17), [409, 'SIN_CUPO']]);
      expect(await ocupacion(DICIEMBRE)).toBe(20);
      expect(await ocupacion(NOVIEMBRE)).toBe(19);
    });
  });

  describe('c) una renovación de diciembre en verificación cuenta para diciembre (DT-3)', () => {
    it('criterio 45: sin aprobar ni rechazar el Yape de Y, un titular renueva diciembre en c por Yape (201, EN_VERIFICACION, conPrioridad [c]); diciembre pasa a 3 de 20 y la oferta sigue mostrando 0 cupos en c a un alumno sin prioridad y a Y', async () => {
      const { titulares, y, sinPrioridad } = await prepararEscenario();
      const [t1] = titulares as [string, ...string[]];

      const deT1 = await delSabado('YAPE', t1);

      expect(deT1.respuesta.status, deT1.respuesta.texto).toBe(201);
      const renovacion = renovacionDe(deT1.respuesta, 201);
      expect(renovacion.pago.estado).toBe('PENDIENTE_VERIFICACION');
      expect(renovacion.renovacion.conPrioridad).toEqual([clase.id]);
      expect(await matriculaDelMes(esc.e.A.id, t1, DICIEMBRE)).toMatchObject({ estado: 'RESERVADA' });
      expect(await ocupacion(DICIEMBRE)).toBe(3);
      expect(await ocupacion(NOVIEMBRE)).toBe(19);
      // Las reservas de c bajan a 17 (T1 ya no es titular; Y todavía no lo es): un titular ve 20 − 3 = 17 y los demás, 0.
      expect(await cuposDe(titulares[1] ?? '')).toMatchObject({ conPrioridad: true, cuposRestantes: 17 });
      expect(await cuposDe(sinPrioridad)).toMatchObject({ conPrioridad: false, cuposRestantes: 0 });
      expect(await cuposDe(y)).toMatchObject({ conPrioridad: false, cuposRestantes: 0 });
      const deY = await delSabado('EFECTIVO', y);
      expect(resumen(deY.respuesta), deY.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(DICIEMBRE)).toBe(3);
    });
  });
});
