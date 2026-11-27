// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asistenciasDe,
  cambiarMatricula,
  clasesUsadasDe,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  marcar,
  rechazoDe,
  resultadoDe,
  type Via,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  ejecutarFaltas,
  inasistenciasDe,
  prepararEscenarioDe009b,
  registrarPosterior,
} from '../../utilidades/escenario-faltas';
import { codigoDeRespuesta } from '../../utilidades/escenario-pagos';

// Criterio 12 (crítico, RN-14, RN-15, D-16, DR-2, criterio 16 de 010): un alumno cuya única matrícula `VIGENTE` es la de M+1: el marcado por QR o manual de una clase de M responde 409 `MENSUALIDAD_NO_VIGENTE` (009), sin descontar; la tarea de faltas no le registra faltas en M; el registro posterior de un día de M lo rechaza. El 1/12 marca la clase de ese día (dentro de su horario, D-16) y descuenta
// de la matrícula de diciembre.
// Lecturas estrictas elegidas: (1) el alumno se crea como lo hace el sistema (un pago en efectivo confirmado por la API el 11/11) y su matrícula se pasa a diciembre como dueño: queda con el estado `ALUMNO_ACTIVO`, su QR y las clases del lunes y del martes de las 18:00; así la tarea de faltas, que solo trabaja con quien tiene un pago confirmado (criterio 24 de 009), sí lo evaluaría si tuviera la matrícula de noviembre
// (un alumno de control con la de noviembre recibe su falta); (2) «una clase de M» es la del lunes 30/11 a las 18:05 de Lima; (3) el 1/12 es martes: se marca la clase del martes de las 18:00, a las 18:05.

const ZONA_ORIGINAL = process.env['TZ'];
const LUNES_30 = '2026-11-30';
const MARTES_1 = '2026-12-01';

