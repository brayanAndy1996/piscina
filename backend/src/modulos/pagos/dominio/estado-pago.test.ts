import { describe, expect, it } from 'vitest';
import { decidirAprobacion, decidirRechazo } from './estado-pago';

describe('decidirAprobacion (spec 007b, criterios 47 y 48)', () => {
  it('un pago pendiente se confirma', () => {
    expect(decidirAprobacion('PENDIENTE_VERIFICACION')).toBe('CONFIRMAR');
  });
  it('un pago ya confirmado responde igual (idempotente)', () => {
    expect(decidirAprobacion('CONFIRMADO')).toBe('YA_CONFIRMADO');
  });
  it('un pago rechazado no se aprueba', () => {
    expect(decidirAprobacion('RECHAZADO')).toBe('RECHAZADO_ANTES');
  });
});

describe('decidirRechazo (spec 007b, criterio 49)', () => {
  it('un pago pendiente se rechaza', () => {
    expect(decidirRechazo('PENDIENTE_VERIFICACION')).toBe('RECHAZAR');
  });
  it('un pago ya rechazado responde igual (idempotente)', () => {
    expect(decidirRechazo('RECHAZADO')).toBe('YA_RECHAZADO');
  });
  it('un pago confirmado no se rechaza', () => {
    expect(decidirRechazo('CONFIRMADO')).toBe('CONFIRMADO_ANTES');
  });
});
