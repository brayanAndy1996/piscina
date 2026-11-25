import { describe, expect, it } from 'vitest';
import { elegirMatriculaDelCarnet, type MatriculaCandidata, vigenteHoy } from './matricula-del-carnet';

// Spec 008a, criterio 8 y DT-12 (prueba no protegida): la matrícula del carnet y `vigenteHoy` con la fecha de Lima ya calculada.

const matricula = (cambios: Partial<MatriculaCandidata> & { id?: string }): MatriculaCandidata & { id: string } => ({
  id: 'm',
  estado: 'VIGENTE',
  anio: 2026,
  mes: 11,
  desde: '2026-11-01',
  hasta: '2026-11-30',
  creadoEn: new Date('2026-11-01T15:00:00.000Z'),
  ...cambios,
});

describe('vigenteHoy', () => {
  it.each([
    ['2026-11-01', true],
    ['2026-11-30', true],
    ['2026-10-31', false],
    ['2026-12-01', false],
  ])('una VIGENTE de noviembre, el %s: %s', (hoy, esperado) => {
    expect(vigenteHoy(matricula({}), hoy)).toBe(esperado);
  });

  it('una FINALIZADA nunca está vigente hoy, aunque hoy esté dentro de su período', () => {
    expect(vigenteHoy(matricula({ estado: 'FINALIZADA' }), '2026-11-15')).toBe(false);
  });
});

describe('elegirMatriculaDelCarnet', () => {
  it('sin matrículas, ninguna', () => {
    expect(elegirMatriculaDelCarnet([], '2026-11-15')).toBeNull();
  });

  it('una RESERVADA o CANCELADA nunca es la del carnet', () => {
    const candidatas = [matricula({ id: 'r', estado: 'RESERVADA' }), matricula({ id: 'c', estado: 'CANCELADA' })];
    expect(elegirMatriculaDelCarnet(candidatas, '2026-11-15')).toBeNull();
  });

  it('prefiere la VIGENTE cuyo período contiene hoy sobre una más reciente', () => {
    const noviembre = matricula({ id: 'nov' });
    const diciembre = matricula({ id: 'dic', mes: 12, desde: '2026-12-01', hasta: '2026-12-31' });
    expect(elegirMatriculaDelCarnet([diciembre, noviembre], '2026-11-30')?.id).toBe('nov');
    expect(elegirMatriculaDelCarnet([noviembre, diciembre], '2026-12-01')?.id).toBe('dic');
  });

  it('si ninguna contiene hoy, la VIGENTE o FINALIZADA con el mes más reciente', () => {
    const octubre = matricula({ id: 'oct', mes: 10, desde: '2026-10-01', hasta: '2026-10-31', estado: 'FINALIZADA' });
    const noviembre = matricula({ id: 'nov' });
    expect(elegirMatriculaDelCarnet([octubre, noviembre], '2026-12-01')?.id).toBe('nov');
    expect(elegirMatriculaDelCarnet([octubre], '2026-12-01')?.id).toBe('oct');
  });

  it('el mes más reciente cruza el año', () => {
    const diciembre = matricula({ id: 'dic', anio: 2026, mes: 12, desde: '2026-12-01', hasta: '2026-12-31' });
    const enero = matricula({ id: 'ene', anio: 2027, mes: 1, desde: '2027-01-01', hasta: '2027-01-31' });
    expect(elegirMatriculaDelCarnet([enero, diciembre], '2027-03-01')?.id).toBe('ene');
  });

  it('con varias del mismo mes, la creada después (DT-12)', () => {
    const vieja = matricula({ id: 'vieja', estado: 'FINALIZADA', creadoEn: new Date('2026-11-01T10:00:00.000Z') });
    const nueva = matricula({ id: 'nueva', estado: 'FINALIZADA', creadoEn: new Date('2026-11-05T10:00:00.000Z') });
    expect(elegirMatriculaDelCarnet([vieja, nueva], '2026-12-15')?.id).toBe('nueva');
  });
});
