// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerMovimientos } from '../../utilidades/caja';
import { conRetencion, type RespuestaApi } from '../../utilidades/inscripciones';
import {
  asistenciasDe,
  clasesUsadasDe,
  en,
  enLima,
  type EscenarioDeAsistencia,
  marcarManual,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoConMatriculas,
  DICIEMBRE,
  ejecutarCierre,
  estadoDeLaMatricula,
  estadoDelAlumno,
  instantaneaDelCierre,
  matriculasPorMes,
  NOVIEMBRE,
  prepararEscenarioDeCierre,
  sembrarAlumno,
} from '../../utilidades/escenario-cierre';
import { ejecutarFaltas, inasistenciasDe } from '../../utilidades/escenario-faltas';
import { rutaAprobacion } from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  crearAlumnoDeNoviembre,
  registrarRenovacion,
  renovacionDe,
  retenerAlumno,
  retenerMatriculasDe,
  sinErroresDelServidor,
} from '../../utilidades/escenario-renovacion';
import { crearAlumnoDeAsistencia } from '../../utilidades/escenario-asistencia';
import { lineasJson } from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import type { Retenedor } from '../../utilidades/planes-clases';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 29 (crítico, D-23, nota O1 de 001, «Orden de bloqueos» de 009, 009b, 007a y 010a): el cierre no se interbloquea. Toma, en este orden, los alumnos afectados con `FOR UPDATE` (ordenados por id) y después sus matrículas con `FOR UPDATE` (ordenadas por id), vuelve a evaluar
// con lo confirmado y escribe. Pruebas deterministas sin `40P01`, sobre el mismo alumno, con: el marcado de asistencia (009), la tarea de faltas (009b), la aprobación de su renovación (007b) y el registro de una renovación (010a, en efectivo y con comprobante). Si la aprobación de la
// renovación de M confirma antes, el cierre lo deja `ALUMNO_ACTIVO`; si confirma después, la aprobación lo deja `ALUMNO_ACTIVO`. Dos llamadas a la vez (dos instancias) dejan el mismo resultado sin error.
// Cómo se prueba: la prueba retiene una fila que las dos operaciones necesitan (la del alumno, o sus matrículas), envía las dos operaciones en los dos órdenes de llegada, comprueba (con `pg_locks`) que las dos esperan y recién entonces suelta. Una implementación que bloquee en otro
// orden (por ejemplo, las matrículas antes que el alumno) forma un ciclo con la operación de la otra historia en alguno de los dos órdenes y termina en `40P01`.
// Lecturas estrictas elegidas: (1) el cierre no lanza: registra el error de cada academia y sigue, así que «sin `40P01`» se comprueba también en el registro técnico (ninguna línea con `40P01`, `deadlock` ni `interbloqueo` y ninguna línea de nivel de error) y en el resultado final, que debe ser
// el de la operación completa; (2) el marcado se hace el miércoles 2/12 a las 18:05 de Lima con la matrícula de diciembre `VIGENTE` y la de noviembre aún `VIGENTE` (la clase de las 18:00 de ese día): 201 y el descuento va a diciembre, y el cierre lo finaliza noviembre en cualquier orden;
// (3) la tarea de faltas corre el 1/12 a las 08:00 y registra la falta del lunes 30/11 aunque el cierre haya finalizado la matrícula de noviembre antes (una falta, la de 2026-11-30); (4) la renovación en verificación de diciembre de un alumno `ALUMNO_ACTIVO` con noviembre `VIGENTE` deja,
// al cerrar, sin matrícula `VIGENTE` de M a ese alumno (es `ALUMNO_VENCIDO` hasta que se apruebe: criterio 27) y la aprobación lo vuelve `ALUMNO_ACTIVO` en los dos órdenes; (5) todas las operaciones de renovación corren con `RELOJ` fijo el 1/12 a las 08:00 (M es diciembre: renovación tardía,
// 13 ocurrencias con tope de 12: S/ 120.00).

