// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  asistenciasDe,
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  desactivarClase,
  type EscenarioDeAsistencia,
  en,
  enLima,
  instantaneaDeAsistencia,
  LUNES,
  MARTES,
  marcar,
  prepararEscenarioDeAsistencia,
  rechazoDe,
  resultadoDe,
  ULTIMO_LUNES_DE_NOVIEMBRE,
  type Via,
} from '../../utilidades/escenario-asistencia';

// Criterio 9 (crítico, D-16, HU-14): solo mientras dura la clase, con la ventana `[inicio, fin)` en America/Lima. Con `RELOJ` fijo, para la clase de 18:00 a 19:00 del alumno: 17:59:59.999 responde `FUERA_DE_HORARIO` con `detalles.claseDeHoy`
// `{ horaInicio: '18:00', horaFin: '19:00' }`; 18:00:00.000 y 18:59:59.999 registran; 19:00:00.000 responde `FUERA_DE_HORARIO`. Para la de 19:00 a 20:00: 19:00:00.000 registra y 20:00:00.000 no. Un día sin clase suya responde `FUERA_DE_HORARIO` con `claseDeHoy: null`.
// La clase de otro nivel o de otro alumno a la misma hora no cuenta: solo la de su matrícula (la asistencia en otro horario es de la 020, HU-38). Todo con el proceso en UTC y en Asia/Tokyo.
// Casos límite: el alumno que llega antes de su clase (17:55) recibe el aviso amarillo con la hora de inicio y puede volver a escanear desde las 18:00 (DR-5); una clase desactivada no cuenta como clase del día. Lecturas estrictas elegidas: la ventana es la misma por las dos vías
// (QR y manual); un rechazo por horario no escribe, no descuenta ni audita; llegar a las 18:59:59.999 es válido (tarde), porque la puntualidad (criterio 10) no cierra la ventana.

const ZONA_ORIGINAL = process.env['TZ'];

interface CasoDeVentana {
  clase: 'lunes18' | 'lunes19';
  dia: string;
  hora: string;
  registra: boolean;
  nombre: string;
}

const CASOS: CasoDeVentana[] = [
  { clase: 'lunes18', dia: LUNES, hora: '17:55:00.000', registra: false, nombre: 'cinco minutos antes (17:55)' },
  {
    clase: 'lunes18',
    dia: LUNES,
    hora: '17:59:59.999',
    registra: false,
    nombre: 'un milisegundo antes del inicio (17:59:59.999)',
  },
  { clase: 'lunes18', dia: LUNES, hora: '18:00:00.000', registra: true, nombre: 'justo al inicio (18:00:00.000)' },
  { clase: 'lunes18', dia: LUNES, hora: '18:30:00.000', registra: true, nombre: 'a mitad de la clase (18:30)' },
  {
    clase: 'lunes18',
    dia: LUNES,
    hora: '18:59:59.999',
    registra: true,
    nombre: 'un milisegundo antes del fin (18:59:59.999)',
  },
  { clase: 'lunes18', dia: LUNES, hora: '19:00:00.000', registra: false, nombre: 'justo al fin (19:00:00.000)' },
  {
    clase: 'lunes18',
    dia: LUNES,
    hora: '23:59:59.999',
    registra: false,
    nombre: 'a última hora del día (23:59:59.999)',
  },
  {
    clase: 'lunes18',
    dia: LUNES,
    hora: '00:00:00.000',
    registra: false,
    nombre: 'a primera hora del día (00:00:00.000)',
  },
  {
    clase: 'lunes19',
    dia: LUNES,
    hora: '18:59:59.999',
    registra: false,
    nombre: 'la de 19:00: un milisegundo antes del inicio (18:59:59.999)',
  },
  {
    clase: 'lunes19',
    dia: LUNES,
    hora: '19:00:00.000',
    registra: true,
    nombre: 'la de 19:00: justo al inicio (19:00:00.000)',
  },
  {
    clase: 'lunes19',
    dia: LUNES,
    hora: '19:59:59.999',
    registra: true,
    nombre: 'la de 19:00: un milisegundo antes del fin (19:59:59.999)',
  },
  {
    clase: 'lunes19',
    dia: LUNES,
    hora: '20:00:00.000',
    registra: false,
    nombre: 'la de 19:00: justo al fin (20:00:00.000)',
  },
  {
    clase: 'lunes19',
    dia: ULTIMO_LUNES_DE_NOVIEMBRE,
    hora: '19:00:00.000',
    registra: true,
    nombre: 'la de 19:00 del 30/11 (00:00 UTC del 1/12)',
  },
  {
    clase: 'lunes19',
    dia: ULTIMO_LUNES_DE_NOVIEMBRE,
    hora: '20:00:00.000',
    registra: false,
    nombre: 'la de 19:00 del 30/11, a su fin (01:00 UTC del 1/12)',
  },
];

