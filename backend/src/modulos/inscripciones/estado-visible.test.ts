import { describe, expect, it } from 'vitest';
import { type DatosDelEstado, estadoVisible } from './estado-visible';

const AHORA = new Date('2026-11-11T15:00:00.000Z');
const datos = (cambios: Partial<DatosDelEstado> = {}): DatosDelEstado => ({
  estado_solicitud: 'PENDIENTE_PAGO',
  estado_matricula: 'RESERVADA',
  reserva_vence_en: new Date(AHORA.getTime() + 60_000),
  ...cambios,
});

describe('estadoVisible (PB2)', () => {
  it('la fila VENCIDA o CANCELADA es lo que dice, sea cual sea la matrícula', () => {
    expect(estadoVisible(datos({ estado_solicitud: 'VENCIDA' }), AHORA)).toBe('VENCIDA');
    expect(estadoVisible(datos({ estado_solicitud: 'CANCELADA', reserva_vence_en: null }), AHORA)).toBe('CANCELADA');
    expect(estadoVisible(datos({ estado_solicitud: 'VENCIDA', estado_matricula: 'CANCELADA' }), AHORA)).toBe('VENCIDA');
  });

  it('una fila PENDIENTE_PAGO con la matrícula CANCELADA se ve CANCELADA', () => {
    expect(estadoVisible(datos({ estado_matricula: 'CANCELADA', reserva_vence_en: null }), AHORA)).toBe('CANCELADA');
  });

  it('con la reserva vencida se ve VENCIDA, también en el instante exacto del vencimiento; un milisegundo antes, PENDIENTE_PAGO', () => {
    expect(estadoVisible(datos({ reserva_vence_en: new Date(AHORA.getTime()) }), AHORA)).toBe('VENCIDA');
    expect(estadoVisible(datos({ reserva_vence_en: new Date(AHORA.getTime() - 1) }), AHORA)).toBe('VENCIDA');
    expect(estadoVisible(datos({ reserva_vence_en: new Date(AHORA.getTime() + 1) }), AHORA)).toBe('PENDIENTE_PAGO');
  });

  it('sin vencimiento (pago en verificación) o con la matrícula vigente sigue PENDIENTE_PAGO', () => {
    expect(estadoVisible(datos({ reserva_vence_en: null }), AHORA)).toBe('PENDIENTE_PAGO');
    expect(estadoVisible(datos({ estado_matricula: 'VIGENTE', reserva_vence_en: null }), AHORA)).toBe('PENDIENTE_PAGO');
  });
});