const INTERBLOQUEO = /40P01|deadlock|interbloqueo/i;
const DIA_1_A_LAS_8 = enLima('2026-12-01', '08:00');
const MIERCOLES_2_A_LAS_18_05 = enLima('2026-12-02', '18:05');

type Respuesta = Pick<RespuestaApi, 'status' | 'texto' | 'body'>;
type Retencion = 'alumno' | 'matriculas';
type Orden = 'cierre-primero' | 'la-otra-primero';

describe('el cierre de mes y las demás operaciones del alumno (criterio 29)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeCierre(ctx);
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const errores = () =>
    lineasJson(lineas).filter((registro) => typeof registro['level'] === 'number' && registro['level'] >= 50);

  /** La vuelta del cierre como una operación más (nunca lanza: el servicio registra el error de cada academia). */
  const cierre = (ahora: Date) => async (): Promise<Respuesta> => {
    await ejecutarCierre(ctx, ahora);
    return { status: 200, texto: '', body: null };
  };

  /**
   * Retiene la fila del alumno (o sus matrículas), envía el cierre y la otra operación en el orden pedido, comprueba que las dos esperan y suelta. Devuelve las respuestas
   * por nombre y comprueba que no hubo 5xx ni interbloqueo, ni en las respuestas ni en el registro técnico.
   */
  async function cruce(
    alumnoId: string,
    retencion: Retencion,
    orden: Orden,
    ahora: Date,
    otra: () => Promise<Respuesta>,
  ): Promise<{ cierre: Respuesta; otra: Respuesta }> {
    const retener: (retenedor: Retenedor) => Promise<void> =
      retencion === 'alumno' ? retenerAlumno(A(), alumnoId) : retenerMatriculasDe(A(), alumnoId);
    const { resultados, todasEsperaron } = await conRetencion<Respuesta>({
      academiaId: A(),
      retener,
      enviar: orden === 'cierre-primero' ? [cierre(ahora), otra] : [otra, cierre(ahora)],
      enOrden: true,
      liberar: 'COMMIT',
    });
    expect(todasEsperaron, 'las dos operaciones debían quedar esperando lo que retuvo la prueba').toBe(true);
    sinErroresDelServidor(resultados);
    expect(lineas.join('\n'), 'el registro técnico no menciona un interbloqueo').not.toMatch(INTERBLOQUEO);
    expect(errores(), 'el cierre no registró ningún error').toEqual([]);
    const [primera, segunda] = resultados as [Respuesta, Respuesta];
    return orden === 'cierre-primero' ? { cierre: primera, otra: segunda } : { cierre: segunda, otra: primera };
  }

  describe.each<Retencion>(['alumno', 'matriculas'])('con %s retenido por la prueba', (retencion) => {
    describe.each<[string, Orden]>([
      ['el cierre llega primero', 'cierre-primero'],
      ['la otra operación llega primero', 'la-otra-primero'],
    ])('%s', (_nombre, orden) => {
      it('criterio 29: el cierre y el marcado de asistencia del mismo alumno terminan sin 40P01: el marcado 201 descuenta de diciembre y noviembre queda FINALIZADA', async () => {
        const alumno = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [
            { mes: NOVIEMBRE, estado: 'VIGENTE', clasesUsadas: 4 },
            { mes: DICIEMBRE, estado: 'VIGENTE' },
          ],
        });
        const cookie = en(ctx, esc, MIERCOLES_2_A_LAS_18_05).secretaria;

        const resultado = await cruce(alumno.alumnoId, retencion, orden, MIERCOLES_2_A_LAS_18_05, () =>
          marcarManual(ctx, cookie, alumno.alumnoId),
        );

        expect(resultado.otra.status, resultado.otra.texto.slice(0, 300)).toBe(201);
        expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
        const matriculas = await matriculasPorMes(A(), alumno.alumnoId);
        expect(matriculas['2026-12']).toMatchObject({ estado: 'VIGENTE', clasesUsadas: 1 });
        expect(matriculas['2026-11']).toMatchObject({ estado: 'FINALIZADA', clasesUsadas: 4 });
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
        expect(await clasesUsadasDe(A(), (matriculas['2026-12'] as { id: string }).id)).toBe(1);
      });

      it('criterio 29: el cierre y la tarea de faltas con el mismo alumno terminan sin 40P01: una falta (la del 30/11, con la matrícula FINALIZADA) y el alumno ALUMNO_VENCIDO', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        const faltas = async (): Promise<Respuesta> => {
          await ejecutarFaltas(ctx, DIA_1_A_LAS_8);
          return { status: 200, texto: '', body: null };
        };

        await cruce(alumno.alumnoId, retencion, orden, DIA_1_A_LAS_8, faltas);

        const registradas = await inasistenciasDe(A(), alumno.alumnoId);
        expect(registradas.map((falta) => [falta.matricula_id, falta.fecha])).toEqual([
          [alumno.matriculaId, '2026-11-30'],
        ]);
        expect(await estadoDeLaMatricula(A(), alumno.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_VENCIDO');
      });

      it('criterio 29: el cierre y la aprobación de la renovación de diciembre (en verificación) del mismo alumno terminan sin 40P01 y el alumno queda ALUMNO_ACTIVO, con la renovación VIGENTE, se confirme antes o después', async () => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const cookies = en(ctx, esc, DIA_1_A_LAS_8);
        await abrirCajaPara(esc, DIA_1_A_LAS_8);
        const renovacion = renovacionDe(
          (
            await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
              fechaOperacion: '2026-12-01',
            })
          ).respuesta,
        );
        expect(renovacion.renovacion.estado).toBe('EN_VERIFICACION');
        const aprobar = () => ctx.http.post(rutaAprobacion(renovacion.pago.id), {}, { cookie: cookies.admin });

        const resultado = await cruce(alumno.alumnoId, retencion, orden, DIA_1_A_LAS_8, aprobar);

        expect(resultado.otra.status, resultado.otra.texto.slice(0, 300)).toBe(200);
        const matriculas = await matriculasPorMes(A(), alumno.alumnoId);
        expect(matriculas['2026-12']?.estado).toBe('VIGENTE');
        expect(matriculas['2026-11']?.estado).toBe('FINALIZADA');
        expect(await estadoDelAlumno(A(), alumno.alumnoId), 'quien paga el mes en curso queda ALUMNO_ACTIVO').toBe(
          'ALUMNO_ACTIVO',
        );
        expect((await leerPagos(A())).filter((pago) => pago.estado === 'CONFIRMADO')).toHaveLength(1);
        expect((await leerMovimientos(A())).filter((movimiento) => movimiento.metodo === 'YAPE')).toHaveLength(1);
      });

      it('criterio 29: el cierre y el registro de una renovación de diciembre en efectivo del mismo alumno terminan sin 40P01: 201, renovación VIGENTE, noviembre FINALIZADA y el alumno ALUMNO_ACTIVO', async () => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const cookies = en(ctx, esc, DIA_1_A_LAS_8);
        await abrirCajaPara(esc, DIA_1_A_LAS_8);

        const resultado = await cruce(
          alumno.alumnoId,
          retencion,
          orden,
          DIA_1_A_LAS_8,
          async () => (await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId)).respuesta,
        );

        expect(resultado.otra.status, resultado.otra.texto.slice(0, 300)).toBe(201);
        const matriculas = await matriculasPorMes(A(), alumno.alumnoId);
        expect(matriculas['2026-12']?.estado).toBe('VIGENTE');
        expect(matriculas['2026-11']?.estado).toBe('FINALIZADA');
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
        expect((await leerMovimientos(A())).filter((movimiento) => movimiento.concepto === 'MENSUALIDAD')).toHaveLength(
          1,
        );
      });

      it('criterio 29: el cierre y el registro de una renovación de diciembre con Yape del mismo alumno terminan sin 40P01: 201 en verificación, noviembre FINALIZADA y el alumno ALUMNO_VENCIDO hasta que se apruebe', async () => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const cookies = en(ctx, esc, DIA_1_A_LAS_8);
        await abrirCajaPara(esc, DIA_1_A_LAS_8);

        const resultado = await cruce(
          alumno.alumnoId,
          retencion,
          orden,
          DIA_1_A_LAS_8,
          async () =>
            (
              await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
                fechaOperacion: '2026-12-01',
              })
            ).respuesta,
        );

        expect(resultado.otra.status, resultado.otra.texto.slice(0, 300)).toBe(201);
        const matriculas = await matriculasPorMes(A(), alumno.alumnoId);
        expect(matriculas['2026-12']?.estado).toBe('RESERVADA');
        expect(matriculas['2026-11']?.estado).toBe('FINALIZADA');
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_VENCIDO');
      });
    });
  });

  describe('dos instancias a la vez (criterio 29)', () => {
    let alumnos: Record<'sinRenovar' | 'renovo' | 'vencidoQuePago', AlumnoConMatriculas>;
    let deB: AlumnoConMatriculas;
    beforeEach(async () => {
      alumnos = {
        sinRenovar: await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
        }),
        renovo: await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [
            { mes: NOVIEMBRE, estado: 'VIGENTE' },
            { mes: DICIEMBRE, estado: 'VIGENTE' },
          ],
        }),
        vencidoQuePago: await sembrarAlumno(esc, {
          estado: 'ALUMNO_VENCIDO',
          matriculas: [{ mes: DICIEMBRE, estado: 'VIGENTE' }],
        }),
      };
      deB = await sembrarAlumno(esc, {
        academia: 'B',
        estado: 'ALUMNO_ACTIVO',
        matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
      });
    });

    async function comprobarResultado(): Promise<void> {
      expect(await estadoDeLaMatricula(A(), alumnos.sinRenovar.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
      expect(await estadoDelAlumno(A(), alumnos.sinRenovar.alumnoId)).toBe('ALUMNO_VENCIDO');
      expect(await estadoDeLaMatricula(A(), alumnos.renovo.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
      expect(await estadoDeLaMatricula(A(), alumnos.renovo.alumnoId, DICIEMBRE)).toBe('VIGENTE');
      expect(await estadoDelAlumno(A(), alumnos.renovo.alumnoId)).toBe('ALUMNO_ACTIVO');
      expect(await estadoDelAlumno(A(), alumnos.vencidoQuePago.alumnoId)).toBe('ALUMNO_ACTIVO');
      expect(await estadoDeLaMatricula(esc.e.B.id, deB.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
      expect(await estadoDelAlumno(esc.e.B.id, deB.alumnoId)).toBe('ALUMNO_VENCIDO');
    }

    it.each([2, 4])(
      'criterio 29: %i llamadas a la vez (instancias) no fallan, no registran errores ni 40P01 y, con una vuelta más (la que saltó una academia por el bloqueo de otra), dejan el mismo resultado que una sola',
      async (llamadas) => {
        const PRIMERO = enLima('2026-12-01', '00:00:00.000');

        await Promise.all(Array.from({ length: llamadas }, () => ejecutarCierre(ctx, PRIMERO)));
        await ejecutarCierre(ctx, PRIMERO);

        await comprobarResultado();
        expect(lineas.join('\n')).not.toMatch(INTERBLOQUEO);
        expect(errores(), 'ninguna instancia registró un error').toEqual([]);
        const despuesDeTodas = await instantaneaDelCierre(esc);
        await ejecutarCierre(ctx, enLima('2026-12-01', '00:15:00.000'));
        expect(await instantaneaDelCierre(esc), 'otra vuelta no cambia nada').toBe(despuesDeTodas);
      },
    );
  });
});
