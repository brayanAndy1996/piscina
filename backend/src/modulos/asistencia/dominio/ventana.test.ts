import { afterEach, describe, expect, it } from 'vitest';
import { dentroDeLaVentana, diaIsoEnLima, ventanaDeLaClase } from './ventana';

// Criterios 9 y 20 de la 009a: la ventana de la clase es `[inicio, fin)` en America/Lima, con el proceso en cualquier zona.

const TZ_ORIGINAL = process.env['TZ'];
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = TZ_ORIGINAL;
});

const ZONAS = ['UTC', 'Asia/Tokyo', 'America/Lima', 'Pacific/Kiritimati'];

describe.each(ZONAS)('ventana de la clase, con el proceso en TZ=%s', (zona) => {
  const poner = () => {
    process.env['TZ'] = zona;
  };

  it('18:00 a 19:00 del lunes 16/11/2026 en Lima son 23:00 y 00:00 UTC', () => {
    poner();
    const { inicio, fin } = ventanaDeLaClase('2026-11-16', '18:00', '19:00');
    expect(inicio.toISOString()).toBe('2026-11-16T23:00:00.000Z');
    expect(fin.toISOString()).toBe('2026-11-17T00:00:00.000Z');
  });

  it('la clase de 19:00 a 20:00 del último día del mes termina ya en diciembre en UTC, pero es del 30/11', () => {
    poner();
    const { inicio, fin } = ventanaDeLaClase('2026-11-30', '19:00', '20:00');
    expect(inicio.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(fin.toISOString()).toBe('2026-12-01T01:00:00.000Z');
  });

  it('incluye el inicio y excluye el fin: 17:59:59.999 fuera, 18:00:00.000 y 18:59:59.999 dentro, 19:00:00.000 fuera', () => {
    poner();
    const ventana = ventanaDeLaClase('2026-11-16', '18:00', '19:00');
    const enLima = (hora: string) => new Date(`2026-11-16T${hora}-05:00`);
    expect(dentroDeLaVentana(enLima('17:59:59.999'), ventana)).toBe(false);
    expect(dentroDeLaVentana(enLima('18:00:00.000'), ventana)).toBe(true);
    expect(dentroDeLaVentana(enLima('18:59:59.999'), ventana)).toBe(true);
    expect(dentroDeLaVentana(enLima('19:00:00.000'), ventana)).toBe(false);
  });

  it('la clase de 19:00 a 20:00: 19:00:00.000 registra y 20:00:00.000 no', () => {
    poner();
    const ventana = ventanaDeLaClase('2026-11-30', '19:00', '20:00');
    expect(dentroDeLaVentana(new Date('2026-12-01T00:00:00.000Z'), ventana)).toBe(true);
    expect(dentroDeLaVentana(new Date('2026-12-01T00:59:59.999Z'), ventana)).toBe(true);
    expect(dentroDeLaVentana(new Date('2026-12-01T01:00:00.000Z'), ventana)).toBe(false);
  });

  it('acepta las horas con segundos (HH:MM:SS)', () => {
    poner();
    expect(ventanaDeLaClase('2026-11-16', '18:00:00', '19:00:00').inicio.toISOString()).toBe(
      '2026-11-16T23:00:00.000Z',
    );
  });

  it('diaIsoEnLima: 1 lunes … 7 domingo, sin que la zona del proceso lo cambie', () => {
    poner();
    const esperado: [string, number][] = [
      ['2026-11-16', 1],
      ['2026-11-17', 2],
      ['2026-11-18', 3],
      ['2026-11-19', 4],
      ['2026-11-20', 5],
      ['2026-11-21', 6],
      ['2026-11-22', 7],
      ['2026-11-30', 1],
      ['2026-12-01', 2],
      ['2028-02-29', 2],
    ];
    for (const [fecha, dia] of esperado) expect(diaIsoEnLima(fecha), fecha).toBe(dia);
  });
});

describe('fechas y horas que no tienen el formato', () => {
  it('lanzan RangeError', () => {
    expect(() => diaIsoEnLima('16/11/2026')).toThrow(RangeError);
    expect(() => ventanaDeLaClase('2026-11-16', '25:00', '19:00')).toThrow(RangeError);
    expect(() => ventanaDeLaClase('2026-11-16', '18:00', '19')).toThrow(RangeError);
  });
});
