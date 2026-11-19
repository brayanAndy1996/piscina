import { describe, expect, it } from 'vitest';
import { actualizarPlanSchema, crearPlanSchema, planSchema, vigenciaInvertida } from './planes';

const PLAN = {
  nombre: 'Plan Mensual',
  vecesPorSemana: 3,
  clasesPorMes: 12,
  precio: '120.00',
  diasPermitidos: [1, 3, 5],
  franjasPermitidas: ['08:00', '19:00'],
  nivelesAplicables: ['BASICO', 'AVANZADO'],
};

const campos = (resultado: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (resultado.error?.issues ?? []).map((problema) => problema.path.map(String).join('.'));

describe('crearPlanSchema (spec 004, criterios 8 y 9)', () => {
  it('acepta el plan de ejemplo y la duración vale 60 si no se envía', () => {
    const resultado = crearPlanSchema.safeParse(PLAN);

    expect(resultado.success).toBe(true);
    expect(resultado.data?.duracionMinutos).toBe(60);
  });

  it('recorta el nombre y acepta fechas de vigencia, también null', () => {
    const resultado = crearPlanSchema.safeParse({
      ...PLAN,
      nombre: '  Plan de verano  ',
      vigenciaInicio: '2027-01-01',
      vigenciaFin: null,
    });

    expect(resultado.success).toBe(true);
    expect(resultado.data?.nombre).toBe('Plan de verano');
  });

  it.each([
    ['nombre de 2 caracteres', { nombre: 'ab' }, 'nombre'],
    ['nombre de 81 caracteres', { nombre: 'a'.repeat(81) }, 'nombre'],
    ['nombre con controles', { nombre: 'Plan\u0000X' }, 'nombre'],
    ['nombre con menos de 3 visibles', { nombre: ' a b ' }, 'nombre'],
    ['vecesPorSemana 0', { vecesPorSemana: 0 }, 'vecesPorSemana'],
    ['vecesPorSemana 8', { vecesPorSemana: 8 }, 'vecesPorSemana'],
    ['vecesPorSemana decimal', { vecesPorSemana: 2.5 }, 'vecesPorSemana'],
    ['clasesPorMes 32', { clasesPorMes: 32 }, 'clasesPorMes'],
    ['duracionMinutos 14', { duracionMinutos: 14 }, 'duracionMinutos'],
    ['duracionMinutos 61', { duracionMinutos: 61 }, 'duracionMinutos'],
    ['duracionMinutos null', { duracionMinutos: null }, 'duracionMinutos'],
    ['diasPermitidos vacío', { diasPermitidos: [] }, 'diasPermitidos'],
    ['diasPermitidos repetidos', { diasPermitidos: [1, 1, 3] }, 'diasPermitidos'],
    ['diasPermitidos fuera de rango', { diasPermitidos: [1, 3, 8] }, 'diasPermitidos.2'],
    ['menos días que veces por semana', { diasPermitidos: [1, 3] }, 'diasPermitidos'],
    ['franjasPermitidas vacía', { franjasPermitidas: [] }, 'franjasPermitidas'],
    ['franjasPermitidas repetidas', { franjasPermitidas: ['08:00', '08:00'] }, 'franjasPermitidas'],
    ['franja que no es un bloque', { franjasPermitidas: ['08:30'] }, 'franjasPermitidas.0'],
    ['nivelesAplicables vacío', { nivelesAplicables: [] }, 'nivelesAplicables'],
    ['nivelesAplicables repetidos', { nivelesAplicables: ['BASICO', 'BASICO'] }, 'nivelesAplicables'],
    ['nivel desconocido', { nivelesAplicables: ['EXPERTO'] }, 'nivelesAplicables.0'],
    ['vigenciaInicio que no existe', { vigenciaInicio: '2026-02-30' }, 'vigenciaInicio'],
    ['vigenciaFin que no es fecha', { vigenciaFin: 'mañana' }, 'vigenciaFin'],
    ['vigenciaFin antes de vigenciaInicio', { vigenciaInicio: '2026-03-01', vigenciaFin: '2026-02-28' }, 'vigenciaFin'],
    ['un campo de más', { academiaId: 'x' }, ''],
    ['un campo calculado (estado)', { estado: 'VIGENTE' }, ''],
  ])('rechaza %s', (_nombre, cambio, campo) => {
    const resultado = crearPlanSchema.safeParse({ ...PLAN, ...cambio });

    expect(resultado.success).toBe(false);
    if (campo !== '') expect(campos(resultado)).toContain(campo);
  });

  it('una vigencia de un solo día es válida y 7 veces por semana exige los 7 días', () => {
    expect(
      crearPlanSchema.safeParse({ ...PLAN, vigenciaInicio: '2026-03-01', vigenciaFin: '2026-03-01' }).success,
    ).toBe(true);
    expect(crearPlanSchema.safeParse({ ...PLAN, vecesPorSemana: 7, diasPermitidos: [1, 2, 3, 4, 5, 6] }).success).toBe(
      false,
    );
    expect(
      crearPlanSchema.safeParse({ ...PLAN, vecesPorSemana: 7, diasPermitidos: [1, 2, 3, 4, 5, 6, 7] }).success,
    ).toBe(true);
  });

  it('las reglas que cruzan campos también se comprueban cuando otro campo ya falló', () => {
    const resultado = crearPlanSchema.safeParse({ ...PLAN, precio: '0', diasPermitidos: [1, 3] });

    expect(campos(resultado)).toEqual(expect.arrayContaining(['precio', 'diasPermitidos']));
  });
});

describe('actualizarPlanSchema (spec 004, criterio 12)', () => {
  it('acepta uno o varios campos, null en las vigencias y activo', () => {
    expect(actualizarPlanSchema.safeParse({ precio: '130' }).success).toBe(true);
    expect(actualizarPlanSchema.safeParse({ vigenciaInicio: null, vigenciaFin: null }).success).toBe(true);
    expect(actualizarPlanSchema.safeParse({ activo: false }).success).toBe(true);
    expect(actualizarPlanSchema.safeParse({ nombre: 'Nuevo nombre', clasesPorMes: 8, activo: true }).success).toBe(
      true,
    );
  });

  it('rechaza el cuerpo vacío, los campos de más y los valores inválidos', () => {
    expect(actualizarPlanSchema.safeParse({}).success).toBe(false);
    expect(actualizarPlanSchema.safeParse({ precio: undefined }).success).toBe(false);
    expect(actualizarPlanSchema.safeParse({ academiaId: 'x', precio: '1' }).success).toBe(false);
    expect(actualizarPlanSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(actualizarPlanSchema.safeParse({ activo: 'si' }).success).toBe(false);
    expect(actualizarPlanSchema.safeParse({ nombre: null }).success).toBe(false);
  });
});

describe('vigenciaInvertida', () => {
  it('compara solo cuando hay las dos fechas', () => {
    expect(vigenciaInvertida('2026-03-01', '2026-02-28')).toBe(true);
    expect(vigenciaInvertida('2026-03-01', '2026-03-01')).toBe(false);
    expect(vigenciaInvertida(null, '2026-02-28')).toBe(false);
    expect(vigenciaInvertida('2026-03-01', undefined)).toBe(false);
  });
});

describe('planSchema', () => {
  it('describe la respuesta de la API', () => {
    const resultado = planSchema.safeParse({
      id: '3f2b8f0e-6a6c-4c1e-9a53-0d1c2b3a4e5f',
      ...PLAN,
      duracionMinutos: 60,
      vigenciaInicio: null,
      vigenciaFin: null,
      activo: true,
      estado: 'VIGENTE',
    });

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });
});
