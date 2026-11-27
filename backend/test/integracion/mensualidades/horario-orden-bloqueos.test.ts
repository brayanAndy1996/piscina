// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conFilaRetenida } from '../../utilidades/carreras';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { asistenciasDe, clasesUsadasDe, en, enLima, marcarManual } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoConMatriculas,
  DICIEMBRE as DICIEMBRE_CIERRE,
  ejecutarCierre,
  estadoDeLaMatricula,
  estadoDelAlumno,
  NOVIEMBRE as NOVIEMBRE_CIERRE,
  prepararEscenarioDeCierre,
  sembrarAlumno,
} from '../../utilidades/escenario-cierre';
import { ejecutarFaltas, inasistenciasDe } from '../../utilidades/escenario-faltas';
import {
  ACCION_HORARIO,
  ampliarEscenarioDeHorario,
  cambiarHorario,
  clasesDeLaMatricula,
  crearAlumnoDeHorario,
  crearAlumnoPagadoDeHorario,
  type EscenarioDeHorario,
  exigirRutasDe010c,
  ordenados,
  resumen,
} from '../../utilidades/escenario-horario';
import {
  crearAlumnoVencido,
  registrarRenovacion,
  retenerAlumno,
  retenerMatriculasDe,
  sinErroresDelServidor,
} from '../../utilidades/escenario-renovacion';
import {
  conRetencion,
  crearPlanYClaseSabado,
  llenarClase,
  ocupacionDeClase,
  type RespuestaApi,
  retenerClases,
} from '../../utilidades/inscripciones';
import { lineasJson } from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import type { ClaseDePrueba, PlanDePrueba, Retenedor } from '../../utilidades/planes-clases';
import { CLAVE_COMUN, cookieDeUsuario, crearUsuarioDePrueba } from '../../utilidades/usuarios';

// Criterio 39 (crítico, «Cupo de una clase» de 004): `bloquearActorVigente` → el alumno con `FOR UPDATE` → la matrícula con `FOR UPDATE` → `bloquearClasesParaCupo` con las clases que salen y las que entran, en una sola llamada → «ahora» → escrituras y auditoría. Pruebas deterministas sin `40P01`, a la vez que: el marcado del mismo alumno,
// la tarea de faltas, una renovación de otro alumno con la misma clase y el cierre de mes.
// Cómo se prueba (como el criterio 13 de la 010a y el 29 de la 010b): la prueba retiene una fila que las dos operaciones necesitan (la del alumno, sus matrículas o las clases), envía las dos operaciones en los dos órdenes de llegada, comprueba (con `pg_locks`) que las dos esperan y recién entonces suelta. Una implementación que bloquee en otro orden (la matrícula antes que el alumno, o
// las clases en el orden recibido en lugar de en una sola llamada ordenada) forma un ciclo con la otra operación en alguno de los dos órdenes y termina en `40P01` (500).
// Lecturas estrictas elegidas: (1) «sin `40P01`» es: ninguna respuesta 5xx, ningún texto con `40P01`, `deadlock` o `interbloqueo` (ni en las respuestas ni en el registro técnico) y ninguna línea de error en el registro; (2) el marcado y el cambio se cruzan el lunes 30/11/2026 a las 18:05 de Lima: si el marcado llega primero, registra la asistencia de la clase de las 18:00 (201) y el cambio
// se hace después (200); si el cambio llega primero, la clase de las 18:00 ya no es suya, la del lunes de las 17:00 ya terminó y el marcado responde 409 `FUERA_DE_HORARIO`; (3) la tarea de faltas corre ese lunes a las 19:05: si llega primero, deja la falta de la clase de las 18:00; si llega el cambio primero, la clase quitada no genera falta (y la nueva, que empieza antes del cambio, tampoco); (4) para provocar el ciclo
// con la renovación, el cambio pide sus clases con las que entran en orden descendente de id y la renovación, en ascendente, y la prueba retiene la clase de menor id; (5) en el intercambio (dos alumnos con las clases cruzadas y cupo) se retiene la clase de menor id y los dos cambios terminan 200; (6) el cierre y el cambio se cruzan con `RELOJ` y reloj del cierre el 1/12 a las 08:00: el cambio es de la matrícula de diciembre y el cierre finaliza la de noviembre.

