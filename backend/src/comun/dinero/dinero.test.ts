import { describe, expect, it } from 'vitest';
import { aDecimal, aTextoMonto, montosIguales } from './index';

describe('dinero: Decimal y texto con dos decimales (spec 004, criterio 10)', () => {
  it('da siempre dos decimales, sin pasar por coma flotante', () => {
    expect(aTextoMonto('120')).toBe('120.00');
    expect(aTextoMonto('120.5')).toBe('120.50');
    expect(aTextoMonto('0.01')).toBe('0.01');
    expect(aTextoMonto('99999.99')).toBe('99999.99');
    // Valores que `Number` no guarda exactos (0.57 * 100 = 56.99999999999999).
    for (const texto of ['0.57', '1.15', '8.20', '19.99', '57.01']) expect(aTextoMonto(texto)).toBe(texto);
  });

  it('acepta un Decimal', () => {
    expect(aTextoMonto(aDecimal('1234.5'))).toBe('1234.50');
  });

  it('"120", "120.0" y "120.00" son el mismo monto', () => {
    expect(montosIguales('120', '120.00')).toBe(true);
    expect(montosIguales('120.0', '120.00')).toBe(true);
    expect(montosIguales('120.01', '120.00')).toBe(false);
  });
});
