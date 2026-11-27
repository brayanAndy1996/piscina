// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  ejecutarCierre,
  estadoDeLaMatricula,
  estadoDelAlumno,
  NOVIEMBRE as NOVIEMBRE_CIERRE,
} from '../../utilidades/escenario-cierre';
import {
  cuerpoParaMes,
  enviarPublico,
  type EscenarioMesSiguiente,
  INSTANTE,
  MES_DIC,
  prepararEscenarioDeMesSiguiente,
} from '../../utilidades/escenario-mes-siguiente';
import { cambiarHorario, clasesDeLaMatricula, ordenados } from '../../utilidades/escenario-horario';
import { cuerpoCobro, rutaCobro, sembrarCobrable } from '../../utilidades/escenario-pagos';
import {
  abrirCajaPara,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  DICIEMBRE,
  matriculaDelMes,
  NOVIEMBRE,
  registrarRenovacion,
  resumen,
  sembrarTitulares,
  sinErroresDelServidor,
} from '../../utilidades/escenario-renovacion';
import {
  conRetencion,
  cuerpoInscripcion,
  llenarClase,
  ocupacionDeClase,
  type RespuestaApi,
  retenerClases,
  solicitudDe,
} from '../../utilidades/inscripciones';

// Criterio 7 (crítico, RN-11, D-06): pruebas deterministas (espera comprobada en `pg_locks` con `pg_blocking_pids`), con `RELOJ` fijo en la ventana: dos envíos públicos para M+1 por el último lugar libre de c, uno 201 y el otro `SIN_CUPO`; un envío público para M+1 y la renovación de M+1 de un alumno
// sin prioridad (010a) por el último lugar libre, uno solo ocupa; un envío público para M+1 y la renovación de un titular de c, con un solo lugar libre más la reserva del titular, los dos 201; un envío público para M+1 y un cambio de horario (010c) que lleva una matrícula de M+1 a c por el último lugar libre,
// uno solo entra; un envío para M y otro para M+1 de la misma clase, con un lugar libre en cada mes, los dos 201; dos envíos para M+1 con `[c1, c2]` y `[c2, c1]` a la vez terminan sin `40P01` ni 500. Después de cada prueba, la ocupación de cada mes es como mucho el aforo.
// Criterio 8 (crítico, «Cupo de una clase» de 004; «Orden de bloqueos» de 005): el envío para M+1 sigue el orden de la 005 (el actor → los consultivos → las filas del cliente → `bloquearClasesParaCupo` con todas las clases en una sola llamada → la ocupación y las reservas de prioridad → las escrituras); la configuración se lee en la misma
// transacción. Pruebas deterministas sin `40P01`, a la vez que, sobre la misma clase: la renovación de un titular (010a), un cambio de horario (010c), el cobro en efectivo de otra solicitud (007a) y la tarea del cierre de mes.
// Cómo se prueba (como el criterio 10 de la 010a y el 39 de la 010c): la prueba retiene con `SELECT … FOR UPDATE` la fila de la clase (la que toma `bloquearClasesParaCupo`), envía las operaciones en orden, comprueba con `pg_blocking_pids` que todas esperan y recién entonces suelta: la primera en llegar a la cola gana. Para el cruce de
// clases, el envío pide las clases en orden descendente de id y la otra operación en ascendente, y se retiene la de menor id: una implementación que bloquee en el orden recibido forma un ciclo en alguno de los dos órdenes y termina en `40P01` (500).

const INTERBLOQUEO = /40P01|deadlock|interbloqueo/i;

