// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 85 (ataque ronda 2, F3; complementa el criterio 28): fuera de backend/src/infraestructura/prisma/ y de
// backend/src/cli/, `npm run lint` falla si un archivo de backend/src/ llega a un valor de estos modulos: cualquier ruta
// que contenga `generated/prisma`, el archivo de PrismaService (`prisma.service`), `pg` (y `pg/...`), `pg-pool`,
// `@prisma/client`, `@prisma/adapter-pg` o cualquier otro `@prisma/...`; por cualquiera de estas vias: `import` de un
// valor, `export ... from`, `import(...)` dinamico (con cadena o plantilla), `require(...)` o `import x = require(...)`.
// Ademas falla con `import(...)` o `require(...)` cuyo argumento no es una cadena literal, y con `createRequire` (de
// `module` o `node:module`). `import type` e `import { type X }` siguen permitidos. Se prueba con el eslint.config.mjs real
// y sin informacion de tipos.
//
// ALCANCE EN cli/ AJUSTADO POR EL CRITERIO 113 (decision del orquestador tras la ronda 4, 11/11/2026): entre los criterios 85 y
// 113 manda el 113, mas estricto. En backend/src/cli/, el cliente generado (`generated/prisma/*`) y `@prisma/...` solo se cargan
// con una importacion estatica; `import(...)`, `require(...)`, `import x = require(...)` y el espacio de nombres usado como
// valor (`import * as Prisma ...; export const x = Prisma`) FALLAN tambien en cli/. Los casos que antes esperaban que pasaran
// en cli/ ahora esperan que fallen (helper `esRechazadoFueraDePrisma`). `pg` y `pg-pool` en cli/ no cambian: siguen pasando.
//
// ADAPTADO A LA RONDA 3 DEL ATAQUE:
//  - criterio 96 (reemplaza la frase "Un comentario eslint-disable no evita el fallo" y la precision P-15): con
//    eslint.config.mjs un comentario eslint-disable vuelve a apagar la regla que nombra; que ningun comentario evita el fallo se
//    comprueba con el paso protegido (eslint.protegido.config.mjs, sin comentarios en linea).
//  - criterio 95: desde backend/src/cli/ un import que se resuelve a un archivo interno de infraestructura/prisma/ (como
//    `../infraestructura/prisma/prisma.service`) ahora falla; los tres ejemplos de PrismaService usan una ruta con el mismo
//    nombre que, desde cli/, no se resuelve a esa carpeta. El comportamiento nuevo se prueba en regla-acceso-base-ronda3.test.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { obtenerEslintProtegido } from './ayuda-lint-ronda3.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const eslint = new ESLint({
  cwd: raiz,
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

const MODULO = 'backend/src/modulos/ejemplo/ejemplo.service.ts';
const PRISMA = 'backend/src/infraestructura/prisma/base-datos.ts';
const CLI = 'backend/src/cli/superadmin.ts';

/**
 * Reglas que el ejemplo puede incumplir de rebote (una variable sin usar, el `require` que ya prohibe la configuracion
 * de TypeScript): no cuentan como el rechazo del criterio 85, que debe venir de la regla de acceso a la base.
 */
