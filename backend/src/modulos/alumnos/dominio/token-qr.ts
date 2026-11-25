import { randomBytes } from 'node:crypto';

/**
 * Token del QR del carnet (spec 008a, criterio 3, DT-1 a DT-3): 32 bytes al azar de `node:crypto` en base64url sin relleno, 43 caracteres de
 * `[A-Za-z0-9_-]`. No se deriva del DNI, del id ni de ningún dato de la persona.
 */
export function nuevoTokenQr(): string {
  return randomBytes(32).toString('base64url');
}
