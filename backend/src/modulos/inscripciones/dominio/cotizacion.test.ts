import { describe, expect, it } from 'vitest';
import { cotizarInscripcion } from './cotizacion';

const LMV18 = [
  { diaSemana: 1, horaInicio: '18:00' },
  { diaSemana: 3, horaInicio: '18:00' },
  { diaSemana: 5, horaInicio: '18:00' },
] as const;
const PLAN = { precio: '120.00', clasesPorMes: 12 };

describe('cotizarInscripcion (criterios 9 y 11)', () => {
  it('a mitad de mes cobra la parte proporcional, redondeada hacia arriba (11 de noviembre de 2026, 10:00 en Lima: 9 clases)', () => {
    expect(cotizarInscripcion(PLAN, LMV18, new Date('2026-11-11T15:00:00.000Z'))).toEqual({
      mes: '2026-11',
      fechaInicio: '2026-11-11',
      fechaFin: '2026-11-30',
      clasesRestantes: 9,
      clasesTotales: 9,
      clasesPorMes: 12,
      precioPlan: '120.00',
      monto: '90.00',
      esProporcional: true,
    });
  });

  it('el 1 del mes quedan más clases que las del plan: se topa en las del plan y no es proporcional', () => {
    const cotizacion = cotizarInscripcion(PLAN, LMV18, new Date('2026-11-01T15:00:00.000Z'));

    expect(cotizacion).toMatchObject({
      clasesRestantes: 13,
      clasesTotales: 12,
      monto: '120.00',
      esProporcional: false,
    });
  });

  it('un precio con céntimos se cobra al sol entero hacia arriba, una sola vez', () => {
    const cotizacion = cotizarInscripcion(
      { precio: '120.50', clasesPorMes: 12 },
      LMV18,
      new Date('2026-11-01T15:00:00.000Z'),
    );

    expect(cotizacion).toMatchObject({ precioPlan: '120.50', monto: '121.00' });
  });

  it('el último día del mes después de la última clase no queda ninguna (0, sin monto)', () => {
    const cotizacion = cotizarInscripcion(PLAN, LMV18, new Date('2026-12-01T04:59:59.000Z'));

    expect(cotizacion).toMatchObject({ mes: '2026-11', clasesRestantes: 0, clasesTotales: 0, monto: '0.00' });
  });

  it('el mes y la fecha son los de Lima aunque en UTC ya sea otro día', () => {
    const cotizacion = cotizarInscripcion(PLAN, LMV18, new Date('2026-12-01T05:00:00.000Z'));

    expect(cotizacion).toMatchObject({ mes: '2026-12', fechaInicio: '2026-12-01', fechaFin: '2026-12-31' });
  });
});
