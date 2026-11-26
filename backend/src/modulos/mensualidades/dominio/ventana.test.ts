import { afterEach, describe, expect, it } from 'vitest';
import {
  estaPorVencer,
  inicioDelMesEnLima,
  mesesPermitidos,
  mesSiguiente,
  textoDelMes,
  ultimoDiaDelMes,
  ventanaDeRenovacion,
} from './ventana';

// Criterios 3 y 21 de la 010a: la ventana de renovación, los meses permitidos y «por vencer», con los bordes de Lima, febrero de 28 y 29 días y el
// cambio de año, también con `TZ=Asia/Tokyo`.

const TZ_ORIGINAL = process.env['TZ'];
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = TZ_ORIGINAL;
});

/** Un instante de Lima (UTC−5, sin horario de verano) a partir de su fecha y hora local. */
const lima = (fecha: string, hora: string): Date => new Date(`${fecha}T${hora}-05:00`);

describe.each(['UTC', 'Asia/Tokyo'])('con el proceso en TZ=%s', (zona) => {
  const fijar = () => {
    process.env['TZ'] = zona;
  };

  describe('ventanaDeRenovacion', () => {
    it('con N = 5, noviembre de 2026 va del 26/11 al 30/11', () => {
      fijar();
      expect(ventanaDeRenovacion(lima('2026-11-10', '10:00'), 5)).toEqual({
        mes: { anio: 2026, mes: 11 },
        desde: '2026-11-26',
        hasta: '2026-11-30',
        abierta: false,
      });
    });

    it('abre a las 00:00:00.000 del día 26 y sigue abierta hasta las 23:59:59.999 del 30; el 25 a las 23:59:59.999 todavía no', () => {
      fijar();
      expect(ventanaDeRenovacion(lima('2026-11-25', '23:59:59.999'), 5).abierta).toBe(false);
      expect(ventanaDeRenovacion(lima('2026-11-26', '00:00:00.000'), 5).abierta).toBe(true);
      expect(ventanaDeRenovacion(lima('2026-11-30', '23:59:59.999'), 5).abierta).toBe(true);
    });

    it('el 1/12 a las 00:00:00.000 de Lima ya es otro mes: la ventana es la de diciembre y está cerrada', () => {
      fijar();
      const ventana = ventanaDeRenovacion(lima('2026-12-01', '00:00:00.000'), 5);
      expect(ventana).toMatchObject({
        mes: { anio: 2026, mes: 12 },
        desde: '2026-12-27',
        hasta: '2026-12-31',
        abierta: false,
      });
    });

    it('febrero de 2027 (28 días) con N = 15 va del 14/02 al 28/02, y febrero de 2028 (29 días), del 15/02 al 29/02', () => {
      fijar();
      expect(ventanaDeRenovacion(lima('2027-02-20', '10:00'), 15)).toMatchObject({
        desde: '2027-02-14',
        hasta: '2027-02-28',
        abierta: true,
      });
      expect(ventanaDeRenovacion(lima('2028-02-14', '10:00'), 15)).toMatchObject({
        desde: '2028-02-15',
        hasta: '2028-02-29',
        abierta: false,
      });
      expect(ventanaDeRenovacion(lima('2028-02-15', '00:00:00.000'), 15).abierta).toBe(true);
    });

    it('N = 1 es solo el último día; N mayor que el mes no pasa del día 1', () => {
      fijar();
      expect(ventanaDeRenovacion(lima('2026-11-29', '23:59:59.999'), 1).abierta).toBe(false);
      expect(ventanaDeRenovacion(lima('2026-11-30', '00:00:00.000'), 1)).toMatchObject({
        desde: '2026-11-30',
        abierta: true,
      });
      expect(ventanaDeRenovacion(lima('2027-02-01', '00:00:00.000'), 40)).toMatchObject({
        desde: '2027-02-01',
        abierta: true,
      });
    });

    it('rechaza una cantidad de días que no es un entero de 1 o más', () => {
      fijar();
      expect(() => ventanaDeRenovacion(lima('2026-11-10', '10:00'), 0)).toThrow(RangeError);
      expect(() => ventanaDeRenovacion(lima('2026-11-10', '10:00'), 2.5)).toThrow(RangeError);
    });
  });

  describe('mesesPermitidos', () => {
    it('fuera de la ventana solo el mes en curso; dentro, también el siguiente, en orden cronológico', () => {
      fijar();
      expect(mesesPermitidos(lima('2026-11-25', '23:59:59.999'), 5)).toEqual(['2026-11']);
      expect(mesesPermitidos(lima('2026-11-26', '00:00:00.000'), 5)).toEqual(['2026-11', '2026-12']);
      expect(mesesPermitidos(lima('2026-11-30', '23:59:59.999'), 5)).toEqual(['2026-11', '2026-12']);
      expect(mesesPermitidos(lima('2026-12-01', '00:00:00.000'), 5)).toEqual(['2026-12']);
    });

    it('en diciembre el mes siguiente es enero del año siguiente', () => {
      fijar();
      expect(mesesPermitidos(lima('2026-12-28', '10:00'), 5)).toEqual(['2026-12', '2027-01']);
      expect(mesesPermitidos(lima('2027-01-01', '00:00:00.000'), 5)).toEqual(['2027-01']);
    });
  });

  describe('estaPorVencer', () => {
    it('con N = 5, desde el 26/11 (inclusive) hasta el 30/11; el 25/11 todavía no', () => {
      fijar();
      expect(estaPorVencer('2026-11-25', 5)).toBe(false);
      expect(estaPorVencer('2026-11-26', 5)).toBe(true);
      expect(estaPorVencer('2026-11-30', 5)).toBe(true);
      expect(estaPorVencer('2026-12-01', 5)).toBe(false);
    });

    it('febrero de 28 y de 29 días', () => {
      fijar();
      expect(estaPorVencer('2027-02-24', 5)).toBe(true);
      expect(estaPorVencer('2027-02-23', 5)).toBe(false);
      expect(estaPorVencer('2028-02-25', 5)).toBe(true);
      expect(estaPorVencer('2028-02-24', 5)).toBe(false);
    });
  });
});

describe('los meses', () => {
  it('el siguiente de diciembre es enero del año siguiente y el texto lleva dos cifras', () => {
    expect(mesSiguiente({ anio: 2026, mes: 12 })).toEqual({ anio: 2027, mes: 1 });
    expect(mesSiguiente({ anio: 2026, mes: 2 })).toEqual({ anio: 2026, mes: 3 });
    expect(textoDelMes({ anio: 2027, mes: 1 })).toBe('2027-01');
  });

  it('el último día de cada mes, con febrero de 28 y de 29 días', () => {
    expect(ultimoDiaDelMes({ anio: 2027, mes: 2 })).toBe('2027-02-28');
    expect(ultimoDiaDelMes({ anio: 2028, mes: 2 })).toBe('2028-02-29');
    expect(ultimoDiaDelMes({ anio: 2026, mes: 12 })).toBe('2026-12-31');
  });

  it.each(['UTC', 'Asia/Tokyo'])(
    'las 00:00 de Lima del día 1 son las 05:00 en UTC, con el proceso en TZ=%s',
    (zona) => {
      process.env['TZ'] = zona;
      expect(inicioDelMesEnLima({ anio: 2026, mes: 12 }).toISOString()).toBe('2026-12-01T05:00:00.000Z');
      expect(inicioDelMesEnLima({ anio: 2027, mes: 1 }).toISOString()).toBe('2027-01-01T05:00:00.000Z');
    },
  );
});
