import { describe, expect, it } from 'vitest';
import { formatearSoles, normalizarMonto, sonMismoMonto } from './dinero';

describe('montos como texto', () => {
  it.each([
    ['120', '120.00'],
    ['120.5', '120.50'],
    ['120.00', '120.00'],
    ['0.01', '0.01'],
    ['99999.99', '99999.99'],
    ['007', '7.00'],
  ])('normaliza %s como %s', (texto, esperado) => {
    expect(normalizarMonto(texto)).toBe(esperado);
  });

  it.each(['', ' 120', '120,50', '1e2', '-1', '120.505', '.5', '12a'])('%j no es un monto', (texto) => {
    expect(normalizarMonto(texto)).toBeNull();
  });

  it('compara montos sin pasar por número', () => {
    expect(sonMismoMonto('120', '120.00')).toBe(true);
    expect(sonMismoMonto('120.5', '120.50')).toBe(true);
    expect(sonMismoMonto('120.01', '120.10')).toBe(false);
    expect(sonMismoMonto('0.1', '0.10')).toBe(true);
    expect(sonMismoMonto('abc', 'abc')).toBe(true);
    expect(sonMismoMonto('abc', '120')).toBe(false);
  });

  it('da formato S/ con dos decimales y coma de millares, sin perder precisión', () => {
    expect(formatearSoles('120.00')).toBe('S/ 120.00');
    expect(formatearSoles('88')).toBe('S/ 88.00');
    expect(formatearSoles('0.01')).toBe('S/ 0.01');
    expect(formatearSoles('1200.5')).toBe('S/ 1,200.50');
    expect(formatearSoles('99999.99')).toBe('S/ 99,999.99');
    // Un valor que una coma flotante no representa bien sigue exacto.
    expect(formatearSoles('90071992547409.93')).toBe('S/ 90,071,992,547,409.93');
  });
});
