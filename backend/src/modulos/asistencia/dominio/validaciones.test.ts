import { describe, expect, it } from 'vitest';
import { decidirMarcado, type EntradaDeLaDecision } from './validaciones';

// Criterios 7 y 20 de la 009a: la primera validación que falla decide, en el orden de la tabla del criterio 7.

const LUNES_18_05 = new Date('2026-11-16T23:05:00.000Z');

/** Un alumno que cumple todo: matrícula del día con clases, la clase de las 18:00 a 19:00 y la llegada a las 18:05. */
function entrada(sobre: Partial<EntradaDeLaDecision> = {}): EntradaDeLaDecision {
  return {
    ahora: LUNES_18_05,
    hoy: '2026-11-16',
    toleranciaMinutos: 10,
    alumnoInactivo: false,
    yaMarcoHoy: false,
    matricula: { clasesTotales: 12, clasesUsadas: 0, creadaEn: new Date('2026-11-11T15:00:00.000Z') },
    pagoEnVerificacion: false,
    claseDeHoy: { horaInicio: '18:00', horaFin: '19:00' },
    ...sobre,
  };
}

const codigo = (sobre: Partial<EntradaDeLaDecision>) => {
  const decision = decidirMarcado(entrada(sobre));
  return decision.tipo === 'RECHAZO' ? decision.codigo : decision.estadoLlegada;
};

describe('decidirMarcado', () => {
  it('quien cumple todo se registra, puntual a las 18:05 y tarde a las 18:11 con 10 minutos', () => {
    expect(decidirMarcado(entrada())).toEqual({ tipo: 'REGISTRAR', estadoLlegada: 'PUNTUAL' });
    expect(codigo({ ahora: new Date('2026-11-16T23:11:00.000Z') })).toBe('TARDE');
  });

  it('cada condición sola da su código', () => {
    expect(codigo({ alumnoInactivo: true })).toBe('ALUMNO_INACTIVO');
    expect(codigo({ yaMarcoHoy: true })).toBe('ASISTENCIA_YA_REGISTRADA');
    expect(codigo({ matricula: null, pagoEnVerificacion: true })).toBe('PAGO_EN_VERIFICACION');
    expect(codigo({ matricula: null })).toBe('MENSUALIDAD_NO_VIGENTE');
    expect(
      codigo({ matricula: { clasesTotales: 12, clasesUsadas: 12, creadaEn: new Date('2026-11-11T15:00:00.000Z') } }),
    ).toBe('SIN_CLASES_RESTANTES');
    expect(codigo({ claseDeHoy: null })).toBe('FUERA_DE_HORARIO');
    expect(codigo({ ahora: new Date('2026-11-16T22:59:59.999Z') })).toBe('FUERA_DE_HORARIO');
    expect(codigo({ ahora: new Date('2026-11-17T00:00:00.000Z') })).toBe('FUERA_DE_HORARIO');
    expect(
      codigo({ matricula: { clasesTotales: 12, clasesUsadas: 0, creadaEn: new Date('2026-11-16T23:10:00.000Z') } }),
    ).toBe('CLASE_NO_INCLUIDA');
  });

  it('el orden: inactivo gana a todo, después ya marcó, pago en verificación, sin matrícula, sin clases, horario y ocurrencia', () => {
    const todo = entrada({
      alumnoInactivo: true,
      yaMarcoHoy: true,
      matricula: null,
      pagoEnVerificacion: true,
      claseDeHoy: null,
    });
    expect(decidirMarcado(todo)).toEqual({ tipo: 'RECHAZO', codigo: 'ALUMNO_INACTIVO' });
    expect(decidirMarcado({ ...todo, alumnoInactivo: false })).toEqual({
      tipo: 'RECHAZO',
      codigo: 'ASISTENCIA_YA_REGISTRADA',
    });
    expect(decidirMarcado({ ...todo, alumnoInactivo: false, yaMarcoHoy: false })).toEqual({
      tipo: 'RECHAZO',
      codigo: 'PAGO_EN_VERIFICACION',
    });
    expect(decidirMarcado({ ...todo, alumnoInactivo: false, yaMarcoHoy: false, pagoEnVerificacion: false })).toEqual({
      tipo: 'RECHAZO',
      codigo: 'MENSUALIDAD_NO_VIGENTE',
    });
    const agotada = { clasesTotales: 12, clasesUsadas: 12, creadaEn: new Date('2026-11-16T23:10:00.000Z') };
    expect(decidirMarcado(entrada({ matricula: agotada, claseDeHoy: null }))).toEqual({
      tipo: 'RECHAZO',
      codigo: 'SIN_CLASES_RESTANTES',
    });
    const nueva = { clasesTotales: 12, clasesUsadas: 0, creadaEn: new Date('2026-11-16T23:10:00.000Z') };
    expect(decidirMarcado(entrada({ matricula: nueva, ahora: new Date('2026-11-17T00:30:00.000Z') }))).toEqual({
      tipo: 'RECHAZO',
      codigo: 'FUERA_DE_HORARIO',
    });
  });

  it('una ocurrencia que empieza exactamente cuando se creó la matrícula no está incluida; un milisegundo después sí', () => {
    const inicio = new Date('2026-11-16T23:00:00.000Z');
    expect(codigo({ matricula: { clasesTotales: 12, clasesUsadas: 0, creadaEn: inicio } })).toBe('CLASE_NO_INCLUIDA');
    expect(
      codigo({ matricula: { clasesTotales: 12, clasesUsadas: 0, creadaEn: new Date(inicio.getTime() - 1) } }),
    ).toBe('PUNTUAL');
  });

  it('la última clase (11 usadas de 12) todavía se registra', () => {
    expect(
      codigo({ matricula: { clasesTotales: 12, clasesUsadas: 11, creadaEn: new Date('2026-11-11T15:00:00.000Z') } }),
    ).toBe('PUNTUAL');
  });
});
