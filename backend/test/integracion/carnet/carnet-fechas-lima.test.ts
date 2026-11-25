import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AlumnoConQr,
  type AppCarnet,
  carnetDe,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
  prepararEscenarioDelCarnet,
  RUTA_MI_CARNET,
} from '../../utilidades/escenario-carnet';

// Spec 008, criterio 8 (prueba obligatoria, no protegida; HU-13, RNF-12): «hoy» del carnet es el día de Lima según `RELOJ`, no el del proceso ni el de UTC.
// Con una matrícula de noviembre (2026-11-01 a 2026-11-30) y el proceso en TZ=UTC y en TZ=Asia/Tokyo:
//   - el 30/11 a las 18:59 y a las 19:00 de Lima (esta última ya es 1/12 en UTC) está vigente hoy;
//   - el 1/12 a las 00:00 de Lima ya no, y el carnet sigue mostrando la matrícula de noviembre (no hay una de diciembre) con `vigenteHoy: false`.
// Se lee por `/api/mi-carnet`: la sesión del alumno dura 30 días, así que la cookie emitida el 11/11 sigue valiendo en esos instantes.

const ZONA_ORIGINAL = process.env['TZ'];

const CASOS: { instante: string; vigenteHoy: boolean; nombre: string }[] = [
  { instante: '2026-11-30T23:59:00.000Z', vigenteHoy: true, nombre: '18:59 del 30/11 en Lima' },
  { instante: '2026-12-01T00:00:00.000Z', vigenteHoy: true, nombre: '19:00 del 30/11 en Lima (ya es 1/12 en UTC)' },
  { instante: '2026-12-01T04:59:59.999Z', vigenteHoy: true, nombre: '23:59:59.999 del 30/11 en Lima' },
  { instante: '2026-12-01T05:00:00.000Z', vigenteHoy: false, nombre: '00:00 del 1/12 en Lima' },
];

describe.each(['UTC', 'Asia/Tokyo'])(
  'la vigencia del carnet usa el día de Lima (criterio 8) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppCarnet;
    let esc: EscenarioDelCarnet;
    let alumno: AlumnoConQr;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppCarnet();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      esc = await prepararEscenarioDelCarnet(ctx);
      alumno = await crearAlumnoPorPago(ctx, esc);
    });
    afterAll(async () => {
      await ctx?.cerrarTodo();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    it.each(CASOS)(
      '$nombre: vigenteHoy es $vigenteHoy y la matrícula es la de noviembre',
      async ({ instante, vigenteHoy }) => {
        ctx.reloj.fijar(new Date(instante));

        const carnet = carnetDe(await ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie }));

        expect(carnet.matricula, 'el carnet muestra la matrícula de noviembre').toMatchObject({
          desde: '2026-11-01',
          hasta: '2026-11-30',
          vigenteHoy,
        });
      },
    );
  },
);