describe('el último cupo simultáneo y el orden de bloqueos del envío para el mes siguiente (criterios 7 y 8)', () => {
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
  const ocupacion = (claseId: string, mes: { anio: number; mes: number }) =>
    ocupacionDeClase(A(), claseId, mes, INSTANTE.viernes27);
  /** El envío de un cliente nuevo para `mes` en c (plan de una clase por semana de S/ 40.00). */
  const enviarAC = async (mes = MES_DIC): Promise<RespuestaApi> =>
    enviarPublico(ctx, await cuerpoParaMes(esc.e, mes, { plan: esc.planUnDia, clases: [esc.c] }));
  const renovarC = async (alumnoId: string): Promise<RespuestaApi> =>
    (
      await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumnoId, {
        total: '40.00',
        seleccion: { planId: esc.planUnDia.id, claseIds: [esc.c.id] },
      })
    ).respuesta;
  /** Las tres clases de los lunes, miércoles y viernes de las 18:00 con los ids ordenados. */
  const tresClases = () => {
    const todas = [esc.e.lunes, esc.e.miercoles, esc.e.viernes];
    return [...todas].sort((a, b) => (a.id < b.id ? -1 : 1));
  };
  const envioConClases = async (clases: { id: string; dia_semana: number; hora_inicio: string }[]) =>
    enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC, { clases }));

  describe('criterio 7: dos envíos públicos por el último lugar libre de c', () => {
    it.each([
      ['el primero', 0, 1],
      ['el segundo', 1, 0],
    ])(
      'criterio 7: con un lugar libre en diciembre (19 de 20) y %s en llegar a la cola: uno 201 y el otro 409 SIN_CUPO; diciembre queda en 20',
      async (_nombre, quien, otro) => {
        await llenarClase(A(), esc.c.id, esc.planUnDia.id, 19, { mes: DICIEMBRE });
        const cuerpos = [
          await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDia, clases: [esc.c] }),
          await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDia, clases: [esc.c] }),
        ];
        const enviar = (i: number) => () => enviarPublico(ctx, cuerpos[i]);

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: A(),
          retener: retenerClases([esc.c.id], A()),
          enviar: [enviar(quien), enviar(otro)],
          enOrden: true,
          liberar: 'COMMIT',
        });

        expect(todasEsperaron, 'los dos envíos debían quedar esperando el bloqueo de la clase').toBe(true);
        const [primera, segunda] = resultados as [RespuestaApi, RespuestaApi];
        expect(primera.status, primera.texto).toBe(201);
        expect(resumen(segunda), segunda.texto).toEqual([409, 'SIN_CUPO']);
        expect(await ocupacion(esc.c.id, DICIEMBRE)).toBe(20);
        expect(await ocupacion(esc.c.id, NOVIEMBRE)).toBe(0);
      },
    );

    it.each([1, 2, 3])(
      'criterio 7: cinco envíos a la vez (sin retener nada, ronda %i) por dos lugares libres dejan exactamente dos 201, el resto 409 SIN_CUPO, sin 5xx, y diciembre en 20',
      async () => {
        await llenarClase(A(), esc.c.id, esc.planUnDia.id, 18, { mes: DICIEMBRE });
        const cuerpos = [];
        for (let i = 0; i < 5; i++)
          cuerpos.push(await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDia, clases: [esc.c] }));

        const respuestas = await Promise.all(cuerpos.map((cuerpo) => enviarPublico(ctx, cuerpo)));

        sinErroresDelServidor(respuestas);
        expect(respuestas.filter((r) => r.status === 201)).toHaveLength(2);
        expect(respuestas.filter((r) => r.status !== 201).map((r) => resumen(r))).toEqual([
          [409, 'SIN_CUPO'],
          [409, 'SIN_CUPO'],
          [409, 'SIN_CUPO'],
        ]);
        expect(await ocupacion(esc.c.id, DICIEMBRE)).toBe(20);
      },
    );
  });

  describe('criterio 7: un envío público y la renovación de un alumno sin prioridad por el último lugar libre', () => {
    it.each([
      ['el envío llega primero', true],
      ['la renovación llega primero', false],
    ])(
      'criterio 7: con un lugar libre en diciembre (19 de 20) y %s: uno solo ocupa (el primero 201, el otro 409 SIN_CUPO) y diciembre queda en 20',
      async (_nombre, envioPrimero) => {
        await llenarClase(A(), esc.c.id, esc.planUnDia.id, 19, { mes: DICIEMBRE });
        const vencido = await crearAlumnoVencido(ctx, esc);
        const envio = () => enviarAC();
        const renovacion = () => renovarC(vencido.alumnoId);

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: A(),
          retener: retenerClases([esc.c.id], A()),
          enviar: envioPrimero ? [envio, renovacion] : [renovacion, envio],
          enOrden: true,
          liberar: 'COMMIT',
        });

        expect(todasEsperaron, 'las dos operaciones debían quedar esperando el bloqueo de la clase').toBe(true);
        const [primera, segunda] = resultados as [RespuestaApi, RespuestaApi];
        expect(primera.status, primera.texto).toBe(201);
        expect(resumen(segunda), segunda.texto).toEqual([409, 'SIN_CUPO']);
        expect(await ocupacion(esc.c.id, DICIEMBRE)).toBe(20);
      },
    );

    it.each([1, 2, 3])(
      'criterio 7: lo mismo a la vez, sin retener nada (ronda %i): un solo ganador y ningún 5xx',
      async () => {
        await llenarClase(A(), esc.c.id, esc.planUnDia.id, 19, { mes: DICIEMBRE });
        const vencido = await crearAlumnoVencido(ctx, esc);

        const [envio, renovacion] = await Promise.all([enviarAC(), renovarC(vencido.alumnoId)]);

        sinErroresDelServidor([envio, renovacion]);
        expect([envio.status, renovacion.status].filter((estado) => estado === 201)).toHaveLength(1);
        // El que pierde recibe SIN_CUPO (nunca MES_CAMBIO ni otro error).
        for (const respuesta of [envio, renovacion]) {
          expect(respuesta.status === 201 || resumen(respuesta)[1] === 'SIN_CUPO', respuesta.texto).toBe(true);
        }
        expect(await ocupacion(esc.c.id, DICIEMBRE)).toBe(20);
      },
    );
  });

  describe('criterio 7: un envío público y la renovación de un titular de c, con un solo lugar libre más la reserva del titular', () => {
    it.each([
      ['el envío primero', true],
      ['el titular primero', false],
    ])(
      'criterio 7: con 19 titulares apartados (20 − 19 = 1 lugar para el cliente y 20 para el titular) y %s: los dos 201 y diciembre queda en 2',
      async (_nombre, envioPrimero) => {
        const titulares = await sembrarTitulares(A(), esc.planUnDia.id, 19, { claseIds: [esc.c.id] });
        const envio = () => enviarAC();
        const renovacion = () => renovarC(titulares[0] as string);

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: A(),
          retener: retenerClases([esc.c.id], A()),
          enviar: envioPrimero ? [envio, renovacion] : [renovacion, envio],
          enOrden: true,
          liberar: 'COMMIT',
        });

        expect(todasEsperaron).toBe(true);
        for (const respuesta of resultados) expect(respuesta.status, respuesta.texto).toBe(201);
        expect(await ocupacion(esc.c.id, DICIEMBRE)).toBe(2);
        expect(await ocupacion(esc.c.id, NOVIEMBRE)).toBe(19);
      },
    );

    it('criterio 7: tres titulares y un cliente a la vez (sin retener nada) por 19 reservas: todos entran y diciembre no pasa de 20', async () => {
      const titulares = await sembrarTitulares(A(), esc.planUnDia.id, 19, { claseIds: [esc.c.id] });

      const respuestas = await Promise.all([
        renovarC(titulares[0] as string),
        renovarC(titulares[1] as string),
        enviarAC(),
        renovarC(titulares[2] as string),
      ]);

      sinErroresDelServidor(respuestas);
      for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await ocupacion(esc.c.id, DICIEMBRE)).toBe(4);
    });
  });

  describe('criterio 7: un envío público y un cambio de horario (010c) que lleva una matrícula de M+1 a c por el último lugar libre', () => {
    it.each([
      ['el envío llega primero', true],
      ['el cambio llega primero', false],
    ])(
      'criterio 7: con un lugar libre en c en diciembre (19 de 20) y %s: uno solo entra (el primero 200 o 201, el otro 409 SIN_CUPO) y diciembre queda en 20',
      async (_nombre, envioPrimero) => {
        await llenarClase(A(), esc.c.id, esc.planUnDia.id, 19, { mes: DICIEMBRE });
        const [alumnoId] = await sembrarTitulares(A(), esc.planUnDia.id, 1, {
          claseIds: [esc.martes10.id],
          mes: DICIEMBRE,
        });
        const matricula = await matriculaDelMes(A(), alumnoId as string, DICIEMBRE);
        const envio = () => enviarAC();
        const cambio = () => cambiarHorario(ctx, cookies.secretaria, matricula.id, [esc.c.id]);

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: A(),
          retener: retenerClases([esc.c.id], A()),
          enviar: envioPrimero ? [envio, cambio] : [cambio, envio],
          enOrden: true,
          liberar: 'COMMIT',
        });

        expect(todasEsperaron, 'las dos operaciones debían quedar esperando el bloqueo de la clase').toBe(true);
        const [primera, segunda] = resultados as [RespuestaApi, RespuestaApi];
        expect([200, 201], primera.texto).toContain(primera.status);
        expect(resumen(segunda), segunda.texto).toEqual([409, 'SIN_CUPO']);
        expect(await ocupacion(esc.c.id, DICIEMBRE)).toBe(20);
        expect(await clasesDeLaMatricula(A(), matricula.id)).toEqual(envioPrimero ? [esc.martes10.id] : [esc.c.id]);
      },
    );
  });

  describe('criterio 7: un envío para M y otro para M+1 de la misma clase, con un lugar libre en cada mes', () => {
    it.each([
      ['el de noviembre primero', true],
      ['el de diciembre primero', false],
    ])(
      'criterio 7: con 19 de 20 en cada mes y %s: los dos 201 y cada mes queda en 20',
      async (_nombre, noviembrePrimero) => {
        await llenarClase(A(), esc.c.id, esc.planUnDia.id, 19, { mes: NOVIEMBRE });
        await llenarClase(A(), esc.c.id, esc.planUnDia.id, 19, { mes: DICIEMBRE });
        const deNoviembre = async () =>
          enviarPublico(
            ctx,
            await cuerpoInscripcion(esc.e, { plan: esc.planUnDia, clases: [esc.c], ahora: INSTANTE.viernes27 }),
          );
        const deDiciembre = () => enviarAC();

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: A(),
          retener: retenerClases([esc.c.id], A()),
          enviar: noviembrePrimero ? [deNoviembre, deDiciembre] : [deDiciembre, deNoviembre],
          enOrden: true,
          liberar: 'COMMIT',
        });

        expect(todasEsperaron).toBe(true);
        for (const respuesta of resultados) expect(respuesta.status, respuesta.texto).toBe(201);
        const meses = resultados.map((respuesta) => solicitudDe(respuesta).cotizacion['mes']).sort();
        expect(meses).toEqual(['2026-11', '2026-12']);
        expect(await ocupacion(esc.c.id, NOVIEMBRE)).toBe(20);
        expect(await ocupacion(esc.c.id, DICIEMBRE)).toBe(20);
      },
    );
  });

  describe('criterio 7: dos envíos para M+1 con las mismas clases en orden contrario', () => {
    it.each([
      ['el ascendente llega primero', true],
      ['el descendente llega primero', false],
    ])(
      'criterio 7: [c1, c2, c3] y [c3, c2, c1] con la clase de menor id retenida y %s: los dos terminan sin 40P01 y con 201; la ocupación de cada clase en diciembre es 2',
      async (_nombre, ascendentePrimero) => {
        const ascendentes = tresClases();
        const descendentes = [...ascendentes].reverse();
        const ascendente = () => envioConClases(ascendentes);
        const descendente = () => envioConClases(descendentes);

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: A(),
          retener: retenerClases([ascendentes[0]?.id as string], A()),
          enviar: ascendentePrimero ? [ascendente, descendente] : [descendente, ascendente],
          enOrden: true,
          liberar: 'COMMIT',
        });

        expect(todasEsperaron, 'los dos envíos debían quedar esperando la clase retenida').toBe(true);
        sinErroresDelServidor(resultados);
        for (const respuesta of resultados) expect(respuesta.status, respuesta.texto).toBe(201);
        for (const clase of ascendentes) expect(await ocupacion(clase.id, DICIEMBRE), clase.id).toBe(2);
      },
    );

    it('criterio 7: con la clase de mayor id retenida, el mismo cruce termina igual de bien', async () => {
      const ascendentes = tresClases();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: A(),
        retener: retenerClases([ascendentes[2]?.id as string], A()),
        enviar: [() => envioConClases(ascendentes), () => envioConClases([...ascendentes].reverse())],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      sinErroresDelServidor(resultados);
      for (const respuesta of resultados) expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 7: diez envíos simultáneos con las tres clases en distinto orden terminan sin 40P01 ni 5xx y con la ocupación de cada clase en 10', async () => {
      const ids = tresClases();
      const ordenes = [ids, [...ids].reverse(), [ids[1], ids[2], ids[0]], [ids[2], ids[0], ids[1]]] as (typeof ids)[];

      const respuestas = await Promise.all(
        Array.from({ length: 10 }, (_, i) => envioConClases(ordenes[i % ordenes.length] as typeof ids)),
      );

      sinErroresDelServidor(respuestas);
      for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto).toBe(201);
      for (const clase of ids) expect(await ocupacion(clase.id, DICIEMBRE)).toBe(10);
    });
  });

  describe('criterio 8: el envío para M+1 a la vez que otras operaciones sobre las mismas clases', () => {
    describe.each([
      ['el envío llega primero', true],
      ['la otra operación llega primero', false],
    ])('%s', (_nombre, envioPrimero) => {
      const ordenar = (envio: () => Promise<RespuestaApi>, otra: () => Promise<RespuestaApi>) =>
        envioPrimero ? [envio, otra] : [otra, envio];
      const delOrden = (resultados: RespuestaApi[], cual: 'envio' | 'otra') =>
        resultados[(cual === 'envio') === envioPrimero ? 0 : 1] as RespuestaApi;

      async function cruce(
        clasesRetenidas: string[],
        enviar: (() => Promise<RespuestaApi>)[],
      ): Promise<RespuestaApi[]> {
        const { resultados, todasEsperaron } = await conRetencion<RespuestaApi>({
          academiaId: A(),
          retener: retenerClases(clasesRetenidas, A()),
          enviar,
          enOrden: true,
          liberar: 'COMMIT',
        });
        expect(todasEsperaron, 'las dos operaciones debían quedar esperando lo que retuvo la prueba').toBe(true);
        sinErroresDelServidor(resultados);
        for (const respuesta of resultados) expect(respuesta.texto).not.toMatch(INTERBLOQUEO);
        return resultados;
      }

      it('criterio 8: el envío (clases en orden descendente) y la renovación de un titular (en ascendente) terminan sin 40P01: 201 y 201', async () => {
        const titular = await crearAlumnoDeNoviembre(ctx, esc);
        const ascendentes = tresClases();
        const renovacion = async () =>
          (
            await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, titular.alumnoId, {
              seleccion: { claseIds: ascendentes.map((c) => c.id) },
            })
          ).respuesta;

        const resultados = await cruce(
          [ascendentes[0]?.id as string],
          ordenar(() => envioConClases([...ascendentes].reverse()), renovacion),
        );

        expect(delOrden(resultados, 'envio').status, delOrden(resultados, 'envio').texto).toBe(201);
        expect(delOrden(resultados, 'otra').status, delOrden(resultados, 'otra').texto).toBe(201);
        for (const clase of ascendentes) expect(await ocupacion(clase.id, DICIEMBRE), clase.id).toBe(2);
      });

      it('criterio 8: el envío y un cambio de horario (010c) de una matrícula de diciembre con las mismas clases terminan sin 40P01: 201 y 200', async () => {
        const [alumnoId] = await sembrarTitulares(A(), esc.e.plan.id, 1, {
          claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
          mes: DICIEMBRE,
        });
        const matricula = await matriculaDelMes(A(), alumnoId as string, DICIEMBRE);
        const nuevas = [esc.e.lunes17, esc.miercoles19, esc.e.viernes];
        const porId = [...nuevas].sort((a, b) => (a.id < b.id ? -1 : 1));
        const cambio = () =>
          cambiarHorario(
            ctx,
            cookies.secretaria,
            matricula.id,
            porId.map((c) => c.id),
          );

        const resultados = await cruce(
          [porId[0]?.id as string],
          ordenar(() => envioConClases([...porId].reverse()), cambio),
        );

        expect(delOrden(resultados, 'envio').status, delOrden(resultados, 'envio').texto).toBe(201);
        expect(delOrden(resultados, 'otra').status, delOrden(resultados, 'otra').texto).toBe(200);
        expect(await clasesDeLaMatricula(A(), matricula.id)).toEqual(ordenados(porId.map((c) => c.id)));
      });

      it('criterio 8: el envío y el cobro en efectivo de otra solicitud con las mismas clases terminan sin 40P01: 201 y 201', async () => {
        const ascendentes = tresClases();
        const otra = await sembrarCobrable(esc.e, {
          planId: esc.e.plan.id,
          claseIds: ascendentes.map((c) => c.id),
          ahora: INSTANTE.viernes27,
        });
        const cobro = () =>
          ctx.http.post(rutaCobro(otra.solicitudId), cuerpoCobro('42.00'), { cookie: cookies.secretaria });

        const resultados = await cruce(
          [ascendentes[0]?.id as string],
          ordenar(() => envioConClases([...ascendentes].reverse()), cobro),
        );

        expect(delOrden(resultados, 'envio').status, delOrden(resultados, 'envio').texto).toBe(201);
        expect(delOrden(resultados, 'otra').status, delOrden(resultados, 'otra').texto).toBe(201);
      });
    });

    it.each([1, 2, 3])(
      'criterio 8: el envío para diciembre a las 23:59:59.900 del 30/11 y la tarea del cierre de mes (ronda %i) a la vez terminan sin 40P01: el envío responde 201 y el cierre finaliza noviembre de quien no renovó',
      async () => {
        const titulares = await sembrarTitulares(A(), esc.e.plan.id, 3, { claseIds: tresClases().map((c) => c.id) });
        ctx.reloj.fijar(new Date(INSTANTE.martes1.getTime() - 100));

        const [respuesta] = await Promise.all([
          envioConClases([...tresClases()].reverse()),
          ejecutarCierre(ctx, INSTANTE.martes1),
        ]);

        sinErroresDelServidor([respuesta]);
        expect(respuesta.status, respuesta.texto).toBe(201);
        for (const alumnoId of titulares) {
          expect(await estadoDeLaMatricula(A(), alumnoId, NOVIEMBRE_CIERRE), 'noviembre se finaliza').toBe(
            'FINALIZADA',
          );
          expect(await estadoDelAlumno(A(), alumnoId), 'sin diciembre queda vencido').toBe('ALUMNO_VENCIDO');
        }
        expect(await ocupacionDeClase(A(), tresClases()[0]?.id as string, DICIEMBRE, INSTANTE.martes1)).toBe(1);
      },
    );
  });
});
