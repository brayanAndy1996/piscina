// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { sembrarCobrable } from '../../utilidades/escenario-pagos';
import { sembrarEnVerificacion } from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  crearAlumnoVencido,
  detallesDe,
  DICIEMBRE,
  fijarAforo,
  INSTANTES,
  instantaneaDeRenovacion,
  MES_DICIEMBRE,
  NOVIEMBRE,
  pedirOferta,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
  resumen,
  sembrarMatriculaDelMes,
  sembrarTitulares,
  type OpcionesDeRegistro,
} from '../../utilidades/escenario-renovacion';
import { crearPlanDeDosVeces, crearPlanYClaseSabado, ocupacionDeClase } from '../../utilidades/inscripciones';
import type { ClaseDePrueba, PlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 9 (crítico, D-06, RN-11, HU-12): con `RELOJ` fijo en la ventana y una clase c de aforo 20 con 20 matrículas de noviembre `VIGENTE`: un alumno que no es titular en c recibe `SIN_CUPO` para c en diciembre; cada titular renueva c con 201, también el
// último; un titular que renueva con otras clases conserva su prioridad solo en las clases que ya tenía y, al renovar, deja libre su lugar en las que no eligió. Un titular con la matrícula de noviembre en verificación también tiene prioridad; un cliente con una
// reserva de 24 horas, no. El 1/12 a las 00:00:00.000 de Lima ya no hay reservas: con 15 renovados, una renovación tardía de otro alumno toma c. Si el administrador bajó el aforo de c por debajo de los inscritos (DR-5 de 004), un titular recibe `SIN_CUPO`
// cuando diciembre ya está en el nuevo aforo (DR-5). La ocupación de cada mes nunca pasa del aforo.
// Definiciones (spec): el titular de prioridad en c es un alumno (no `CLIENTE`) con una matrícula de M `VIGENTE` o en verificación que incluye c y que no tiene una matrícula de M+1 que ocupe cupo; las reservas de prioridad de c son sus titulares y solo cuentan para M+1;
// el cupo libre para A en M+1 es `aforo − ocupación(c, M+1) − reservas(c)`, más 1 si A es titular en c; para M, `aforo − ocupación(c, M)`.
// Lecturas estrictas elegidas: (1) el caso del aforo reducido (el aforo mínimo es 20) se prueba con diciembre ya en el nuevo aforo (aforo 30 bajado a 20, con 20 de 20 ocupados y 10 titulares sin renovar) porque ahí las dos lecturas posibles de DR-5 (la fórmula de DT-4 o «los últimos titulares quedan sin lugar»)
// dan `SIN_CUPO`; (2) «un titular en verificación» es una matrícula `RESERVADA` sin vencimiento con un pago `PENDIENTE_VERIFICACION` (definición de «Mensualidad en verificación»); (3) el 30/11 a las 23:59:59.999 todavía hay reservas y el 1/12 a las 00:00:00.000 ya
// no; (4) las reservas no restan al mes en curso: una renovación tardía de noviembre con un solo cupo libre lo toma aunque haya titulares.

describe('la prioridad para conservar el horario (criterio 9)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let plan: PlanDePrueba;
  let clase: ClaseDePrueba;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    ({ plan, clase } = await crearPlanYClaseSabado(esc.e));
    await abrirCajaPara(esc, INSTANTES.viernes27);
    ctx.reloj.fijar(INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  /** Diciembre con el plan de los sábados (S/ 40.00, 4 clases, 4 sábados) y la clase c. */
  const delSabado: OpcionesDeRegistro = { total: '40.00' };
  const pedir = (via: 'EFECTIVO' | 'YAPE', cookie: string, alumnoId: string, opciones: OpcionesDeRegistro = {}) =>
    registrarRenovacion(ctx, esc, via, cookie, alumnoId, {
      ...delSabado,
      ...opciones,
      seleccion: { planId: plan.id, claseIds: [clase.id], ...opciones.seleccion },
    });
  const ocupacion = (mes: { anio: number; mes: number }, claseId = clase.id, ahora = INSTANTES.viernes27) =>
    ocupacionDeClase(esc.e.A.id, claseId, mes, ahora);

  describe('los titulares de una clase llena', () => {
    it('criterio 9: con 20 titulares en la clase de aforo 20, un alumno que no es titular recibe SIN_CUPO para diciembre y cada titular renueva con 201, también el último; la ocupación de cada mes nunca pasa de 20', async () => {
      const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 20, { claseIds: [clase.id] });
      const extra = await crearAlumnoVencido(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const sinPrioridad = await pedir('EFECTIVO', cookies.secretaria, extra.alumnoId);

      expect(resumen(sinPrioridad.respuesta), sinPrioridad.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDe(sinPrioridad.respuesta)['claseIds']).toEqual([clase.id]);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);

      for (const [indice, alumnoId] of titulares.entries()) {
        const { respuesta } = await pedir('EFECTIVO', cookies.secretaria, alumnoId);
        expect(respuesta.status, `el titular ${indice + 1} de 20: ${respuesta.texto}`).toBe(201);
        expect(renovacionDe(respuesta, 201).renovacion).toMatchObject({
          mes: MES_DICIEMBRE,
          estado: 'VIGENTE',
          conPrioridad: [clase.id],
        });
      }

      expect(await ocupacion(DICIEMBRE)).toBe(20);
      expect(await ocupacion(NOVIEMBRE)).toBe(20);
      const despues = await pedir('EFECTIVO', cookies.secretaria, extra.alumnoId);
      expect(resumen(despues.respuesta), despues.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(DICIEMBRE)).toBe(20);
    });

    it('criterio 9: con 19 titulares y ninguna renovación hay un solo cupo libre para quien no tiene prioridad: el primero lo toma (201) y el segundo recibe SIN_CUPO', async () => {
      await sembrarTitulares(esc.e.A.id, plan.id, 19, { claseIds: [clase.id] });
      const extra = await crearAlumnoVencido(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const unCupo = await pedir('YAPE', cookies.secretaria, extra.alumnoId);

      // 20 − 0 (diciembre) − 19 (reservas) = 1: toma el cupo que sobra.
      expect(unCupo.respuesta.status, unCupo.respuesta.texto).toBe(201);
      const otro = await crearAlumnoVencido(ctx, esc);
      const sinCupo = await pedir('YAPE', cookies.secretaria, otro.alumnoId);
      // 20 − 1 (diciembre) − 19 (reservas) = 0.
      expect(resumen(sinCupo.respuesta), sinCupo.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(DICIEMBRE)).toBe(1);
    });

    it('criterio 9 y casos límite: una renovación tardía de noviembre (M) no resta las reservas de prioridad: con 19 titulares y un cupo libre en noviembre, el alumno vencido toma ese cupo (201)', async () => {
      await sembrarTitulares(esc.e.A.id, plan.id, 19, { claseIds: [clase.id] });
      const extra = await crearAlumnoVencido(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.jueves26);

      const { respuesta } = await pedir('YAPE', cookies.secretaria, extra.alumnoId, {
        seleccion: { mes: '2026-11' },
        total: '10.00',
        fechaOperacion: '2026-11-26',
      });

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await ocupacion(NOVIEMBRE, clase.id, INSTANTES.jueves26)).toBe(20);
    });
  });

  describe('un titular que renueva con otras clases', () => {
    let plan2: PlanDePrueba;

    beforeEach(async () => {
      plan2 = await crearPlanDeDosVeces(esc.e);
    });

    it('criterio 9: conserva la prioridad solo en las clases que ya tenía (SIN_CUPO solo en la que no era suya) y, al renovar con otras clases, deja libre su lugar en las que no eligió', async () => {
      const { lunes, miercoles, viernes, lunes17 } = esc.e;
      const [titular] = await sembrarTitulares(esc.e.A.id, plan2.id, 1, { claseIds: [lunes.id, miercoles.id] });
      await sembrarTitulares(esc.e.A.id, plan2.id, 19, { claseIds: [lunes.id] });
      await sembrarTitulares(esc.e.A.id, plan2.id, 20, { claseIds: [viernes.id] });
      const nuevo = await crearAlumnoVencido(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const sel = (claseIds: string[]) => ({ planId: plan2.id, claseIds });

      // Sin prioridad en el lunes (lleno por 20 titulares), el alumno nuevo solo se queda sin el lunes; el miércoles tiene un solo titular.
      const sinLunes = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, nuevo.alumnoId, {
        seleccion: sel([lunes.id, miercoles.id]),
        total: '90.00',
      });
      expect(resumen(sinLunes.respuesta), sinLunes.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDe(sinLunes.respuesta)['claseIds']).toEqual([lunes.id]);

      // El titular conserva el lunes (la que ya tenía) pero no el viernes (20 titulares ajenos): SIN_CUPO solo en el viernes.
      const conViernes = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, titular ?? '', {
        seleccion: sel([lunes.id, viernes.id]),
        total: '90.00',
      });
      expect(resumen(conViernes.respuesta), conViernes.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDe(conViernes.respuesta)['claseIds']).toEqual([viernes.id]);

      // Renueva con el miércoles (suya) y el lunes de las 17:00 (libre): usa su prioridad solo en el miércoles y deja libre su lugar del lunes de las 18:00.
      const renueva = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, titular ?? '', {
        seleccion: sel([miercoles.id, lunes17.id]),
        total: '90.00',
      });
      expect(renovacionDe(renueva.respuesta, 201).renovacion.conPrioridad).toEqual([miercoles.id]);

      // Ahora quedan 19 reservas en el lunes de las 18:00 y ninguna ocupación de diciembre: el alumno nuevo toma el cupo que dejó el titular.
      const nuevoConLunes = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, nuevo.alumnoId, {
        seleccion: sel([lunes.id, miercoles.id]),
        total: '90.00',
      });
      expect(nuevoConLunes.respuesta.status, nuevoConLunes.respuesta.texto).toBe(201);
      expect(await ocupacion(DICIEMBRE, lunes.id)).toBe(1);
      expect(await ocupacion(NOVIEMBRE, lunes.id)).toBe(20);
      // Y otro alumno sin prioridad ya no cabe en ese lunes: 20 − 1 (diciembre) − 19 (reservas) = 0.
      const otro = await crearAlumnoVencido(ctx, esc);
      const lleno = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, otro.alumnoId, {
        seleccion: sel([lunes.id, miercoles.id]),
        total: '90.00',
      });
      expect(resumen(lleno.respuesta), lleno.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDe(lleno.respuesta)['claseIds']).toEqual([lunes.id]);
    });
  });

  describe('quién es titular y quién no', () => {
    it('criterio 9: un titular con la matrícula de noviembre en verificación también tiene prioridad: con 19 titulares y uno en verificación, un alumno sin prioridad recibe SIN_CUPO y el de la verificación renueva (201)', async () => {
      await sembrarTitulares(esc.e.A.id, plan.id, 19, { claseIds: [clase.id] });
      const enVerificacion = await sembrarEnVerificacion(esc.e, {
        planId: plan.id,
        claseIds: [clase.id],
        estadoAlumno: 'ALUMNO_ACTIVO',
        ahora: INSTANTES.viernes27,
        clasesTotales: 4,
        clasesPorMesPlan: 4,
        precioPlan: '40.00',
        monto: '40.00',
      });
      const extra = await crearAlumnoVencido(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const sinPrioridad = await pedir('YAPE', cookies.secretaria, extra.alumnoId);
      const titular = await pedir('YAPE', cookies.secretaria, enVerificacion.alumnoId);

      expect(resumen(sinPrioridad.respuesta), sinPrioridad.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(titular.respuesta.status, titular.respuesta.texto).toBe(201);
      expect(renovacionDe(titular.respuesta, 201).renovacion.conPrioridad).toEqual([clase.id]);
    });

    it('criterio 9: un cliente con una reserva de 24 horas no es titular: con 19 titulares y un cliente con reserva, un alumno sin prioridad toma el cupo que queda (201) y el cliente no cuenta como reserva', async () => {
      await sembrarTitulares(esc.e.A.id, plan.id, 19, { claseIds: [clase.id] });
      const cliente = await sembrarCobrable(esc.e, {
        planId: plan.id,
        claseIds: [clase.id],
        ahora: INSTANTES.viernes27,
        clasesTotales: 4,
        clasesPorMesPlan: 4,
        precioPlan: '40.00',
        monto: '40.00',
      });
      expect(await ocupacion(NOVIEMBRE), 'el cliente ocupa el cupo número 20 de noviembre con su reserva').toBe(20);
      const extra = await crearAlumnoVencido(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const { respuesta } = await pedir('YAPE', cookies.secretaria, extra.alumnoId);

      // 20 − 0 (diciembre) − 19 (reservas de los titulares; el cliente no cuenta) = 1.
      expect(respuesta.status, respuesta.texto).toBe(201);
      // Y el cliente, que no es un alumno, no renueva: 404 como cualquier CLIENTE.
      const delCliente = await pedir('YAPE', cookies.secretaria, cliente.alumnoId);
      expect(resumen(delCliente.respuesta), delCliente.respuesta.texto).toEqual([404, 'NO_ENCONTRADO']);
    });

    it('criterio 9: quien ya tiene su matrícula de diciembre deja de ser titular: sus lugares apartados en otras clases se liberan', async () => {
      const { miercoles, lunes } = esc.e;
      const plan2 = await crearPlanDeDosVeces(esc.e);
      const titulares = await sembrarTitulares(esc.e.A.id, plan2.id, 20, { claseIds: [lunes.id] });
      await sembrarMatriculaDelMes(esc.e.A.id, plan2.id, [titulares[0] ?? ''], [miercoles.id], DICIEMBRE);
      const extra = await crearAlumnoVencido(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, extra.alumnoId, {
        seleccion: { planId: plan2.id, claseIds: [lunes.id, miercoles.id] },
        total: '90.00',
      });

      // 20 − 0 (diciembre en el lunes) − 19 (el primer titular ya tiene diciembre y no aparta el lunes) = 1.
      expect(respuesta.status, respuesta.texto).toBe(201);
    });
  });

  describe('el día 1 se libera lo que nadie renovó (D-06)', () => {
    async function conQuinceRenovados() {
      const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 20, { claseIds: [clase.id] });
      await sembrarMatriculaDelMes(esc.e.A.id, plan.id, titulares.slice(0, 15), [clase.id], DICIEMBRE);
      const extra = await crearAlumnoVencido(ctx, esc);
      return { titulares, extra };
    }

    it('criterio 9: el 30/11 a las 23:59:59.999 de Lima todavía hay reservas (20 − 15 − 5 = 0): SIN_CUPO; el 1/12 a las 00:00:00.000 ya no (20 − 15 = 5): la renovación tardía de otro alumno toma c (201)', async () => {
      const { extra } = await conQuinceRenovados();
      const alFinal = en(ctx, esc, INSTANTES.ultimoDeLaVentana);
      const antes = await pedir('YAPE', alFinal.secretaria, extra.alumnoId, { fechaOperacion: '2026-11-30' });
      expect(resumen(antes.respuesta), antes.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(DICIEMBRE, clase.id, INSTANTES.ultimoDeLaVentana)).toBe(15);

      const primeroDeDiciembre = en(ctx, esc, INSTANTES.primeroDeDiciembre);
      const despues = await pedir('YAPE', primeroDeDiciembre.secretaria, extra.alumnoId, {
        fechaOperacion: '2026-12-01',
      });

      expect(despues.respuesta.status, despues.respuesta.texto).toBe(201);
      expect(renovacionDe(despues.respuesta, 201).renovacion).toMatchObject({ mes: MES_DICIEMBRE, conPrioridad: [] });
      expect(await ocupacion(DICIEMBRE, clase.id, INSTANTES.primeroDeDiciembre)).toBe(16);
    });

    it('criterio 9: el 1/12 los cinco titulares que no renovaron ya no tienen lugar apartado: cinco alumnos más caben (20 − 15 = 5) y el sexto no', async () => {
      const { titulares } = await conQuinceRenovados();
      const nuevos = [];
      for (let i = 0; i < 6; i++) nuevos.push(await crearAlumnoVencido(ctx, esc));
      const cookies = en(ctx, esc, INSTANTES.primeroDeDiciembre);

      const respuestas = [];
      for (const alumno of nuevos) {
        respuestas.push(await pedir('YAPE', cookies.secretaria, alumno.alumnoId, { fechaOperacion: '2026-12-01' }));
      }

      expect(respuestas.map((r) => r.respuesta.status)).toEqual([201, 201, 201, 201, 201, 409]);
      expect(resumen((respuestas[5] as (typeof respuestas)[number]).respuesta)).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(DICIEMBRE, clase.id, INSTANTES.primeroDeDiciembre)).toBe(20);
      expect(titulares).toHaveLength(20);
    });
  });

  describe('el aforo reducido por debajo de los inscritos (DR-5 de 004)', () => {
    /** Aforo 30 con 30 titulares en noviembre y 20 ya renovados en diciembre; después el administrador baja el aforo a 20 (el mínimo). */
    async function conElAforoBajado() {
      await fijarAforo(esc.e.A.id, clase.id, 30);
      const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 30, { claseIds: [clase.id] });
      await sembrarMatriculaDelMes(esc.e.A.id, plan.id, titulares.slice(0, 20), [clase.id], DICIEMBRE);
      await fijarAforo(esc.e.A.id, clase.id, 20);
      return titulares;
    }

    it('criterio 9: con 30 titulares, veinte ya renovados y el aforo bajado de 30 a 20 (diciembre ya está en el nuevo aforo), un titular que falta recibe SIN_CUPO y también un alumno sin prioridad; la ocupación de diciembre no pasa de 20', async () => {
      const titulares = await conElAforoBajado();
      const extra = await crearAlumnoVencido(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const titular = await pedir('YAPE', cookies.secretaria, titulares[20] ?? '');
      const sinPrioridad = await pedir('YAPE', cookies.secretaria, extra.alumnoId);

      expect(resumen(titular.respuesta), titular.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(resumen(sinPrioridad.respuesta), sinPrioridad.respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      expect(await ocupacion(DICIEMBRE)).toBe(20);
      expect(await ocupacion(NOVIEMBRE), 'noviembre no expulsa a nadie: sigue con 30').toBe(30);
    });

    it('criterio 9: con el aforo subido otra vez a 30, el mismo titular renueva con el último lugar (30 − 20 − 10 + 1 = 1): 201, y diciembre queda en 21 de 30', async () => {
      const titulares = await conElAforoBajado();
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const sinLugar = await pedir('YAPE', cookies.secretaria, titulares[20] ?? '');
      expect(sinLugar.respuesta.status).toBe(409);
      await fijarAforo(esc.e.A.id, clase.id, 30);

      const { respuesta } = await pedir('YAPE', cookies.secretaria, titulares[20] ?? '');

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await ocupacion(DICIEMBRE)).toBe(21);
    });
  });

  describe('la oferta muestra los cupos que calcula el registro (criterio 2, DT-4)', () => {
    it('criterio 9: con 20 titulares y 0 de diciembre, la clase c ofrece 0 cupos y sin prioridad al alumno sin horario y 1 cupo con prioridad a un titular', async () => {
      const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 20, { claseIds: [clase.id] });
      const extra = await crearAlumnoVencido(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const delExtra = await pedirOferta(ctx, cookies.secretaria, extra.alumnoId, MES_DICIEMBRE);
      const delTitular = await pedirOferta(ctx, cookies.secretaria, titulares[0] ?? '', MES_DICIEMBRE);

      for (const respuesta of [delExtra, delTitular]) expect(respuesta.status, respuesta.texto).toBe(200);
      const claseDe = (cuerpo: { body: Record<string, unknown> | null }) =>
        (cuerpo.body?.['clases'] as { id: string; cuposRestantes: number; conPrioridad: boolean }[]).find(
          (c) => c.id === clase.id,
        );
      expect(claseDe(delExtra)).toMatchObject({ cuposRestantes: 0, conPrioridad: false });
      expect(claseDe(delTitular)).toMatchObject({ cuposRestantes: 20, conPrioridad: true });
    });
  });

  it('criterio 9: el aforo nunca se pasa aunque se envíen a la vez más renovaciones de las que caben: 6 pedidos de alumnos sin prioridad por 5 cupos libres (20 menos 15 lugares apartados) dejan exactamente 5 renovaciones y la ocupación de diciembre en 5', async () => {
    const extras = [];
    for (let i = 0; i < 6; i++) extras.push(await crearAlumnoVencido(ctx, esc));
    await sembrarTitulares(esc.e.A.id, plan.id, 15, { claseIds: [clase.id] });
    const cookies = en(ctx, esc, INSTANTES.viernes27);

    const respuestas = await Promise.all(extras.map((alumno) => pedir('YAPE', cookies.secretaria, alumno.alumnoId)));

    // 20 de aforo − 15 titulares apartados = 5 cupos libres para quienes no tienen prioridad.
    expect(respuestas.filter((r) => r.respuesta.status === 201)).toHaveLength(5);
    expect(respuestas.filter((r) => r.respuesta.status === 409).map((r) => resumen(r.respuesta)[1])).toEqual([
      'SIN_CUPO',
    ]);
    expect(await ocupacion(DICIEMBRE)).toBe(5);
  });
});
