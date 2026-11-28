import { describe, expect, it } from 'vitest';
import { mesesDeAsistencia } from './mensualidad-del-panel';

// Spec 011, criterio 11 (prueba obligatoria): los meses de asistencia que ve el alumno, en el dominio puro.

describe('mesesDeAsistencia (criterio 11)', () => {
  it('trae M siempre y los meses anteriores pagados, del más nuevo al más viejo y sin repetir', () => {
    expect(mesesDeAsistencia('2026-11', ['2026-09', '2026-10', '2026-09', '2025-12'])).toEqual([
      '2026-11',
      '2026-10',
      '2026-09',
      '2025-12',
    ]);
  });

  it('M aparece aunque no tenga mensualidad pagada, y no se repite si sí la tiene', () => {
    expect(mesesDeAsistencia('2026-11', [])).toEqual(['2026-11']);
    expect(mesesDeAsistencia('2026-11', ['2026-11', '2026-10'])).toEqual(['2026-11', '2026-10']);
  });

  it('nunca trae M+1 ni uno posterior, aunque venga como pagado', () => {
    expect(mesesDeAsistencia('2026-11', ['2026-12', '2027-01', '2026-10'])).toEqual(['2026-11', '2026-10']);
  });
});
