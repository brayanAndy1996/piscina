// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import {
  crearAcademiaSchema,
  iniciarSesionPlataformaSchema,
  reactivarAcademiaSchema,
  suspenderAcademiaSchema,
} from './index';

// Criterios 87 y 88 (ataque ronda 2, F5 y F6) en los esquemas compartidos.
//  - 87: al contar los 3 caracteres visibles del criterio 77 no cuentan los caracteres con la propiedad
//    \p{Default_Ignorable_Code_Point} (entre ellos U+115F, U+1160, U+3164, U+FFA0, U+180E, U+17B4 y U+17B5) ni U+2800
//    (patron Braille en blanco). Se prueban por su efecto en los esquemas publicos (nombrando el campo). Los caracteres se
//    escriben con escapes: en el codigo fuente serian invisibles.
//  - 88: las longitudes (correo hasta 254; clave de 1 a 128; nombre de 3 a 100; motivo de 3 a 500) se cuentan por puntos de
//    codigo ([...texto].length) y no por unidades UTF-16 (.length).

/** Campos con error de un `safeParse` fallido (la ruta del error, unida con puntos). */
function camposConError(resultado: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return (resultado.error?.issues ?? []).map((issue) => issue.path.map(String).join('.'));
}

const EMOJI = '😀'; // 1 punto de codigo, 2 unidades UTF-16

/** Textos de "3 caracteres" que se ven en blanco (ejemplos de la spec), mas el resto de la lista de ignorables. */
const EN_BLANCO: readonly (readonly [string, string])[] = [
  ['tres U+3164 (hangul filler)', 'ㅤㅤㅤ'],
  ['tres U+2800 (patron Braille en blanco)', '⠀⠀⠀'],
  ['tres U+FFA0 (hangul filler de ancho medio)', 'ﾠﾠﾠ'],
  ['U+115F, U+1160 y U+115F (jamo fillers)', 'ᅟᅠᅟ'],
  ['U+17B4, U+17B5 y U+17B4 (vocales jemer inherentes)', '឴឵឴'],
  ['tres U+180E (separador mongol de vocales)', '᠎᠎᠎'],
  ['dos letras y un U+3164 (2 visibles)', 'abㅤ'],
  ['dos letras y varios U+3164', 'abㅤㅤㅤㅤ'],
  ['dos letras y un U+2800', 'ab⠀'],
  ['una letra y cuatro U+FFA0', 'aﾠﾠﾠﾠ'],
  ['letras separadas por U+3164 (solo 2 visibles)', 'aㅤㅤb'],
];

/** Textos que se aceptan: tienen 3 o mas caracteres visibles, con o sin ignorables en medio. */
const NOMBRES_ACEPTADOS: readonly string[] = [
  'Academia Ñandú',
  'Club 3',
  '수영 아카데미',
  'Del​fines',
  'aㅤbㅤc',
  'abc⠀',
];

describe('criterio 87: caracteres que se ven en blanco no cuentan como visibles', () => {
  it.each(EN_BLANCO)('crearAcademiaSchema rechaza un nombre de %s, nombrando el campo', (_caso, nombre) => {
    const resultado = crearAcademiaSchema.safeParse({ nombre, nombreCorto: 'delfines' });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('nombre');
  });

  it.each(EN_BLANCO)('suspenderAcademiaSchema rechaza un motivo de %s', (_caso, motivo) => {
    const resultado = suspenderAcademiaSchema.safeParse({ motivo });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('motivo');
  });

  it.each(EN_BLANCO)('reactivarAcademiaSchema rechaza un motivo de %s', (_caso, motivo) => {
    const resultado = reactivarAcademiaSchema.safeParse({ motivo });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('motivo');
  });

  it.each(NOMBRES_ACEPTADOS)('crearAcademiaSchema acepta el nombre %j y lo conserva tal como llega', (nombre) => {
    const resultado = crearAcademiaSchema.safeParse({ nombre, nombreCorto: 'delfines' });

    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.nombre).toBe(nombre);
  });

  it.each(NOMBRES_ACEPTADOS)('suspenderAcademiaSchema acepta el motivo %j', (motivo) => {
    expect(suspenderAcademiaSchema.safeParse({ motivo }).success).toBe(true);
  });

  it('reactivarAcademiaSchema sigue aceptando que falte el motivo', () => {
    expect(reactivarAcademiaSchema.safeParse({}).success).toBe(true);
  });
});

