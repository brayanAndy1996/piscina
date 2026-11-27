import { afterEach, describe, expect, it } from 'vitest';
import { estadoDeMensualidad, type EntradaDeEstado } from './estado';

// Criterio 24 de la 010b: el estado de la mensualidad (AL_DIA, POR_VENCER, VENCIDO, PENDIENTE_VERIFICACION) con los ejemplos de la spec (N = 5 en noviembre
// de 2026), los bordes del mes, febrero de 28 y 29 días, un mes pasado y el cambio de año, también con `TZ=Asia/Tokyo`. La función es pura: no depende de la zona.

const TZ_ORIGINAL = process.env['TZ'];
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = TZ_ORIGINAL;
});

const base: EntradaDeEstado = {
  hoy: '2026-11-25',
  mes: '2026-11',
  diasPorVencer: 5,
  pagadaDelMes: false,
  enVerificacionDelMes: false,
  pagadaDelMesAnterior: false,
  siguiente: null,
};
const con = (cambios: Partial<EntradaDeEstado>): EntradaDeEstado => ({ ...base, ...cambios });

describe.each(['UTC', 'Asia/Tokyo'])('con el proceso en TZ=%s', (zona) => {
  const fijar = () => {
    process.env['TZ'] = zona;
  };

  describe('con la mensualidad del mes pagada', () => {
    it('el 25/11 (antes de los últimos 5 días) está AL_DIA', () => {
      fijar();
      expect(estadoDeMensualidad(con({ pagadaDelMes: true }))).toBe('AL_DIA');
    });

    it('el 26/11 (primer día por vencer) está POR_VENCER; también el 30/11', () => {
      fijar();
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-11-26' }))).toBe('POR_VENCER');
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-11-30' }))).toBe('POR_VENCER');
    });

    it('por vencer con diciembre pagado está AL_DIA', () => {
      fijar();
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-11-27', siguiente: 'PAGADA' }))).toBe('AL_DIA');
    });

    it('por vencer con diciembre en verificación está PENDIENTE_VERIFICACION', () => {
      fijar();
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-11-27', siguiente: 'EN_VERIFICACION' }))).toBe(
        'PENDIENTE_VERIFICACION',
      );
    });

    it('antes de los días por vencer, la mensualidad del mes siguiente no cambia el estado', () => {
      fijar();
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, siguiente: 'EN_VERIFICACION' }))).toBe('AL_DIA');
    });

    it('un mes anterior al mes en curso, aunque sea de los últimos días, está AL_DIA (no hay «por vencer» del pasado)', () => {
      fijar();
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-12-02', mes: '2026-11' }))).toBe('AL_DIA');
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-11-30', mes: '2026-10' }))).toBe('AL_DIA');
    });

    it('diasPorVencer se respeta: con 1 solo el último día; con 10 desde el 21/11', () => {
      fijar();
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-11-29', diasPorVencer: 1 }))).toBe('AL_DIA');
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-11-30', diasPorVencer: 1 }))).toBe('POR_VENCER');
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-11-20', diasPorVencer: 10 }))).toBe('AL_DIA');
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-11-21', diasPorVencer: 10 }))).toBe('POR_VENCER');
    });

    it('febrero: con N = 5, desde el 24/02 en 2027 (28 días) y desde el 25/02 en 2028 (29 días)', () => {
      fijar();
      const febrero = (hoy: string) => con({ pagadaDelMes: true, hoy, mes: hoy.slice(0, 7) });
      expect(estadoDeMensualidad(febrero('2027-02-23'))).toBe('AL_DIA');
      expect(estadoDeMensualidad(febrero('2027-02-24'))).toBe('POR_VENCER');
      expect(estadoDeMensualidad(febrero('2028-02-24'))).toBe('AL_DIA');
      expect(estadoDeMensualidad(febrero('2028-02-25'))).toBe('POR_VENCER');
    });

    it('el cambio de año: diciembre por vencer con enero pagado está AL_DIA', () => {
      fijar();
      expect(
        estadoDeMensualidad(con({ pagadaDelMes: true, hoy: '2026-12-28', mes: '2026-12', siguiente: 'PAGADA' })),
      ).toBe('AL_DIA');
    });

    it('la mensualidad pagada gana a la que está en verificación del mismo mes', () => {
      fijar();
      expect(estadoDeMensualidad(con({ pagadaDelMes: true, enVerificacionDelMes: true }))).toBe('AL_DIA');
    });
  });

  describe('sin la mensualidad del mes pagada', () => {
    it('con la del mes en verificación está PENDIENTE_VERIFICACION, haya o no la del mes anterior', () => {
      fijar();
      const diciembre = { hoy: '2026-12-01', mes: '2026-12', enVerificacionDelMes: true };
      expect(estadoDeMensualidad(con(diciembre))).toBe('PENDIENTE_VERIFICACION');
      expect(estadoDeMensualidad(con({ ...diciembre, pagadaDelMesAnterior: true }))).toBe('PENDIENTE_VERIFICACION');
    });

    it('el 1/12 sin diciembre y con noviembre pagado está VENCIDO', () => {
      fijar();
      expect(estadoDeMensualidad(con({ hoy: '2026-12-01', mes: '2026-12', pagadaDelMesAnterior: true }))).toBe(
        'VENCIDO',
      );
    });

    it('el vencimiento cruza el año: enero sin enero y con diciembre pagado está VENCIDO', () => {
      fijar();
      expect(estadoDeMensualidad(con({ hoy: '2027-01-01', mes: '2027-01', pagadaDelMesAnterior: true }))).toBe(
        'VENCIDO',
      );
    });

    it('sin ninguna de las dos y sin la del mes anterior no tiene estado (el listado no lo muestra)', () => {
      fijar();
      expect(estadoDeMensualidad(con({}))).toBeNull();
      expect(estadoDeMensualidad(con({ siguiente: 'PAGADA' }))).toBeNull();
    });
  });

  it('un mes posterior al mes en curso no se evalúa', () => {
    fijar();
    expect(() => estadoDeMensualidad(con({ mes: '2026-12' }))).toThrow(RangeError);
  });
});
