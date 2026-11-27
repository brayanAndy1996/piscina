import { describe, expect, it } from 'vitest';
import { diferenciaDeClases, type MatriculaParaCambiar, sePuedeCambiarElHorario } from './horario';

const NOVIEMBRE = { anio: 2026, mes: 11 };
const matricula = (cambios: Partial<MatriculaParaCambiar> = {}): MatriculaParaCambiar => ({
  anio: 2026,
  mes: 11,
  estado: 'VIGENTE',
  reservaVenceEn: null,
  ...cambios,
});

describe('sePuedeCambiarElHorario (criterio 35)', () => {
  it.each([
    ['la VIGENTE del mes en curso', matricula(), true],
    ['la VIGENTE del mes siguiente', matricula({ mes: 12 }), true],
    ['la RESERVADA sin vencimiento (en verificación)', matricula({ estado: 'RESERVADA' }), true],
    [
      'una reserva de 24 horas',
      matricula({ estado: 'RESERVADA', reservaVenceEn: new Date('2026-11-27T10:00:00Z') }),
      false,
    ],
    ['la FINALIZADA', matricula({ estado: 'FINALIZADA' }), false],
    ['la CANCELADA', matricula({ estado: 'CANCELADA' }), false],
    ['la de octubre', matricula({ mes: 10 }), false],
    ['la de enero, dos meses adelante', matricula({ anio: 2027, mes: 1 }), false],
    ['la de noviembre del año siguiente', matricula({ anio: 2027 }), false],
  ])('%s', (_nombre, entrada, esperado) => {
    expect(sePuedeCambiarElHorario(entrada, NOVIEMBRE)).toBe(esperado);
  });

  it('en diciembre, el mes siguiente es enero del año siguiente', () => {
    const diciembre = { anio: 2026, mes: 12 };
    expect(sePuedeCambiarElHorario(matricula({ anio: 2027, mes: 1 }), diciembre)).toBe(true);
    expect(sePuedeCambiarElHorario(matricula({ anio: 2026, mes: 1 }), diciembre)).toBe(false);
  });
});

describe('diferenciaDeClases (criterio 37)', () => {
  it('separa las que salen, las que entran y las que se quedan, ordenadas', () => {
    expect(diferenciaDeClases(['c', 'a', 'b'], ['d', 'b', 'a'])).toEqual({
      salen: ['c'],
      entran: ['d'],
      seQuedan: ['a', 'b'],
    });
  });

  it('las mismas clases en otro orden y con otras mayúsculas no tienen diferencias', () => {
    expect(diferenciaDeClases(['a', 'b'], ['B', 'A'])).toEqual({ salen: [], entran: [], seQuedan: ['a', 'b'] });
  });
});
