// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppCarnet, conAlumnoRetenido, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { cuerpoCobro, rutaCobro, sembrarCobrable } from '../../utilidades/escenario-pagos';
import { rutaAprobacion } from '../../utilidades/escenario-pagos-007b';
import {
  type AlumnoDeAsistencia,
  asistenciasDe,
  clasesUsadasDe,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  LUNES,
  ponerPagoEnVerificacion,
  resultadoDe,
} from '../../utilidades/escenario-asistencia';
import {
  asegurarCajaDelDia,
  ejecutarFaltas,
  inasistenciasDe,
  leerInasistencias,
  prepararEscenarioDe009b,
  registrarPosterior,
} from '../../utilidades/escenario-faltas';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import type { RespuestaApi } from '../../utilidades/inscripciones';
import { abrirRetenedor, conClaseRetenida, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';

// Criterio 27 (crítico, DT-5, DT-9): la tarea toma, en este orden, las filas de los alumnos con `FOR KEY SHARE` (ordenadas por id), sus matrículas con `FOR UPDATE` (ordenadas por id) y después inserta con las condiciones del criterio 24
// evaluadas otra vez. Prueba determinista: un registro posterior (criterio 28) y la tarea sobre el mismo alumno y día, en los dos órdenes posibles, terminan sin falta o con la falta cubierta por esa asistencia; nunca con una falta sin cubrir y una
// asistencia del mismo día. Sin `40P01` con un cobro o la confirmación de un pago (007) del mismo alumno.
// Cómo se hace determinista: una conexión de la prueba retiene la matrícula del alumno con `FOR UPDATE`; se lanza la primera operación y se espera, con la cadena de bloqueos de PostgreSQL (`pg_locks`), a que quede esperando; se lanza la segunda y se
// espera a que también quede esperando; se suelta. Las esperas de una misma fila se atienden en el orden en que llegaron: la primera termina antes de que la segunda avance.
// Lecturas estrictas elegidas: con el posterior primero, el resultado es una asistencia y ninguna falta (la tarea vuelve a evaluar sus condiciones y ve la asistencia ya confirmada); con la tarea primero, la falta queda registrada y el posterior la
// cubre con su asistencia (`asistencia_id` y `cubierta_en`); el registro posterior es 201 en los dos órdenes. La confirmación de un pago del mismo alumno se prueba con la de un Yape pendiente de una matrícula nueva del alumno que ya tiene su matrícula
// `FINALIZADA` con una falta por registrar: la tarea registra esa falta de todos modos y ninguna de las dos operaciones termina con un interbloqueo (`40P01`) ni lo deja en el registro técnico; lo que responde esa confirmación (la renovación es de la 010)
// no se exige, solo que no sea un interbloqueo. El cobro de otro alumno de la misma clase (que toma la clase con `FOR UPDATE`) a la vez que la tarea, con la clase retenida, termina con el cobro 201 y la falta registrada.

describe('la tarea de faltas y las demás operaciones del alumno (criterio 27)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDe009b(ctx);
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  /** La clase de las 18:00 ya terminó: el registro posterior y la tarea son posibles. */
  const AHORA = enLima(LUNES, '19:30:00.000');
  const INTERBLOQUEO = /40P01|deadlock|interbloqueo/i;

  type Operacion = 'posterior' | 'tarea';

  describe('el registro posterior y la tarea sobre el mismo alumno y día, en los dos órdenes', () => {
    /** Retiene la matrícula del alumno, lanza `primera` y `segunda` esperando que cada una quede esperando, y las suelta. */
    async function carrera(alumno: AlumnoDeAsistencia, primera: Operacion, segunda: Operacion) {
      const cookie = en(ctx, esc, AHORA).secretaria;
      const lanzar: Record<Operacion, () => Promise<Pick<RespuestaApi, 'status' | 'texto' | 'body'>>> = {
        posterior: () => registrarPosterior(ctx, cookie, alumno.alumnoId, LUNES, '18:05'),
        tarea: async () => {
          await ejecutarFaltas(ctx, AHORA);
          return { status: 200, texto: '', body: null };
        },
      };
      const retenedor = await abrirRetenedor(A());
      try {
        await retenedor.consultar(
          'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
          [A(), alumno.matriculaId],
        );
        const p1 = observar(lanzar[primera]());
        expect(
          await esperarEspera(
            async () => (await retenedor.sesionesEsperando()) >= 1,
            [p1],
            `la primera operación (${primera}) ni respondió ni quedó esperando la matrícula.`,
          ),
          `${primera} debía quedar esperando la matrícula del alumno`,
        ).toBe(true);
        const p2 = observar(lanzar[segunda]());
        expect(
          await esperarEspera(
            async () => (await retenedor.sesionesEsperando()) >= 2,
            [p1, p2],
            `la segunda operación (${segunda}) ni respondió ni quedó esperando la matrícula.`,
          ),
          `${segunda} debía quedar esperando la matrícula del alumno`,
        ).toBe(true);
        await retenedor.liberar('ROLLBACK');
        const [r1, r2] = await conLimite(
          Promise.all([p1.resultado, p2.resultado]),
          'Límite de seguridad: las operaciones no respondieron tras soltar la matrícula.',
        );
        return { [primera]: r1, [segunda]: r2 } as Record<Operacion, Pick<RespuestaApi, 'status' | 'texto' | 'body'>>;
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    }

    it('criterio 27: el registro posterior primero y la tarea después: queda la asistencia y ninguna falta', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);

      const respuestas = await carrera(alumno, 'posterior', 'tarea');

      const resultado = resultadoDe(respuestas.posterior, 201);
      expect(resultado.asistencia.registroPosterior).toBe(true);
      const asistencias = await asistenciasDe(A(), alumno.alumnoId);
      expect(asistencias).toHaveLength(1);
      expect(await inasistenciasDe(A(), alumno.alumnoId), 'ninguna falta junto a la asistencia del día').toEqual([]);
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
    });

    it('criterio 27: la tarea primero y el registro posterior después: queda la asistencia y la falta cubierta por esa asistencia', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);

      const respuestas = await carrera(alumno, 'tarea', 'posterior');

      expect(respuestas.tarea.status).toBe(200);
      resultadoDe(respuestas.posterior, 201);
      const [asistencia] = await asistenciasDe(A(), alumno.alumnoId);
      const faltas = await inasistenciasDe(A(), alumno.alumnoId);
      expect(faltas).toHaveLength(1);
      expect(faltas[0]).toMatchObject({ fecha: LUNES, asistencia_id: asistencia?.id });
      expect(faltas[0]?.cubierta_en).not.toBeNull();
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
    });

    it('criterio 27: en los dos órdenes, ningún alumno termina con una falta sin cubrir y una asistencia del mismo día, y la tarea no se detiene para quien no vino', async () => {
      const primero = await crearAlumnoDeAsistencia(ctx, esc);
      await carrera(primero, 'posterior', 'tarea');
      const segundo = await crearAlumnoDeAsistencia(ctx, esc);
      await carrera(segundo, 'tarea', 'posterior');
      const ausentes = [await crearAlumnoDeAsistencia(ctx, esc), await crearAlumnoDeAsistencia(ctx, esc)];

      await ejecutarFaltas(ctx, AHORA);
      await ejecutarFaltas(ctx, AHORA);

      for (const alumno of [primero, segundo]) {
        expect(await asistenciasDe(A(), alumno.alumnoId), 'una asistencia posterior').toHaveLength(1);
        expect(
          (await inasistenciasDe(A(), alumno.alumnoId)).filter((falta) => falta.asistencia_id === null),
          'sin una falta sin cubrir junto a la asistencia',
        ).toEqual([]);
      }
      for (const alumno of ausentes) expect(await inasistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
    });
  });

  describe('sin 40P01 con las operaciones de pago (007)', () => {
    it.each(['tarea-primero', 'confirmacion-primero'] as const)(
      'criterio 27: la tarea y la confirmación de un pago del mismo alumno a la vez, con la fila del alumno retenida (%s): ninguna termina con 40P01 y la falta se registra',
      async (orden) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        const { pagoId } = await ponerPagoEnVerificacion(esc, alumno);
        await asegurarCajaDelDia(esc, LUNES);
        const cookie = en(ctx, esc, AHORA).secretaria;
        const tarea = async (): Promise<Pick<RespuestaApi, 'status' | 'texto' | 'body'>> => {
          await ejecutarFaltas(ctx, AHORA);
          return { status: 200, texto: '', body: null };
        };
        const confirmacion = () => ctx.http.post(rutaAprobacion(pagoId), {}, { cookie });

        const { resultados } = await conAlumnoRetenido({
          academiaId: A(),
          alumnoId: alumno.alumnoId,
          esperando: 2,
          enviar: orden === 'tarea-primero' ? [tarea, confirmacion] : [confirmacion, tarea],
        });

        for (const respuesta of resultados) expect(respuesta.texto).not.toMatch(INTERBLOQUEO);
        expect(lineas.join('\n'), 'el registro técnico no menciona un interbloqueo').not.toMatch(INTERBLOQUEO);
        const faltas = await inasistenciasDe(A(), alumno.alumnoId);
        expect(faltas.map((falta) => [falta.matricula_id, falta.fecha])).toEqual([[alumno.matriculaId, LUNES]]);
      },
    );

    it.each(['tarea-primero', 'cobro-primero'] as const)(
      'criterio 27: la tarea y el cobro de otro alumno de la misma clase (que toma la clase con FOR UPDATE) a la vez, con la clase retenida (%s): el cobro responde 201, la falta se registra y no hay 40P01',
      async (orden) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        await asegurarCajaDelDia(esc, LUNES);
        const cookie = en(ctx, esc, AHORA).secretaria;
        const cliente = await sembrarCobrable(esc.e, { reservaVenceEn: enLima('2026-11-20', '10:00') });
        const tarea = async (): Promise<Pick<RespuestaApi, 'status' | 'texto' | 'body'>> => {
          await ejecutarFaltas(ctx, AHORA);
          return { status: 200, texto: '', body: null };
        };
        const cobro = () => ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie });

        const { resultados } = await conClaseRetenida({
          academiaId: A(),
          claseId: esc.e.lunes.id,
          cambio: { tipo: 'bloquear' },
          liberar: 'ROLLBACK',
          enviar: orden === 'tarea-primero' ? [tarea, cobro] : [cobro, tarea],
        });

        const respuestaCobro = resultados[orden === 'tarea-primero' ? 1 : 0] as { status: number; texto: string };
        expect(respuestaCobro.status, respuestaCobro.texto.slice(0, 300)).toBe(201);
        for (const respuesta of resultados) expect(respuesta.texto).not.toMatch(INTERBLOQUEO);
        expect(lineas.join('\n')).not.toMatch(INTERBLOQUEO);
        expect(await inasistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
        // El cliente recién cobrado confirmó su pago a las 19:30: no tiene falta por la clase de las 18:00.
        expect(await inasistenciasDe(A(), cliente.alumnoId)).toEqual([]);
        expect((await leerInasistencias(esc.e.B.id)).length).toBe(0);
      },
    );
  });
});
