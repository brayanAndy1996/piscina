// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  asistenciasDe,
  cambiarMatricula,
  clasesUsadasDe,
  codigoDeRespuesta,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  marcar,
  PRIMERO_DE_DICIEMBRE,
  prepararEscenarioDeAsistencia,
  rechazoDe,
  resultadoDe,
  ULTIMO_LUNES_DE_NOVIEMBRE,
  LUNES,
  ponerPagoEnVerificacion,
} from '../../utilidades/escenario-asistencia';
import { cambiarAlumno } from '../../utilidades/escenario-carnet';
import { insertarFila } from '../../utilidades/inscripciones';

// Criterio 8 (crítico, RN-15, RNF-12): con `RELOJ` fijo y el proceso en `TZ=Asia/Tokyo` (y en UTC): un alumno con matrícula `VIGENTE` de noviembre y la clase de los lunes de 19:00 a 20:00 marca el lunes 30/11/2026 a las 19:30 de Lima (ya es
// 1/12 en UTC): 201, `fecha` 2026-11-30 y descuento en la matrícula de noviembre. El 1/12 a las 08:00 de Lima, sin matrícula de diciembre, responde `MENSUALIDAD_NO_VIGENTE` (4.5). Una matrícula `RESERVADA` (sin pago en verificación), `CANCELADA` o `FINALIZADA`,
// o `VIGENTE` de otro mes, no es la del día. El alumno con estado `ALUMNO_VENCIDO` y matrícula del día marca: decide la matrícula, no la columna `estado` (que es de la 010).
// Lecturas estrictas elegidas: se prueban también los bordes exactos del cambio de mes en Lima (23:59:59.999 del 30/11 todavía es noviembre; 00:00:00.000 del 1/12 ya no), la `fecha_inicio` de una inscripción a mitad de mes (desde ese día, no antes) y que la hora que se
// guarda y se devuelve es la de Lima (`horaLlegada`) y no la del proceso.

const ZONA_ORIGINAL = process.env['TZ'];

