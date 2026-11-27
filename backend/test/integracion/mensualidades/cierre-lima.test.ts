// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asistenciasDe,
  clasesUsadasDe,
  crearAlumnoDeAsistencia,
  en,
  enLima,
  type EscenarioDeAsistencia,
  marcarManual,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  DICIEMBRE,
  ejecutarCierre,
  ENERO_2027,
  estadoDeLaMatricula,
  estadoDelAlumno,
  instantaneaDelCierre,
  matriculasPorMes,
  NOVIEMBRE,
  prepararEscenarioDeCierre,
  sembrarAlumno,
} from '../../utilidades/escenario-cierre';
import { asegurarCajaDelDia, ejecutarFaltas, inasistenciasDe } from '../../utilidades/escenario-faltas';
import { rutaAprobacion, sembrarEnVerificacion } from '../../utilidades/escenario-pagos-007b';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 28 (crítico, RNF-12, RN-23): con `RELOJ` fijo y el proceso en `TZ=Asia/Tokyo` (y en UTC): el 30/11/2026 a las 23:59:59.999 de Lima no cierra noviembre; el 1/12 a las 00:00:00.000 sí. Un Yape de noviembre aprobado el 3/12 (DR-2 de 007) deja la matrícula `VIGENTE` de
// noviembre, que la vuelta siguiente cierra, y el alumno queda `ALUMNO_VENCIDO` si no tiene diciembre. Un alumno que renovó diciembre en la ventana sigue `ALUMNO_ACTIVO`; uno `ALUMNO_VENCIDO` que pagó diciembre pasa a `ALUMNO_ACTIVO`. La tarea de faltas (009b) sigue registrando la
// falta del 30/11 con la matrícula ya `FINALIZADA`.
// Lecturas estrictas elegidas: (1) la tarea recibe «ahora» por parámetro: el reloj del proceso y su zona no cuentan; los dos bordes se prueban con el instante exacto (el 30/11 a las 23:59:59.999 de Lima es el 1/12 a las 04:59:59.999 UTC y a las 13:59:59.999 en Tokio: una
// implementación que decida con la fecha del proceso cerraría noviembre un día antes); (2) «no cierra noviembre» es que ninguna fila de `alumnos` ni de `matriculas` cambia (ni los estados de los alumnos); (3) la clase de 19:00 a 20:00 del último día: una vuelta durante la clase
// (a las 19:00:00.000 y a las 19:59:59.999) no cierra y el marcado de las 19:30 sigue descontando de la mensualidad de noviembre; (4) el Yape aprobado el 3/12 se prueba con la aprobación real por la API (la caja de ese día abierta, `RELOJ` en ese instante): el alumno recién
// aprobado es `ALUMNO_ACTIVO` y la vuelta siguiente lo deja `ALUMNO_VENCIDO`; antes de la aprobación, la vuelta no toca la matrícula `RESERVADA` ni al `CLIENTE`; (5) el cambio de año (la matrícula `VIGENTE` de diciembre de 2026 se finaliza el 1/1/2027 a las 00:00 de Lima, no antes)
// es parte de «un mes anterior a M»; (6) la falta del 30/11 se registra igual si la tarea de faltas corre antes o después del cierre, con una sola falta.

const ZONA_ORIGINAL = process.env['TZ'];

