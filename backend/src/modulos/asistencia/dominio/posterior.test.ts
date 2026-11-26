import { describe, expect, it } from 'vitest';
import { decidirPosterior, type EntradaDelPosterior } from './validaciones';

// Criterio 28 de la 009b: el registro posterior; la primera validación que falla decide (fecha, inactivo, ya tiene, sin matrícula, sin clases, sin clase,
// clase sin terminar, hora fuera de la clase, ocurrencia no incluida). Con el proceso en cualquier zona: todo se calcula en America/Lima.

/** Las 19:30 del lunes 16/11/2026 en Lima (00:30 UTC del martes). */
const LUNES_19_30 = new Date('2026-11-17T00:30:00.000Z');

function entrada(sobre: Partial<EntradaDelPosterior> = {}): EntradaDelPosterior {
  return {
    ahora: LUNES_19_30,
    hoy: '2026-11-16',
    fecha: '2026-11-16',
    horaLlegada: '18:05',
    toleranciaMinutos: 10,
    alumnoInactivo: false,
    yaTieneAsistencia: false,
    matricula: { clasesTotales: 12, clasesUsadas: 0, creadaEn: new Date('2026-11-11T15:00:00.000Z') },
    clase: { horaInicio: '18:00', horaFin: '19:00' },
    ...sobre,
  };
}

const codigo = (sobre: Partial<EntradaDelPosterior>) => {
  const decision = decidirPosterior(entrada(sobre));
  return decision.tipo === 'RECHAZO' ? decision.codigo : decision.estadoLlegada;
};

describe('decidirPosterior', () => {
  it('quien cumple todo se registra con la hora de llegada de Lima y el estado de la tolerancia', () => {
    expect(decidirPosterior(entrada())).toEqual({
      tipo: 'REGISTRAR',
      estadoLlegada: 'PUNTUAL',
      llegadaEn: new Date('2026-11-16T23:05:00.000Z'),
    });
    expect(codigo({ horaLlegada: '18:10' })).toBe('PUNTUAL');
    expect(codigo({ horaLlegada: '18:11' })).toBe('TARDE');
    expect(codigo({ horaLlegada: '18:59' })).toBe('TARDE');
  });

  it('cada condición sola da su código', () => {
    expect(codigo({ fecha: '2026-11-23' })).toBe('FECHA_NO_PERMITIDA');
    expect(codigo({ fecha: '2026-10-26' })).toBe('FECHA_NO_PERMITIDA');
    expect(codigo({ alumnoInactivo: true })).toBe('ALUMNO_INACTIVO');
    expect(codigo({ yaTieneAsistencia: true })).toBe('ASISTENCIA_YA_REGISTRADA');
    expect(codigo({ matricula: null })).toBe('MENSUALIDAD_NO_VIGENTE');
    expect(
      codigo({ matricula: { clasesTotales: 12, clasesUsadas: 12, creadaEn: new Date('2026-11-11T15:00:00.000Z') } }),
    ).toBe('SIN_CLASES_RESTANTES');
    expect(codigo({ clase: null })).toBe('FUERA_DE_HORARIO');
    expect(codigo({ ahora: new Date('2026-11-16T23:59:59.999Z') })).toBe('CLASE_NO_TERMINADA');
    expect(codigo({ horaLlegada: '17:59' })).toBe('HORA_FUERA_DE_LA_CLASE');
    expect(codigo({ horaLlegada: '19:00' })).toBe('HORA_FUERA_DE_LA_CLASE');
    expect(
      codigo({ matricula: { clasesTotales: 12, clasesUsadas: 0, creadaEn: new Date('2026-11-16T23:30:00.000Z') } }),
    ).toBe('CLASE_NO_INCLUIDA');
  });

  it('la clase termina en su fin exacto: a las 19:00:00.000 ya se puede registrar', () => {
    expect(codigo({ ahora: new Date('2026-11-17T00:00:00.000Z') })).toBe('PUNTUAL');
    expect(codigo({ ahora: new Date('2026-11-16T23:59:59.999Z') })).toBe('CLASE_NO_TERMINADA');
  });

  it('el mes se mide en Lima: el 30/11 es del mes en curso a las 20:30 de Lima (1/12 en UTC) y no el 1/12 a las 20:30 de Lima', () => {
    const claseDe19 = { horaInicio: '19:00', horaFin: '20:00' };
    expect(
      codigo({
        hoy: '2026-11-30',
        fecha: '2026-11-30',
        horaLlegada: '19:10',
        clase: claseDe19,
        ahora: new Date('2026-12-01T01:30:00.000Z'),
      }),
    ).toBe('PUNTUAL');
    expect(
      codigo({
        hoy: '2026-12-01',
        fecha: '2026-11-30',
        horaLlegada: '19:10',
        clase: claseDe19,
        ahora: new Date('2026-12-02T01:30:00.000Z'),
      }),
    ).toBe('FECHA_NO_PERMITIDA');
  });

  it('un rechazo anterior gana al siguiente: fecha antes que inactivo, inactivo antes que ya tiene, y la hora fuera de la clase antes que la ocurrencia no incluida', () => {
    expect(codigo({ fecha: '2026-11-23', alumnoInactivo: true })).toBe('FECHA_NO_PERMITIDA');
    expect(codigo({ alumnoInactivo: true, yaTieneAsistencia: true, matricula: null })).toBe('ALUMNO_INACTIVO');
    expect(codigo({ yaTieneAsistencia: true, matricula: null })).toBe('ASISTENCIA_YA_REGISTRADA');
    expect(
      codigo({
        horaLlegada: '19:30',
        matricula: { clasesTotales: 12, clasesUsadas: 0, creadaEn: new Date('2026-11-16T23:30:00.000Z') },
      }),
    ).toBe('HORA_FUERA_DE_LA_CLASE');
  });
});
