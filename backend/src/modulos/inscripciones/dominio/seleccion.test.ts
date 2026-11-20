import { describe, expect, it } from 'vitest';
import { type ClaseParaSeleccion, MENSAJE_CLASE_NO_DISPONIBLE, planAplicaAlNivel, validarSeleccion } from './seleccion';

const PLAN = {
  vecesPorSemana: 3,
  diasPermitidos: [1, 3, 5],
  franjasPermitidas: ['17:00', '18:00', '19:00'],
  nivelesAplicables: ['BASICO', 'INTERMEDIO'] as const,
};
const clase = (id: string, diaSemana: number, horaInicio: string, extra: Partial<ClaseParaSeleccion> = {}) => ({
  id,
  nivel: 'BASICO' as const,
  diaSemana,
  horaInicio,
  activo: true,
  ...extra,
});
const LUNES = clase('a', 1, '18:00');
const MIERCOLES = clase('b', 3, '18:00');
const VIERNES = clase('c', 5, '18:00');

describe('validarSeleccion (criterio 15 b)', () => {
  const validar = (
    clases: ClaseParaSeleccion[],
    ids: string[],
    nivel: 'BASICO' | 'INTERMEDIO' | 'AVANZADO' = 'BASICO',
  ) => validarSeleccion(PLAN, nivel, clases, ids, 'inscripcion.claseIds');

  it('una selección válida no tiene errores', () => {
    expect(validar([LUNES, MIERCOLES, VIERNES], ['a', 'b', 'c'])).toEqual([]);
  });

  it('exige exactamente las veces por semana del plan', () => {
    expect(validar([LUNES, MIERCOLES], ['a', 'b'])[0]).toMatchObject({ campo: 'inscripcion.claseIds' });
    expect(validar([LUNES, MIERCOLES, VIERNES, clase('d', 1, '17:00')], ['a', 'b', 'c', 'd']).length).toBeGreaterThan(
      0,
    );
  });

  it('exige días distintos: dos clases el mismo día', () => {
    const errores = validar([LUNES, clase('d', 1, '17:00'), MIERCOLES], ['a', 'd', 'b']);

    expect(errores.map((e) => e.mensaje)).toContain('Elige una sola clase por día.');
  });

  it('rechaza una clase de otro nivel, de un día o de una franja que el plan no permite, con su posición', () => {
    expect(validar([LUNES, MIERCOLES, clase('c', 5, '18:00', { nivel: 'AVANZADO' })], ['a', 'b', 'c'])).toEqual([
      { campo: 'inscripcion.claseIds.2', mensaje: 'La clase no es del nivel elegido.' },
    ]);
    expect(validar([LUNES, MIERCOLES, clase('c', 2, '18:00')], ['a', 'b', 'c'])[0]).toMatchObject({
      campo: 'inscripcion.claseIds.2',
    });
    expect(validar([LUNES, MIERCOLES, clase('c', 5, '08:00')], ['a', 'b', 'c'])[0]).toMatchObject({
      campo: 'inscripcion.claseIds.2',
    });
  });

  it('una clase inexistente, de otra academia (no vuelve del bloqueo) o inactiva da el mismo error', () => {
    const inactiva = validar([LUNES, MIERCOLES, clase('c', 5, '18:00', { activo: false })], ['a', 'b', 'c']);
    const inexistente = validar([LUNES, MIERCOLES], ['a', 'b', 'c']);

    expect(inactiva).toEqual([{ campo: 'inscripcion.claseIds.2', mensaje: MENSAJE_CLASE_NO_DISPONIBLE }]);
    expect(inexistente).toEqual(inactiva);
  });

  it('los ids se comparan sin distinguir mayúsculas', () => {
    expect(validar([clase('aa', 1, '18:00'), MIERCOLES, VIERNES], ['AA', 'b', 'c'])).toEqual([]);
  });

  it('el plan aplica al nivel solo si lo lista', () => {
    expect(planAplicaAlNivel(PLAN, 'BASICO')).toBe(true);
    expect(planAplicaAlNivel(PLAN, 'AVANZADO')).toBe(false);
  });
});
