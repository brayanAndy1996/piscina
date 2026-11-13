import { z } from 'zod';

/**
 * Reglas de texto compartidas por la API, la web y los comandos (spec 001, criterios 76 y 77). Se usan propiedades
 * Unicode y no una lista de caracteres permitidos, para no rechazar nombres legítimos con tildes, ñ o de otros
 * alfabetos. Las historias siguientes reutilizan estos esquemas en todo texto de entrada.
 */

/**
 * Caracteres de control (`\p{Cc}`: U+0000 a U+001F y U+007F a U+009F, con el tabulador y los saltos de línea) y
 * sustitutos UTF-16 sueltos (`\p{Cs}`; con la bandera `u`, una pareja válida es un solo carácter y no coincide).
 */
const CONTROLES_O_SUSTITUTOS = /[\p{Cc}\p{Cs}]/u;

/** Control bidireccional (U+061C, U+200E, U+200F, U+202A a U+202E, U+2066 a U+2069) y separadores U+2028 y U+2029. */
const BIDI_O_SEPARADORES = /[\p{Bidi_Control}\u2028\u2029]/u;

/** Lo que se ve: letras, números, signos de puntuación y símbolos. No cuentan espacios, formato ni marcas combinantes. */
const VISIBLES = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * Caracteres que son letras o símbolos para Unicode pero se ven en blanco (criterio 87): los de la propiedad
 * `Default_Ignorable_Code_Point` (U+115F, U+1160, U+3164, U+FFA0, U+180E, U+17B4, U+17B5, entre otros) y el patrón Braille
 * en blanco U+2800. No cuentan como visibles.
 */
const EN_BLANCO = /[\p{Default_Ignorable_Code_Point}\u2800]/u;

/** Cantidad de caracteres visibles de un texto (por puntos de código). */
export function contarVisibles(texto: string): number {
  let cuenta = 0;
  for (const caracter of texto) {
    if (VISIBLES.test(caracter) && !EN_BLANCO.test(caracter)) cuenta += 1;
  }
  return cuenta;
}

/** Cantidad mínima de caracteres visibles de un texto de `textoVisibleSchema`. */
export const VISIBLES_MINIMOS = 3;

const MENSAJE_CONTROLES = 'No puede contener caracteres de control ni caracteres no válidos.';

/** `true` si el texto trae un carácter de control o un sustituto UTF-16 suelto. */
export function tieneControles(texto: string): boolean {
  return CONTROLES_O_SUSTITUTOS.test(texto);
}

/**
 * Rechaza los textos con caracteres de control (`\p{Cc}`, incluidos el nulo, el tabulador y los saltos de línea en
 * medio del texto) o con un sustituto UTF-16 suelto. Aplíquese después del recorte que haga el campo; `clave` no se
 * recorta, así que un control en cualquier posición es error. Devuelve el mismo tipo de esquema para poder seguir
 * encadenando (`.pipe(...)`).
 */
export function sinControles<T extends z.ZodString>(esquema: T, mensaje: string = MENSAJE_CONTROLES): T {
  return esquema.refine((valor) => !tieneControles(valor), { message: mensaje });
}

/**
 * Texto de una línea para mostrar a las personas (nombres y motivos): se recorta, no admite controles ni sustitutos
 * sueltos, ni control bidireccional ni separadores de línea o de párrafo, y debe tener al menos 3 caracteres visibles
 * además de la longitud pedida (`visibles`, por defecto `VISIBLES_MINIMOS`). El valor se guarda tal como llega, después
 * del recorte. `sujeto` abre los mensajes ("El nombre", "El motivo").
 */
export function textoVisibleSchema(opciones: { sujeto: string; min: number; max: number; visibles?: number }) {
  const { sujeto, min, max, visibles = VISIBLES_MINIMOS } = opciones;
  return sinControles(
    z
      .string()
      .trim()
      .min(min, `${sujeto} debe tener al menos ${min} caracteres.`)
      .max(max, `${sujeto} debe tener como máximo ${max} caracteres.`),
    `${sujeto} no puede contener caracteres de control ni caracteres no válidos.`,
  )
    .refine((valor) => !BIDI_O_SEPARADORES.test(valor), {
      message: `${sujeto} no puede contener caracteres de dirección del texto ni separadores de línea.`,
    })
    .refine((valor) => contarVisibles(valor) >= visibles, {
      message: `${sujeto} debe tener al menos ${visibles} caracteres visibles.`,
    });
}
