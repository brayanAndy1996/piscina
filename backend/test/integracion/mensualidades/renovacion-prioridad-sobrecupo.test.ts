// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { rutaRechazo } from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  cotizarRenovacion,
  crearAlumnoVencido,
  cuerpoCotizacionRenovacion,
  DICIEMBRE,
  fijarAforo,
  INSTANTES,
  MES_DICIEMBRE,
  MES_NOVIEMBRE,
  NOVIEMBRE,
  pedirOferta,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  resumen,
  sembrarMatriculaDelMes,
  sembrarTitulares,
  sinErroresDelServidor,
  type OpcionesDeRegistro,
} from '../../utilidades/escenario-renovacion';
import {
  conRetencion,
  crearPlanYClaseSabado,
  ocupacionDeClase,
  type RespuestaApi,
  retenerClases,
} from '../../utilidades/inscripciones';
import type { ClaseDePrueba, PlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 44 (crítico, ronda adversarial 1 de la 010a, R1-1; D-06, RN-11, HU-12, DR-5, DT-4): más titulares que lugares en el mes siguiente. Con `RELOJ` fijo en la ventana (27/11/2026, N = 5) y una clase c de los sábados, en M+1 un titular de c toma c si
// `aforo − ocupación(c, M+1) ≥ 1`, sin restarle las reservas; entre titulares gana el primero que llega; quien no es titular sigue necesitando `aforo − ocupación(c, M+1) − reservas(c) ≥ 1`. Casos: (a) renovación tardía que convierte a un alumno en el titular número 20 de
// 19 lugares; (b) un Yape rechazado que devuelve la titularidad a quien había dejado c; (c) aforo bajado de 30 a 20 con 30 titulares (DR-5); (d) dos titulares a la vez por el último lugar. Diciembre termina con c en el aforo (20 de 20) y ningún mes pasa del aforo vigente.
// Lecturas estrictas elegidas: (1) «los 19 titulares de antes renuevan, cada uno con 201; después Y recibe `SIN_CUPO`» se prueba en ese orden y, en otra prueba, con Y primero (Y entra y el último de los otros recibe `SIN_CUPO`); (2) el caso (d) deja a 19 titulares «ya
// renovados» sembrándoles la matrícula de diciembre `VIGENTE` sin solicitud (el estado al que llega una renovación) para que la prueba ataque solo la carrera; la espera de las dos peticiones se comprueba con la retención de la fila de la clase (`SELECT … FOR UPDATE`, la que toma el
// registro para el aforo) y la lectura de los bloqueos en espera de `pg_locks` (`pg_blocking_pids`, como el criterio 10); gana la primera que llega a la cola y las dos órdenes de llegada valen; (3) la oferta del titular es `aforo − ocupación(c, M+1)`: 19 en el caso (a) y 20 en el (c).

describe('titulares con sobrecupo en el mes siguiente (criterio 44)', () => {
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
      ...opciones,
      seleccion: { planId: plan.id, claseIds: [clase.id], ...opciones.seleccion },
    }).then((r) => r.respuesta);
  const ocupacion = (mes: { anio: number; mes: number }) =>
    ocupacionDeClase(esc.e.A.id, clase.id, mes, INSTANTES.viernes27);
  const cuposDe = async (alumnoId: string): Promise<{ cuposRestantes: number; conPrioridad: boolean } | undefined> => {
    const oferta = await pedirOferta(ctx, cookies.secretaria, alumnoId, MES_DICIEMBRE);
    expect(oferta.status, oferta.texto).toBe(200);
    return (
      oferta.body?.['clases'] as { id: string; cuposRestantes: number; conPrioridad: boolean }[] | undefined
    )?.find((c) => c.id === clase.id);
  };
  /** Cada alumno renueva diciembre en c, uno tras otro, y se devuelve lo que respondió el registro. */
  const renovarUnoTrasOtro = async (alumnoIds: readonly string[]): Promise<[number, string | undefined][]> => {
    const resultados: [number, string | undefined][] = [];
    for (const id of alumnoIds) resultados.push(resumen(await delSabado('EFECTIVO', id)));
    return resultados;
  };
  const ok = (n: number): [number, string | undefined][] => Array.from({ length: n }, () => [201, undefined]);
  const sinCupo = (n: number): [number, string | undefined][] => Array.from({ length: n }, () => [409, 'SIN_CUPO']);

  describe('a) una renovación tardía convierte a un alumno en el titular número 20 de 19 lugares', () => {
    /** c de aforo 20 con 19 titulares; X renueva diciembre sin prioridad (queda 1 de 20) e Y hace la renovación tardía de noviembre y pasa a ser titular. */
    async function prepararSobrecupo() {
      await fijarAforo(esc.e.A.id, clase.id, 20);
      const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 19, { claseIds: [clase.id] });
      const x = await crearAlumnoVencido(ctx, esc);
      const y = await crearAlumnoVencido(ctx, esc);
      const sinPrioridad = await crearAlumnoVencido(ctx, esc);

      const deX = await delSabado('EFECTIVO', x.alumnoId);
      expect(deX.status, deX.texto).toBe(201);
      const cotizacion = await cotizarRenovacion(
        ctx,
        cookies.secretaria,
        y.alumnoId,
        cuerpoCotizacionRenovacion({ mes: MES_NOVIEMBRE, planId: plan.id, claseIds: [clase.id] }),
      );
      expect(cotizacion.status, cotizacion.texto).toBe(200);
      const total = (cotizacion.body?.['cotizacion'] as { monto: string }).monto;
      const deY = await delSabado('EFECTIVO', y.alumnoId, { total, seleccion: { mes: MES_NOVIEMBRE } });
      expect(deY.status, deY.texto).toBe(201);
      expect(await ocupacion(NOVIEMBRE)).toBe(20);
      expect(await ocupacion(DICIEMBRE)).toBe(1);
      return { titulares, y: y.alumnoId, sinPrioridad: sinPrioridad.alumnoId };
    }

    it('criterio 44: un alumno sin prioridad recibe SIN_CUPO para c en diciembre y la oferta muestra 19 cupos a un titular y 0 a ese alumno', async () => {
      const { titulares, y, sinPrioridad } = await prepararSobrecupo();

      const rechazado = await delSabado('EFECTIVO', sinPrioridad);
      expect(resumen(rechazado), rechazado.texto).toEqual([409, 'SIN_CUPO']);
      expect(await cuposDe(titulares[0] ?? '')).toMatchObject({ cuposRestantes: 19, conPrioridad: true });
      expect(await cuposDe(y)).toMatchObject({ cuposRestantes: 19, conPrioridad: true });
      expect(await cuposDe(sinPrioridad)).toMatchObject({ cuposRestantes: 0, conPrioridad: false });
      expect(await ocupacion(DICIEMBRE)).toBe(1);
    });

    it('criterio 44: los 19 titulares de antes renuevan c, cada uno con 201; después Y recibe SIN_CUPO y diciembre queda en 20 de 20', async () => {
      const { titulares, y } = await prepararSobrecupo();

      const deLosDeAntes = await renovarUnoTrasOtro(titulares);
      const deY = await delSabado('EFECTIVO', y);

      expect(deLosDeAntes).toEqual(ok(19));
      expect(resumen(deY), deY.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(DICIEMBRE)).toBe(20);
      expect(await ocupacion(NOVIEMBRE)).toBe(20);
    });

    it('criterio 44: con Y primero, Y entra con 201 y el último de los otros 19 titulares recibe SIN_CUPO; diciembre queda en 20 de 20', async () => {
      const { titulares, y } = await prepararSobrecupo();

      const deY = await delSabado('EFECTIVO', y);
      const deLosDeAntes = await renovarUnoTrasOtro(titulares);

      expect(deY.status, deY.texto).toBe(201);
      expect(deLosDeAntes).toEqual([...ok(18), [409, 'SIN_CUPO']]);
      expect(await ocupacion(DICIEMBRE)).toBe(20);
      expect(await ocupacion(NOVIEMBRE)).toBe(20);
    });
  });

  describe('b) un Yape rechazado devuelve la titularidad a quien había dejado c', () => {
    it('criterio 44: con 20 titulares, T0 renueva por Yape sin c, X toma c (201) y se rechaza el Yape de T0; un alumno sin prioridad recibe SIN_CUPO, los otros 19 titulares renuevan con 201 y T0 recibe SIN_CUPO', async () => {
      const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 20, { claseIds: [clase.id] });
      const [t0, ...otros] = titulares as [string, ...string[]];
      const x = await crearAlumnoVencido(ctx, esc);
      const sinPrioridad = await crearAlumnoVencido(ctx, esc);

      // T0 renueva diciembre por Yape con las clases de los lunes, miércoles y viernes (sin c): deja libre su lugar en c.
      const deT0 = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, t0, {
        total: '120.00',
        fechaOperacion: '2026-11-27',
      });
      expect(deT0.respuesta.status, deT0.respuesta.texto).toBe(201);
      const deX = await delSabado('EFECTIVO', x.alumnoId);
      expect(deX.status, deX.texto).toBe(201);
      const pagoId = (deT0.respuesta.body?.['pago'] as { id: string }).id;
      const rechazo = await ctx.http.post(
        rutaRechazo(pagoId),
        { motivo: 'La imagen no se lee, sube otra foto' },
        { cookie: cookies.secretaria },
      );
      expect(rechazo.status, rechazo.texto).toBe(200);
      expect(await ocupacion(DICIEMBRE)).toBe(1);

      const rechazado = await delSabado('EFECTIVO', sinPrioridad.alumnoId);
      const deLosOtros = await renovarUnoTrasOtro(otros);
      const deT0Tarde = await delSabado('EFECTIVO', t0);

      expect(resumen(rechazado), rechazado.texto).toEqual([409, 'SIN_CUPO']);
      expect(deLosOtros).toEqual(ok(19));
      expect(resumen(deT0Tarde), deT0Tarde.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(DICIEMBRE)).toBe(20);
      expect(await ocupacion(NOVIEMBRE)).toBe(20);
    });
  });

  describe('c) el administrador baja el aforo por debajo de los titulares (DR-5)', () => {
    async function prepararAforoBajado() {
      await fijarAforo(esc.e.A.id, clase.id, 30);
      const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 30, { claseIds: [clase.id] });
      await fijarAforo(esc.e.A.id, clase.id, 20);
      return titulares;
    }

    it('criterio 44: con 30 titulares y el aforo en 20, un alumno sin prioridad recibe SIN_CUPO y la oferta muestra 20 cupos a un titular y 0 a ese alumno', async () => {
      const titulares = await prepararAforoBajado();
      const sinPrioridad = await crearAlumnoVencido(ctx, esc);

      const rechazado = await delSabado('EFECTIVO', sinPrioridad.alumnoId);

      expect(resumen(rechazado), rechazado.texto).toEqual([409, 'SIN_CUPO']);
      expect(await cuposDe(titulares[0] ?? '')).toMatchObject({ cuposRestantes: 20, conPrioridad: true });
      expect(await cuposDe(sinPrioridad.alumnoId)).toMatchObject({ cuposRestantes: 0, conPrioridad: false });
      expect(await ocupacion(DICIEMBRE)).toBe(0);
    });

    it('criterio 44: los titulares renuevan c uno tras otro: los primeros 20, con 201; del 21 al 30, SIN_CUPO; diciembre queda en 20 y noviembre conserva sus 30', async () => {
      const titulares = await prepararAforoBajado();

      const resultados = await renovarUnoTrasOtro(titulares);

      expect(resultados).toEqual([...ok(20), ...sinCupo(10)]);
      expect(await ocupacion(DICIEMBRE)).toBe(20);
      expect(await ocupacion(NOVIEMBRE)).toBe(30);
    });
  });

  describe('d) dos titulares a la vez por el último lugar', () => {
    it('criterio 44: con 19 titulares ya renovados (diciembre en 19 de 20), dos de los que faltan renuevan c a la vez, esperando los dos el bloqueo de la clase: uno 201 y el otro SIN_CUPO, sin 40P01, y diciembre queda en 20 de 20', async () => {
      await fijarAforo(esc.e.A.id, clase.id, 30);
      const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 30, { claseIds: [clase.id] });
      await fijarAforo(esc.e.A.id, clase.id, 20);
      await sembrarMatriculaDelMes(esc.e.A.id, plan.id, titulares.slice(0, 19), [clase.id], DICIEMBRE);
      expect(await ocupacion(DICIEMBRE)).toBe(19);
      const [primero, segundo] = titulares.slice(19, 21) as [string, string];

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: esc.e.A.id,
        retener: retenerClases([clase.id], esc.e.A.id),
        enviar: [() => delSabado('EFECTIVO', primero), () => delSabado('EFECTIVO', segundo)],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron, 'las dos renovaciones debían quedar esperando el bloqueo de la clase').toBe(true);
      const respuestas = resultados as [RespuestaApi, RespuestaApi];
      sinErroresDelServidor(respuestas);
      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
      expect(respuestas.filter((r) => r.status !== 201).map((r) => resumen(r))).toEqual([[409, 'SIN_CUPO']]);
      expect(await ocupacion(DICIEMBRE)).toBe(20);
      expect(await ocupacion(NOVIEMBRE)).toBe(30);
    });
  });
});