describe.each(['UTC', 'Asia/Tokyo'])(
  'la mensualidad del día y los bordes de Lima (criterio 8) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppCarnet;
    let esc: EscenarioDeAsistencia;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppCarnet();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      esc = await prepararEscenarioDeAsistencia(ctx);
    });
    afterAll(async () => {
      await ctx?.cerrarTodo();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    const alumnoDe19 = () => crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id] });

    describe('el último lunes de noviembre: 19:00 a 20:00 en Lima es el 1/12 en UTC', () => {
      it('criterio 8: el lunes 30/11 a las 19:30 de Lima (00:30 UTC del 1/12) marca: 201, fecha 2026-11-30, hora 19:30 y el descuento va a la matrícula de noviembre', async () => {
        const alumno = await alumnoDe19();
        const instante = enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '19:30');
        expect(instante.toISOString(), 'es el 1/12 en UTC').toBe('2026-12-01T00:30:00.000Z');
        const cookie = en(ctx, esc, instante).secretaria;

        const respuesta = await marcar(ctx, 'QR', cookie, alumno);

        const resultado = resultadoDe(respuesta, 201);
        expect(resultado.asistencia).toMatchObject({
          fecha: '2026-11-30',
          horaLlegada: '19:30',
          llegadaEn: '2026-12-01T00:30:00.000Z',
          estadoLlegada: 'TARDE',
        });
        expect(resultado.clase).toMatchObject({
          id: esc.lunes19.id,
          horaInicio: '19:00',
          horaFin: '20:00',
          diaSemana: 1,
        });
        expect(resultado.clases).toEqual({ usadas: 1, totales: 12, restantes: 11 });
        const [fila] = await asistenciasDe(esc.e.A.id, alumno.alumnoId);
        expect(fila).toMatchObject({ fecha: '2026-11-30', matricula_id: alumno.matriculaId, clase_id: esc.lunes19.id });
        expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
      });

      it('criterio 8: la manual hace lo mismo a las 19:00:00.000 de Lima (00:00 UTC del 1/12): fecha 2026-11-30, puntual', async () => {
        const alumno = await alumnoDe19();
        const cookie = en(ctx, esc, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '19:00:00.000')).secretaria;

        const resultado = resultadoDe(await marcar(ctx, 'MANUAL', cookie, alumno), 201);

        expect(resultado.asistencia).toMatchObject({
          fecha: '2026-11-30',
          horaLlegada: '19:00',
          estadoLlegada: 'PUNTUAL',
        });
      });

      it('criterio 8: a las 19:59:59.999 de Lima todavía marca (y es la misma fecha de Lima, el 30/11), y a las 20:00:00.000 ya es FUERA_DE_HORARIO', async () => {
        const dentro = await alumnoDe19();
        const fuera = await alumnoDe19();

        const ultimo = await marcar(
          ctx,
          'QR',
          en(ctx, esc, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '19:59:59.999')).secretaria,
          dentro,
        );
        const pasado = await marcar(
          ctx,
          'QR',
          en(ctx, esc, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '20:00:00.000')).secretaria,
          fuera,
        );

        expect(resultadoDe(ultimo, 201).asistencia).toMatchObject({ fecha: '2026-11-30', horaLlegada: '19:59' });
        expect(rechazoDe(pasado, 'FUERA_DE_HORARIO', 'AMARILLA').claseDeHoy).toEqual({
          horaInicio: '19:00',
          horaFin: '20:00',
        });
      });
    });

    describe('el cambio de mes', () => {
      it('criterio 8: el 30/11 a las 23:59:59.999 de Lima todavía hay matrícula del día (FUERA_DE_HORARIO, no MENSUALIDAD_NO_VIGENTE); el 1/12 a las 00:00:00.000 de Lima ya no (MENSUALIDAD_NO_VIGENTE)', async () => {
        const alumno = await alumnoDe19();

        const ultimoInstante = await marcar(
          ctx,
          'QR',
          en(ctx, esc, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '23:59:59.999')).secretaria,
          alumno,
        );
        const primerInstante = await marcar(
          ctx,
          'QR',
          en(ctx, esc, enLima(PRIMERO_DE_DICIEMBRE, '00:00:00.000')).secretaria,
          alumno,
        );

        rechazoDe(ultimoInstante, 'FUERA_DE_HORARIO', 'AMARILLA');
        rechazoDe(primerInstante, 'MENSUALIDAD_NO_VIGENTE', 'ROJA');
        expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toEqual([]);
      });

      it('criterio 8 (4.5): el 1/12 a las 08:00 de Lima, sin matrícula de diciembre, responde MENSUALIDAD_NO_VIGENTE (ROJA) con clases null, por las dos vías', async () => {
        const alumno = await alumnoDe19();
        const cookie = en(ctx, esc, enLima(PRIMERO_DE_DICIEMBRE, '08:00')).secretaria;

        for (const via of ['QR', 'MANUAL'] as const) {
          const respuesta = await marcar(ctx, via, cookie, alumno);

          const detalles = rechazoDe(respuesta, 'MENSUALIDAD_NO_VIGENTE', 'ROJA');
          expect(detalles.clases).toBeNull();
        }
      });

      it('criterio 8: con una matrícula VIGENTE de diciembre sí hay matrícula del día el 1/12, y el descuento va a la de diciembre, no a la de noviembre', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.e.martes.id] });
        await cambiarMatricula(esc.e.A.id, alumno.matriculaId, { estado: 'FINALIZADA' });
        // El martes 1/12 hay clase de 18:00; la matrícula de diciembre es nueva (creada el 11/11, antes de la clase).
        const diciembre = await crearMatriculaDeDiciembre(alumno);
        const cookie = en(ctx, esc, enLima(PRIMERO_DE_DICIEMBRE, '18:05')).secretaria;

        const respuesta = await marcar(ctx, 'QR', cookie, alumno);

        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
        expect(await clasesUsadasDe(esc.e.A.id, diciembre)).toBe(1);
        expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(0);
        expect((await asistenciasDe(esc.e.A.id, alumno.alumnoId))[0]).toMatchObject({
          matricula_id: diciembre,
          fecha: PRIMERO_DE_DICIEMBRE,
        });
      });

      async function crearMatriculaDeDiciembre(alumno: {
        academiaId: string;
        alumnoId: string;
        claseId: string;
      }): Promise<string> {
        const id = randomUUID();
        await insertarFila('propietario', 'matriculas', alumno.academiaId, {
          id,
          alumno_id: alumno.alumnoId,
          plan_id: esc.e.plan.id,
          anio: 2026,
          mes: 12,
          fecha_inicio: '2026-12-01',
          fecha_fin: '2026-12-31',
          clases_totales: 12,
          clases_usadas: 0,
          es_proporcional: false,
          precio_plan: '120.00',
          clases_por_mes_plan: 12,
          monto_calculado: '120.00',
          estado: 'VIGENTE',
          reserva_vence_en: null,
          creado_en: new Date('2026-11-11T15:00:00.000Z'),
          actualizado_en: new Date('2026-11-11T15:00:00.000Z'),
        });
        await insertarFila('propietario', 'matricula_clases', alumno.academiaId, {
          matricula_id: id,
          clase_id: alumno.claseId,
        });
        return id;
      }
    });

    describe('lo que no es la matrícula del día (criterio 8)', () => {
      it.each([
        ['RESERVADA (sin pago en verificación)', { estado: 'RESERVADA' }],
        ['CANCELADA', { estado: 'CANCELADA' }],
        ['FINALIZADA', { estado: 'FINALIZADA' }],
        [
          'VIGENTE de otro mes (diciembre)',
          { anio: 2026, mes: 12, fecha_inicio: '2026-12-01', fecha_fin: '2026-12-31' },
        ],
        ['VIGENTE de otro mes (octubre)', { anio: 2026, mes: 10, fecha_inicio: '2026-10-01', fecha_fin: '2026-10-31' }],
        [
          'VIGENTE de noviembre de otro año',
          { anio: 2025, mes: 11, fecha_inicio: '2025-11-01', fecha_fin: '2025-11-30' },
        ],
      ])(
        'criterio 8: una matrícula %s no es la del día: MENSUALIDAD_NO_VIGENTE (ROJA), por las dos vías, sin escribir',
        async (_nombre, cambios) => {
          const alumno = await crearAlumnoDeAsistencia(ctx, esc);
          await cambiarMatricula(esc.e.A.id, alumno.matriculaId, cambios);
          const cookie = en(ctx, esc, enLima(LUNES, '18:20')).secretaria;

          for (const via of ['QR', 'MANUAL'] as const) {
            const respuesta = await marcar(ctx, via, cookie, alumno);

            expect(rechazoDe(respuesta, 'MENSUALIDAD_NO_VIGENTE', 'ROJA').clases).toBeNull();
          }
          expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toEqual([]);
          expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(0);
        },
      );

      it('criterio 8 (control): la misma matrícula VIGENTE de noviembre sí marca dentro de su clase', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);

        const respuesta = await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '18:20')).secretaria, alumno);

        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
      });

      it('criterio 8: con una matrícula RESERVADA y un pago en verificación del mes, el rechazo es PAGO_EN_VERIFICACION y no MENSUALIDAD_NO_VIGENTE (DR-3)', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        await ponerPagoEnVerificacion(esc, alumno);

        const respuesta = await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '18:20')).secretaria, alumno);

        rechazoDe(respuesta, 'PAGO_EN_VERIFICACION', 'ROJA');
      });

      it('criterio 8: un alumno con estado ALUMNO_VENCIDO y matrícula del día marca: decide la matrícula, no la columna estado', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc, { estadoDelAlumno: 'ALUMNO_VENCIDO' });

        const respuesta = await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '18:20')).secretaria, alumno);

        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
      });

      it('criterio 8: un alumno con estado ALUMNO_ACTIVO y sin matrícula del día no marca: decide la matrícula, no la columna estado', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        await cambiarMatricula(esc.e.A.id, alumno.matriculaId, { estado: 'FINALIZADA' });
        await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { estado: 'ALUMNO_ACTIVO' });

        const respuesta = await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '18:20')).secretaria, alumno);

        expect(codigoDeRespuesta(respuesta)).toBe('MENSUALIDAD_NO_VIGENTE');
      });

      it('criterio 8 («Inscrito a mitad de mes»): con fecha_inicio el 16/11 la matrícula vale ese mismo día; con fecha_inicio el 17/11, no: MENSUALIDAD_NO_VIGENTE', async () => {
        const desdeHoy = await crearAlumnoDeAsistencia(ctx, esc, { fechaInicio: '2026-11-16' });
        const desdeManana = await crearAlumnoDeAsistencia(ctx, esc, { fechaInicio: '2026-11-17' });
        const cookie = en(ctx, esc, enLima(LUNES, '18:20')).secretaria;

        const hoy = await marcar(ctx, 'QR', cookie, desdeHoy);
        const manana = await marcar(ctx, 'QR', cookie, desdeManana);

        expect(hoy.status, hoy.texto.slice(0, 300)).toBe(201);
        rechazoDe(manana, 'MENSUALIDAD_NO_VIGENTE', 'ROJA');
      });
    });

    describe('la hora que se guarda es la de Lima, no la del proceso', () => {
      it('criterio 8: la asistencia del lunes 16/11 a las 18:05 de Lima (23:05 UTC, 08:05 del martes en Tokyo) guarda fecha 2026-11-16 y devuelve la hora 18:05', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);

        const resultado = resultadoDe(
          await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '18:05')).secretaria, alumno),
          201,
        );

        expect(resultado.asistencia).toMatchObject({
          fecha: LUNES,
          horaLlegada: '18:05',
          llegadaEn: '2026-11-16T23:05:00.000Z',
        });
        expect((await asistenciasDe(esc.e.A.id, alumno.alumnoId))[0]?.fecha).toBe(LUNES);
      });
    });
  },
);
