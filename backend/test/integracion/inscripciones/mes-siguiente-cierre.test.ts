// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, enLima } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  DICIEMBRE,
  ejecutarCierre,
  ENERO_2027,
  estadoDeLaMatricula,
  estadoDelAlumno,
  instantaneaDelCierre,
  NOVIEMBRE,
  OCTUBRE,
  prepararEscenarioDeCierre,
  sembrarAlumno,
} from '../../utilidades/escenario-cierre';
import { cuerpoParaMes, enviarPublico, INSTANTE, MES_DIC } from '../../utilidades/escenario-mes-siguiente';
import { cuerpoCobro, rutaCobro } from '../../utilidades/escenario-pagos';
import type { EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { abrirCajaPara } from '../../utilidades/escenario-renovacion';
import { leerAlumnos, leerSolicitudes } from '../../utilidades/inscripciones';

// Criterio 11 (crítico, 8.8, RN-23, D-23, DR-2): la tarea del cierre de mes (criterio 27 de 010) pasa un `ALUMNO_ACTIVO` a `ALUMNO_VENCIDO` solo si no tiene matrícula `VIGENTE` de M **ni de M+1**; el resto de sus reglas no cambia. Con `RELOJ` fijo y `TZ=Asia/Tokyo`: un cliente que pagó diciembre el 27/11 queda `ALUMNO_ACTIVO` después de las
// vueltas del 27/11, del 30/11 a las 23:59:59.999 y del 1/12 a las 00:00:00.000. Un `ALUMNO_ACTIVO` sin nada de M ni de M+1 sigue pasando a `ALUMNO_VENCIDO`; un `ALUMNO_VENCIDO` que renovó diciembre sigue `ALUMNO_VENCIDO` hasta el 1/12 (criterio 28 de 010, sin cambios). Volver a correr la tarea no cambia nada.
// Lecturas estrictas elegidas: (1) «M+1» es el mes siguiente al de Lima de «ahora» de la vuelta (`cerrar(ahora)`); solo cuenta una matrícula `VIGENTE` (no `RESERVADA`, `CANCELADA` ni `FINALIZADA`) y solo de M+1 (no de M+2); (2) las matrículas se siembran como dueño (sin solicitud ni pago), como en las pruebas de la 010b; el caso de «pagó diciembre el 27/11» se prueba también con el flujo
// completo (formulario público y cobro en efectivo).

const ZONA_ORIGINAL = process.env['TZ'];
const VUELTA_DEL_27 = INSTANTE.viernes27;
const VUELTA_ULTIMO_INSTANTE = enLima('2026-11-30', '23:59:59.999');
const VUELTA_DEL_PRIMERO = enLima('2026-12-01', '00:00:00.000');

describe.each(['UTC', 'Asia/Tokyo'])(
  'el cierre de mes no vence a quien ya pagó el mes siguiente (criterio 11) con el proceso en TZ=%s',
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
    const B = () => esc.e.B.id;

    describe('un ALUMNO_ACTIVO con solo la matrícula VIGENTE de M+1', () => {
      it('criterio 11: queda ALUMNO_ACTIVO después de las vueltas del 27/11, del 30/11 a las 23:59:59.999 y del 1/12 a las 00:00:00.000, en las dos academias, y su matrícula de diciembre sigue VIGENTE', async () => {
        const deA = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [{ mes: DICIEMBRE, estado: 'VIGENTE' }],
        });
        const deB = await sembrarAlumno(esc, {
          academia: 'B',
          estado: 'ALUMNO_ACTIVO',
          matriculas: [{ mes: DICIEMBRE, estado: 'VIGENTE' }],
        });

        for (const vuelta of [VUELTA_DEL_27, VUELTA_ULTIMO_INSTANTE, VUELTA_DEL_PRIMERO]) {
          await ejecutarCierre(ctx, vuelta);

          expect(await estadoDelAlumno(A(), deA.alumnoId), vuelta.toISOString()).toBe('ALUMNO_ACTIVO');
          expect(await estadoDelAlumno(B(), deB.alumnoId), vuelta.toISOString()).toBe('ALUMNO_ACTIVO');
          expect(await estadoDeLaMatricula(A(), deA.alumnoId, DICIEMBRE), vuelta.toISOString()).toBe('VIGENTE');
        }
      });

      it('criterio 11: volver a correr la tarea no cambia nada (ni el alumno ni sus matrículas)', async () => {
        await sembrarAlumno(esc, { estado: 'ALUMNO_ACTIVO', matriculas: [{ mes: DICIEMBRE, estado: 'VIGENTE' }] });
        await ejecutarCierre(ctx, VUELTA_DEL_27);
        const despuesDeLaPrimera = await instantaneaDelCierre(esc);

        await ejecutarCierre(ctx, VUELTA_DEL_27);
        await ejecutarCierre(ctx, VUELTA_ULTIMO_INSTANTE);

        expect(await instantaneaDelCierre(esc)).toBe(despuesDeLaPrimera);
      });

      it('criterio 11: el cambio de año: con solo la matrícula VIGENTE de enero de 2027 queda ALUMNO_ACTIVO el 31/12/2026 a las 10:00 y el 1/1/2027 a las 00:00:00.000', async () => {
        const alumno = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [{ mes: ENERO_2027, estado: 'VIGENTE' }],
        });

        for (const vuelta of [
          INSTANTE.jueves31dic,
          enLima('2026-12-31', '23:59:59.999'),
          enLima('2027-01-01', '00:00:00.000'),
        ]) {
          await ejecutarCierre(ctx, vuelta);
          expect(await estadoDelAlumno(A(), alumno.alumnoId), vuelta.toISOString()).toBe('ALUMNO_ACTIVO');
        }
      });

      it('criterio 11: con noviembre VIGENTE y diciembre VIGENTE sigue ALUMNO_ACTIVO el 27/11 y, el 1/12, con noviembre finalizada', async () => {
        const alumno = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [
            { mes: NOVIEMBRE, estado: 'VIGENTE' },
            { mes: DICIEMBRE, estado: 'VIGENTE' },
          ],
        });

        await ejecutarCierre(ctx, VUELTA_DEL_27);
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
        await ejecutarCierre(ctx, VUELTA_DEL_PRIMERO);

        expect(await estadoDeLaMatricula(A(), alumno.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
      });
    });

    describe('lo que sigue como antes: sin matrícula VIGENTE de M ni de M+1', () => {
      it.each([
        [
          'una matrícula antigua de octubre, VIGENTE (nada de M ni de M+1)',
          [{ mes: OCTUBRE, estado: 'VIGENTE' as const }],
        ],
        [
          'la de diciembre en verificación (RESERVADA): todavía no pagó',
          [{ mes: DICIEMBRE, estado: 'RESERVADA' as const }],
        ],
        ['la de diciembre CANCELADA', [{ mes: DICIEMBRE, estado: 'CANCELADA' as const }]],
        ['la de diciembre FINALIZADA', [{ mes: DICIEMBRE, estado: 'FINALIZADA' as const }]],
        ['solo la de enero de 2027 VIGENTE (M+2, no M+1)', [{ mes: ENERO_2027, estado: 'VIGENTE' as const }]],
      ])(
        'criterio 11: un ALUMNO_ACTIVO con %s pasa a ALUMNO_VENCIDO en la vuelta del 27/11',
        async (_nombre, matriculas) => {
          const alumno = await sembrarAlumno(esc, { estado: 'ALUMNO_ACTIVO', matriculas });

          await ejecutarCierre(ctx, VUELTA_DEL_27);

          expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_VENCIDO');
        },
      );

      it('criterio 11: un ALUMNO_ACTIVO con la matrícula VIGENTE de M (noviembre) sigue activo el 27/11; el 1/12 sin renovar pasa a ALUMNO_VENCIDO (sin cambios)', async () => {
        const alumno = await sembrarAlumno(esc, {
          estado: 'ALUMNO_ACTIVO',
          matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
        });

        await ejecutarCierre(ctx, VUELTA_DEL_27);
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
        await ejecutarCierre(ctx, VUELTA_DEL_PRIMERO);

        expect(await estadoDeLaMatricula(A(), alumno.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
        expect(await estadoDelAlumno(A(), alumno.alumnoId)).toBe('ALUMNO_VENCIDO');
      });

      it('criterio 11: un ALUMNO_VENCIDO que renovó diciembre sigue ALUMNO_VENCIDO el 27/11 y el 30/11 a las 23:59:59.999, y pasa a ALUMNO_ACTIVO el 1/12 a las 00:00:00.000 (criterio 28 de 010, sin cambios)', async () => {
        const vencido = await sembrarAlumno(esc, {
          estado: 'ALUMNO_VENCIDO',
          matriculas: [
            { mes: OCTUBRE, estado: 'FINALIZADA' },
            { mes: DICIEMBRE, estado: 'VIGENTE' },
          ],
        });

        await ejecutarCierre(ctx, VUELTA_DEL_27);
        expect(await estadoDelAlumno(A(), vencido.alumnoId)).toBe('ALUMNO_VENCIDO');
        await ejecutarCierre(ctx, VUELTA_ULTIMO_INSTANTE);
        expect(await estadoDelAlumno(A(), vencido.alumnoId)).toBe('ALUMNO_VENCIDO');
        await ejecutarCierre(ctx, VUELTA_DEL_PRIMERO);

        expect(await estadoDelAlumno(A(), vencido.alumnoId)).toBe('ALUMNO_ACTIVO');
      });

      it('criterio 11: un CLIENTE o un INACTIVO no cambian de estado por la matrícula VIGENTE de diciembre', async () => {
        const cliente = await sembrarAlumno(esc, {
          estado: 'CLIENTE',
          matriculas: [{ mes: DICIEMBRE, estado: 'VIGENTE' }],
        });
        const inactivo = await sembrarAlumno(esc, {
          estado: 'INACTIVO',
          matriculas: [{ mes: DICIEMBRE, estado: 'VIGENTE' }],
        });

        await ejecutarCierre(ctx, VUELTA_DEL_27);
        await ejecutarCierre(ctx, VUELTA_DEL_PRIMERO);

        expect(await estadoDelAlumno(A(), cliente.alumnoId)).toBe('CLIENTE');
        expect(await estadoDelAlumno(A(), inactivo.alumnoId)).toBe('INACTIVO');
      });
    });

    describe('el flujo completo: un cliente que pagó diciembre el 27/11', () => {
      it('criterio 11: se inscribe por el formulario para diciembre, paga en efectivo el 27/11 y queda ALUMNO_ACTIVO después de las vueltas del 27/11, del 30/11 a las 23:59:59.999 y del 1/12 a las 00:00:00.000 (con diciembre VIGENTE)', async () => {
        const cookies = en(ctx, esc, INSTANTE.viernes27);
        await abrirCajaPara(esc, INSTANTE.viernes27);
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC);
        const envio = await enviarPublico(ctx, cuerpo);
        expect(envio.status, envio.texto).toBe(201);
        const alumno = (await leerAlumnos(A())).find((fila) => fila.dni === (cuerpo['alumno'] as { dni: string }).dni);
        const solicitud = (await leerSolicitudes(A())).find((fila) => fila.alumno_id === alumno?.id);
        const cobro = await ctx.http.post(rutaCobro(solicitud?.id as string), cuerpoCobro('120.00'), {
          cookie: cookies.secretaria,
        });
        expect(cobro.status, cobro.texto).toBe(201);
        expect(await estadoDelAlumno(A(), alumno?.id as string)).toBe('ALUMNO_ACTIVO');

        for (const vuelta of [VUELTA_DEL_27, VUELTA_ULTIMO_INSTANTE, VUELTA_DEL_PRIMERO]) {
          await ejecutarCierre(ctx, vuelta);

          expect(await estadoDelAlumno(A(), alumno?.id as string), vuelta.toISOString()).toBe('ALUMNO_ACTIVO');
          expect(await estadoDeLaMatricula(A(), alumno?.id as string, DICIEMBRE), vuelta.toISOString()).toBe('VIGENTE');
        }
      });
    });
  },
);