describe('criterio 88: longitudes por puntos de codigo en los esquemas compartidos', () => {
  it('crearAcademiaSchema acepta un nombre de 51 emojis (102 unidades UTF-16)', () => {
    const resultado = crearAcademiaSchema.safeParse({ nombre: EMOJI.repeat(51), nombreCorto: 'delfines' });

    expect(resultado.success).toBe(true);
  });

  it('crearAcademiaSchema acepta un nombre de 100 emojis (el maximo) y rechaza uno de 101', () => {
    const justo = crearAcademiaSchema.safeParse({ nombre: EMOJI.repeat(100), nombreCorto: 'delfines' });
    const demasiado = crearAcademiaSchema.safeParse({ nombre: EMOJI.repeat(101), nombreCorto: 'delfines' });

    expect(justo.success).toBe(true);
    expect(demasiado.success).toBe(false);
    expect(camposConError(demasiado)).toContain('nombre');
  });

  it('crearAcademiaSchema rechaza un nombre de 2 emojis (menos de 3 puntos de codigo)', () => {
    const resultado = crearAcademiaSchema.safeParse({ nombre: EMOJI.repeat(2), nombreCorto: 'delfines' });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('nombre');
  });

  it('crearAcademiaSchema cuenta el recorte antes de la longitud: 100 emojis con espacios en los extremos se aceptan', () => {
    const resultado = crearAcademiaSchema.safeParse({ nombre: `  ${EMOJI.repeat(100)}  `, nombreCorto: 'delfines' });

    expect(resultado.success).toBe(true);
  });

  it('suspenderAcademiaSchema acepta un motivo de 500 emojis (1000 unidades UTF-16) y rechaza uno de 501', () => {
    const justo = suspenderAcademiaSchema.safeParse({ motivo: EMOJI.repeat(500) });
    const demasiado = suspenderAcademiaSchema.safeParse({ motivo: EMOJI.repeat(501) });

    expect(justo.success).toBe(true);
    expect(demasiado.success).toBe(false);
    expect(camposConError(demasiado)).toContain('motivo');
  });

  it('reactivarAcademiaSchema acepta un motivo de 500 emojis y rechaza uno de 501', () => {
    expect(reactivarAcademiaSchema.safeParse({ motivo: EMOJI.repeat(500) }).success).toBe(true);
    const demasiado = reactivarAcademiaSchema.safeParse({ motivo: EMOJI.repeat(501) });

    expect(demasiado.success).toBe(false);
    expect(camposConError(demasiado)).toContain('motivo');
  });

  it('iniciarSesionPlataformaSchema acepta una clave de 128 emojis (256 unidades UTF-16)', () => {
    const resultado = iniciarSesionPlataformaSchema.safeParse({
      correo: 'dueno@aquagestion.test',
      clave: EMOJI.repeat(128),
    });

    expect(resultado.success).toBe(true);
  });

  it('iniciarSesionPlataformaSchema rechaza una clave de 129 emojis, nombrando el campo', () => {
    const resultado = iniciarSesionPlataformaSchema.safeParse({
      correo: 'dueno@aquagestion.test',
      clave: EMOJI.repeat(129),
    });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('clave');
  });

  it('iniciarSesionPlataformaSchema acepta una clave de un solo emoji (el minimo es 1 punto de codigo)', () => {
    const resultado = iniciarSesionPlataformaSchema.safeParse({ correo: 'dueno@aquagestion.test', clave: EMOJI });

    expect(resultado.success).toBe(true);
  });

  it('iniciarSesionPlataformaSchema acepta un correo de 254 caracteres y rechaza uno de 255', () => {
    const dominio = '@aquagestion.test';
    const correoDe = (largo: number) => `${'a'.repeat(largo - dominio.length)}${dominio}`;

    expect(iniciarSesionPlataformaSchema.safeParse({ correo: correoDe(254), clave: 'x' }).success).toBe(true);
    const demasiado = iniciarSesionPlataformaSchema.safeParse({ correo: correoDe(255), clave: 'x' });
    expect(demasiado.success).toBe(false);
    expect(camposConError(demasiado)).toContain('correo');
  });
});
