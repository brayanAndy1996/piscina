// Qué archivos revisan las reglas de seguridad del backend y cuáles quedan fuera (spec 001, criterios 95, 110, 118 y 119).
// Lo comparten las reglas (`regla-acceso-base.mjs`, `regla-prisma.mjs`, `regla-sql-sesion.mjs`) y las dos configuraciones de ESLint
// (`eslint.config.mjs` y `eslint.protegido.config.mjs`), para que no puedan diferir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Todo lo que `tsx` ejecuta, incluidos los `.jsx` (criterio 119). */
export const ARCHIVOS_DE_CODIGO = ['backend/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

/**
 * Pruebas dentro de `backend/src/`: solo los nombres que terminan exactamente en `.test.<ts|mts|cts|js|mjs|cjs>` (criterio 110). Un
 * archivo como `atajo.test.util.ts`, `x.test.d.ts` o `x.test.tsx` no está exento. `backend/test/` queda fuera de `backend/src/**`.
 */
export const EXENCION_PRUEBAS = 'backend/src/**/*.test.{ts,mts,cts,js,mjs,cjs}';

/** El cliente generado por `prisma generate`: lo único bajo `backend/src/generated/` que las reglas no revisan (criterio 118). */
export const EXENCION_CLIENTE_GENERADO = 'backend/src/generated/prisma/**';

/** Extensiones que se prueban al resolver una importación sin extensión (criterio 95, más `.jsx` del criterio 119). */
export const EXTENSIONES = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Ruta con `/` como separador y, en Windows, en minúsculas (el sistema de archivos no distingue mayúsculas). */
export function comparable(ruta) {
  const posix = ruta.replaceAll('\\', '/');
  return process.platform === 'win32' ? posix.toLowerCase() : posix;
}

function realpathONulo(ruta) {
  try {
    return fs.realpathSync.native(ruta);
  } catch {
    return null;
  }
}

/**
 * Ruta real (sin enlaces simbólicos ni uniones) de `ruta` (criterio 111). Si el archivo existe, prueba la ruta tal cual, con cada
 * extensión y con `index.<extensión>` si es una carpeta. Si no existe, resuelve los enlaces de la parte que sí existe (la carpeta
 * más cercana) y deja el resto como está: la resolución léxica de siempre.
 */
export function rutaReal(ruta) {
  const absoluta = path.resolve(ruta);
  const directa = realpathONulo(absoluta);
  if (directa !== null) {
    // Una carpeta se importa por su `index`: la ruta real de la carpeta basta (todo `index.*` está dentro de ella).
    return directa;
  }
  for (const extension of EXTENSIONES) {
    const conExtension = realpathONulo(`${absoluta}${extension}`);
    if (conExtension !== null) return conExtension;
  }
  // No existe: se resuelve la carpeta existente más cercana y se le agrega lo que falta.
  let existente = path.dirname(absoluta);
  const faltante = [path.basename(absoluta)];
  while (existente !== path.dirname(existente)) {
    const real = realpathONulo(existente);
    if (real !== null) return path.join(real, ...faltante);
    faltante.unshift(path.basename(existente));
    existente = path.dirname(existente);
  }
  return absoluta;
}

/**
 * Rutas reales (comparables) a las que puede apuntar el especificador de un módulo relativo, absoluto o `file:`, resuelto respecto de
 * la carpeta del archivo que importa: la léxica y la real (si el archivo está detrás de un enlace, `tsx` y Node resuelven desde su
 * carpeta real); cada una pasa por `fs.realpathSync` si existe (criterio 111). Lista vacía si es un paquete (`pg`,
 * `@nestjs/common`…) o no se puede resolver.
 */
export function resolverEspecificador(especificador, carpetas) {
  const rutas = [];
  if (especificador.startsWith('file:')) {
    try {
      rutas.push(fileURLToPath(especificador));
    } catch {
      return [];
    }
  } else if (/^(?:\.{1,2}(?:[\\/]|$)|[\\/]|[a-zA-Z]:[\\/])/.test(especificador)) {
    for (const carpeta of carpetas) rutas.push(path.resolve(carpeta, especificador));
  } else {
    return [];
  }
  return [...new Set(rutas.map((ruta) => comparable(path.normalize(rutaReal(ruta)))))];
}

/**
 * Datos del archivo que revisa una regla: su ruta léxica y real, la raíz (`context.cwd`, real) en forma comparable y las carpetas
 * desde las que se resuelven sus importaciones relativas (la léxica y la real).
 */
export function contextoDeArchivo(context) {
  const archivoLexico = path.resolve(context.cwd, context.filename);
  const archivo = rutaReal(archivoLexico);
  return {
    archivo,
    archivoComparable: comparable(archivo),
    raiz: comparable(rutaReal(path.resolve(context.cwd))),
    carpetas: [...new Set([path.dirname(archivoLexico), path.dirname(archivo)])],
  };
}

/** ¿El destino (ya comparable) es el `index` de `infraestructura/prisma/`, el punto autorizado (criterios 85 y 114)? */
export function esElPuntoAutorizado(destino, raiz) {
  const carpeta = `${raiz}/backend/src/infraestructura/prisma`;
  const sinExtension = destino.replace(/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '');
  return sinExtension === carpeta || sinExtension === `${carpeta}/index`;
}
