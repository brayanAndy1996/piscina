// spec: 001-academias-aislamiento (pruebas protegidas)

/**
 * Casos de texto de los criterios 76 y 77 (ataque ronda 1), compartidos por las pruebas de la API y del comando del
 * superadmin. Todos los valores son inventados.
 */

/** Caracteres de control (\p{Cc}) que se prueban en medio de un texto: el tabulador y los saltos de linea cuentan. */
export const CONTROLES: readonly (readonly [string, string])[] = [
  ['U+0000 (nulo)', '\u0000'],
  ['U+0001', '\u0001'],
  ['tabulador U+0009', '\t'],
  ['salto de linea U+000A', '\n'],
  ['retorno de carro U+000D', '\r'],
  ['U+001F', '\u001f'],
  ['U+007F (DEL)', '\u007f'],
  ['U+0080', '\u0080'],
  ['U+0085 (NEL)', '\u0085'],
  ['U+009F', '\u009f'],
];

/** Caracteres de control bidireccional (\p{Bidi_Control}). */
export const BIDI: readonly (readonly [string, string])[] = [
  ['U+061C', '\u061c'],
  ['U+200E', '\u200e'],
  ['U+200F', '\u200f'],
  ['U+202A', '\u202a'],
  ['U+202B', '\u202b'],
  ['U+202C', '\u202c'],
  ['U+202D', '\u202d'],
  ['U+202E', '\u202e'],
  ['U+2066', '\u2066'],
  ['U+2067', '\u2067'],
  ['U+2068', '\u2068'],
  ['U+2069', '\u2069'],
];

/** Separadores de linea y de parrafo. */
export const SEPARADORES: readonly (readonly [string, string])[] = [
  ['U+2028 (separador de linea)', '\u2028'],
  ['U+2029 (separador de parrafo)', '\u2029'],
];

/**
 * Textos que se rechazan por no tener 3 caracteres visibles (letras, numeros, puntuacion o simbolos): los espacios, los
 * caracteres de formato (\p{Cf}) y las marcas combinantes (\p{M}) no cuentan.
 */
export const POCO_VISIBLES: readonly (readonly [string, string])[] = [
  ['cuatro espacios de ancho cero (U+200B)', '\u200b'.repeat(4)],
  ['dos letras separadas por un espacio de ancho cero', 'a\u200bb'],
  ['dos letras con espacios', 'a b'],
  ['dos letras con una marca combinante en medio', 'a\u0301b'],
  ['solo marcas combinantes', '\u0301\u0301\u0301\u0301'],
  ['dos letras y caracteres de formato (U+200D)', 'ab\u200d\u200d'],
  ['tres espacios de ancho cero y una letra', '\u200b\u200b\u200ba'],
];

/** Textos validos de nombre: se guardan tal como llegan, despues del recorte. */
export const NOMBRES_VALIDOS: readonly string[] = [
  'Academia Ñandú',
  'Club 3',
  'A.1',
  'Delfines de Lima',
  'Del\u200bfines',
  '😀😀😀',
];

/** Un sustituto UTF-16 suelto (U+D800 sin su pareja) en medio de un texto. */
export const SUSTITUTO_SUELTO = '\ud800';
