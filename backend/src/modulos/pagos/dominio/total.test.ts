import { describe, expect, it } from 'vitest';
import { Decimal } from '../../../infraestructura/prisma';
import { totalACobrar } from './total';

// Spec 007, criterio 10 (prueba no protegida): el total sale de lo guardado en la matrícula, nunca del plan. Sin ajuste es `monto_calculado`
// redondeado hacia arriba al sol entero; con ajuste, el ajuste reemplaza al monto calculado y también se redondea hacia arriba, una sola vez.

describe('totalACobrar: el monto guardado en la matrícula manda', () => {
  it('sin ajuste, el total es el monto calculado guardado redondeado hacia arriba (no el que daría el plan)', () => {
    expect(totalACobrar({ montoAjustado: null, montoCalculado: new Decimal('45.50') }).toString()).toBe('46');
    expect(totalACobrar({ montoAjustado: null, montoCalculado: new Decimal('45.01') }).toString()).toBe('46');
  });

  it('sin ajuste, un monto calculado entero no se redondea de más', () => {
    expect(totalACobrar({ montoAjustado: null, montoCalculado: new Decimal('45.00') }).toString()).toBe('45');
  });

  it('con ajuste, el ajuste reemplaza al monto calculado, sea mayor o menor', () => {
    expect(totalACobrar({ montoAjustado: new Decimal('60'), montoCalculado: new Decimal('45.50') }).toString()).toBe(
      '60',
    );
    expect(totalACobrar({ montoAjustado: new Decimal('20'), montoCalculado: new Decimal('145.50') }).toString()).toBe(
      '20',
    );
  });

  it('con ajuste, el redondeo hacia arriba se hace una sola vez, sobre el ajuste', () => {
    expect(totalACobrar({ montoAjustado: new Decimal('59.01'), montoCalculado: new Decimal('45.50') }).toString()).toBe(
      '60',
    );
  });

  it('un ajuste de cero cobra cero (no cae al monto calculado)', () => {
    expect(totalACobrar({ montoAjustado: new Decimal('0'), montoCalculado: new Decimal('45.50') }).toString()).toBe(
      '0',
    );
  });
});
