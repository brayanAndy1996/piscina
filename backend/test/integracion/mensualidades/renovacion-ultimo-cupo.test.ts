// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  abrirCajaPara,
  crearAlumnoVencido,
  DICIEMBRE,
  INSTANTES,
  MES_NOVIEMBRE,
  NOVIEMBRE,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  resumen,
  sembrarTitulares,
  sinErroresDelServidor,
  type OpcionesDeRegistro,
  type Via,
} from '../../utilidades/escenario-renovacion';
import {
  conRetencion,
  crearPlanYClaseSabado,
  cuerpoInscripcion,
  llenarClase,
  ocupacionDeClase,
  type RespuestaApi,
  retenerClases,
  rutaPublica,
} from '../../utilidades/inscripciones';
import type { ClaseDePrueba, PlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 10 (crítico, RN-11, D-06): pruebas deterministas (espera comprobada con `pg_blocking_pids`, como el resto de las carreras de la 005 a la 009): dos renovaciones de alumnos sin prioridad por el último cupo libre de c en diciembre: una 201 y otra 409
// `SIN_CUPO`; un titular y un alumno sin prioridad con un solo cupo libre más la reserva del titular: los dos 201; una renovación tardía de M y un envío de la inscripción pública (005) por el último cupo de c en M: uno solo ocupa; una renovación de `[c1, c2]` y
// otra de `[c2, c1]` a la vez terminan sin `40P01`. Después de cada prueba, la ocupación de cada mes es como mucho el aforo.
// Lecturas estrictas elegidas: (1) la prueba retiene con `SELECT … FOR UPDATE` la fila de las clases (la que toma `bloquearClasesParaCupo`), envía las peticiones en orden, comprueba que todas esperan y recién entonces suelta: la primera en llegar a la cola gana;
// (2) «sin 40P01» se comprueba también por el texto de la respuesta (`40P01`, `deadlock`, `interbloqueo`) y porque ninguna responde 5xx; el orden de bloqueo de las clases es el de `bloquearClasesParaCupo` (una sola llamada con todas las clases), así que se retiene la
// clase de id más bajo y las peticiones piden las clases en orden ascendente y descendente de id, que es lo que interbloquea a una implementación que bloquee en el orden recibido; (3) los dos 201 del titular y el alumno sin prioridad valen en los dos órdenes de llegada.

const VIAS: Via[] = ['EFECTIVO', 'YAPE'];

describe('el último cupo simultáneo (criterio 10)', () => {
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
    cookies = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const delSabado = (via: Via, alumnoId: string, opciones: OpcionesDeRegistro = {}) =>
    registrarRenovacion(ctx, esc, via, cookies.secretaria, alumnoId, {
      total: '40.00',
      ...opciones,
      seleccion: { planId: plan.id, claseIds: [clase.id], ...opciones.seleccion },
    }).then((r) => r.respuesta);
  const ocupacion = (mes: { anio: number; mes: number }, claseId = clase.id, ahora = INSTANTES.viernes27) =>
    ocupacionDeClase(esc.e.A.id, claseId, mes, ahora);

  describe('dos renovaciones sin prioridad por el último cupo libre', () => {
    describe.each(VIAS)('por %s', (via) => {
      it.each([
        ['el primer alumno', 0, 1],
        ['el segundo alumno', 1, 0],
      ])(
        'criterio 10: con un cupo libre en diciembre (19 de 20), si llega primero %s gana: una 201 y la otra 409 SIN_CUPO; la ocupación queda en 20',
        async (_nombre, quien, otra) => {
          await llenarClase(esc.e.A.id, clase.id, plan.id, 19, { mes: DICIEMBRE });
          const alumnos = [await crearAlumnoVencido(ctx, esc), await crearAlumnoVencido(ctx, esc)];
          const orden = [quien, otra];

          const { resultados, todasEsperaron } = await conRetencion({
            academiaId: esc.e.A.id,
            retener: retenerClases([clase.id], esc.e.A.id),
            enviar: orden.map((i) => () => delSabado(via, (alumnos[i] as (typeof alumnos)[number]).alumnoId)),
            enOrden: true,
            liberar: 'COMMIT',
          });

          expect(todasEsperaron, 'las dos renovaciones debían quedar esperando el bloqueo de la clase').toBe(true);
          const [primera, segunda] = resultados as [RespuestaApi, RespuestaApi];
          expect(primera.status, primera.texto).toBe(201);
          expect(resumen(segunda), segunda.texto).toEqual([409, 'SIN_CUPO']);
          expect(await ocupacion(DICIEMBRE)).toBe(20);
        },
      );
    });

    it('criterio 10: cinco renovaciones a la vez (sin retener nada) por tres cupos libres dejan exactamente tres 201, el resto 409 SIN_CUPO, sin 5xx, y la ocupación en 20', async () => {
      await llenarClase(esc.e.A.id, clase.id, plan.id, 17, { mes: DICIEMBRE });
      const alumnos = [];
      for (let i = 0; i < 5; i++) alumnos.push(await crearAlumnoVencido(ctx, esc));

      const respuestas = await Promise.all(alumnos.map((a) => delSabado('YAPE', a.alumnoId)));

      sinErroresDelServidor(respuestas);
      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(3);
      expect(respuestas.filter((r) => r.status !== 201).map((r) => resumen(r))).toEqual([
        [409, 'SIN_CUPO'],
        [409, 'SIN_CUPO'],
      ]);
      expect(await ocupacion(DICIEMBRE)).toBe(20);
    });
  });

  describe('un titular y un alumno sin prioridad con un solo cupo libre más la reserva del titular', () => {
    it.each([
      ['el titular primero', true],
      ['el alumno sin prioridad primero', false],
    ])(
      'criterio 10: con 19 titulares apartados (20 − 19 = 1 cupo libre para el sin prioridad y 2 para el titular), %s: los dos 201 y la ocupación de diciembre en 2',
      async (_nombre, titularPrimero) => {
        const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 19, { claseIds: [clase.id] });
        const sinPrioridad = await crearAlumnoVencido(ctx, esc);
        const hacerTitular = () => delSabado('YAPE', titulares[0] ?? '');
        const hacerOtro = () => delSabado('YAPE', sinPrioridad.alumnoId);

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: esc.e.A.id,
          retener: retenerClases([clase.id], esc.e.A.id),
          enviar: titularPrimero ? [hacerTitular, hacerOtro] : [hacerOtro, hacerTitular],
          enOrden: true,
          liberar: 'COMMIT',
        });

        expect(todasEsperaron).toBe(true);
        for (const respuesta of resultados) expect(respuesta.status, respuesta.texto).toBe(201);
        expect(await ocupacion(DICIEMBRE)).toBe(2);
        expect(await ocupacion(NOVIEMBRE)).toBe(19);
      },
    );

    it('criterio 10: tres titulares y un alumno sin prioridad a la vez (sin retener nada) por 19 reservas: todos entran (el sin prioridad toma el único cupo no apartado) y diciembre no pasa de 20', async () => {
      const titulares = await sembrarTitulares(esc.e.A.id, plan.id, 19, { claseIds: [clase.id] });
      const sinPrioridad = await crearAlumnoVencido(ctx, esc);

      const respuestas = await Promise.all([
        delSabado('YAPE', titulares[0] ?? ''),
        delSabado('YAPE', titulares[1] ?? ''),
        delSabado('YAPE', sinPrioridad.alumnoId),
        delSabado('YAPE', titulares[2] ?? ''),
      ]);

      sinErroresDelServidor(respuestas);
      for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await ocupacion(DICIEMBRE)).toBe(4);
    });
  });

  describe('una renovación tardía de M y un envío de la inscripción pública (005) por el último cupo de c en M', () => {
    const enviarInscripcion = async () => {
      const cuerpo = await cuerpoInscripcion(esc.e, { plan, clases: [clase], ahora: INSTANTES.jueves26 });
      return ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
    };

    it.each([
      ['la renovación llega primero', true],
      ['el envío llega primero', false],
    ])(
      'criterio 10: con un cupo libre en noviembre (19 de 20) y %s, uno solo ocupa: el primero 201 y el otro 409 SIN_CUPO; la ocupación de noviembre queda en 20',
      async (_nombre, renovacionPrimero) => {
        await llenarClase(esc.e.A.id, clase.id, plan.id, 19, { mes: NOVIEMBRE });
        const alumno = await crearAlumnoVencido(ctx, esc);
        cookies = en(ctx, esc, INSTANTES.jueves26);
        const hacerRenovacion = () =>
          delSabado('YAPE', alumno.alumnoId, {
            seleccion: { mes: MES_NOVIEMBRE },
            total: '10.00',
            fechaOperacion: '2026-11-26',
          });

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: esc.e.A.id,
          retener: retenerClases([clase.id], esc.e.A.id),
          enviar: renovacionPrimero ? [hacerRenovacion, enviarInscripcion] : [enviarInscripcion, hacerRenovacion],
          enOrden: true,
          liberar: 'COMMIT',
        });

        expect(todasEsperaron, 'las dos operaciones debían quedar esperando el bloqueo de la clase').toBe(true);
        const [primera, segunda] = resultados as [RespuestaApi, RespuestaApi];
        expect(primera.status, primera.texto).toBe(201);
        expect(resumen(segunda), segunda.texto).toEqual([409, 'SIN_CUPO']);
        expect(await ocupacion(NOVIEMBRE, clase.id, INSTANTES.jueves26)).toBe(20);
      },
    );

    it.each([1, 2, 3])(
      'criterio 10: lo mismo a la vez, sin retener nada (ronda %i): un solo ganador y ningún 5xx',
      async () => {
        await llenarClase(esc.e.A.id, clase.id, plan.id, 19, { mes: NOVIEMBRE });
        const alumno = await crearAlumnoVencido(ctx, esc);
        cookies = en(ctx, esc, INSTANTES.jueves26);

        const [renovacion, inscripcion] = await Promise.all([
          delSabado('YAPE', alumno.alumnoId, {
            seleccion: { mes: MES_NOVIEMBRE },
            total: '10.00',
            fechaOperacion: '2026-11-26',
          }),
          enviarInscripcion(),
        ]);

        sinErroresDelServidor([renovacion, inscripcion]);
        expect([renovacion.status, inscripcion.status].filter((estado) => estado === 201)).toHaveLength(1);
        expect(await ocupacion(NOVIEMBRE, clase.id, INSTANTES.jueves26)).toBe(20);
      },
    );
  });

  describe('dos renovaciones con las mismas clases en orden contrario a la vez', () => {
    it.each([
      ['la de orden ascendente llega primero', true],
      ['la de orden descendente llega primero', false],
    ])(
      'criterio 10: [c1, c2, c3] y [c3, c2, c1] con la clase de id más bajo retenida, %s: las dos terminan sin 40P01 y con 201; la ocupación de cada clase en diciembre es 2',
      async (_nombre, ascendentePrimero) => {
        const ids = [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id].sort();
        const descendentes = [...ids].reverse();
        const alumnos = [await crearAlumnoVencido(ctx, esc), await crearAlumnoVencido(ctx, esc)];
        const ascendente = () =>
          registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, (alumnos[0] as (typeof alumnos)[number]).alumnoId, {
            seleccion: { claseIds: ids },
          }).then((r) => r.respuesta);
        const descendente = () =>
          registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, (alumnos[1] as (typeof alumnos)[number]).alumnoId, {
            seleccion: { claseIds: descendentes },
          }).then((r) => r.respuesta);

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: esc.e.A.id,
          retener: retenerClases([ids[0] as string], esc.e.A.id),
          enviar: ascendentePrimero ? [ascendente, descendente] : [descendente, ascendente],
          enOrden: true,
          liberar: 'COMMIT',
        });

        expect(todasEsperaron, 'las dos renovaciones debían quedar esperando la clase retenida').toBe(true);
        sinErroresDelServidor(resultados);
        for (const respuesta of resultados) expect(respuesta.status, respuesta.texto).toBe(201);
        for (const id of ids) expect(await ocupacion(DICIEMBRE, id)).toBe(2);
      },
    );

    it('criterio 10: con la clase de id más alto retenida, el mismo cruce termina igual de bien', async () => {
      const ids = [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id].sort();
      const alumnos = [await crearAlumnoVencido(ctx, esc), await crearAlumnoVencido(ctx, esc)];

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: esc.e.A.id,
        retener: retenerClases([ids[2] as string], esc.e.A.id),
        enviar: [
          () =>
            registrarRenovacion(
              ctx,
              esc,
              'YAPE',
              cookies.secretaria,
              (alumnos[0] as (typeof alumnos)[number]).alumnoId,
              {
                seleccion: { claseIds: ids },
              },
            ).then((r) => r.respuesta),
          () =>
            registrarRenovacion(
              ctx,
              esc,
              'YAPE',
              cookies.secretaria,
              (alumnos[1] as (typeof alumnos)[number]).alumnoId,
              {
                seleccion: { claseIds: [...ids].reverse() },
              },
            ).then((r) => r.respuesta),
        ],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      sinErroresDelServidor(resultados);
      for (const respuesta of resultados) expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 10: diez renovaciones simultáneas con las tres clases en distinto orden terminan sin 40P01 ni 5xx y con la ocupación de cada clase en 10', async () => {
      const ids = [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id].sort();
      const ordenes = [
        ids,
        [...ids].reverse(),
        [ids[1], ids[2], ids[0]] as string[],
        [ids[2], ids[0], ids[1]] as string[],
      ];
      const alumnos = [];
      for (let i = 0; i < 10; i++) alumnos.push(await crearAlumnoVencido(ctx, esc));

      const respuestas = await Promise.all(
        alumnos.map((alumno, i) =>
          registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
            seleccion: { claseIds: ordenes[i % ordenes.length] as string[] },
          }).then((r) => r.respuesta),
        ),
      );

      sinErroresDelServidor(respuestas);
      for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto).toBe(201);
      for (const id of ids) expect(await ocupacion(DICIEMBRE, id)).toBe(10);
    });
  });
});
