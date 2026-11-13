import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Contraseñas con argon2id (RNF-03, D-25) y los parámetros por defecto de `@node-rs/argon2` (19 MiB de memoria, 2
 * pasadas, 1 hilo). El hash lleva su propia sal y sus parámetros, así que se puede cambiar el costo más adelante sin
 * invalidar los hashes ya guardados.
 */
export function hashearClave(clave: string): Promise<string> {
  return hash(clave);
}

/**
 * Comprueba una clave contra su hash. Devuelve `false` si no coincide o si el hash guardado no tiene un formato
 * válido; nunca lanza por una clave equivocada.
 */
export async function verificarClave(hashGuardado: string, clave: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, clave);
  } catch {
    return false;
  }
}

let hashFicticio: Promise<string> | undefined;

/**
 * Hash de una clave aleatoria que nadie conoce, calculado una sola vez por proceso. Se verifica contra él cuando el
 * correo no existe, para que el tiempo de respuesta no delate qué correos están registrados.
 */
export function obtenerHashFicticio(): Promise<string> {
  hashFicticio ??= hashearClave(randomBytes(24).toString('base64url'));
  return hashFicticio;
}
