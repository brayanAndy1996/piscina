// ¿Este módulo es el que Node lanzó como punto de entrada? (spec 001, criterio 171, P-44). Solo módulos de Node.
//
// Node resuelve el punto de entrada con su ruta real (siguiendo enlaces simbólicos y uniones de Windows), mientras que
// `process.argv[1]` conserva la ruta tal como se escribió. Por eso se comparan las rutas reales de los dos, y en Windows
// sin distinguir mayúsculas. Los scripts del proyecto y la copia del hook de sesión usan esta regla.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Igualdad de dos rutas ya resueltas: en 'win32', sin distinguir mayúsculas; en las demás, exacta. */
export function rutasIguales(a, b, plataforma = process.platform) {
  return plataforma === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * ¿El módulo de `urlDelModulo` es el punto de entrada del proceso? Compara las rutas reales de `path.resolve(argv1)` y de
 * `fileURLToPath(urlDelModulo)` con `rutasIguales`. Devuelve `false` si `argv1` no es una cadena no vacía, si `urlDelModulo`
 * no es una URL `file:` o si resolver alguna ruta lanza. Nunca lanza.
 */
export function esPuntoDeEntrada(
  urlDelModulo,
  argv1 = process.argv[1],
  { plataforma = process.platform, realpath = fs.realpathSync } = {},
) {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try {
    const delModulo = realpath(fileURLToPath(urlDelModulo));
    const delArgumento = realpath(path.resolve(argv1));
    return rutasIguales(delModulo, delArgumento, plataforma);
  } catch {
    return false;
  }
}
