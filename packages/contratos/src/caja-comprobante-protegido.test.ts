// spec: 006-caja (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { registrarEgresoSchema } from './caja';

// Criterio 47 (crítico, HU-26, DR-3, RN-22; ronda adversarial 1), en su parte de contrato: el `comprobante` de `registrarEgresoSchema`
// se trata en este orden:
//   a) recorte, igual que la descripción (el `trim` de `textoVisibleSchema`, que también quita U+2028 y U+2029 de los bordes);
//   b) rechazo (400 en el campo `comprobante`): controles o sustitutos sueltos, más de 60 caracteres, o los caracteres que rechaza la descripción
//      (`BIDI_O_SEPARADORES`: de dirección del texto, U+061C, U+200E, U+200F, U+202A a U+202E, U+2066 a U+2069, y los separadores U+2028 y U+2029).
//      El rechazo va antes que la normalización de c: U+202E solo se rechaza;
//   c) sin ningún carácter visible según `contarVisibles` (los `Default_Ignorable_Code_Point`, U+2800 y las marcas combinantes no cuentan) es
//      como vacío y se guarda `null`; con al menos uno visible se guarda el texto recortado tal como llega, invisibles incluidos, sin mínimo de
//      visibles (`"1"` es válido).
// Los caracteres invisibles se escriben siempre con escapes `\uXXXX`: como literales no se verían en el código.

const CLAVE = '6f1c6d3e-3b52-4d4b-9a40-0a7a3d6c9f11';
const base = { claveIdempotencia: CLAVE, descripcion: 'Compra de útiles', monto: '15.5' };

/** Los caracteres de dirección del texto que rechaza la descripción (`\p{Bidi_Control}`), uno por uno. */
const BIDI: readonly (readonly [string, string])[] = [
  ['U+061C', '\u061C'],
  ['U+200E', '\u200E'],
  ['U+200F', '\u200F'],
  ['U+202A', '\u202A'],
  ['U+202B', '\u202B'],
  ['U+202C', '\u202C'],
  ['U+202D', '\u202D'],
  ['U+202E', '\u202E'],
  ['U+2066', '\u2066'],
  ['U+2067', '\u2067'],
  ['U+2068', '\u2068'],
  ['U+2069', '\u2069'],
];

function camposConError(resultado: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return (resultado.error?.issues ?? []).map((issue) => issue.path.map(String).join('.'));
}

function analizar(comprobante: unknown) {
  return registrarEgresoSchema.safeParse({ ...base, comprobante });
}

describe('criterio 47 b: el comprobante rechaza lo mismo que la descripción', () => {
  it.each([
    ['U+202E en medio', 'B001\u202E321'],
    ['U+202E al inicio', '\u202EB001'],
    ['U+2066 y U+2069 alrededor', '\u2066B001\u2069'],
    ['U+200F al final de un texto visible', 'B001\u200F'],
    ['U+2028 en medio', 'B001\u2028123'],
    ['U+2029 en medio', 'B001\u2029123'],
    ['U+202E solo (el rechazo va antes que la normalización a null)', '\u202E'],
    ['U+2067 solo', '\u2067'],
    ['U+200E solo, con espacios alrededor', ' \u200E '],
    ['U+2028 en medio de dos números con espacios alrededor', '  1\u20282  '],
  ])('rechaza el comprobante %s en el campo comprobante', (_nombre, comprobante) => {
    const resultado = analizar(comprobante);

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('comprobante');
  });

  it.each(BIDI)('rechaza el carácter de dirección %s dentro de un comprobante visible', (_nombre, caracter) => {
    const resultado = analizar(`B001${caracter}321`);

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('comprobante');
  });

  it.each(BIDI)('rechaza el carácter de dirección %s solo, sin normalizarlo a null', (_nombre, caracter) => {
    const resultado = analizar(caracter);

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('comprobante');
  });

  it.each([
    ['más de 60 caracteres', 'a'.repeat(61)],
    ['con un tabulador en medio', 'B001\t123'],
    ['con un salto de línea en medio', 'B001\n123'],
    ['con un carácter nulo', 'B001\u0000123'],
    ['con un sustituto UTF-16 suelto', 'B001\uD800'],
  ])('sigue rechazando el comprobante %s', (_nombre, comprobante) => {
    const resultado = analizar(comprobante);

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('comprobante');
  });
});