const INTERBLOQUEO = /40P01|deadlock|interbloqueo/i;
const LUNES_30_A_LAS_18_05 = enLima('2026-11-30', '18:05');
const LUNES_30_A_LAS_19_05 = enLima('2026-11-30', '19:05');
const VIERNES_27 = enLima('2026-11-27', '10:00');
const DIA_1_A_LAS_8 = enLima('2026-12-01', '08:00');

type Respuesta = Pick<RespuestaApi, 'status' | 'texto' | 'body'>;

describe('el orden de bloqueos del cambio de horario (criterio 39)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let esc: EscenarioDeHorario;

  beforeAll(async () => {
    ctx = await crearAppCarnet({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    exigirRutasDe010c(ctx.app);
    esc = await ampliarEscenarioDeHorario(ctx, await prepararEscenarioDeCierre(ctx));
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const delLunes17 = () => [esc.e.lunes17.id, esc.e.miercoles.id, esc.e.viernes.id];
  const errores = () =>
    lineasJson(lineas).filter((registro) => typeof registro['level'] === 'number' && registro['level'] >= 50);

  /** Las dos operaciones esperan lo retenido y, al soltarlo, terminan: sin 5xx ni interbloqueo. Devuelve las respuestas en el orden de `enviar`. */
  async function cruce(
    retener: (retenedor: Retenedor) => Promise<void>,
    enviar: (() => Promise<Respuesta>)[],
  ): Promise<Respuesta[]> {
    const { resultados, todasEsperaron } = await conRetencion<Respuesta>({
      academiaId: A(),
      retener,
      enviar,
      enOrden: true,
      liberar: 'COMMIT',
    });
    expect(todasEsperaron, 'las operaciones debían quedar esperando lo que retuvo la prueba').toBe(true);
    sinErroresDelServidor(resultados);
    expect(lineas.join('\n'), 'el registro técnico no menciona un interbloqueo').not.toMatch(INTERBLOQUEO);
    expect(errores(), 'ninguna operación registró un error').toEqual([]);
    return resultados;
  }

  describe.each([
    ['el cambio llega primero', true],
    ['la otra operación llega primero', false],
  ])('%s', (_nombre, cambioPrimero) => {
    const ordenar = (cambio: () => Promise<Respuesta>, otra: () => Promise<Respuesta>) =>
      cambioPrimero ? [cambio, otra] : [otra, cambio];
    const delOrden = (resultados: Respuesta[], cual: 'cambio' | 'otra') =>
      resultados[(cual === 'cambio') === cambioPrimero ? 0 : 1] as Respuesta;

    describe.each(['alumno', 'matriculas'] as const)(
      'con %s retenido por la prueba, y el marcado del mismo alumno',
      (retencion) => {
        it('criterio 39: el cambio y el marcado de asistencia terminan sin 40P01: el marcado registra la clase de las 18:00 solo si llega primero, y el cambio siempre se hace (200)', async () => {
          const alumno = await crearAlumnoDeHorario(ctx, esc);
          const cookie = en(ctx, esc, LUNES_30_A_LAS_18_05).secretaria;
          const retener =
            retencion === 'alumno' ? retenerAlumno(A(), alumno.alumnoId) : retenerMatriculasDe(A(), alumno.alumnoId);

          const resultados = await cruce(
            retener,
            ordenar(
              () => cambiarHorario(ctx, cookie, alumno.matriculaId, delLunes17()),
              () => marcarManual(ctx, cookie, alumno.alumnoId),
            ),
          );

          const cambio = delOrden(resultados, 'cambio');
          const marcado = delOrden(resultados, 'otra');
          expect(cambio.status, cambio.texto).toBe(200);
          expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(ordenados(delLunes17()));
          if (cambioPrimero) {
            expect(resumen(marcado), marcado.texto).toEqual([409, 'FUERA_DE_HORARIO']);
            expect(await asistenciasDe(A(), alumno.alumnoId)).toEqual([]);
            expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(0);
          } else {
            expect(marcado.status, marcado.texto).toBe(201);
            expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
            expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
          }
          expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).toHaveLength(1);
        });
      },
    );

    it('criterio 39: con la fila del alumno retenida, el cambio y la tarea de faltas del mismo alumno terminan sin 40P01: la falta de la clase de las 18:00 solo queda si la tarea llega primero', async () => {
      const alumno = await crearAlumnoPagadoDeHorario(ctx, esc, {
        claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
      });
      const cookie = en(ctx, esc, LUNES_30_A_LAS_19_05).secretaria;
      const faltas = async (): Promise<Respuesta> => {
        await ejecutarFaltas(ctx, LUNES_30_A_LAS_19_05);
        return { status: 200, texto: '', body: null };
      };

      const resultados = await cruce(
        retenerAlumno(A(), alumno.alumnoId),
        ordenar(() => cambiarHorario(ctx, cookie, alumno.matriculaId, delLunes17()), faltas),
      );

      const cambio = delOrden(resultados, 'cambio');
      expect(cambio.status, cambio.texto).toBe(200);
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(ordenados(delLunes17()));
      const registradas = (await inasistenciasDe(A(), alumno.alumnoId)).map((falta) => [falta.fecha, falta.clase_id]);
      expect(registradas).toEqual(cambioPrimero ? [] : [['2026-11-30', esc.e.lunes.id]]);
    });

    it('criterio 39: con la clase de menor id retenida, el cambio (que pide las que entran en orden descendente) y la renovación de otro alumno (en orden ascendente) con las mismas clases terminan sin 40P01: 200 y 201', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const vencido = await crearAlumnoVencido(ctx, esc);
      const galletas = en(ctx, esc, VIERNES_27);
      const [menor, mayor] = ordenados([esc.e.lunes17.id, esc.miercoles19.id]) as [string, string];
      const renovar = async (): Promise<Respuesta> =>
        (
          await registrarRenovacion(ctx, esc, 'YAPE', galletas.secretaria, vencido.alumnoId, {
            seleccion: { claseIds: ordenados([esc.e.lunes17.id, esc.miercoles19.id, esc.e.viernes.id]) },
          })
        ).respuesta;
      const cambiar = () =>
        cambiarHorario(ctx, galletas.secretaria, alumno.matriculaId, [esc.e.viernes.id, mayor, menor]);

      const resultados = await cruce(retenerClases([menor], A()), ordenar(cambiar, renovar));

      const cambio = delOrden(resultados, 'cambio');
      const renovacion = delOrden(resultados, 'otra');
      expect(cambio.status, cambio.texto).toBe(200);
      expect(renovacion.status, renovacion.texto).toBe(201);
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(
        ordenados([esc.e.lunes17.id, esc.miercoles19.id, esc.e.viernes.id]),
      );
    });
  });

  describe('dos cambios con las clases cruzadas (el intercambio, con cupo)', () => {
    let sabado18: ClaseDePrueba;
    let planSabados: PlanDePrueba;

    beforeEach(async () => {
      ({ plan: planSabados, clase: sabado18 } = await crearPlanYClaseSabado(esc.e));
      await llenarClase(A(), esc.sabado17.id, planSabados.id, 5, { mes: NOVIEMBRE_CIERRE });
      await llenarClase(A(), sabado18.id, planSabados.id, 5, { mes: NOVIEMBRE_CIERRE });
    });

    it.each([
      ['llega primero el del sábado de las 17:00', true],
      ['llega primero el del sábado de las 18:00', false],
    ])(
      'criterio 39: con la clase de menor id retenida y %s, los dos terminan sin 40P01 y con 200: cada uno queda en la clase del otro y la ocupación de cada clase sigue en 6',
      async (_nombre, primeroX) => {
        const x = await crearAlumnoDeHorario(ctx, esc, { plan: esc.planUnDia, claseIds: [esc.sabado17.id] });
        const y = await crearAlumnoDeHorario(ctx, esc, { plan: esc.planUnDia, claseIds: [sabado18.id] });
        const cookie = en(ctx, esc, VIERNES_27).secretaria;
        const deX = () => cambiarHorario(ctx, cookie, x.matriculaId, [sabado18.id]);
        const deY = () => cambiarHorario(ctx, cookie, y.matriculaId, [esc.sabado17.id]);
        const [menor] = ordenados([esc.sabado17.id, sabado18.id]) as [string, string];

        const resultados = await cruce(retenerClases([menor], A()), primeroX ? [deX, deY] : [deY, deX]);

        for (const respuesta of resultados) expect(respuesta.status, respuesta.texto).toBe(200);
        expect(await clasesDeLaMatricula(A(), x.matriculaId)).toEqual([sabado18.id]);
        expect(await clasesDeLaMatricula(A(), y.matriculaId)).toEqual([esc.sabado17.id]);
        expect(await ocupacionDeClase(A(), esc.sabado17.id, NOVIEMBRE_CIERRE, VIERNES_27)).toBe(6);
        expect(await ocupacionDeClase(A(), sabado18.id, NOVIEMBRE_CIERRE, VIERNES_27)).toBe(6);
      },
    );
  });

  describe.each([
    ['el cierre llega primero', true],
    ['el cambio llega primero', false],
  ])('el cierre de mes y el cambio de la matrícula de diciembre: %s', (_nombre, cierrePrimero) => {
    describe.each(['alumno', 'matriculas'] as const)('con %s retenido por la prueba', (retencion) => {
      it('criterio 39: terminan sin 40P01: noviembre queda FINALIZADA, el cambio (200) deja las clases nuevas en diciembre y el alumno ALUMNO_ACTIVO, sin errores en el registro', async () => {
        const alumno: AlumnoConMatriculas = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [
            { mes: NOVIEMBRE_CIERRE, estado: 'VIGENTE', clasesUsadas: 4 },
            { mes: DICIEMBRE_CIERRE, estado: 'VIGENTE' },
          ],
        });
        const [, diciembreId] = alumno.matriculaIds as [string, string];
        const cookie = en(ctx, esc, DIA_1_A_LAS_8).secretaria;
        const cierre = async (): Promise<Respuesta> => {
          await ejecutarCierre(ctx, DIA_1_A_LAS_8);
          return { status: 200, texto: '', body: null };
        };
        const cambio = () => cambiarHorario(ctx, cookie, diciembreId, delLunes17());
        const retener =
          retencion === 'alumno' ? retenerAlumno(A(), alumno.alumnoId) : retenerMatriculasDe(A(), alumno.alumnoId);

        const resultados = await cruce(retener, cierrePrimero ? [cierre, cambio] : [cambio, cierre]);

        const delCambio = resultados[cierrePrimero ? 1 : 0] as Respuesta;
        expect(delCambio.status, delCambio.texto).toBe(200);
        expect(await clasesDeLaMatricula(A(), diciembreId)).toEqual(ordenados(delLunes17()));
        expect(await estadoDeLaMatricula(A(), alumno.alumnoId, NOVIEMBRE_CIERRE)).toBe('FINALIZADA');
        expect(await estadoDeLaMatricula(A(), alumno.alumnoId, DICIEMBRE_CIERRE)).toBe('VIGENTE');
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
        expect(
          await clasesDeLaMatricula(A(), alumno.matriculaIds[0] as string),
          'la matrícula de noviembre no cambia',
        ).toEqual(ordenados([esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id]));
      });
    });
  });

  describe('bloquearActorVigente es la primera sentencia (el 401 gana a cualquier 200, 404 o 409)', () => {
    it.each(['desactivar', 'solo-version'] as const)(
      'criterio 39 (%s): si el actor deja de ser vigente mientras el cambio espera su fila, responde 401 NO_AUTENTICADO y no escribe ni audita',
      async (cambio) => {
        const alumno = await crearAlumnoDeHorario(ctx, esc);
        const x = await crearUsuarioDePrueba({ academiaId: A(), rol: 'SECRETARIA', clave: CLAVE_COMUN });
        const cookieX = cookieDeUsuario(x, VIERNES_27);
        en(ctx, esc, VIERNES_27);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: A(),
          actorId: x.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => cambiarHorario(ctx, cookieX, alumno.matriculaId, delLunes17()),
        });

        expect(esperoElBloqueo, 'el cambio debía quedar esperando la fila del actor (bloquearActorVigente)').toBe(true);
        expect(resumen(resultado), resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(
          ordenados([esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id]),
        );
        expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).toEqual([]);
      },
    );

    it('criterio 39 (control): si la prueba solo bloquea la fila del actor y hace ROLLBACK, el cambio espera y responde lo suyo (200)', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const x = await crearUsuarioDePrueba({ academiaId: A(), rol: 'SECRETARIA', clave: CLAVE_COMUN });
      const cookieX = cookieDeUsuario(x, VIERNES_27);
      en(ctx, esc, VIERNES_27);

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: A(),
        actorId: x.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'ROLLBACK',
        enviar: () => cambiarHorario(ctx, cookieX, alumno.matriculaId, delLunes17()),
      });

      expect(esperoElBloqueo).toBe(true);
      expect(resultado.status, resultado.texto).toBe(200);
    });
  });
});
