// Dependencias del backend (spec 001, criterios 127 a 129, precisión P-30). Solo módulos de Node: lo importan el paso protegido del
// lint (`scripts/comprobar-fuentes-protegidas.mjs`) y las reglas de ESLint de `eslint/`.
//
// - Criterio 127: `backend/package.json` solo puede declarar los paquetes de `DEPENDENCIAS_BACKEND_PERMITIDAS`. Agregar una
//   dependencia al backend exige agregarla aquí en el mismo cambio, donde la ve la revisión.
// - Criterio 128: `backend/src/` solo importa valores de módulos de Node o de paquetes declarados en `backend/package.json`
//   (`nombreDePaquete` da el nombre del paquete de un especificador).
// - Criterio 129: lista negra de clientes de base de datos (`CLIENTES_DE_BASE_PROHIBIDOS`), segunda capa sobre el 128.
import fs from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';

/**
 * Paquetes que `backend/package.json` puede declarar (en cualquier sección). Las dependencias de hoy más `express`, que el
 * backend importa y hasta la ronda 5 llegaba solo como dependencia de `@nestjs/platform-express` (criterio 128). Ningún paquete
 * de la lista negra (criterio 129) puede estar aquí.
 */
export const DEPENDENCIAS_BACKEND_PERMITIDAS = Object.freeze([
  // dependencies
  '@aquagestion/contratos',
  '@nestjs/common',
  '@nestjs/core',
  '@nestjs/platform-express',
  '@nestjs/throttler',
  '@node-rs/argon2',
  '@prisma/adapter-pg',
  '@prisma/client',
  'dotenv',
  'express',
  'helmet',
  'jsonwebtoken',
  'nestjs-pino',
  'pg',
  'pino',
  'pino-http',
  'reflect-metadata',
  'rxjs',
  'zod',
  // devDependencies
  '@nestjs/cli',
  '@nestjs/testing',
  '@types/express',
  '@types/jsonwebtoken',
  '@types/pg',
  '@types/supertest',
  'pino-pretty',
  'prisma',
  'supertest',
  'tsx',
]);

/** Las seis secciones de `package.json` que declaran paquetes. */
export const SECCIONES_DE_DEPENDENCIAS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundleDependencies',
  'bundledDependencies',
]);

/** Las secciones que son un arreglo de nombres (el resto son objetos nombre → versión). */
const SECCIONES_CON_ARREGLO = new Set(['bundleDependencies', 'bundledDependencies']);

/** Nombres de los paquetes que declara un `package.json` ya leído, en todas las secciones. */
function paquetesDeclarados(paquete) {
  const nombres = [];
  if (paquete === null || typeof paquete !== 'object') return nombres;
  for (const seccion of SECCIONES_DE_DEPENDENCIAS) {
    const valor = paquete[seccion];
    if (SECCIONES_CON_ARREGLO.has(seccion)) {
      if (Array.isArray(valor)) nombres.push(...valor.filter((nombre) => typeof nombre === 'string'));
    } else if (valor !== null && typeof valor === 'object' && !Array.isArray(valor)) {
      nombres.push(...Object.keys(valor));
    }
  }
  return nombres;
}

/**
 * Los nombres que `paquete` (el contenido de un `package.json`) declara y que no están en `permitidas`, sin repetidos y en el
 * orden en que aparecen. Sin la lista, usa `DEPENDENCIAS_BACKEND_PERMITIDAS`.
 */
export function dependenciasNoPermitidas(paquete, permitidas = DEPENDENCIAS_BACKEND_PERMITIDAS) {
  const lista = new Set(permitidas);
  return [...new Set(paquetesDeclarados(paquete))].filter((nombre) => !lista.has(nombre));
}

/** Texto del archivo de la lista, para los mensajes. */
const ARCHIVO_DE_LA_LISTA = 'scripts/lib/dependencias-backend.mjs';

/**
 * Problemas de las dependencias del backend: lee `<raiz>/backend/package.json` y devuelve un texto por cada paquete que no está
 * en la lista permitida (nombrando el paquete y el archivo de la lista). Falla cerrada: si el archivo falta, no se puede leer o
 * no es JSON, devuelve un problema que lo dice. Lista vacía: cumple.
 */
export function problemasDeDependencias(raiz) {
  const archivo = path.join(raiz, 'backend', 'package.json');
  let paquete;
  try {
    paquete = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    return [`No se pudo leer ni analizar backend/package.json (${motivo}); sin él no se comprueban las dependencias.`];
  }
  if (paquete === null || typeof paquete !== 'object' || Array.isArray(paquete)) {
    return ['backend/package.json no contiene un objeto JSON; sin él no se comprueban las dependencias.'];
  }
  return dependenciasNoPermitidas(paquete).map(
    (nombre) =>
      `Dependencia del backend no permitida: ${nombre}. Si es necesaria, agrégala a DEPENDENCIAS_BACKEND_PERMITIDAS en ` +
      `${ARCHIVO_DE_LA_LISTA} en el mismo cambio, con su justificación en la especificación.`,
  );
}

/**
 * Nombre del paquete de un especificador de importación: `@ámbito/nombre` o `nombre`, sin la subruta. `null` si el especificador
 * es relativo, absoluto (ruta de POSIX o de Windows), una URL `file:` o un módulo de Node (`node:…` o un nombre de
 * `module.builtinModules`). Los alias (`#interno`) se devuelven tal cual: no son módulos de Node ni paquetes declarados.
 */
export function nombreDePaquete(especificador) {
  if (typeof especificador !== 'string' || especificador === '') return null;
  if (especificador === '.' || especificador === '..') return null;
  if (/^\.{1,2}[\\/]/.test(especificador)) return null;
  if (/^[\\/]/.test(especificador) || /^[A-Za-z]:[\\/]/.test(especificador)) return null;
  if (/^file:/i.test(especificador)) return null;
  if (/^node:/i.test(especificador) || isBuiltin(especificador)) return null;
  const partes = especificador.split('/');
  if (especificador.startsWith('@') && partes.length > 1) return `${partes[0]}/${partes[1]}`;
  return partes[0];
}

/**
 * Clientes de base de datos que el backend no usa nunca (criterio 129): el único camino a la base es `BaseDatos`. Cada entrada
 * es un nombre exacto o una expresión regular que se prueba contra el nombre del paquete (sin la subruta).
 */
export const CLIENTES_DE_BASE_PROHIBIDOS = Object.freeze([
  'postgres',
  'knex',
  /^kysely(?:-.*)?$/,
  /^slonik(?:-.*)?$/,
  /^@slonik\/.+$/,
  /^@neondatabase\/.+$/,
  '@vercel/postgres',
  /^@vercel\/postgres-.*$/,
  /^mysql/,
  /^sequelize(?:-.*)?$/,
  'typeorm',
  /^@typeorm\/.+$/,
  'drizzle-orm',
  /^drizzle-.*$/,
  'pg-promise',
  'pg-native',
  /^@databases\/.+$/,
  /^@mikro-orm\/.+$/,
  '@electric-sql/pglite',
]);

/**
 * ¿Es el paquete (o el especificador, con o sin subruta) un cliente de base de la lista negra? Los relativos, absolutos y los
 * módulos de Node nunca lo son.
 */
export function esClienteDeBaseProhibido(nombreOEspecificador) {
  const nombre = nombreDePaquete(nombreOEspecificador);
  if (nombre === null) return false;
  return CLIENTES_DE_BASE_PROHIBIDOS.some((entrada) =>
    typeof entrada === 'string' ? entrada === nombre : entrada.test(nombre),
  );
}
