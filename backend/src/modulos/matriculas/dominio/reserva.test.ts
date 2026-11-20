import { describe, expect, it } from 'vitest';
import { finDelMesEnLima, RESERVA_SIN_PAGO_MS, vencimientoDeReserva } from './reserva';

// Pruebas de apoyo (no protegidas) de `reserva.ts` (spec 005, criterio 54): bordes extra de Lima.
describe('reserva (apoyo)', () => {
  it('la reserva dura 24 horas', () => {
    expect(RESERVA_SIN_PAGO_MS).toBe(86_400_000);
  });

  it.each([
    // Hora de Lima en el borde del día: 23:59 del 31 de enero en Lima ya es 1 de febrero en UTC.
    ['2027-02-01T04:59:00.000Z', '2027-02-01T04:59:59.999Z'],
    ['2027-02-01T05:00:00.000Z', '2027-03-01T04:59:59.999Z'],
    // Meses de 30 y de 31 días.
    ['2026-04-15T12:00:00.000Z', '2026-05-01T04:59:59.999Z'],
    ['2026-07-31T12:00:00.000Z', '2026-08-01T04:59:59.999Z'],
  ])('el fin del mes de %s es %s', (ahora, esperado) => {
    expect(finDelMesEnLima(new Date(ahora)).toISOString()).toBe(esperado);
  });

  it('vence a las 24 horas cuando falta más de un día para fin de mes', () => {
    expect(vencimientoDeReserva(new Date('2026-11-10T15:00:00.000Z')).toISOString()).toBe('2026-11-11T15:00:00.000Z');
  });
});