describe.each(['UTC', 'Asia/Tokyo'])(
  'el cierre de mes y los bordes de Lima (criterio 28) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppCarnet;
    let esc: EscenarioDeAsistencia;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppCarnet();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      esc = await prepararEscenarioDeCierre(ctx);
    });
    afterAll(async () => {
      await ctx?.cerrarTodo();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    const A = () => esc.e.A.id;
    const ULTIMO_INSTANTE_DE_NOVIEMBRE = enLima('2026-11-30', '23:59:59.999');
    const PRIMER_INSTANTE_DE_DICIEMBRE = enLima('2026-12-01', '00:00:00.000');

    describe('el cambio de mes', () => {
      it('criterio 28: el 30/11 a las 23:59:59.999 de Lima el cierre no cambia ninguna fila; el 1/12 a las 00:00:00.000 finaliza noviembre y actualiza a los alumnos', async () => {
        expect(ULTIMO_INSTANTE_DE_NOVIEMBRE.toISOString(), 'es el 1/12 a las 04:59:59.999 UTC').toBe(
          '2026-12-01T04:59:59.999Z',
        );
        const sinRenovar = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE', clasesUsadas: 2 }],
        });
        const renovo = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [
            { mes: NOVIEMBRE, estado: 'VIGENTE' },
            { mes: DICIEMBRE, estado: 'VIGENTE' },
          ],
        });
        const antes = await instantaneaDelCierre(esc);

        await ejecutarCierre(ctx, ULTIMO_INSTANTE_DE_NOVIEMBRE);

        expect(
          await instantaneaDelCierre(esc),
          'una milésima antes de las 00:00 de Lima del 1/12 no se cierra nada',
        ).toBe(antes);

        await ejecutarCierre(ctx, PRIMER_INSTANTE_DE_DICIEMBRE);

        expect(await estadoDeLaMatricula(A(), sinRenovar.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
        expect(await estadoDelAlumno(A(), sinRenovar.alumnoId)).toBe('ALUMNO_VENCIDO');
        expect(await estadoDeLaMatricula(A(), renovo.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
        expect(await estadoDeLaMatricula(A(), renovo.alumnoId, DICIEMBRE)).toBe('VIGENTE');
        expect(
          await estadoDelAlumno(A(), renovo.alumnoId),
          'quien renovó diciembre en la ventana sigue ALUMNO_ACTIVO',
        ).toBe('ALUMNO_ACTIVO');
      });

      it('criterio 28: un alumno ALUMNO_VENCIDO que pagó diciembre pasa a ALUMNO_ACTIVO el 1/12 a las 00:00:00.000 de Lima y no antes (a las 23:59:59.999 del 30/11 su matrícula de diciembre no es la del mes en curso)', async () => {
        const vencido = await sembrarAlumno(esc, {
          estado: 'ALUMNO_VENCIDO',
          matriculas: [{ mes: DICIEMBRE, estado: 'VIGENTE' }],
        });

        await ejecutarCierre(ctx, ULTIMO_INSTANTE_DE_NOVIEMBRE);
        expect(await estadoDelAlumno(A(), vencido.alumnoId), 'el 30/11 todavía no es diciembre').toBe('ALUMNO_VENCIDO');

        await ejecutarCierre(ctx, PRIMER_INSTANTE_DE_DICIEMBRE);
        expect(await estadoDelAlumno(A(), vencido.alumnoId)).toBe('ALUMNO_ACTIVO');
      });

      it('criterio 28: la clase de 19:00 a 20:00 del último día: una vuelta a las 19:00:00.000 y otra a las 19:59:59.999 no cierran noviembre, el marcado de las 19:30 descuenta de noviembre, y la del 1/12 a las 00:00:00.000 la finaliza con la clase ya descontada', async () => {
        const alumno = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          claseIds: [esc.lunes19.id],
          matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
        });
        const matriculaId = alumno.matriculaIds[0] as string;

        await ejecutarCierre(ctx, enLima('2026-11-30', '19:00:00.000'));
        const marcado = await marcarManual(
          ctx,
          en(ctx, esc, enLima('2026-11-30', '19:30')).secretaria,
          alumno.alumnoId,
        );
        await ejecutarCierre(ctx, enLima('2026-11-30', '19:59:59.999'));
        await ejecutarCierre(ctx, ULTIMO_INSTANTE_DE_NOVIEMBRE);

        expect(marcado.status, marcado.texto.slice(0, 300)).toBe(201);
        expect(
          await estadoDeLaMatricula(A(), alumno.alumnoId, NOVIEMBRE),
          'la mensualidad dura hasta las 23:59:59.999 de Lima',
        ).toBe('VIGENTE');
        expect(await clasesUsadasDe(A(), matriculaId)).toBe(1);
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_ACTIVO');

        await ejecutarCierre(ctx, PRIMER_INSTANTE_DE_DICIEMBRE);

        expect((await matriculasPorMes(A(), alumno.alumnoId))['2026-11']).toMatchObject({
          estado: 'FINALIZADA',
          clasesTotales: 12,
          clasesUsadas: 1,
        });
        expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      });

      it('criterio 28: el cambio de año: la matrícula VIGENTE de diciembre de 2026 no se finaliza el 31/12 a las 23:59:59.999 de Lima y sí el 1/1/2027 a las 00:00:00.000; quien tiene la de enero sigue ALUMNO_ACTIVO', async () => {
        const sinRenovar = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [{ mes: DICIEMBRE, estado: 'VIGENTE' }],
        });
        const renovo = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [
            { mes: DICIEMBRE, estado: 'VIGENTE' },
            { mes: ENERO_2027, estado: 'VIGENTE' },
          ],
        });
        const antes = await instantaneaDelCierre(esc);

        await ejecutarCierre(ctx, enLima('2026-12-31', '23:59:59.999'));
        expect(await instantaneaDelCierre(esc), 'el 31/12 no se cierra nada').toBe(antes);

        await ejecutarCierre(ctx, enLima('2027-01-01', '00:00:00.000'));

        expect(await estadoDeLaMatricula(A(), sinRenovar.alumnoId, DICIEMBRE)).toBe('FINALIZADA');
        expect(await estadoDelAlumno(A(), sinRenovar.alumnoId)).toBe('ALUMNO_VENCIDO');
        expect(await estadoDeLaMatricula(A(), renovo.alumnoId, DICIEMBRE)).toBe('FINALIZADA');
        expect(await estadoDeLaMatricula(A(), renovo.alumnoId, ENERO_2027)).toBe('VIGENTE');
        expect(await estadoDelAlumno(A(), renovo.alumnoId)).toBe('ALUMNO_ACTIVO');
      });

      it('criterio 28: una academia suspendida el 1/12 queda intacta y, al reactivarla el 3/12, la vuelta cierra su noviembre (la fecha que decide es la de «ahora», no la de la suspensión)', async () => {
        const alumno = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
        });
        await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');

        await ejecutarCierre(ctx, PRIMER_INSTANTE_DE_DICIEMBRE);
        expect(await estadoDeLaMatricula(A(), alumno.alumnoId, NOVIEMBRE)).toBe('VIGENTE');

        await fijarEstadoDeAcademia(A(), 'ACTIVA');
        await ejecutarCierre(ctx, enLima('2026-12-03', '10:00'));

        expect(await estadoDeLaMatricula(A(), alumno.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_VENCIDO');
      });
    });

    describe('un Yape de noviembre aprobado tarde (DR-2 de 007)', () => {
      const TRES_DE_DICIEMBRE = enLima('2026-12-03', '10:00');

      it('criterio 28: el 3/12 la vuelta no toca el Yape en verificación (matrícula RESERVADA, persona CLIENTE); aprobado ese día, la matrícula queda VIGENTE de noviembre y la vuelta siguiente la finaliza y deja al alumno ALUMNO_VENCIDO', async () => {
        const cliente = await sembrarEnVerificacion(esc.e, { claseIds: [esc.e.lunes.id] });

        await ejecutarCierre(ctx, TRES_DE_DICIEMBRE);

        expect(
          await estadoDeLaMatricula(A(), cliente.alumnoId, NOVIEMBRE),
          'la reserva en verificación no se cierra',
        ).toBe('RESERVADA');
        expect(await estadoDelAlumno(A(), cliente.alumnoId)).toBe('CLIENTE');

        const cookie = en(ctx, esc, TRES_DE_DICIEMBRE).secretaria;
        await asegurarCajaDelDia(esc, '2026-12-03');
        const aprobacion = await ctx.http.post(rutaAprobacion(cliente.pagoId), {}, { cookie });
        expect(aprobacion.status, aprobacion.texto.slice(0, 300)).toBe(200);
        expect(
          await estadoDeLaMatricula(A(), cliente.alumnoId, NOVIEMBRE),
          'aprobado el 3/12 el pago de noviembre deja la matrícula VIGENTE',
        ).toBe('VIGENTE');
        expect(await estadoDelAlumno(A(), cliente.alumnoId)).toBe('ALUMNO_ACTIVO');

        await ejecutarCierre(ctx, enLima('2026-12-03', '10:15'));

        const matricula = (await matriculasPorMes(A(), cliente.alumnoId))['2026-11'];
        expect(matricula, 'la vuelta siguiente cierra la matrícula de noviembre y conserva sus clases').toMatchObject({
          estado: 'FINALIZADA',
          clasesTotales: 5,
          clasesUsadas: 0,
        });
        expect(await estadoDelAlumno(A(), cliente.alumnoId), 'sin diciembre, ALUMNO_VENCIDO').toBe('ALUMNO_VENCIDO');
      });
    });

    describe('la tarea de faltas con la matrícula ya finalizada (009b)', () => {
      const FALTAS_EL_1_DE_DICIEMBRE = enLima('2026-12-01', '08:00');

      it('criterio 28: con noviembre ya FINALIZADA por el cierre de las 00:00, la tarea de faltas de las 08:00 sigue registrando la falta del lunes 30/11 (una sola) con esa matrícula', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);

        await ejecutarCierre(ctx, PRIMER_INSTANTE_DE_DICIEMBRE);
        expect(await estadoDeLaMatricula(A(), alumno.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
        await ejecutarFaltas(ctx, FALTAS_EL_1_DE_DICIEMBRE);
        await ejecutarFaltas(ctx, FALTAS_EL_1_DE_DICIEMBRE);

        const faltas = await inasistenciasDe(A(), alumno.alumnoId);
        expect(faltas.map((falta) => [falta.matricula_id, falta.fecha, falta.clase_id])).toEqual([
          [alumno.matriculaId, '2026-11-30', esc.e.lunes.id],
        ]);
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_VENCIDO');
      });

      it('criterio 28: en el otro orden (las faltas primero y el cierre después) queda la misma falta, y el cierre no la borra ni la duplica', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);

        await ejecutarFaltas(ctx, enLima('2026-11-30', '23:30'));
        await ejecutarCierre(ctx, PRIMER_INSTANTE_DE_DICIEMBRE);
        await ejecutarFaltas(ctx, FALTAS_EL_1_DE_DICIEMBRE);

        const faltas = await inasistenciasDe(A(), alumno.alumnoId);
        expect(faltas.map((falta) => [falta.matricula_id, falta.fecha])).toEqual([[alumno.matriculaId, '2026-11-30']]);
        expect(await estadoDeLaMatricula(A(), alumno.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
      });
    });
  },
);
