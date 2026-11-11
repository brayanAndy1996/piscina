// spec: 001-academias-aislamiento (pruebas protegidas)
// Ayuda comun de las pruebas de lint de la ronda 4 del ataque (criterios 109 a 119). No es una prueba: la importan los archivos
// `*.test.mjs` de esta carpeta. Reutiliza la ayuda de la ronda 3 y agrega lo necesario para probar con carpetas temporales
// (criterio 111) y para ejecutar el lint con una raiz distinta del repositorio.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import { expect } from 'vitest';
import { REGLAS_INCIDENTALES, RUTA_CONFIG_PROTEGIDA } from './ayuda-lint-ronda3.mjs';

export * from './ayuda-lint-ronda3.mjs';

/** El punto autorizado (criterio 114), tal como se importa desde un modulo de backend/src/modulos/ejemplo/. */
export const PUNTO = '../../infraestructura/prisma';
/** El mismo punto, tal como se importa desde backend/src/cli/. */
export const PUNTO_DESDE_CLI = '../infraestructura/prisma';

/** Un archivo de cada tipo, con la extension indicada. */
export const enModulos = (ext = 'ts') => `backend/src/modulos/ejemplo/ejemplo.service.${ext}`;
export const enPrisma = (ext = 'ts') => `backend/src/infraestructura/prisma/base-datos.${ext}`;
export const enCli = (ext = 'ts') => `backend/src/cli/superadmin.${ext}`;
export const enEntorno = (ext = 'ts') => `backend/src/infraestructura/entorno/entorno.module.${ext}`;
export const PRINCIPAL = 'backend/src/main.ts';

/** ESLint con la configuracion del paso protegido, sin comentarios en linea, y `cwd` en la carpeta indicada. */
export function eslintProtegidoEn(cwd) {
  return new ESLint({ cwd, overrideConfigFile: RUTA_CONFIG_PROTEGIDA, allowInlineConfig: false });
}

/** Mensajes de severidad 2 (sin los incidentales) del codigo en la ruta absoluta o relativa a `cwd`, con un ESLint dado. */
export async function erroresEn(eslint, cwd, codigo, archivo) {
  const [resultado] = await eslint.lintText(codigo, { filePath: path.resolve(cwd, archivo) });
  const fatales = resultado.messages.filter((mensaje) => mensaje.fatal);
  expect(fatales, `error al analizar ${archivo}: ${codigo}`).toEqual([]);
  return resultado.messages.filter(
    (mensaje) => mensaje.severity === 2 && !(mensaje.ruleId && REGLAS_INCIDENTALES.has(mensaje.ruleId)),
  );
}

/** Crea una carpeta temporal y devuelve su ruta real (sin enlaces en el camino). */
export function carpetaTemporal(prefijo = 'aqua-lint-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefijo)));
}

export function borrarCarpeta(carpeta) {
  fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Escribe un archivo (con sus carpetas) bajo `raiz`. */
export function escribir(raiz, relativa, contenido = '') {
  const ruta = path.join(raiz, ...relativa.split('/'));
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, contenido);
  return ruta;
}

/**
 * Crea un enlace simbolico (`tipo` 'carpeta' o 'archivo'). Devuelve `true` si se pudo y `false` si el sistema no lo permite
 * (Windows sin modo de desarrollador: `EPERM`); cualquier otro error se propaga.
 */
export function crearEnlace(destino, ruta, tipo) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  try {
    // En Windows, un enlace a una carpeta se crea como union (`junction`), que no exige privilegios.
    fs.symlinkSync(destino, ruta, tipo === 'carpeta' ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file');
    return true;
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOSYS')) return false;
    throw error;
  }
}

/** Si el sistema deja crear enlaces simbolicos a archivos y carpetas (se prueba una vez). */
let enlacesPosibles;
export function sePuedenCrearEnlaces() {
  if (enlacesPosibles !== undefined) return enlacesPosibles;
  const carpeta = carpetaTemporal('aqua-sonda-enlaces-');
  try {
    escribir(carpeta, 'destino/x.txt', 'x');
    const carpetaOk = crearEnlace(path.join(carpeta, 'destino'), path.join(carpeta, 'enlace-carpeta'), 'carpeta');
    const archivoOk = crearEnlace(
      path.join(carpeta, 'destino', 'x.txt'),
      path.join(carpeta, 'enlace-archivo'),
      'archivo',
    );
    enlacesPosibles = carpetaOk && archivoOk;
  } finally {
    borrarCarpeta(carpeta);
  }
  if (!enlacesPosibles) {
    console.warn('[criterio 111] AVISO: el sistema no permite crear enlaces simbolicos (EPERM); esos casos se omiten.');
  }
  return enlacesPosibles;
}
