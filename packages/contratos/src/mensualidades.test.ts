import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CABECERA_DATOS_RENOVACION,
  cotizarRenovacionSchema,
  DATOS_RENOVACION_LARGO_MAXIMO,
  datosRenovacionComprobanteSchema,
  pagoPendienteSchema,
  renovarEnEfectivoSchema,
  respuestaRenovacionSchema,
} from './index';

// Los esquemas de la renovación (spec 010a, criterios 5 a 7 y 11) y la bandeja con renovaciones (criterio 14, DT-10).

const clase = randomUUID();
const base = { mes: '2026-12', planId: randomUUID(), claseIds: [clase] };

describe('los cuerpos de la renovación (spec 010a)', () => {
  it('la cabecera y su largo máximo son los del contrato', () => {
    expect(CABECERA_DATOS_RENOVACION).toBe('X-Renovacion-Datos');
    expect(DATOS_RENOVACION_LARGO_MAXIMO).toBe(2048);
  });

  it('la cotización pide mes, plan y clases, y es estricta', () => {
    expect(cotizarRenovacionSchema.safeParse(base).success).toBe(true);
    expect(cotizarRenovacionSchema.safeParse({ ...base, academiaId: randomUUID() }).success).toBe(false);
    expect(cotizarRenovacionSchema.safeParse({ ...base, mes: '12-2026' }).success).toBe(false);
    expect(cotizarRenovacionSchema.safeParse({ ...base, claseIds: [] }).success).toBe(false);
    expect(cotizarRenovacionSchema.safeParse({ ...base, claseIds: [clase, clase] }).success).toBe(false);
  });

  it('el efectivo suma la clave y el total mostrado, sin campos de más', () => {
    const valido = { ...base, claveIdempotencia: randomUUID(), montoMostrado: '120.00' };
    expect(renovarEnEfectivoSchema.safeParse(valido).success).toBe(true);
    expect(renovarEnEfectivoSchema.safeParse({ ...valido, montoMostrado: 120 }).success).toBe(false);
    expect(renovarEnEfectivoSchema.safeParse({ ...valido, montoAjustado: '10' }).success).toBe(false);
    expect(renovarEnEfectivoSchema.safeParse({ ...valido, alumnoId: randomUUID() }).success).toBe(false);
  });

  it('el comprobante lleva el método con comprobante, el número, el monto y la fecha', () => {
    const valido = {
      ...base,
      claveIdempotencia: randomUUID(),
      metodo: 'YAPE',
      numeroOperacion: '  ab-0012 ',
      monto: '120.00',
      fechaOperacion: '2026-11-26',
    };
    const resultado = datosRenovacionComprobanteSchema.safeParse(valido);
    expect(resultado.success).toBe(true);
    expect(resultado.data?.numeroOperacion).toBe('ab-0012');
    expect(datosRenovacionComprobanteSchema.safeParse({ ...valido, metodo: 'EFECTIVO' }).success).toBe(false);
    expect(datosRenovacionComprobanteSchema.safeParse({ ...valido, monto: 120 }).success).toBe(false);
    expect(datosRenovacionComprobanteSchema.safeParse({ ...valido, fechaOperacion: '2026-02-30' }).success).toBe(false);
    expect(datosRenovacionComprobanteSchema.safeParse({ ...valido, nota: 'x' }).success).toBe(false);
  });
});

describe('las respuestas (spec 010a)', () => {
  const pago = {
    id: randomUUID(),
    estado: 'CONFIRMADO',
    metodo: 'EFECTIVO',
    concepto: 'MENSUALIDAD',
    monto: '120.00',
    registradoEn: '2026-11-27T15:00:00.000Z',
    verificadoEn: '2026-11-27T15:00:00.000Z',
    numeroOperacion: null,
    fechaOperacion: null,
    motivoRechazo: null,
    numeroTicket: 7,
  };
  const renovacion = {
    matriculaId: randomUUID(),
    mes: '2026-12',
    estado: 'VIGENTE',
    plan: { id: randomUUID(), nombre: 'Plan' },
    clases: [{ id: clase, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
    fechaInicio: '2026-12-01',
    fechaFin: '2026-12-31',
    clasesTotales: 12,
    total: '120.00',
    conPrioridad: [clase],
  };

  it('la respuesta de la renovación es estricta', () => {
    const valida = { renovacion, pago, repetida: false };
    expect(respuestaRenovacionSchema.safeParse(valida).success).toBe(true);
    expect(respuestaRenovacionSchema.safeParse({ ...valida, extra: 1 }).success).toBe(false);
    expect(
      respuestaRenovacionSchema.safeParse({ ...valida, renovacion: { ...renovacion, dni: '12345678' } }).success,
    ).toBe(false);
    expect(
      respuestaRenovacionSchema.safeParse({ ...valida, renovacion: { ...renovacion, estado: 'RESERVADA' } }).success,
    ).toBe(false);
  });

  it('un pago de la bandeja puede no tener solicitud (una renovación), pero la clave siempre está', () => {
    const elemento = {
      id: randomUUID(),
      metodo: 'YAPE',
      monto: '120.00',
      numeroOperacion: '12345',
      fechaOperacion: '2026-11-26',
      enviadoEn: '2026-11-27T15:00:00.000Z',
      solicitud: null,
      cliente: { nombres: 'Ana', apellidos: 'Pérez', dni: '12345678' },
      mes: '2026-12',
      mesTerminado: false,
    };
    expect(pagoPendienteSchema.safeParse(elemento).success).toBe(true);
    expect(pagoPendienteSchema.safeParse({ ...elemento, solicitud: undefined }).success).toBe(false);
    expect(pagoPendienteSchema.safeParse({ ...elemento, solicitud: { id: randomUUID() } }).success).toBe(false);
  });
});