describe.each(['UTC', 'Asia/Tokyo'])(
  'la asistencia empieza el día 1 para quien pagó el mes siguiente (criterio 12) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppCarnet;
    let esc: EscenarioDeAsistencia;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppCarnet();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      esc = await prepararEscenarioDe009b(ctx, { rutas: true });
    });
    afterAll(async () => {
      await ctx?.cerrarTodo();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    const A = () => esc.e.A.id;
    /** Un alumno con el pago de su mensualidad confirmado, cuya matrícula (única) es de diciembre y está `VIGENTE`. */
    async function alumnoDeDiciembre() {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.e.lunes.id, esc.e.martes.id] });
      await cambiarMatricula(A(), alumno.matriculaId, {
        anio: 2026,
        mes: 12,
        fecha_inicio: '2026-12-01',
        fecha_fin: '2026-12-31',
      });
      return alumno;
    }

    describe.each<Via>(['QR', 'MANUAL'])('el marcado por %s antes del día 1', (via) => {
      it('criterio 12: el lunes 30/11 a las 18:05 (clase de M) responde 409 MENSUALIDAD_NO_VIGENTE (alerta ROJA), no registra asistencia y no descuenta de la matrícula de diciembre', async () => {
        const alumno = await alumnoDeDiciembre();
        const cookie = en(ctx, esc, enLima(LUNES_30, '18:05')).secretaria;

        const respuesta = await marcar(ctx, via, cookie, alumno);

        rechazoDe(respuesta, 'MENSUALIDAD_NO_VIGENTE', 'ROJA');
        expect(await asistenciasDe(A(), alumno.alumnoId)).toEqual([]);
        expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(0);
      });

      it('criterio 12: tampoco al empezar la clase (18:00:00.000) ni en su último milisegundo (18:59:59.999) del último lunes de noviembre: 409 MENSUALIDAD_NO_VIGENTE', async () => {
        const alumno = await alumnoDeDiciembre();

        for (const instante of [enLima(LUNES_30, '18:00:00.000'), enLima(LUNES_30, '18:59:59.999')]) {
          const respuesta = await marcar(ctx, via, en(ctx, esc, instante).secretaria, alumno);
          expect(codigoDeRespuesta(respuesta), instante.toISOString()).toBe('MENSUALIDAD_NO_VIGENTE');
        }
        expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(0);
      });

      it('criterio 12: el 1/12 (martes) a las 18:05, dentro del horario de la clase, marca (201) y descuenta una clase de la matrícula de diciembre', async () => {
        const alumno = await alumnoDeDiciembre();
        const cookie = en(ctx, esc, enLima(MARTES_1, '18:05')).secretaria;

        const respuesta = await marcar(ctx, via, cookie, alumno);

        const resultado = resultadoDe(respuesta, 201);
        expect(resultado.asistencia).toMatchObject({ fecha: MARTES_1 });
        expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
        expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      });

      it('criterio 12: el 1/12 a las 00:00:00.000 la matrícula de diciembre ya es la del día: fuera del horario de la clase responde FUERA_DE_HORARIO (no MENSUALIDAD_NO_VIGENTE) y no descuenta', async () => {
        const alumno = await alumnoDeDiciembre();
        const cookie = en(ctx, esc, enLima(MARTES_1, '00:00:00.000')).secretaria;

        const respuesta = await marcar(ctx, via, cookie, alumno);

        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(409);
        expect(codigoDeRespuesta(respuesta)).not.toBe('MENSUALIDAD_NO_VIGENTE');
        expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(0);
      });
    });

    describe('la tarea de faltas y el registro posterior', () => {
      it('criterio 12: la tarea de faltas del 30/11 a las 19:05 no le registra falta en noviembre (su única matrícula VIGENTE es la de diciembre) y a quien tiene la de noviembre sí', async () => {
        const deDiciembre = await alumnoDeDiciembre();
        const deNoviembre = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.e.lunes.id] });
        en(ctx, esc, enLima(LUNES_30, '19:05'));

        await ejecutarFaltas(ctx, enLima(LUNES_30, '19:05'));
        await ejecutarFaltas(ctx, enLima(LUNES_30, '23:30'));

        expect(await inasistenciasDe(A(), deDiciembre.alumnoId), 'sin falta en M').toEqual([]);
        const control = await inasistenciasDe(A(), deNoviembre.alumnoId);
        expect(
          control.map((falta) => falta.fecha),
          'el alumno de noviembre sí tiene su falta (control de la prueba)',
        ).toEqual([LUNES_30]);
      });

      it('criterio 12: la tarea de faltas del 1/12 por la noche (después de la clase del martes) sí le registra la falta de diciembre si no marcó', async () => {
        const deDiciembre = await alumnoDeDiciembre();
        en(ctx, esc, enLima(MARTES_1, '19:30'));

        await ejecutarFaltas(ctx, enLima(MARTES_1, '19:30'));

        const faltas = await inasistenciasDe(A(), deDiciembre.alumnoId);
        expect(faltas.map((falta) => [falta.fecha, falta.matricula_id])).toEqual([[MARTES_1, deDiciembre.matriculaId]]);
      });

      it.each([
        ['el mismo lunes 30/11 (18:05, ya terminó la clase)', LUNES_30, '18:05'],
        ['el lunes anterior 23/11 (18:05)', '2026-11-23', '18:05'],
      ])(
        'criterio 12: el registro posterior de un día de noviembre (%s), hecho el 30/11 a las 20:00, responde 409 MENSUALIDAD_NO_VIGENTE y no escribe',
        async (_nombre, fecha, hora) => {
          const alumno = await alumnoDeDiciembre();
          const cookie = en(ctx, esc, enLima(LUNES_30, '20:00')).secretaria;

          const respuesta = await registrarPosterior(ctx, cookie, alumno.alumnoId, fecha, hora);

          expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
            409,
            'MENSUALIDAD_NO_VIGENTE',
          ]);
          expect(await asistenciasDe(A(), alumno.alumnoId)).toEqual([]);
          expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(0);
        },
      );
    });
  },
);
