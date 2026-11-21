import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ALFABETO_CROCKFORD, LARGO_CODIGO } from '@aquagestion/contratos';

/**
 * Código y token de una solicitud (spec 005, criterio 24; D-05, D-07). Los dos salen de un generador criptográfico (`node:crypto`), nunca
 * de `Math.random` ni de un contador. Del token solo se guarda su SHA-256: un respaldo de la base filtrado no abre ningún enlace.
 */

/** `AQ-` y 6 caracteres del alfabeto de Crockford en mayúsculas (sin I, L, O ni U), por ejemplo `AQ-7F3K9X`. */
export function nuevoCodigo(): string {
  let sufijo = '';
  for (let i = 0; i < LARGO_CODIGO; i++) sufijo += ALFABETO_CROCKFORD.charAt(randomInt(ALFABETO_CROCKFORD.length));
  return `AQ-${sufijo}`;
}

/** 32 bytes criptográficos en base64url sin relleno (43 caracteres). Aparece solo en la respuesta 201 y en el correo. */
export function nuevoToken(): string {
  return randomBytes(32).toString('base64url');
}

/** El SHA-256 del token (32 bytes) en hexadecimal: lo único que se guarda y con lo que se busca. */
export function hashDeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
