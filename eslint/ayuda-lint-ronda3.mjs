// spec: 001-academias-aislamiento (pruebas protegidas)
// Ayuda comun de las pruebas de lint de la ronda 3 del ataque (criterios 92 a 97). No es una prueba: la importan los
// archivos `*.test.mjs` de esta carpeta.
//
// Dos formas de ejecutar el lint, como `npm run lint` (criterio 96):
//   - la configuracion principal (`eslint.config.mjs`), en la que un comentario `eslint-disable` vuelve a funcionar;
//   - el paso protegido (`eslint.protegido.config.mjs` con `allowInlineConfig: false`, que equivale a `--no-inline-config`),
//     que ningun comentario puede apagar.
// Los archivos de los ejemplos no estan en disco, asi que la configuracion principal se usa sin informacion de tipos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { expect } from 'vitest';

export const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MODULO = 'backend/src/modulos/ejemplo/ejemplo.service.ts';
export const PRISMA = 'backend/src/infraestructura/prisma/base-datos.ts';
export const CLI = 'backend/src/cli/superadmin.ts';

export const RUTA_CONFIG_PROTEGIDA = path.join(raiz, 'eslint.protegido.config.mjs');

/**
 * Reglas que un ejemplo puede incumplir de rebote (una variable sin usar, el `require` que ya prohibe la configuracion de
 * TypeScript): no cuentan como el rechazo que se esta probando.
 */
export const REGLAS_INCIDENTALES = new Set([
  'no-unused-vars',
  '@typescript-eslint/no-unused-vars',
  '@typescript-eslint/no-require-imports',
  '@typescript-eslint/no-var-requires',
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-unused-expressions',
  'no-unused-expressions',
  'no-undef',
  'no-useless-assignment',
  'prefer-const',
]);

let principal;
let protegido;

/** ESLint con `eslint.config.mjs` (sin informacion de tipos). */
export function obtenerEslintPrincipal() {
  principal ??= new ESLint({ cwd: raiz, overrideConfig: [tseslint.configs.disableTypeChecked] });
  return principal;
}

/** ESLint con la configuracion del paso protegido y los comentarios de configuracion en linea desactivados. */
export function obtenerEslintProtegido() {
  if (!fs.existsSync(RUTA_CONFIG_PROTEGIDA)) {
    throw new Error(
      'Falta la funcionalidad de la 001 (criterio 96): no existe eslint.protegido.config.mjs en la raiz del repositorio.',
    );
  }
  protegido ??= new ESLint({ cwd: raiz, overrideConfigFile: RUTA_CONFIG_PROTEGIDA, allowInlineConfig: false });
  return protegido;
}

/** Las dos formas de ejecutar el lint: `[nombre, obtener]`, para `describe.each`. */
export const CONFIGURACIONES = [
  ['eslint.config.mjs', obtenerEslintPrincipal],
  ['paso protegido (eslint.protegido.config.mjs, sin comentarios en linea)', obtenerEslintProtegido],
];

/** Mensajes de ESLint (severidad 2, no incidentales) que produce el codigo en el archivo indicado. */
export async function errores(eslint, codigo, archivo) {
  const [resultado] = await eslint.lintText(codigo, { filePath: path.join(raiz, archivo) });
  const fatales = resultado.messages.filter((mensaje) => mensaje.fatal);
  expect(fatales, `error al analizar ${archivo}: ${codigo}`).toEqual([]);
  return resultado.messages.filter(
    (mensaje) => mensaje.severity === 2 && !(mensaje.ruleId && REGLAS_INCIDENTALES.has(mensaje.ruleId)),
  );
}

/**
 * El ejemplo es rechazado en el archivo indicado y esta limpio en `backend/src/infraestructura/prisma/` (asi se sabe que el
 * error es de la regla que se prueba y no de otra cosa del ejemplo).
 */
export async function esRechazadoFueraDePrisma(eslint, codigo, archivos = [MODULO, CLI]) {
  expect(await errores(eslint, codigo, PRISMA), `en prisma/ el ejemplo no debia fallar: ${codigo}`).toEqual([]);
  for (const archivo of archivos) {
    const encontrados = await errores(eslint, codigo, archivo);
    expect(encontrados.length, `el lint no rechazo en ${archivo}: ${codigo}`).toBeGreaterThan(0);
  }
}

/** No produce ningun error (salvo los incidentales) en el archivo indicado. */
export async function pasaElLint(eslint, codigo, archivos = [MODULO, CLI]) {
  for (const archivo of archivos) {
    expect(await errores(eslint, codigo, archivo), `el lint rechazo en ${archivo}: ${codigo}`).toEqual([]);
  }
}

/** Texto de un SQL como plantilla etiquetada con `$queryRaw` (la forma que el lint analiza). */
export const comoQueryRaw = (sql) => `export const leer = (cliente) => cliente.$queryRaw\`${sql}\`;`;
