import { describe, expect, it } from 'vitest';
import {
  BLOQUES,
  DIAS_SEMANA,
  diaSemanaSchema,
  esFechaReal,
  fechaSchema,
  horaBloqueSchema,
  horaFinDe,
  NIVELES,
  nivelNatacionSchema,
} from './horario';

describe('horario: niveles, días, bloques y fechas (spec 004)', () => {
  it('los niveles van en el orden BASICO, INTERMEDIO, AVANZADO', () => {
    expect([...NIVELES]).toEqual(['BASICO', 'INTERMEDIO', 'AVANZADO']);
    expect(nivelNatacionSchema.safeParse('AVANZADO').success).toBe(true);
    expect(nivelNatacionSchema.safeParse('basico').success).toBe(false);
    expect(nivelNatacionSchema.safeParse('EXPERTO').success).toBe(false);
  });

  it('los días son enteros de 1 a 7', () => {
    for (const dia of DIAS_SEMANA) expect(diaSemanaSchema.safeParse(dia).success).toBe(true);
    for (const malo of [0, 8, -1, 1.5, '1', null, Number.NaN, Number.POSITIVE_INFINITY, true]) {
      expect(diaSemanaSchema.safeParse(malo).success, String(malo)).toBe(false);
    }
  });

  it('los bloques son las doce horas en punto de 08:00 a 19:00 y la clase de las 19:00 termina a las 20:00', () => {
    expect(BLOQUES).toHaveLength(12);
    for (const bloque of BLOQUES) expect(horaBloqueSchema.safeParse(bloque).success, bloque).toBe(true);
    for (const malo of ['07:00', '20:00', '08:30', '8:00', '08:00:00', '24:00', '', null, 8]) {
      expect(horaBloqueSchema.safeParse(malo).success, String(malo)).toBe(false);
    }
    expect(horaFinDe('08:00')).toBe('09:00');
    expect(horaFinDe('09:00')).toBe('10:00');
    expect(horaFinDe('19:00')).toBe('20:00');
  });

  it('las fechas son AAAA-MM-DD reales', () => {
    for (const buena of ['2026-11-17', '2024-02-29', '2026-12-31', '2026-01-01']) {
      expect(fechaSchema.safeParse(buena).success, buena).toBe(true);
    }
    for (const mala of [
      '2026-02-30',
      '2025-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-11-00',
      '2026-11-31',
      '2026-1-1',
      '26-11-17',
      '2026/11/17',
      '2026-11-17T00:00:00Z',
      ' 2026-11-17',
      '',
      null,
      20261117,
    ]) {
      expect(fechaSchema.safeParse(mala).success, String(mala)).toBe(false);
    }
    expect(esFechaReal('0001-01-01')).toBe(true);
    expect(esFechaReal('0004-02-29')).toBe(true);
    expect(esFechaReal('0000-01-01')).toBe(false);
  });
});
