// Comprobación previa del paso protegido del lint (spec 001, criterios 111 y 118, precisión P-28). Solo módulos de Node.
//
// ESLint resuelve las rutas de las importaciones de forma léxica, y un enlace simbólico (o una unión de Windows) dentro del
// código revisado podría hacer que una ruta que parece inocente lleve a otra carpeta. Por eso `npm run lint:protegido` rechaza,
// antes de ESLint, todo enlace dentro de `backend/src/` y de `packages/contratos/src/`. También rechaza lo que no sea el cliente
// generado (`backend/src/generated/prisma/`) dentro de `backend/src/generated/`, que las reglas no revisan.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Rutas de los enlaces simbólicos (y uniones de Windows, que `lstat` informa como enlaces) bajo cada raíz. Recorre con `lstat`,
 * sin seguir ningún enlace: un enlace a una carpeta cuenta como uno solo, sin entrar en ella. Una raíz que no existe no es un
 * error. Una raíz que es en sí un enlace también se informa.
 */
export function enlacesSimbolicos(raices) {
  const encontrados = [];
  const recorrer = (ruta) => {
    let datos;
    try {
      datos = fs.lstatSync(ruta);
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
    if (datos.isSymbolicLink()) {
      encontrados.push(ruta);
      return;
    }
    if (!datos.isDirectory()) return;
    for (const nombre of fs.readdirSync(ruta).sort()) recorrer(path.join(ruta, nombre));
  };
  for (const raiz of raices) recorrer(raiz);
  return encontrados;
}

/**
 * Entradas de `carpeta` (`backend/src/generated/`) que no son la carpeta `prisma`: un archivo suelto, otra carpeta, un archivo o
 * un enlace llamado `prisma`. Una carpeta que no existe (todavía no corrió `prisma generate`) da una lista vacía.
 */
export function entradasAjenasEnGenerated(carpeta) {
  let nombres;
  try {
    nombres = fs.readdirSync(carpeta);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return [];
    throw error;
  }
  return nombres
    .sort()
    .filter((nombre) => nombre !== 'prisma' || !fs.lstatSync(path.join(carpeta, nombre)).isDirectory())
    .map((nombre) => path.join(carpeta, nombre));
}
