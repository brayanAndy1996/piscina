import { describe, expect, it } from 'vitest';
import type { FilaDeMatricula, MensualidadDeUnMes } from '../../mensualidades/lectura-de-estado';
import { elegirMensualidades, mesesDeAsistencia } from './mensualidad-del-panel';

// Spec 011, criterios 8, 9 y 11 (pruebas obligatorias): lo que el panel muestra de la mensualidad, en el dominio puro.

const fila = (mes: string): FilaDeMatricula => {
  const [anio = 0, numero = 0] = mes.split('-').map(Number);
  return {
    alumno_id: 'a',
    nombres: 'Alma',
    apellidos: 'Prueba',
    nivel: 'BASICO',
    anio,
    mes: numero,
    pagada: true,
    plan_id: 'p',
    plan_nombre: 'Plan',
    clases_usadas: 5,
    clases_totales: 12,
    desde: `${mes}-01`,
    hasta: `${mes}-28`,
    clases: [],
  };
};
const pagada = (mes: string): [string, MensualidadDeUnMes] => [mes, { pagada: true, fila: fila(mes) }];
const enVerificacion = (mes: string): [string, MensualidadDeUnMes] => [
  mes,
  { pagada: false, fila: { ...fila(mes), pagada: false } },
];
const meses = (...entradas: [string, MensualidadDeUnMes][]) => new Map(entradas);

describe('elegirMensualidades (criterios 8 y 9)', () => {
  const entrada = (hoy: string, delAlumno: ReadonlyMap<string, MensualidadDeUnMes>) => ({
    hoy,
    diasPorVencer: 5,
    meses: delAlumno,
  });

  it('con la de M pagada y fuera de la ventana: AL_DIA y actual es la de M', () => {
    const r = elegirMensualidades(entrada('2026-11-25', meses(pagada('2026-11'))));
    expect(r.estado).toBe('AL_DIA');
    expect(r.actual?.mes).toBe(11);
    expect(r.siguiente).toBeNull();
  });

  it('en la ventana (26/11 con 5 días): POR_VENCER; con diciembre pagado AL_DIA y siguiente PAGADA; con diciembre en verificación PENDIENTE_VERIFICACION y EN_VERIFICACION', () => {
    expect(elegirMensualidades(entrada('2026-11-26', meses(pagada('2026-11')))).estado).toBe('POR_VENCER');
    const pagadaDic = elegirMensualidades(entrada('2026-11-26', meses(pagada('2026-11'), pagada('2026-12'))));
    expect([pagadaDic.estado, pagadaDic.siguiente?.estado, pagadaDic.siguiente?.fila.mes]).toEqual([
      'AL_DIA',
      'PAGADA',
      12,
    ]);
    const enVerDic = elegirMensualidades(entrada('2026-11-26', meses(pagada('2026-11'), enVerificacion('2026-12'))));
    expect([enVerDic.estado, enVerDic.siguiente?.estado]).toEqual(['PENDIENTE_VERIFICACION', 'EN_VERIFICACION']);
    expect(enVerDic.actual?.mes).toBe(11);
  });

  it('el 1/12 sin diciembre: VENCIDO con actual noviembre; con diciembre pagado: AL_DIA con actual diciembre', () => {
    const vencido = elegirMensualidades(entrada('2026-12-01', meses(pagada('2026-11'))));
    expect([vencido.estado, vencido.actual?.mes]).toEqual(['VENCIDO', 11]);
    const alDia = elegirMensualidades(entrada('2026-12-01', meses(pagada('2026-11'), pagada('2026-12'))));
    expect([alDia.estado, alDia.actual?.mes]).toEqual(['AL_DIA', 12]);
  });

  it('con la de M en verificación y sin la pagada: PENDIENTE_VERIFICACION con actual la de M; si hay pagada, manda la pagada (la agrupación la deja sola)', () => {
    const r = elegirMensualidades(entrada('2026-11-10', meses(enVerificacion('2026-11'))));
    expect([r.estado, r.actual?.pagada]).toEqual(['PENDIENTE_VERIFICACION', false]);
  });

  it('un alumno inscrito solo para diciembre el 28/11: sin estado ni actual, con siguiente PAGADA', () => {
    const r = elegirMensualidades(entrada('2026-11-28', meses(pagada('2026-12'))));
    expect([r.estado, r.actual]).toEqual([null, null]);
    expect(r.siguiente?.estado).toBe('PAGADA');
  });

  it('con la última mensualidad pagada en septiembre, el 15/11: todo null', () => {
    const r = elegirMensualidades(entrada('2026-11-15', meses(pagada('2026-09'))));
    expect(r).toEqual({ estado: null, actual: null, siguiente: null });
  });

  it('enero mira diciembre del año anterior y diciembre mira enero del año siguiente', () => {
    expect(elegirMensualidades(entrada('2027-01-05', meses(pagada('2026-12')))).estado).toBe('VENCIDO');
    const r = elegirMensualidades(entrada('2026-12-28', meses(pagada('2026-12'), pagada('2027-01'))));
    expect([r.estado, r.siguiente?.fila.mes]).toEqual(['AL_DIA', 1]);
  });

  it('sin ninguna mensualidad: todo null', () => {
    expect(elegirMensualidades(entrada('2026-11-15', meses()))).toEqual({
      estado: null,
      actual: null,
      siguiente: null,
    });
  });
});

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
