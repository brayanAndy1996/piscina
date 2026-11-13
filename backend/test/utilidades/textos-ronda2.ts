// spec: 001-academias-aislamiento (pruebas protegidas)

/**
 * Casos de texto de los criterios 87 y 88 (ataque ronda 2), compartidos por las pruebas de la API, del comando del
 * superadmin y de la semilla. Todos los valores son inventados. Los caracteres que se ven en blanco se escriben con
 * escapes: en el codigo fuente serian invisibles.
 */

/** Un emoji: 1 punto de codigo y 2 unidades UTF-16. */
export const EMOJI = '😀';

/** `n` emojis. */
export function emojis(n: number): string {
  return EMOJI.repeat(n);
}

/**
 * Textos que se rechazan por no tener 3 caracteres visibles una vez que no cuentan los caracteres con la propiedad
 * `\p{Default_Ignorable_Code_Point}` ni U+2800. Son los ejemplos de la spec (criterio 87).
 */
export const EN_BLANCO_DE_LA_SPEC: readonly (readonly [string, string])[] = [
  ['tres U+3164', 'ㅤㅤㅤ'],
  ['tres U+2800', '⠀⠀⠀'],
  ['tres U+FFA0', 'ﾠﾠﾠ'],
  ['U+115F, U+1160 y U+115F', 'ᅟᅠᅟ'],
  ['U+17B4, U+17B5 y U+17B4', '឴឵឴'],
  ['tres U+180E', '᠎᠎᠎'],
  ['dos letras y un U+3164 (2 visibles)', 'abㅤ'],
];

/** Otros textos que se ven en blanco o casi (para la API, donde cada caso es rapido). */
export const EN_BLANCO_EXTRA: readonly (readonly [string, string])[] = [
  ['dos letras y un U+2800', 'ab⠀'],
  ['dos letras y varios U+3164', 'abㅤㅤㅤㅤ'],
  ['una letra y cuatro U+FFA0', 'aﾠﾠﾠﾠ'],
  ['letras separadas por U+3164 (2 visibles)', 'aㅤㅤb'],
];

/** Nombres que se siguen aceptando (spec, criterio 87). */
export const NOMBRES_QUE_SE_ACEPTAN: readonly string[] = ['Academia Ñandú', 'Club 3', '수영 아카데미'];