describe('criterio 47 a: el recorte quita también U+2028 y U+2029 de los bordes', () => {
  it.each([
    ['U+2028 solo', '\u2028', null],
    ['U+2029 solo', '\u2029', null],
    ['texto y U+2028 al final', 'B001\u2028', 'B001'],
    ['U+2029 al inicio y al final', '\u2029B001\u2029', 'B001'],
    ['espacios y U+2028 alrededor', ' \u2028 B001 \u2028 ', 'B001'],
  ])('%s: se guarda como el texto recortado o null', (_nombre, comprobante, esperado) => {
    const resultado = analizar(comprobante);

    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.comprobante).toBe(esperado);
  });
});

describe('criterio 47 c: sin nada visible es como vacío (null)', () => {
  it.each([
    ['U+200B (espacio de ancho cero)', '\u200B'],
    ['U+3164 (relleno hangul, se ve en blanco)', '\u3164'],
    ['U+2800 (patrón Braille en blanco)', '\u2800'],
    ['U+00AD (guion blando)', '\u00AD'],
    ['U+0301 (marca combinante sola)', '\u0301'],
    ['U+200B y U+3164 con un espacio antes y otro después', ' \u200B\u3164 '],
    ['varios invisibles distintos', '\u200B\u2800\u00AD\u0301\u3164'],
    ['U+FFA0 (hangul de ancho medio)', '\uFFA0'],
  ])('%s se guarda null', (_nombre, comprobante) => {
    const resultado = analizar(comprobante);

    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.comprobante).toBeNull();
  });

  it.each([undefined, null, '', '   '])(
    'el comprobante %j sigue guardándose null (criterio 18, DR-3)',
    (comprobante) => {
      const resultado = analizar(comprobante);

      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data.comprobante).toBeNull();
    },
  );

  it('la clave ausente se guarda null', () => {
    const resultado = registrarEgresoSchema.safeParse(base);

    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.comprobante).toBeNull();
  });
});

describe('criterio 47 c: con algo visible se guarda el texto recortado tal como llega', () => {
  it.each([
    ['con un invisible en medio', 'B\u200B1', 'B\u200B1'],
    ['con invisibles alrededor de lo visible', '\u200BB001\u3164', '\u200BB001\u3164'],
    ['de un solo carácter, sin mínimo de visibles', '1', '1'],
    ['de una sola letra con espacios alrededor', '  B  ', 'B'],
    ['con una marca combinante tras una letra', 'e\u0301', 'e\u0301'],
    ['normal', 'Boleta B001-123', 'Boleta B001-123'],
  ])('el comprobante %s se guarda tal como llega, recortado', (_nombre, comprobante, esperado) => {
    const resultado = analizar(comprobante);

    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.comprobante).toBe(esperado);
  });

  it('un comprobante de exactamente 60 caracteres se acepta (límite)', () => {
    const resultado = analizar('a'.repeat(60));

    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.comprobante).toBe('a'.repeat(60));
  });
});

describe('criterio 47 y 48 a: la descripción rechaza lo mismo, con las mismas reglas (referencia de la interfaz)', () => {
  it.each([
    ['vacía', ''],
    ['solo espacios', '  '],
    ['de 2 caracteres', 'ab'],
    ['de 201 caracteres', 'a'.repeat(201)],
    ['con un salto de línea en medio', 'Compra\nútiles'],
    ['con U+202E', 'Compra\u202Eútiles'],
    ['con U+2028 en medio', 'Compra\u2028útiles'],
    ['con tres U+200B (nada visible)', '\u200B\u200B\u200B'],
  ])('rechaza la descripción %s', (_nombre, descripcion) => {
    const resultado = registrarEgresoSchema.safeParse({ ...base, descripcion });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('descripcion');
  });
});
