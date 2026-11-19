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

  it('el resultado siempre está en NFC, aunque el invisible esté entre la letra y su tilde suelta (F2-1)', () => {
    const esperado = 'Plan Natación'.normalize('NFC');
    for (const invisible of ['\u200B', '\u00AD', '\uFEFF', '\u2060', '\u200C', '\u200D']) {
      const resultado = normalizarNombrePlan(`Plan Natacio${invisible}\u0301n`);
      expect(resultado, JSON.stringify(invisible)).toBe(esperado);
      expect(resultado).toBe(resultado.normalize('NFC'));
    }
    // jamo de hangul separados por un invisible: se componen en la sílaba
    expect(normalizarNombrePlan('Plan \u1112\u200B\u1161\u200B\u11AB')).toBe('Plan \uD55C');
  });

  it.each([
    ['unión de grafemas U+034F', 'Plan Men\u034Fsual'],
    ['selector de variación U+FE0F', 'Plan Mensual\uFE0F'],
    ['selector de variación U+FE00', 'Plan\uFE00 Mensual'],
    ['selector de variación suplementario U+E0100', 'Plan Men\u{E0100}sual'],
    ['selector de variación suplementario U+E01EF', 'Plan Men\u{E01EF}sual'],
    ['selector mongol U+180B', 'Plan Men\u180Bsual'],
    ['selector mongol U+180F', 'Plan Men\u180Fsual'],
    ['vocal inherente jemer U+17B4', 'Plan Men\u17B4sual'],
    ['vocal inherente jemer U+17B5', 'Plan Men\u17B5sual'],
    ['relleno de hangul U+115F', 'Plan Men\u115Fsual'],
    ['relleno de hangul U+1160', 'Plan Men\u1160sual'],
    ['relleno de hangul U+3164', 'Plan Men\u3164sual'],
    ['relleno de hangul de ancho medio U+FFA0', 'Plan Men\uFFA0sual'],
    ['etiqueta U+E0001', 'Plan Men\u{E0001}sual'],
    ['braille en blanco U+2800 como espacio', 'Plan\u2800Mensual'],
    ['braille en blanco U+2800 en los extremos', '\u2800Plan Mensual\u2800'],
    ['braille en blanco junto a un espacio', 'Plan \u2800 Mensual'],
  ])('F2-2: %s', (_nombre, entrada) => {
    expect(normalizarNombrePlan(entrada)).toBe('Plan Mensual');
  });

  it('todo carácter Cf o Default_Ignorable_Code_Point se elimina, salvo los de control bidireccional', () => {
    for (let punto = 0; punto <= 0x10ffff; punto += 1) {
      if (punto >= 0xd800 && punto <= 0xdfff) continue;
      const caracter = String.fromCodePoint(punto);
      if (!/[\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(caracter)) continue;
      const esperado = /\p{Bidi_Control}/u.test(caracter) ? `Plan${caracter}Mensual` : 'PlanMensual';
      expect(normalizarNombrePlan(`Plan${caracter}Mensual`), `U+${punto.toString(16)}`).toBe(esperado);
    }
  });

  it('es idempotente', () => {
    const una = normalizarNombrePlan(' ​Plan　 Men­sual ');
    expect(normalizarNombrePlan(una)).toBe(una);
    const suelta = normalizarNombrePlan('Plan Natacio\u200B\u0301n\u2800');
    expect(normalizarNombrePlan(suelta)).toBe(suelta);
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

  it('los límites se miden tras normalizar también con invisibles nuevos y braille en blanco', () => {
    const justo = `${'a'.repeat(40)}\u2800\u034F\uFE0F\u2800${'b'.repeat(39)}`;
    const corto = 'a\u034F\u2800\uFE0Fb';

    expect(crearPlanSchema.safeParse({ ...PLAN, nombre: justo }).data?.nombre).toHaveLength(80);
    expect(crearPlanSchema.safeParse({ ...PLAN, nombre: corto }).success).toBe(false);
    expect(crearPlanSchema.safeParse({ ...PLAN, nombre: '\u034F\uFE0F\u2800\u180B' }).success).toBe(false);
  });

  it('el nombre del esquema queda en NFC con un invisible entre la letra y la tilde (F2-1)', () => {
    const creado = crearPlanSchema.safeParse({ ...PLAN, nombre: 'Plan Natacio\u200B\u0301n' });
    expect(creado.data?.nombre).toBe('Plan Natación'.normalize('NFC'));
  });

  it('los controles bidireccionales y los de control siguen siendo errores del campo nombre', () => {
    for (const nombre of ['Plan‮Mensual', 'Plan‏Mensual', 'Plan\u0000Mensual']) {
      const resultado = crearPlanSchema.safeParse({ ...PLAN, nombre });
      expect(resultado.success, nombre).toBe(false);
      expect(resultado.error?.issues.map((i) => i.path.join('.'))).toContain('nombre');
    }
  });

  it('los separadores de línea y de párrafo (U+2028 y U+2029) siguen siendo errores del campo nombre', () => {
    for (const nombre of ['Plan\u2028Mensual', 'Plan\u2029Mensual']) {
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