const REGLAS_INCIDENTALES = new Set([
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

/** Errores de ESLint (severidad 2) que no son incidentales, para el codigo en el archivo indicado. */
async function erroresDeAcceso(codigo, archivo) {
  const [resultado] = await eslint.lintText(codigo, { filePath: path.join(raiz, archivo) });
  const fatales = resultado.messages.filter((mensaje) => mensaje.fatal);
  expect(fatales, `error al analizar ${archivo}: ${codigo}`).toEqual([]);
  return resultado.messages.filter(
    (mensaje) => mensaje.severity === 2 && mensaje.ruleId && !REGLAS_INCIDENTALES.has(mensaje.ruleId),
  );
}

/** Rechazado en un modulo normal y libre de errores propios en prisma/ y en cli/ (el error es de la regla, no del ejemplo). */
async function esRechazadoSoloFueraDePrismaYCli(codigo) {
  expect(await erroresDeAcceso(codigo, PRISMA), `prisma/ no debia fallar: ${codigo}`).toEqual([]);
  expect(await erroresDeAcceso(codigo, CLI), `cli/ no debia fallar: ${codigo}`).toEqual([]);
  expect((await erroresDeAcceso(codigo, MODULO)).length, `el lint no rechazo: ${codigo}`).toBeGreaterThan(0);
}

/**
 * (alcance ajustado por el criterio 113) Rechazado en un modulo normal Y en cli/, y libre de errores propios solo en
 * infraestructura/prisma/. Es el caso de las cargas dinamicas, con `require` o con espacio de nombres como valor del cliente
 * generado y de `@prisma/...`, que en cli/ solo se admiten como importacion estatica.
 */
async function esRechazadoFueraDePrisma(codigo) {
  expect(await erroresDeAcceso(codigo, PRISMA), `prisma/ no debia fallar: ${codigo}`).toEqual([]);
  expect(
    (await erroresDeAcceso(codigo, CLI)).length,
    `(criterio 113) el lint no rechazo en cli/: ${codigo}`,
  ).toBeGreaterThan(0);
  expect((await erroresDeAcceso(codigo, MODULO)).length, `el lint no rechazo: ${codigo}`).toBeGreaterThan(0);
}

/** Lo que el criterio 113 restringe en cli/: el cliente generado y `@prisma/...`. `pg`, `pg-pool` y PrismaService no. */
const ALCANCE_113 = /generated\/prisma|@prisma\//;

/** Segun el modulo que se carga: cliente generado o `@prisma/...` falla tambien en cli/ (113); el resto, como antes. */
function esRechazadoSegunElAlcance(codigo) {
  return ALCANCE_113.test(codigo) ? esRechazadoFueraDePrisma(codigo) : esRechazadoSoloFueraDePrismaYCli(codigo);
}

/** Modulos prohibidos: [descripcion, texto de la ruta]. */
const MODULOS_PROHIBIDOS = [
  ['el cliente generado de Prisma', '../generated/prisma/client'],
  ['un archivo del cliente generado', '../../generated/prisma/enums'],
  ['una ruta que contiene generated/prisma', '../../src/generated/prisma'],
  // (criterio 95) Antes: '../infraestructura/prisma/prisma.service', que desde cli/ ahora se resuelve a un interno de
  // infraestructura/prisma/ y falla; con esta ruta el nombre prisma.service se sigue probando y cli/ queda limpio.
  ['PrismaService', '../../infraestructura/prisma/prisma.service'],
  ['pg', 'pg'],
  ['un archivo de pg', 'pg/lib/client'],
  ['pg-pool', 'pg-pool'],
  ['@prisma/client', '@prisma/client'],
  ['@prisma/adapter-pg', '@prisma/adapter-pg'],
  ['otro paquete @prisma/...', '@prisma/adapter-neon'],
  ['un archivo interno de @prisma/client', '@prisma/client/runtime/library'],
];

describe('criterio 85: import de un valor', () => {
  it.each(MODULOS_PROHIBIDOS)('criterio 85: import de un valor desde %s falla el lint', async (_nombre, ruta) => {
    await esRechazadoSoloFueraDePrismaYCli(`import { Algo } from '${ruta}';\nexport const x = Algo;`);
  });

  it.each([
    ['import por defecto', "import pg from 'pg';\nexport const x = pg;"],
    ['import de PrismaClient', "import { PrismaClient } from '@prisma/client';\nexport const x = PrismaClient;"],
    ['import de PrismaPg', "import { PrismaPg } from '@prisma/adapter-pg';\nexport const x = PrismaPg;"],
    [
      'import de un valor junto con un tipo',
      "import { PrismaClient, type Prisma } from '../generated/prisma/client';\nexport const x = PrismaClient;",
    ],
    ['import de Pool de pg', "import { Pool } from 'pg';\nexport const x = Pool;"],
  ])('criterio 85: %s falla el lint', async (_nombre, codigo) => {
    await esRechazadoSoloFueraDePrismaYCli(codigo);
  });

  // (alcance ajustado por el criterio 113) Antes pasaba en cli/; ahora el espacio de nombres exportado como valor falla alli.
  it('criterio 85 (alcance ajustado por el criterio 113): import de todo con * exportado como valor falla el lint, tambien en cli/', async () => {
    await esRechazadoFueraDePrisma("import * as Prisma from '../generated/prisma/client';\nexport const x = Prisma;");
  });
});

describe('criterio 85: export ... from', () => {
  it.each(MODULOS_PROHIBIDOS)('criterio 85: export { X } from %s falla el lint', async (_nombre, ruta) => {
    await esRechazadoSoloFueraDePrismaYCli(`export { Algo } from '${ruta}';`);
  });

  it.each([
    ['export * from', "export * from '../generated/prisma/client';"],
    ['export * as X from', "export * as Prisma from '@prisma/client';"],
    ['export * from pg', "export * from 'pg';"],
    ['export { default } from pg-pool', "export { default } from 'pg-pool';"],
    // (criterio 95) Ruta cambiada, por la misma razon que PrismaService en MODULOS_PROHIBIDOS.
    ['export de PrismaService', "export { PrismaService } from '../../infraestructura/prisma/prisma.service';"],
  ])('criterio 85: %s falla el lint', async (_nombre, codigo) => {
    await esRechazadoSoloFueraDePrismaYCli(codigo);
  });
});

describe('criterio 85: import(...) dinamico (alcance en cli/ ajustado por el criterio 113: el cliente generado y @prisma/... fallan tambien alli)', () => {
  it.each(MODULOS_PROHIBIDOS)('criterio 85: import("%s") con cadena falla el lint', async (_nombre, ruta) => {
    await esRechazadoSegunElAlcance(`export const cargar = () => import('${ruta}');`);
  });

  it.each([
    ['con el cliente generado', "export const cargar = () => import('../generated/prisma/client');"],
    [
      'con una plantilla sin ${} hacia PrismaService',
      // (criterio 95) Ruta cambiada, por la misma razon que PrismaService en MODULOS_PROHIBIDOS.
      'export const cargar = () => import(`../../infraestructura/prisma/prisma.service`);',
    ],
    ['con una plantilla sin ${} hacia pg', 'export const cargar = () => import(`pg`);'],
    ['con await', "export async function cargar() {\n  const m = await import('@prisma/client');\n  return m;\n}"],
    ['con comillas dobles', 'export const cargar = () => import("@prisma/adapter-pg");'],
  ])('criterio 85: import() %s falla el lint', async (_nombre, codigo) => {
    await esRechazadoSegunElAlcance(codigo);
  });
});

describe('criterio 85: require(...) y import x = require(...) (alcance en cli/ ajustado por el criterio 113), y comentarios eslint-disable (criterio 96)', () => {
  it.each(MODULOS_PROHIBIDOS)('criterio 85: require("%s") falla el lint', async (_nombre, ruta) => {
    await esRechazadoSegunElAlcance(`export const m = require('${ruta}');`);
  });

  it.each(MODULOS_PROHIBIDOS)('criterio 85: import x = require("%s") falla el lint', async (_nombre, ruta) => {
    await esRechazadoSegunElAlcance(`import algo = require('${ruta}');\nexport const x = algo;`);
  });

  it.each([
    [
      "require('pg') precedido de eslint-disable-next-line @typescript-eslint/no-require-imports",
      "// eslint-disable-next-line @typescript-eslint/no-require-imports\nexport const pg = require('pg');",
    ],
    [
      'require con eslint-disable-next-line sin nombres',
      "// eslint-disable-next-line\nexport const pg = require('pg');",
    ],
    ['require con eslint-disable-line', "export const pg = require('pg'); // eslint-disable-line"],
    ['require con eslint-disable de bloque, de archivo', "/* eslint-disable */\nexport const pg = require('pg');"],
    [
      'import de un valor con eslint-disable-next-line',
      "// eslint-disable-next-line\nimport { PrismaClient } from '@prisma/client';\nexport const x = PrismaClient;",
    ],
    [
      'import de un valor con eslint-disable de archivo y nombres de regla',
      "/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-imports, no-restricted-syntax */\nimport pg from 'pg';\nexport const x = pg;",
    ],
    [
      'import dinamico con eslint-disable-next-line',
      "// eslint-disable-next-line\nexport const cargar = () => import('../generated/prisma/client');",
    ],
  ])('criterio 96: %s sigue fallando el paso protegido', async (_nombre, codigo) => {
    // (criterio 96) Antes se probaba con eslint.config.mjs; ahora, con el paso protegido (allowInlineConfig: false).
    const [resultado] = await obtenerEslintProtegido().lintText(codigo, { filePath: path.join(raiz, MODULO) });
    const fatales = resultado.messages.filter((mensaje) => mensaje.fatal);
    expect(fatales, `error al analizar: ${codigo}`).toEqual([]);
    const errores = resultado.messages.filter((mensaje) => mensaje.severity === 2);

    expect(errores.length, `el comentario apago la regla: ${codigo}`).toBeGreaterThan(0);
  });
});

// (precision del criterio 113, 11/11/2026) Tambien fallan en cli/; solo infraestructura/prisma/ queda libre.
describe('criterio 85: import() y require() con un argumento que no es una cadena literal (tambien en cli/, criterio 113)', () => {
  it.each([
    ['import(nombre)', 'export const cargar = (nombre) => import(nombre);'],
    ['import con una plantilla con ${}', 'export const cargar = (nombre) => import(`../${nombre}`);'],
    ['import con una concatenacion', "export const cargar = (nombre) => import('../' + nombre);"],
    ['import con una llamada', 'export const cargar = (nombre) => import(nombre.toString());'],
    ['require(nombre)', 'export const cargar = (nombre) => require(nombre);'],
    ['require con una plantilla con ${}', 'export const cargar = (nombre) => require(`./${nombre}`);'],
    ["require con una concatenacion 'p' + 'g'", "export const m = require('p' + 'g');"],
  ])('criterio 85: %s falla el lint', async (_nombre, codigo) => {
    await esRechazadoFueraDePrisma(codigo);
  });
});

// (precision del criterio 113, 11/11/2026) createRequire y la funcion que devuelve fallan tambien en cli/.
describe('criterio 85: createRequire (tambien en cli/, criterio 113)', () => {
  it.each([
    [
      "createRequire de 'module'",
      "import { createRequire } from 'module';\nexport const requerir = createRequire(import.meta.url);",
    ],
    [
      "createRequire de 'node:module'",
      "import { createRequire } from 'node:module';\nexport const requerir = createRequire(import.meta.url);",
    ],
    [
      'createRequire con otro nombre local',
      "import { createRequire as crear } from 'node:module';\nexport const requerir = crear(import.meta.url);",
    ],
    [
      'createRequire por el objeto del modulo',
      "import module from 'node:module';\nexport const requerir = module.createRequire(import.meta.url);",
    ],
    [
      'createRequire por import de todo',
      "import * as modulo from 'node:module';\nexport const requerir = modulo.createRequire(import.meta.url);",
    ],
  ])('criterio 85: %s falla el lint', async (_nombre, codigo) => {
    await esRechazadoFueraDePrisma(codigo);
  });
});

describe('criterio 85: lo que sigue permitido', () => {
  it.each([
    [
      'import type de Prisma',
      "import type { Prisma } from '../generated/prisma/client';\nexport type T = Prisma.JsonValue;",
    ],
    [
      'import con type en linea',
      "import { type Prisma } from '../generated/prisma/client';\nexport type T = Prisma.JsonValue;",
    ],
    [
      'varios tipos en linea',
      "import { type Prisma, type PrismaClient } from '../generated/prisma/client';\nexport type T = [Prisma.JsonValue, PrismaClient];",
    ],
    ['import type de pg', "import type pg from 'pg';\nexport type T = pg.Pool;"],
    [
      'import type de @prisma/client',
      "import type { PrismaClient } from '@prisma/client';\nexport type T = PrismaClient;",
    ],
    ['export type { X } from', "export type { Prisma } from '../generated/prisma/client';"],
    ['BaseDatos', "import { BaseDatos } from '../../infraestructura/prisma';\nexport const x = BaseDatos;"],
    ['otro modulo cualquiera', "import { Injectable } from '@nestjs/common';\nexport const x = Injectable;"],
    ['import() de un modulo propio con cadena', "export const cargar = () => import('./otro-modulo');"],
    ['import de un modulo de node', "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;"],
  ])('criterio 85: %s pasa el lint en un modulo', async (_nombre, codigo) => {
    expect(await erroresDeAcceso(codigo, MODULO)).toEqual([]);
  });

  it.each([
    ['la carpeta de Prisma de la infraestructura', PRISMA],
    ['los comandos', CLI],
  ])(
    'criterio 85: nada de lo anterior se aplica en %s (solo importaciones estaticas del cliente y de @prisma/..., criterio 113)',
    async (_nombre, archivo) => {
      const codigo = [
        "import pg from 'pg';",
        "import { PrismaPg } from '@prisma/adapter-pg';",
        "import { PrismaClient } from '../generated/prisma/client';",
        "export * from '@prisma/client';",
        'export const cargar = () => import(`./prisma.service`);',
        'export const x = [pg, PrismaPg, PrismaClient];',
      ].join('\n');

      expect(await erroresDeAcceso(codigo, archivo)).toEqual([]);
    },
  );

  it.each([
    ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
    ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
    ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
  ])('criterio 85: nada de lo anterior se aplica en %s', async (_nombre, archivo) => {
    const codigo =
      "import pg from 'pg';\nimport { PrismaClient } from '../src/generated/prisma/client';\nexport const x = [pg, PrismaClient];";

    expect(await erroresDeAcceso(codigo, archivo)).toEqual([]);
  });
});
