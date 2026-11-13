import { describe, expect, it } from 'vitest';
import { formatearFecha, formatearFechaHora } from './fechas';

describe('fechas en America/Lima', () => {
  it('formatea la fecha con dd/MM/yyyy', () => {
    expect(formatearFecha('2026-11-12T03:00:00.000Z')).toBe('11/11/2026');
  });

  it('formatea fecha y hora con dd/MM/yyyy HH:mm de 24 horas', () => {
    expect(formatearFechaHora('2026-11-12T03:05:00.000Z')).toBe('11/11/2026 22:05');
    // Medianoche en Lima (05:00 UTC): "00:00" y no "24:00".
    expect(formatearFechaHora('2026-11-12T05:00:00.000Z')).toBe('12/11/2026 00:00');
  });
});