describe.each(['UTC', 'Asia/Tokyo'])(
  'la ventana [inicio, fin) de la clase (criterio 9) con el proceso en TZ=%s',
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

    const alumnoDe = (clase: 'lunes18' | 'lunes19'): Promise<AlumnoDeAsistencia> =>
      clase === 'lunes18'
        ? crearAlumnoDeAsistencia(ctx, esc)
        : crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id] });

    describe.each<Via>(['QR', 'MANUAL'])('por la vía %s', (via) => {
      it.each(CASOS)(
        'criterio 9: $nombre ($dia $hora de Lima) → registra = $registra',
        async ({ clase, dia, hora, registra }) => {
          const alumno = await alumnoDe(clase);
          const cookie = en(ctx, esc, enLima(dia, hora)).secretaria;
          const antes = await instantaneaDeAsistencia(esc.e);

          const respuesta = await marcar(ctx, via, cookie, alumno);

          if (registra) {
            const resultado = resultadoDe(respuesta, 201);
            expect(resultado.asistencia.fecha, 'la fecha es la de Lima').toBe(dia);
            expect(resultado.asistencia.horaLlegada).toBe(hora.slice(0, 5));
            expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
          } else {
            const detalles = rechazoDe(respuesta, 'FUERA_DE_HORARIO', 'AMARILLA');
            expect(detalles.claseDeHoy, 'la clase de hoy del alumno').toEqual(
              clase === 'lunes18'
                ? { horaInicio: '18:00', horaFin: '19:00' }
                : { horaInicio: '19:00', horaFin: '20:00' },
            );
            expect(await instantaneaDeAsistencia(esc.e), 'un rechazo no escribe, no descuenta ni audita').toBe(antes);
          }
        },
      );
    });

    describe('un día sin clase suya', () => {
      it.each([
        ['el martes 17/11', MARTES],
        ['el miércoles 18/11', '2026-11-18'],
        ['el domingo 15/11', '2026-11-15'],
        ['el sábado 21/11', '2026-11-21'],
      ])(
        'criterio 9: %s a las 18:30 de Lima responde FUERA_DE_HORARIO con claseDeHoy null (por las dos vías)',
        async (_nombre, dia) => {
          const alumno = await alumnoDe('lunes18');
          const cookie = en(ctx, esc, enLima(dia, '18:30')).secretaria;

          for (const via of ['QR', 'MANUAL'] as const) {
            const detalles = rechazoDe(await marcar(ctx, via, cookie, alumno), 'FUERA_DE_HORARIO', 'AMARILLA');
            expect(detalles.claseDeHoy).toBeNull();
          }
          expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toEqual([]);
        },
      );
    });

    describe('solo cuenta la clase de su matrícula', () => {
      it('criterio 9: el alumno de la clase de las 17:00 no marca a las 18:30 aunque haya otra clase del mismo nivel a las 18:00 (la de otro alumno): FUERA_DE_HORARIO con su clase', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.e.lunes17.id] });
        const cookie = en(ctx, esc, enLima(LUNES, '18:30')).secretaria;

        const respuesta = await marcar(ctx, 'QR', cookie, alumno);

        expect(rechazoDe(respuesta, 'FUERA_DE_HORARIO', 'AMARILLA').claseDeHoy).toEqual({
          horaInicio: '17:00',
          horaFin: '18:00',
        });
      });

      it('criterio 9: ese mismo alumno sí marca a las 17:30, dentro de su clase de las 17:00', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.e.lunes17.id] });
        const cookie = en(ctx, esc, enLima(LUNES, '17:30')).secretaria;

        const resultado = resultadoDe(await marcar(ctx, 'QR', cookie, alumno), 201);

        expect(resultado.clase).toMatchObject({ id: esc.e.lunes17.id, horaInicio: '17:00', horaFin: '18:00' });
      });

      it('criterio 9: el alumno de la clase INTERMEDIO de las 18:00 marca con su clase, no con la BASICO de la misma hora', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc, {
          claseIds: [esc.e.intermedioLunes.id],
          nivel: 'INTERMEDIO',
        });
        const cookie = en(ctx, esc, enLima(LUNES, '18:30')).secretaria;

        const resultado = resultadoDe(await marcar(ctx, 'MANUAL', cookie, alumno), 201);

        expect(resultado.clase).toMatchObject({ id: esc.e.intermedioLunes.id, nivel: 'INTERMEDIO' });
        expect((await asistenciasDe(esc.e.A.id, alumno.alumnoId))[0]?.clase_id).toBe(esc.e.intermedioLunes.id);
      });

      it('criterio 9 («Clase desactivada»): una clase desactivada no cuenta como clase del día: FUERA_DE_HORARIO con claseDeHoy null', async () => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        await desactivarClase(esc.e.A.id, esc.e.lunes.id);
        const cookie = en(ctx, esc, enLima(LUNES, '18:30')).secretaria;

        const detalles = rechazoDe(await marcar(ctx, 'QR', cookie, alumno), 'FUERA_DE_HORARIO', 'AMARILLA');

        expect(detalles.claseDeHoy).toBeNull();
      });
    });

    describe('llegar antes y volver a escanear (DR-5)', () => {
      it('criterio 9: a las 17:55 el aviso es amarillo (no se registra nada); a las 18:00 el mismo alumno, con otra clave, marca', async () => {
        const alumno = await alumnoDe('lunes18');

        const antes = await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '17:55')).secretaria, alumno);
        const despues = await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '18:00')).secretaria, alumno);

        expect(rechazoDe(antes, 'FUERA_DE_HORARIO', 'AMARILLA').claseDeHoy).toEqual({
          horaInicio: '18:00',
          horaFin: '19:00',
        });
        expect(resultadoDe(despues, 201).asistencia).toMatchObject({ horaLlegada: '18:00', estadoLlegada: 'PUNTUAL' });
        expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
      });
    });
  },
);
