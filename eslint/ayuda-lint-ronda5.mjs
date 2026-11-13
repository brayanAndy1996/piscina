// spec: 001-academias-aislamiento (pruebas protegidas)
// Ayuda comun de las pruebas de lint de la ronda 5 del ataque (criterios 128 y 129). No es una prueba: la importan los archivos
// `*.test.mjs` de esta carpeta. Reutiliza la ayuda de la ronda 4.
//
// (ajustado por el criterio 128, decision del orquestador tras la ronda 5) El criterio 128 rechaza en todo backend/src/ (tambien en
// infraestructura/prisma/ y en cli/) un paquete que no esta declarado en backend/package.json. Los ejemplos protegidos de las
// rondas 1 a 4 que comprueban que infraestructura/prisma/ y cli/ estan exentos de SU regla (pg-pool, @prisma/adapter-neon,
// sql-template-tag...) siguen comprobando lo mismo, pero en un repositorio temporal cuyo `backend/package.json` declara esos
// paquetes (ademas de los del real): asi el criterio 128 no interviene y solo se prueba la regla original.
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll } from 'vitest';
import { borrarCarpeta, carpetaTemporal, erroresEn, escribir, eslintProtegidoEn, raiz } from './ayuda-lint-ronda4.mjs';

export * from './ayuda-lint-ronda4.mjs';

const SECCIONES = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function paquetesDelBackendReal() {
  const paquete = JSON.parse(fs.readFileSync(path.join(raiz, 'backend', 'package.json'), 'utf8'));
  return new Set(SECCIONES.flatMap((seccion) => Object.keys(paquete[seccion] ?? {})));
}

const nombreDe = (especificador) => {
  const partes = especificador.split('/');
  return especificador.startsWith('@') ? partes.slice(0, 2).join('/') : partes[0];
};

/** Nombres de los paquetes que el codigo importa por cualquier via (cadena literal) y que ni son de Node ni son relativos. */
export function paquetesImportados(codigo) {
  const encontrados = new Set();
  const patron = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"`]([^'"`$\\]+)['"`]/g;
  for (const [, especificador] of codigo.matchAll(patron)) {
    if (/^(\.|\/|[A-Za-z]:|file:|node:|#|~|@\/)/.test(especificador)) continue;
    if (builtinModules.includes(especificador) || builtinModules.includes(especificador.split('/')[0])) continue;
    encontrados.add(nombreDe(especificador));
  }
  return [...encontrados];
}

const repositorios = new Map();
const creados = [];
afterAll(() => {
  for (const carpeta of creados.splice(0)) borrarCarpeta(carpeta);
  repositorios.clear();
});

function repositorioQueDeclara(extras) {
  const clave = [...extras].sort().join('|');
  let repositorio = repositorios.get(clave);
  if (!repositorio) {
    const carpeta = carpetaTemporal('aqua-declarados-');
    creados.push(carpeta);
    const dependencias = Object.fromEntries([...paquetesDelBackendReal(), ...extras].map((nombre) => [nombre, '*']));
    escribir(
      carpeta,
      'backend/package.json',
      `${JSON.stringify({ name: '@aquagestion/backend', dependencies: dependencias })}\n`,
    );
    repositorio = { carpeta, eslint: eslintProtegidoEn(carpeta) };
    repositorios.set(clave, repositorio);
  }
  return repositorio;
}

/**
 * Mensajes de ESLint (sin los incidentales) del codigo en `archivo` para un archivo EXENTO de una regla de acceso (infraestructura/
 * prisma/ o cli/). Si el codigo solo importa paquetes declarados en el backend/package.json real (o de Node), usa `conRealidad()`, el
 * lint de siempre. Si importa alguno no declarado, lo revisa con la configuracion del paso protegido en un repositorio temporal cuyo
 * `backend/package.json` declara tambien esos paquetes.
 */
export async function erroresDeclarandoLoImportado(codigo, archivo, conRealidad) {
  const reales = paquetesDelBackendReal();
  const extras = paquetesImportados(codigo).filter((nombre) => !reales.has(nombre));
  if (extras.length === 0) return conRealidad();
  const { carpeta, eslint } = repositorioQueDeclara(extras);
  return erroresEn(eslint, carpeta, codigo, archivo);
}

/**
 * ESLint con la configuracion principal (`eslint.config.mjs` de la raiz del repositorio, sin informacion de tipos) y `cwd` en una
 * carpeta temporal: sirve para probar una regla con la configuracion principal sin depender del `backend/package.json` real.
 */
export function eslintPrincipalEn(cwd) {
  return new ESLint({
    cwd,
    overrideConfigFile: path.join(raiz, 'eslint.config.mjs'),
    overrideConfig: [tseslint.configs.disableTypeChecked],
  });
}
