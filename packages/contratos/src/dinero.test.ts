import { describe, expect, it } from 'vitest';
import { MONTO_MAXIMO, montoSchema } from './dinero';

describe('montoSchema (spec 004, criterio 10)', () => {
  it('acepta textos con hasta dos decimales, mayores que 0 y hasta el máximo', () => {
    for (const texto of ['120', '120.5', '120.00', '0.01', '0.10', '99999.99', '99999', '1', '10000']) {
      expect(montoSchema.safeParse(texto).success, texto).toBe(true);
    }
    expect(montoSchema.safeParse(MONTO_MAXIMO).success).toBe(true);
  });

  it('devuelve el mismo texto, sin convertirlo', () => {
    expect(montoSchema.parse('120.5')).toBe('120.5');
  });

  it('rechaza lo que no es un texto de monto, sin pasar por coma flotante', () => {
    for (const malo of [
      120,
      '0',
      '00',
      '0.0',
      '0.00',
      '00.50',
      '012',
      '-1',
      '120.505',
      '1e2',
      '120,50',
      ' 120',
      '120 ',
      '120\n',
      '100000',
      '99999.995',
      '.5',
      '5.',
      '',
      null,
      undefined,
      '١٢٠',
    ]) {
      expect(montoSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });
});
