import { afterEach, describe, expect, it } from 'vitest';
import { cotizarRenovacion } from './cotizacion';

// Criterios 5 y 21 de la 010a (RN-25, HU-34, D-03, DR-3): la cotización de la renovación, con los bordes de Lima y con `TZ=Asia/Tokyo`.

const TZ_ORIGINAL = process.env['TZ'];
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = TZ_ORIGINAL;
});

const lima = (fecha: string, hora: string): Date => new Date(`${fecha}T${hora}-05:00`);
const LMV18 = [
  { diaSemana: 1, horaInicio: '18:00' },
  { diaSemana: 3, horaInicio: '18:00' },
  { diaSemana: 5, horaInicio: '18:00' },
] as const;
const PLAN_120 = { precio: '120.00', clasesPorMes: 12 };
const PLAN_100 = { precio: '100.00', clasesPorMes: 12 };

describe.each(['UTC', 'Asia/Tokyo'])('cotizarRenovacion con el proceso en TZ=%s', (zona) => {
  const fijar = () => {
    process.env['TZ'] = zona;
  };

  it('diciembre de 2026 con lunes, miércoles y viernes: 13 ocurrencias, tope 12, S/ 120.00 y no proporcional, desde cualquier día de la ventana', () => {
    fijar();
    for (const ahora of [lima('2026-11-26', '10:00'), lima('2026-11-30', '23:59:59.999')]) {
      expect(cotizarRenovacion(PLAN_120, LMV18, '2026-12', ahora)).toEqual({
        mes: '2026-12',
        fechaInicio: '2026-12-01',
        fechaFin: '2026-12-31',
        clasesRestantes: 13,
        clasesTotales: 12,
        clasesPorMes: 12,
        precioPlan: '120.00',
        monto: '120.00',
        esProporcional: false,
      });
    }
  });

  it('renovación tardía el jueves 26/11 a las 10:00 (quedan el viernes 27 y el lunes 30): 120 ÷ 12 × 2 = S/ 20.00, desde hoy', () => {
    fijar();
    expect(cotizarRenovacion(PLAN_120, LMV18, '2026-11', lima('2026-11-26', '10:00'))).toEqual({
      mes: '2026-11',
      fechaInicio: '2026-11-26',
      fechaFin: '2026-11-30',
      clasesRestantes: 2,
      clasesTotales: 2,
      clasesPorMes: 12,
      precioPlan: '120.00',
      monto: '20.00',
      esProporcional: true,
    });
  });

  it('plan de S/ 100.00 y 12 clases con 5 restantes (viernes 20/11 a las 10:00): 41.67 hacia arriba, una sola vez: S/ 42.00', () => {
    fijar();
    expect(cotizarRenovacion(PLAN_100, LMV18, '2026-11', lima('2026-11-20', '10:00'))).toMatchObject({
      clasesRestantes: 5,
      monto: '42.00',
      esProporcional: true,
    });
  });

  it('la clase de hoy cuenta si todavía no empezó y deja de contar si empieza en «ahora»', () => {
    fijar();
    const sabado18 = [{ diaSemana: 6, horaInicio: '18:00' }] as const;
    expect(cotizarRenovacion(PLAN_100, sabado18, '2026-11', lima('2026-11-28', '17:59:59.999'))).toMatchObject({
      clasesRestantes: 1,
      monto: '9.00',
    });
    expect(cotizarRenovacion(PLAN_100, sabado18, '2026-11', lima('2026-11-28', '18:00:00.000'))).toMatchObject({
      clasesRestantes: 0,
      clasesTotales: 0,
      monto: '0.00',
    });
  });

  it('el mes siguiente se cotiza desde el día 1 aunque hoy sea el 30/11 a las 23:59:59.999: 5 clases con 4 sábados es proporcional (S/ 40.00 de S/ 50.00)', () => {
    fijar();
    const sabado = [{ diaSemana: 6, horaInicio: '18:00' }] as const;
    expect(
      cotizarRenovacion({ precio: '50.00', clasesPorMes: 5 }, sabado, '2026-12', lima('2026-11-30', '23:59:59.999')),
    ).toMatchObject({
      mes: '2026-12',
      fechaInicio: '2026-12-01',
      clasesRestantes: 4,
      clasesTotales: 4,
      monto: '40.00',
      esProporcional: true,
    });
  });

  it('el cambio de año: enero de 2027 se cotiza desde el 1 de enero', () => {
    fijar();
    expect(cotizarRenovacion(PLAN_120, LMV18, '2027-01', lima('2026-12-28', '10:00'))).toMatchObject({
      mes: '2027-01',
      fechaInicio: '2027-01-01',
      fechaFin: '2027-01-31',
    });
  });

  it('un precio con céntimos se cobra al sol entero hacia arriba, una sola vez (S/ 120.50 con las 12 clases: S/ 121.00)', () => {
    fijar();
    expect(
      cotizarRenovacion({ precio: '120.50', clasesPorMes: 12 }, LMV18, '2026-12', lima('2026-11-27', '10:00')),
    ).toMatchObject({
      monto: '121.00',
    });
  });
});
