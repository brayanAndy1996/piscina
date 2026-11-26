// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  cambiarMatricula,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  enLima,
  LUNES,
  PRIMERO_DE_DICIEMBRE,
  ULTIMO_LUNES_DE_NOVIEMBRE,
} from '../../utilidades/escenario-asistencia';
import {
  crearAlumnoPagadoEn,
  ejecutarFaltas,
  inasistenciasDe,
  prepararEscenarioDe009b,
} from '../../utilidades/escenario-faltas';

// Criterio 25 (crítico, D-16, RNF-12): con `RELOJ` fijo y el proceso en `TZ=Asia/Tokyo` (y en UTC): la clase del lunes 30/11/2026 de 19:00 a 20:00 no tiene falta a las 19:59:59.999 y sí a las 20:00:00.000, con `fecha` 2026-11-30 y la
// matrícula de noviembre (en UTC ya es 1/12 y en Tokio también); una vuelta del 1/12 a las 08:00 que no corrió la noche anterior (servidor apagado) registra las faltas del 30/11; una del 2/12 no registra las del 30/11 (fuera de la
// ventana de ayer y hoy). Quien se inscribió y pagó a las 18:30 no tiene falta por la clase de las 18:00 de ese día; quien pagó por Yape hoy no tiene falta por la clase de ayer.
// Lecturas estrictas elegidas: «su inicio no es anterior a la fecha de confirmación» se lee con el borde incluido (el pago confirmado a las 18:00:00.000 exactas no deja la clase de las 18:00 fuera; a las 18:00:00.001 sí); la matrícula
// `FINALIZADA` de noviembre (la 010 la cierra el 1/12) sigue dando la falta del 30/11; el pago se confirma de verdad por la API con el reloj en el instante indicado (el cobro en efectivo y la aprobación del Yape), no con una fila sembrada;
// la tarea recibe «ahora» por parámetro: el reloj del proceso y su zona no cuentan.

const ZONA_ORIGINAL = process.env['TZ'];

