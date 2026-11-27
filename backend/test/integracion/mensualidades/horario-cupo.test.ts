// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { en } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  ACCION_HORARIO,
  cambiarHorario,
  clasesDeLaMatricula,
  clasesSinCupo,
  crearAlumnoDeHorario,
  type EscenarioDeHorario,
  instantaneaDeHorario,
  prepararEscenarioDeHorario,
  resumen,
} from '../../utilidades/escenario-horario';
import {
  crearAlumnoVencido,
  DICIEMBRE,
  exigirRutasDe010a,
  INSTANTES,
  matriculaDelMes,
  NOVIEMBRE,
  registrarRenovacion,
  sembrarMatriculaDelMes,
  sembrarTitulares,
  sinErroresDelServidor,
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

// Criterio 36 (crítico, HU-03, RN-11): cada clase que entra necesita cupo libre para el alumno en el mes de la matrícula (definición de «Cupo libre», con las reservas de prioridad si es M+1); si no, 409 `SIN_CUPO` con `detalles.claseIds`. Las clases que se quedan no se vuelven a comprobar. Pruebas deterministas: un cambio y una renovación
// por el último cupo de c, uno solo entra; un cambio y un envío de la inscripción pública (005) por el último cupo de M, uno solo entra; dos alumnos que intercambian clases llenas reciben los dos `SIN_CUPO`. La ocupación nunca pasa del aforo.
// Cómo se prueba (como en el criterio 10 de la 010a): la prueba retiene con `SELECT … FOR UPDATE` la fila de la clase (la que toma `bloquearClasesParaCupo`), envía las peticiones en orden, comprueba con `pg_locks` que todas esperan y recién entonces suelta: la primera en llegar a la cola gana; se prueba en los dos órdenes de llegada, y a la vez sin retener nada.
// Lecturas estrictas elegidas: (1) «ahora» es el viernes 27/11/2026 a las 10:00 de Lima, dentro de la ventana de renovación de diciembre (N = 5): la matrícula de M es la de noviembre y la de M+1, la de diciembre; (2) el alumno que cambia la matrícula de M+1 es «titular» de una clase c si tiene una matrícula de M `VIGENTE` con c, sin contar la matrícula de M+1 que
// está cambiando («En todos los casos no cuenta la matrícula que A está cambiando»), y a los demás titulares de c, a los de otros alumnos y a quien no es titular los trata la definición; (3) `detalles.claseIds` trae solo las clases que entran y no tienen cupo, no las que se quedan; (4) un rechazo `SIN_CUPO` no escribe nada, ni siquiera las clases que sí tenían cupo;
// (5) una reserva de 24 horas sin vencer o una renovación en verificación ocupan cupo, una reserva vencida no (`contarOcupacion` de 005); (6) la ocupación se lee con el mismo conteo que la 005 (`ocupacionDeClase`: `VIGENTE`, o `RESERVADA` sin vencer).

const AFORO = 20;

describe('el cupo en la clase destino (criterio 36)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeHorario;
  let planSabados: PlanDePrueba;
  let sabado18: ClaseDePrueba;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeHorario(ctx);
    ({ plan: planSabados, clase: sabado18 } = await crearPlanYClaseSabado(esc.e));
    cookies = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const ocupacion = (claseId: string, mes: { anio: number; mes: number }) =>
    ocupacionDeClase(A(), claseId, mes, INSTANTES.viernes27);
  /** Un alumno de noviembre con su matrícula del sábado de las 17:00 (plan de una clase por semana), que puede pasarse al sábado de las 18:00. */
  const alumnoDelSabado17 = (opciones: { mes?: { anio: number; mes: number } } = {}) =>
    crearAlumnoDeHorario(ctx, esc, { plan: esc.planUnDia, claseIds: [esc.sabado17.id], ...opciones });
  const alSabado18 = (cookie: string, matriculaId: string) => cambiarHorario(ctx, cookie, matriculaId, [sabado18.id]);

  describe('en el mes en curso (noviembre)', () => {
    it('criterio 36: con un cupo libre (19 de 20), el primero entra (200) y el segundo recibe 409 SIN_CUPO con detalles.claseIds; la ocupación queda en 20 y el rechazado no cambia', async () => {
      await llenarClase(A(), sabado18.id, planSabados.id, AFORO - 1, { mes: NOVIEMBRE });
      const [primero, segundo] = [await alumnoDelSabado17(), await alumnoDelSabado17()];

      const entra = await alSabado18(cookies.secretaria, primero.matriculaId);
      const antes = await instantaneaDeHorario(esc);
      const sinCupo = await alSabado18(cookies.secretaria, segundo.matriculaId);

      expect(entra.status, entra.texto).toBe(200);
      expect(resumen(sinCupo), sinCupo.texto).toEqual([409, 'SIN_CUPO']);
      expect(clasesSinCupo(sinCupo)).toEqual([sabado18.id]);
      expect(await instantaneaDeHorario(esc), 'el rechazo no escribe ni audita').toBe(antes);
      expect(await clasesDeLaMatricula(A(), primero.matriculaId)).toEqual([sabado18.id]);
      expect(await clasesDeLaMatricula(A(), segundo.matriculaId)).toEqual([esc.sabado17.id]);
      expect(await ocupacion(sabado18.id, NOVIEMBRE)).toBe(AFORO);
    });

    it('criterio 36: con la clase llena (20 de 20) recibe 409 SIN_CUPO y no escribe ni audita', async () => {
      await llenarClase(A(), sabado18.id, planSabados.id, AFORO, { mes: NOVIEMBRE });
      const alumno = await alumnoDelSabado17();
      const antes = await instantaneaDeHorario(esc);

      const respuesta = await alSabado18(cookies.secretaria, alumno.matriculaId);

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(clasesSinCupo(respuesta)).toEqual([sabado18.id]);
      expect(await instantaneaDeHorario(esc)).toBe(antes);
      expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).toEqual([]);
    });

    it.each([
      [
        'una reserva de 24 horas sin vencer',
        'RESERVADA',
        new Date(INSTANTES.viernes27.getTime() + 3 * 60 * 60 * 1000),
        409,
      ],
      ['una matrícula en verificación (RESERVADA sin vencimiento)', 'RESERVADA', null, 409],
      [
        'una reserva de 24 horas ya vencida',
        'RESERVADA',
        new Date(INSTANTES.viernes27.getTime() - 60 * 60 * 1000),
        200,
      ],
    ] as const)(
      'criterio 36: con 20 matrículas que son %s en la clase, el cambio responde %i',
      async (_nombre, estado, reservaVenceEn, esperado) => {
        await llenarClase(A(), sabado18.id, planSabados.id, AFORO, { mes: NOVIEMBRE, estado, reservaVenceEn });
        const alumno = await alumnoDelSabado17();

        const respuesta = await alSabado18(cookies.secretaria, alumno.matriculaId);

        expect(respuesta.status, respuesta.texto).toBe(esperado);
        if (esperado === 409) expect(resumen(respuesta)).toEqual([409, 'SIN_CUPO']);
      },
    );

    it('criterio 36: las matrículas FINALIZADAS y CANCELADAS no ocupan cupo: con 20 de ellas en la clase, el cambio entra', async () => {
      await llenarClase(A(), sabado18.id, planSabados.id, AFORO, { mes: NOVIEMBRE });
      await ejecutarEstado(A(), sabado18.id, 'FINALIZADA', AFORO / 2);
      await ejecutarEstado(A(), sabado18.id, 'CANCELADA', AFORO / 2);
      const alumno = await alumnoDelSabado17();

      const respuesta = await alSabado18(cookies.secretaria, alumno.matriculaId);

      expect(respuesta.status, respuesta.texto).toBe(200);
    });

    it('criterio 36: las clases que se quedan no se vuelven a comprobar: con el miércoles de las 18:00 pasado de su aforo (21 de 20), el cambio del lunes por el de las 17:00 entra', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await llenarClase(A(), esc.e.miercoles.id, esc.e.plan.id, AFORO, { mes: NOVIEMBRE });
      expect(await ocupacion(esc.e.miercoles.id, NOVIEMBRE), 'el miércoles ya tiene 21 de 20, con el alumno').toBe(
        AFORO + 1,
      );

      const respuesta = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [
        esc.e.lunes17.id,
        esc.e.miercoles.id,
        esc.e.viernes.id,
      ]);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(await ocupacion(esc.e.miercoles.id, NOVIEMBRE), 'la clase que se queda sigue como estaba').toBe(AFORO + 1);
    });

    it('criterio 36: con una clase que entra con cupo y otra llena, detalles.claseIds trae solo la llena y no se escribe ninguna (ni la que sí tenía cupo)', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await llenarClase(A(), esc.miercoles19.id, esc.e.plan.id, AFORO, { mes: NOVIEMBRE });
      const antes = await instantaneaDeHorario(esc);

      const respuesta = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [
        esc.e.lunes17.id,
        esc.miercoles19.id,
        esc.e.viernes.id,
      ]);

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(clasesSinCupo(respuesta)).toEqual([esc.miercoles19.id]);
      expect(await instantaneaDeHorario(esc)).toBe(antes);
    });

    it('criterio 36: con dos clases llenas que entran, detalles.claseIds trae las dos', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await llenarClase(A(), esc.e.lunes17.id, esc.e.plan.id, AFORO, { mes: NOVIEMBRE });
      await llenarClase(A(), esc.miercoles19.id, esc.e.plan.id, AFORO, { mes: NOVIEMBRE });

      const respuesta = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [
        esc.e.lunes17.id,
        esc.miercoles19.id,
        esc.e.viernes.id,
      ]);

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(clasesSinCupo(respuesta)).toEqual([esc.e.lunes17.id, esc.miercoles19.id].sort());
    });
  });

  describe('en el mes siguiente (diciembre) con las reservas de prioridad (D-06)', () => {
    /** Un alumno con la matrícula de diciembre (en el sábado de las 17:00, plan de una clase por semana) y, si se pide, con la de noviembre en la clase dada. */
    async function alumnoDeDiciembre(opciones: { noviembreEn?: ClaseDePrueba } = {}) {
      const alumno = await crearAlumnoDeHorario(ctx, esc, {
        plan: esc.planUnDia,
        claseIds: [(opciones.noviembreEn ?? esc.sabado17).id],
      });
      await sembrarMatriculaDelMes(A(), esc.planUnDia.id, [alumno.alumnoId], [esc.sabado17.id], DICIEMBRE);
      const diciembre = await matriculaDelMes(A(), alumno.alumnoId, DICIEMBRE);
      return { ...alumno, matriculaDeDiciembreId: diciembre.id };
    }

    it('criterio 36: con 19 titulares de la clase apartados (de 20), quien no es titular entra con el único lugar libre y el siguiente recibe SIN_CUPO: 20 − ocupación − reservas', async () => {
      await sembrarTitulares(A(), planSabados.id, AFORO - 1, { claseIds: [sabado18.id] });
      const [primero, segundo] = [await alumnoDeDiciembre(), await alumnoDeDiciembre()];

      const entra = await alSabado18(cookies.secretaria, primero.matriculaDeDiciembreId);
      const sinCupo = await alSabado18(cookies.secretaria, segundo.matriculaDeDiciembreId);

      expect(entra.status, entra.texto).toBe(200);
      expect(resumen(sinCupo), sinCupo.texto).toEqual([409, 'SIN_CUPO']);
      expect(clasesSinCupo(sinCupo)).toEqual([sabado18.id]);
      expect(await ocupacion(sabado18.id, DICIEMBRE)).toBe(1);
      expect(await ocupacion(sabado18.id, NOVIEMBRE)).toBe(AFORO - 1);
    });

    it('criterio 36: con 20 titulares apartados no queda ningún lugar para quien no es titular: 409 SIN_CUPO aunque diciembre esté vacío', async () => {
      await sembrarTitulares(A(), planSabados.id, AFORO, { claseIds: [sabado18.id] });
      const alumno = await alumnoDeDiciembre();
      const antes = await instantaneaDeHorario(esc);

      const respuesta = await alSabado18(cookies.secretaria, alumno.matriculaDeDiciembreId);

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(await instantaneaDeHorario(esc)).toBe(antes);
      expect(await ocupacion(sabado18.id, DICIEMBRE)).toBe(0);
    });

    it('criterio 36: un titular de la clase (con noviembre en ella y diciembre en otra) la toma con aforo − ocupación de diciembre, sin restarle las reservas, y no cuenta su propia matrícula de diciembre', async () => {
      await sembrarTitulares(A(), planSabados.id, AFORO - 1, { claseIds: [sabado18.id] });
      await llenarClase(A(), sabado18.id, planSabados.id, AFORO - 1, { mes: DICIEMBRE });
      const titular = await alumnoDeDiciembre({ noviembreEn: sabado18 });

      const respuesta = await alSabado18(cookies.secretaria, titular.matriculaDeDiciembreId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(await ocupacion(sabado18.id, DICIEMBRE)).toBe(AFORO);
    });

    it('criterio 36: con el mismo estado (19 de diciembre y 19 titulares apartados), quien no es titular recibe SIN_CUPO', async () => {
      await sembrarTitulares(A(), planSabados.id, AFORO - 1, { claseIds: [sabado18.id] });
      await llenarClase(A(), sabado18.id, planSabados.id, AFORO - 1, { mes: DICIEMBRE });
      const noTitular = await alumnoDeDiciembre();

      const respuesta = await alSabado18(cookies.secretaria, noTitular.matriculaDeDiciembreId);

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(sabado18.id, DICIEMBRE)).toBe(AFORO - 1);
    });

    it('criterio 36: un titular con la clase de diciembre llena (20 de 20) recibe 409 SIN_CUPO: nunca se pasa del aforo', async () => {
      await llenarClase(A(), sabado18.id, planSabados.id, AFORO, { mes: DICIEMBRE });
      const titular = await alumnoDeDiciembre({ noviembreEn: sabado18 });

      const respuesta = await alSabado18(cookies.secretaria, titular.matriculaDeDiciembreId);

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(sabado18.id, DICIEMBRE)).toBe(AFORO);
    });
  });

  describe('carreras por el último cupo (deterministas)', () => {
    /** Diciembre con 19 matrículas en la clase y un alumno que ya tiene su matrícula de diciembre en el sábado de las 17:00. */
    async function conUnCupoEnDiciembre() {
      exigirRutasDe010a(ctx.app);
      await llenarClase(A(), sabado18.id, planSabados.id, AFORO - 1, { mes: DICIEMBRE });
      const alumno = await crearAlumnoDeHorario(ctx, esc, {
        plan: esc.planUnDia,
        claseIds: [esc.sabado17.id],
        mes: DICIEMBRE,
      });
      const vencido = await crearAlumnoVencido(ctx, esc);
      return { alumno, vencido };
    }
    const renovarSabado = (alumnoId: string) =>
      registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumnoId, {
        total: '40.00',
        seleccion: { planId: planSabados.id, claseIds: [sabado18.id] },
      }).then((registro) => registro.respuesta);

    describe('un cambio y una renovación por el último cupo de diciembre', () => {
      it.each([
        ['el cambio llega primero', true],
        ['la renovación llega primero', false],
      ])(
        'criterio 36: %s: el primero entra (200 o 201) y el otro recibe 409 SIN_CUPO; la ocupación de diciembre queda en 20',
        async (_nombre, cambioPrimero) => {
          const { alumno, vencido } = await conUnCupoEnDiciembre();
          const cambio = () => alSabado18(cookies.secretaria, alumno.matriculaId);
          const renovacion = () => renovarSabado(vencido.alumnoId);

          const { resultados, todasEsperaron } = await conRetencion({
            academiaId: A(),
            retener: retenerClases([sabado18.id], A()),
            enviar: cambioPrimero ? [cambio, renovacion] : [renovacion, cambio],
            enOrden: true,
            liberar: 'COMMIT',
          });

          expect(todasEsperaron, 'las dos operaciones debían quedar esperando el bloqueo de la clase').toBe(true);
          sinErroresDelServidor(resultados);
          const [primera, segunda] = resultados as [RespuestaApi, RespuestaApi];
          expect(primera.status, primera.texto).toBe(cambioPrimero ? 200 : 201);
          expect(resumen(segunda), segunda.texto).toEqual([409, 'SIN_CUPO']);
          expect(await ocupacion(sabado18.id, DICIEMBRE)).toBe(AFORO);
        },
      );

      it.each([1, 2, 3])(
        'criterio 36: lo mismo a la vez, sin retener nada (ronda %i): un solo ganador y ningún 5xx; la ocupación queda en 20',
        async () => {
          const { alumno, vencido } = await conUnCupoEnDiciembre();

          const respuestas = await Promise.all([
            alSabado18(cookies.secretaria, alumno.matriculaId),
            renovarSabado(vencido.alumnoId),
          ]);

          sinErroresDelServidor(respuestas);
          expect(respuestas.filter((r) => r.status === 200 || r.status === 201)).toHaveLength(1);
          expect(respuestas.filter((r) => r.status === 409).map((r) => resumen(r))).toEqual([[409, 'SIN_CUPO']]);
          expect(await ocupacion(sabado18.id, DICIEMBRE)).toBe(AFORO);
        },
      );
    });

    describe('un cambio y un envío de la inscripción pública (005) por el último cupo de noviembre', () => {
      const enviarInscripcion = async () => {
        const cuerpo = await cuerpoInscripcion(esc.e, {
          plan: planSabados,
          clases: [sabado18],
          ahora: INSTANTES.viernes27,
        });
        return ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
      };

      it.each([
        ['el cambio llega primero', true],
        ['el envío llega primero', false],
      ])(
        'criterio 36: con un cupo libre en noviembre (19 de 20) y %s, uno solo ocupa: el primero 200 o 201 y el otro 409 SIN_CUPO; la ocupación de noviembre queda en 20',
        async (_nombre, cambioPrimero) => {
          await llenarClase(A(), sabado18.id, planSabados.id, AFORO - 1, { mes: NOVIEMBRE });
          const alumno = await alumnoDelSabado17();
          const cambio = () => alSabado18(cookies.secretaria, alumno.matriculaId);

          const { resultados, todasEsperaron } = await conRetencion({
            academiaId: A(),
            retener: retenerClases([sabado18.id], A()),
            enviar: cambioPrimero ? [cambio, enviarInscripcion] : [enviarInscripcion, cambio],
            enOrden: true,
            liberar: 'COMMIT',
          });

          expect(todasEsperaron, 'las dos operaciones debían quedar esperando el bloqueo de la clase').toBe(true);
          const [primera, segunda] = resultados as [RespuestaApi, RespuestaApi];
          expect(primera.status, primera.texto).toBe(cambioPrimero ? 200 : 201);
          expect(resumen(segunda), segunda.texto).toEqual([409, 'SIN_CUPO']);
          expect(await ocupacion(sabado18.id, NOVIEMBRE)).toBe(AFORO);
        },
      );

      it.each([1, 2, 3])(
        'criterio 36: lo mismo a la vez, sin retener nada (ronda %i): un solo ganador y ningún 5xx',
        async () => {
          await llenarClase(A(), sabado18.id, planSabados.id, AFORO - 1, { mes: NOVIEMBRE });
          const alumno = await alumnoDelSabado17();

          const [cambio, inscripcion] = await Promise.all([
            alSabado18(cookies.secretaria, alumno.matriculaId),
            enviarInscripcion(),
          ]);

          sinErroresDelServidor([cambio, inscripcion]);
          expect([cambio.status === 200, inscripcion.status === 201].filter(Boolean)).toHaveLength(1);
          const perdedora = cambio.status === 200 ? inscripcion : cambio;
          expect(resumen(perdedora), perdedora.texto).toEqual([409, 'SIN_CUPO']);
          expect(await ocupacion(sabado18.id, NOVIEMBRE)).toBe(AFORO);
        },
      );
    });

    describe('dos cambios por el último cupo', () => {
      it.each([
        ['el primer alumno', 0],
        ['el segundo alumno', 1],
      ])(
        'criterio 36: con un cupo libre (19 de 20) y llegando primero %s, entra solo ese: el otro recibe 409 SIN_CUPO y la ocupación queda en 20',
        async (_nombre, primero) => {
          await llenarClase(A(), sabado18.id, planSabados.id, AFORO - 1, { mes: NOVIEMBRE });
          const alumnos = [await alumnoDelSabado17(), await alumnoDelSabado17()];
          const pedir = (indice: number) => () =>
            alSabado18(cookies.secretaria, (alumnos[indice] as (typeof alumnos)[number]).matriculaId);

          const { resultados, todasEsperaron } = await conRetencion({
            academiaId: A(),
            retener: retenerClases([sabado18.id], A()),
            enviar: [pedir(primero), pedir(1 - primero)],
            enOrden: true,
            liberar: 'COMMIT',
          });

          expect(todasEsperaron).toBe(true);
          const [ganadora, perdedora] = resultados as [RespuestaApi, RespuestaApi];
          expect(ganadora.status, ganadora.texto).toBe(200);
          expect(resumen(perdedora), perdedora.texto).toEqual([409, 'SIN_CUPO']);
          expect(await clasesDeLaMatricula(A(), (alumnos[primero] as (typeof alumnos)[number]).matriculaId)).toEqual([
            sabado18.id,
          ]);
          expect(
            await clasesDeLaMatricula(A(), (alumnos[1 - primero] as (typeof alumnos)[number]).matriculaId),
          ).toEqual([esc.sabado17.id]);
          expect(await ocupacion(sabado18.id, NOVIEMBRE)).toBe(AFORO);
        },
      );
    });

    describe('dos alumnos que intercambian clases llenas', () => {
      it('criterio 36: el del sábado de las 17:00 pide el de las 18:00 y el del de las 18:00 pide el de las 17:00, las dos clases llenas (20 de 20): los dos reciben 409 SIN_CUPO, uno detrás del otro, y la ocupación sigue en 20 y 20', async () => {
        await llenarClase(A(), esc.sabado17.id, planSabados.id, AFORO - 1, { mes: NOVIEMBRE });
        await llenarClase(A(), sabado18.id, planSabados.id, AFORO - 1, { mes: NOVIEMBRE });
        const x = await alumnoDelSabado17();
        const y = await crearAlumnoDeHorario(ctx, esc, { plan: esc.planUnDia, claseIds: [sabado18.id] });
        expect(await ocupacion(esc.sabado17.id, NOVIEMBRE)).toBe(AFORO);
        expect(await ocupacion(sabado18.id, NOVIEMBRE)).toBe(AFORO);

        const deX = await alSabado18(cookies.secretaria, x.matriculaId);
        const deY = await cambiarHorario(ctx, cookies.secretaria, y.matriculaId, [esc.sabado17.id]);

        expect(resumen(deX), deX.texto).toEqual([409, 'SIN_CUPO']);
        expect(clasesSinCupo(deX)).toEqual([sabado18.id]);
        expect(resumen(deY), deY.texto).toEqual([409, 'SIN_CUPO']);
        expect(clasesSinCupo(deY)).toEqual([esc.sabado17.id]);
        expect(await ocupacion(esc.sabado17.id, NOVIEMBRE)).toBe(AFORO);
        expect(await ocupacion(sabado18.id, NOVIEMBRE)).toBe(AFORO);
      });

      it.each([
        ['llega primero el del sábado de las 17:00', true],
        ['llega primero el del sábado de las 18:00', false],
      ])(
        'criterio 36: a la vez, con las dos clases retenidas por la prueba y %s: los dos reciben 409 SIN_CUPO, sin 40P01 ni 5xx, y la ocupación sigue en 20 y 20',
        async (_nombre, primeroX) => {
          await llenarClase(A(), esc.sabado17.id, planSabados.id, AFORO - 1, { mes: NOVIEMBRE });
          await llenarClase(A(), sabado18.id, planSabados.id, AFORO - 1, { mes: NOVIEMBRE });
          const x = await alumnoDelSabado17();
          const y = await crearAlumnoDeHorario(ctx, esc, { plan: esc.planUnDia, claseIds: [sabado18.id] });
          const deX = () => alSabado18(cookies.secretaria, x.matriculaId);
          const deY = () => cambiarHorario(ctx, cookies.secretaria, y.matriculaId, [esc.sabado17.id]);

          const { resultados, todasEsperaron } = await conRetencion({
            academiaId: A(),
            retener: retenerClases([esc.sabado17.id, sabado18.id], A()),
            enviar: primeroX ? [deX, deY] : [deY, deX],
            enOrden: true,
            liberar: 'COMMIT',
          });

          expect(todasEsperaron, 'los dos cambios debían quedar esperando las clases retenidas').toBe(true);
          sinErroresDelServidor(resultados);
          for (const respuesta of resultados) expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SIN_CUPO']);
          expect(await ocupacion(esc.sabado17.id, NOVIEMBRE)).toBe(AFORO);
          expect(await ocupacion(sabado18.id, NOVIEMBRE)).toBe(AFORO);
          expect(await clasesDeLaMatricula(A(), x.matriculaId)).toEqual([esc.sabado17.id]);
          expect(await clasesDeLaMatricula(A(), y.matriculaId)).toEqual([sabado18.id]);
        },
      );
    });
  });
});

/** Cambia el estado de `cantidad` matrículas de noviembre de la clase (como dueño) para probar que las cerradas no ocupan cupo. */
async function ejecutarEstado(
  academiaId: string,
  claseId: string,
  estado: 'FINALIZADA' | 'CANCELADA',
  cantidad: number,
): Promise<void> {
  await ejecutarComo(
    'propietario',
    `UPDATE matriculas SET estado = $3::estado_matricula, reserva_vence_en = NULL
      WHERE academia_id = $1::uuid AND id IN (
        SELECT m.id FROM matriculas m JOIN matricula_clases mc ON mc.academia_id = m.academia_id AND mc.matricula_id = m.id
         WHERE m.academia_id = $1::uuid AND mc.clase_id = $2::uuid AND m.estado = 'VIGENTE' AND m.anio = 2026 AND m.mes = 11
         ORDER BY m.id LIMIT $4)`,
    [academiaId, claseId, estado, cantidad],
    { academiaId },
  );
}
