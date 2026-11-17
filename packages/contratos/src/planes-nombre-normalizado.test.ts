import { describe, expect, it } from 'vitest';
import { actualizarPlanSchema, crearPlanSchema, normalizarNombrePlan } from './planes';

// Criterio 34 (ronda 1 del ataque adversarial, DT-6 de 004): el nombre del plan se normaliza antes de validar.

const PLAN = {
  nombre: 'Plan Mensual',
  vecesPorSemana: 3,
  clasesPorMes: 12,
  precio: '120.00',
  diasPermitidos: [1, 3, 5],
  franjasPermitidas: ['08:00', '19:00'],
  nivelesAplicables: ['BASICO', 'AVANZADO'],
};

describe('normalizarNombrePlan (criterio 34)', () => {
  it.each([
    ['NFD pasa a NFC', 'Natación'.normalize('NFD'), 'Natación'.normalize('NFC')],
    ['espacio no separable U+00A0', 'Plan Mensual', 'Plan Mensual'],
    ['espacio ideográfico U+3000', 'Plan　Mensual', 'Plan Mensual'],
    ['espacio fino U+2009 y de ancho de eme U+2003', 'Plan  Mensual', 'Plan Mensual'],
    ['ancho cero U+200B se elimina', 'Plan Men​sual', 'Plan Mensual'],
    ['U+200C y U+200D se eliminan', 'Plan‌ Men‍sual', 'Plan Mensual'],
    ['U+2060 se elimina', 'Plan⁠ Mensual', 'Plan Mensual'],
    ['U+FEFF se elimina', '﻿Plan Mensual', 'Plan Mensual'],
    ['guion suave U+00AD se elimina', 'Plan Men­sual', 'Plan Mensual'],
    ['espacios dobles se colapsan', 'Plan    Mensual', 'Plan Mensual'],
    ['un invisible entre dos espacios deja uno solo', 'Plan ​ Mensual', 'Plan Mensual'],
    ['se recortan los extremos', '  　Plan Mensual  ', 'Plan Mensual'],
    ['no cambia las mayúsculas', 'PLAN mensual', 'PLAN mensual'],
    ['un nombre ya normalizado queda igual', 'Plan Mensual', 'Plan Mensual'],
  ])('%s', (_nombre, entrada, esperado) => {
    expect(normalizarNombrePlan(entrada)).toBe(esperado);
  });

  it('no elimina los controles bidireccionales (los rechaza el esquema con 400)', () => {
    expect(normalizarNombrePlan('Plan‮Mensual')).toBe('Plan‮Mensual');
    expect(normalizarNombrePlan('Plan‏Mensual')).toBe('Plan‏Mensual');
    expect(normalizarNombrePlan('Plan؜Mensual')).toBe('Plan؜Mensual');
  });

  it('es idempotente', () => {
    const una = normalizarNombrePlan(' ​Plan　 Men­sual ');
    expect(normalizarNombrePlan(una)).toBe(una);
  });
});

describe('el nombre del plan en los esquemas (criterio 34)', () => {
  it('crearPlanSchema y actualizarPlanSchema devuelven el nombre normalizado', () => {
    const creado = crearPlanSchema.safeParse({ ...PLAN, nombre: ' Plan　 Men​sual ' });
    const actualizado = actualizarPlanSchema.safeParse({ nombre: 'Natación'.normalize('NFD') });

    expect(creado.data?.nombre).toBe('Plan Mensual');
    expect(actualizado.data?.nombre).toBe('Natación'.normalize('NFC'));
  });

  it('los límites se miden sobre el nombre normalizado', () => {
    const justo = `${'a'.repeat(40)}\u200B\u00A0\u00A0${'b'.repeat(39)}`;
    const largo = `${'a'.repeat(40)} ${'b'.repeat(40)}`;

    expect(crearPlanSchema.safeParse({ ...PLAN, nombre: justo }).success).toBe(true);
    expect(crearPlanSchema.safeParse({ ...PLAN, nombre: largo }).success).toBe(false);
    expect(crearPlanSchema.safeParse({ ...PLAN, nombre: 'a​  b' }).success).toBe(false);
    expect(crearPlanSchema.safeParse({ ...PLAN, nombre: '​​​​' }).success).toBe(false);
  });

  it('los controles bidireccionales y los de control siguen siendo errores del campo nombre', () => {
    for (const nombre of ['Plan‮Mensual', 'Plan‏Mensual', 'Plan\u0000Mensual']) {
      const resultado = crearPlanSchema.safeParse({ ...PLAN, nombre });
      expect(resultado.success, nombre).toBe(false);
      expect(resultado.error?.issues.map((i) => i.path.join('.'))).toContain('nombre');
    }
  });

  it('un nombre que no es texto sigue siendo un error del campo nombre', () => {
    expect(crearPlanSchema.safeParse({ ...PLAN, nombre: 123 }).success).toBe(false);
    expect(actualizarPlanSchema.safeParse({ nombre: null }).success).toBe(false);
  });
});