describe.each(['UTC', 'Asia/Tokyo'])(
  'las faltas y los bordes de Lima (criterio 25) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppCarnet;
    let esc: EscenarioDeAsistencia;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppCarnet();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      esc = await prepararEscenarioDe009b(ctx, { rutas: false });
    });
    afterAll(async () => {
      await ctx?.cerrarTodo();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    const A = () => esc.e.A.id;
    const alumnoDe19 = () => crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id] });

    describe('el último lunes de noviembre: 19:00 a 20:00 en Lima es el 1/12 en UTC', () => {
      it('criterio 25: a las 19:59:59.999 del 30/11 todavía no hay falta; a las 20:00:00.000 sí, con fecha 2026-11-30 y la matrícula de noviembre', async () => {
        const alumno = await alumnoDe19();
        const fin = enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '20:00:00.000');
        expect(fin.toISOString(), 'es la 01:00 UTC del 1/12').toBe('2026-12-01T01:00:00.000Z');

        await ejecutarFaltas(ctx, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '19:59:59.999'));
        expect(await inasistenciasDe(A(), alumno.alumnoId), 'una milésima antes del fin').toEqual([]);
        await ejecutarFaltas(ctx, fin);

        const faltas = await inasistenciasDe(A(), alumno.alumnoId);
        expect(faltas).toHaveLength(1);
        expect(faltas[0]).toMatchObject({
          fecha: '2026-11-30',
          matricula_id: alumno.matriculaId,
          clase_id: esc.lunes19.id,
          asistencia_id: null,
        });
        expect(faltas[0]?.registrada_en.toISOString()).toBe(fin.toISOString());
      });

      it('criterio 25: a las 23:30 del 30/11 de Lima (04:30 UTC del 1/12) la fecha de la falta sigue siendo la de Lima: 2026-11-30', async () => {
        const alumno = await alumnoDe19();

        await ejecutarFaltas(ctx, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '23:30:00.000'));

        expect((await inasistenciasDe(A(), alumno.alumnoId)).map((falta) => falta.fecha)).toEqual(['2026-11-30']);
      });

      it.each(['VIGENTE', 'FINALIZADA'] as const)(
        'criterio 25: una vuelta del 1/12 a las 08:00 que no corrió la noche anterior (servidor apagado) registra la falta del 30/11 con la matrícula %s de noviembre',
        async (estado) => {
          const alumno = await alumnoDe19();
          await cambiarMatricula(A(), alumno.matriculaId, { estado });

          await ejecutarFaltas(ctx, enLima(PRIMERO_DE_DICIEMBRE, '08:00:00.000'));

          const faltas = await inasistenciasDe(A(), alumno.alumnoId);
          expect(faltas).toHaveLength(1);
          expect(faltas[0]).toMatchObject({ fecha: '2026-11-30', matricula_id: alumno.matriculaId });
          expect(faltas[0]?.registrada_en.toISOString()).toBe(
            enLima(PRIMERO_DE_DICIEMBRE, '08:00:00.000').toISOString(),
          );
        },
      );

      it('criterio 25: una vuelta del 2/12 no registra las faltas del 30/11: quedan fuera de la ventana de ayer y hoy', async () => {
        const alumno = await alumnoDe19();

        await ejecutarFaltas(ctx, enLima('2026-12-02', '08:00:00.000'));

        expect(await inasistenciasDe(A(), alumno.alumnoId)).toEqual([]);
      });

      it('criterio 25: la falta de una clase que ya pasó el 30/11 no se pierde si la vuelta llega el mismo 30/11 más tarde (21:00) o al día siguiente: una sola falta', async () => {
        const alumno = await alumnoDe19();

        await ejecutarFaltas(ctx, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '21:00:00.000'));
        await ejecutarFaltas(ctx, enLima(PRIMERO_DE_DICIEMBRE, '08:00:00.000'));

        expect(await inasistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      });
    });

    describe('quien pagó después de empezar la clase no tiene falta por ella', () => {
      const CLASE_DE_LAS_18 = LUNES;

      it('criterio 25: quien se inscribió y pagó a las 18:30 del lunes no tiene falta por la clase de las 18:00 de ese día; quien pagó a las 17:30 sí', async () => {
        const tarde = await crearAlumnoPagadoEn(ctx, esc, { pagadoEn: enLima(CLASE_DE_LAS_18, '18:30:00.000') });
        const temprano = await crearAlumnoPagadoEn(ctx, esc, { pagadoEn: enLima(CLASE_DE_LAS_18, '17:30:00.000') });

        await ejecutarFaltas(ctx, enLima(CLASE_DE_LAS_18, '19:00:00.000'));

        expect(await inasistenciasDe(A(), tarde.alumnoId)).toEqual([]);
        expect(await inasistenciasDe(A(), temprano.alumnoId)).toHaveLength(1);
      });

      it('criterio 25: el borde de la confirmación: pagado a las 17:59:59.999 y a las 18:00:00.000 exactas tiene falta; a las 18:00:00.001, no', async () => {
        const antes = await crearAlumnoPagadoEn(ctx, esc, { pagadoEn: enLima(CLASE_DE_LAS_18, '17:59:59.999') });
        const justo = await crearAlumnoPagadoEn(ctx, esc, { pagadoEn: enLima(CLASE_DE_LAS_18, '18:00:00.000') });
        const despues = await crearAlumnoPagadoEn(ctx, esc, { pagadoEn: enLima(CLASE_DE_LAS_18, '18:00:00.001') });

        await ejecutarFaltas(ctx, enLima(CLASE_DE_LAS_18, '19:00:00.000'));

        expect(await inasistenciasDe(A(), antes.alumnoId)).toHaveLength(1);
        expect(await inasistenciasDe(A(), justo.alumnoId)).toHaveLength(1);
        expect(await inasistenciasDe(A(), despues.alumnoId)).toEqual([]);
      });

      it('criterio 25: quien pagó por Yape hoy (martes 17/11 a las 10:00) no tiene falta por la clase de ayer (lunes 16/11 a las 18:00); quien pagó por Yape el lunes a las 17:00 sí', async () => {
        const ayer = await crearAlumnoPagadoEn(ctx, esc, {
          pagadoEn: enLima(CLASE_DE_LAS_18, '17:00:00.000'),
          pago: 'YAPE',
        });
        const hoy = await crearAlumnoPagadoEn(ctx, esc, {
          pagadoEn: enLima('2026-11-17', '10:00:00.000'),
          pago: 'YAPE',
        });

        await ejecutarFaltas(ctx, enLima('2026-11-17', '12:00:00.000'));

        expect(await inasistenciasDe(A(), hoy.alumnoId)).toEqual([]);
        expect((await inasistenciasDe(A(), ayer.alumnoId)).map((falta) => falta.fecha)).toEqual([CLASE_DE_LAS_18]);
      });

      it('criterio 25: el pago del lunes a las 18:30 sí da falta por la clase del lunes siguiente (23/11 a las 18:00): solo la clase de ese día queda fuera', async () => {
        const alumno = await crearAlumnoPagadoEn(ctx, esc, { pagadoEn: enLima(CLASE_DE_LAS_18, '18:30:00.000') });

        await ejecutarFaltas(ctx, enLima('2026-11-23', '19:00:00.000'));

        expect((await inasistenciasDe(A(), alumno.alumnoId)).map((falta) => falta.fecha)).toEqual(['2026-11-23']);
      });
    });
  },
);
