// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 128 (ataque ronda 5, O1; complementa los criterios 85, 95 y 127): el backend solo importa paquetes que declara.
// Dado que npm sube a `node_modules` de la raiz los paquetes de todos los espacios de trabajo, un paquete declarado en el
// `package.json` de la raiz, de `frontend/`, de `e2e/` o de `scripts/` (o una dependencia de otro paquete) se puede importar desde
// `backend/src/` sin pasar por la lista del criterio 127. Por eso, dado el codigo de `backend/src/` (sin las pruebas, criterio 110),
// `npm run lint` (tambien el paso protegido) falla si un archivo importa un valor, por cualquiera de las vias del criterio 85
// (tambien `import 'x'` y `export ... from`), con un especificador que no es relativo ni absoluto (criterio 95) y que no es un modulo
// de Node (`node:...` o un nombre de `module.builtinModules`) ni un paquete declarado en `backend/package.json` (en cualquier
// seccion). El nombre del paquete es `@ambito/nombre` o `nombre`, sin la subruta. Asi fallan tambien los alias (`#...`, `~/...`,
// `@/...`) mientras no se declaren. `import type` e `import { type X }` siguen permitidos.
// Pasan, por ejemplo, `import { Injectable } from '@nestjs/common'`, `import { randomBytes } from 'node:crypto'`,
// `import { readFileSync } from 'fs'` y `import { z } from 'zod'`; fallan `import postgres from 'postgres'`,
// `import x from 'pg-protocol'` (dependencia de `pg`, no declarada), `require('knex')` e `import { y } from '#interno'`.
// Consecuencia: `backend/package.json` declara `express` (se prueba en scripts/test/dependencias-backend.test.mjs).
// Se prueba con las dos configuraciones (eslint.config.mjs y la del paso protegido) sobre el repositorio real, y con
// repositorios temporales cuyo `backend/package.json` declara paquetes en cada seccion (la regla lee `<cwd>/backend/package.json`).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLI,
  CONFIGURACIONES,
  MODULO,
  PRISMA,
  borrarCarpeta,
  carpetaTemporal,
  enModulos,
  erroresEn,
  errores,
  escribir,
  eslintProtegidoEn,
} from './ayuda-lint-ronda4.mjs';

const PRINCIPAL = 'backend/src/main.ts';
/** Archivos de produccion de backend/src/: la regla se aplica en todos (tambien en cli/ y en infraestructura/prisma/). */
const ARCHIVOS = [
  ['un modulo', MODULO],
  ['infraestructura/prisma/', PRISMA],
  ['cli/', CLI],
  ['main.ts', PRINCIPAL],
];

describe.each(CONFIGURACIONES)('criterio 128 con %s', (_configuracion, obtener) => {
  describe('criterio 128: lo que pasa (modulos de Node y paquetes declarados en backend/package.json)', () => {
    const PASAN = [
      [
        '@nestjs/common (ejemplo de la especificacion)',
        "import { Injectable } from '@nestjs/common';\nexport const x = Injectable;",
      ],
      [
        'node:crypto (ejemplo de la especificacion)',
        "import { randomBytes } from 'node:crypto';\nexport const x = randomBytes;",
      ],
      [
        'fs sin el prefijo node: (ejemplo de la especificacion)',
        "import { readFileSync } from 'fs';\nexport const x = readFileSync;",
      ],
      ['zod (ejemplo de la especificacion)', "import { z } from 'zod';\nexport const x = z;"],
      ['path', "import { join } from 'path';\nexport const x = join;"],
      ['node:fs/promises', "import { readFile } from 'node:fs/promises';\nexport const x = readFile;"],
      ['fs/promises sin el prefijo', "import { readFile } from 'fs/promises';\nexport const x = readFile;"],
      ['http', "import { createServer } from 'http';\nexport const x = createServer;"],
      ['una subruta de un paquete declarado', "import { y } from '@nestjs/common/decorators';\nexport const x = y;"],
      ['una subruta de un paquete sin ambito', "import { y } from 'zod/v4';\nexport const x = y;"],
      ['un import de efecto de un paquete declarado', "import 'reflect-metadata';"],
      [
        'una dependencia de desarrollo declarada (@nestjs/testing)',
        "import { Test } from '@nestjs/testing';\nexport const x = Test;",
      ],
      ['otra dependencia declarada (jsonwebtoken)', "import jwt from 'jsonwebtoken';\nexport const x = jwt;"],
      ['otra dependencia declarada (rxjs)', "import { of } from 'rxjs';\nexport const x = of;"],
      ['otra dependencia declarada (helmet)', "import helmet from 'helmet';\nexport const x = helmet;"],
      [
        'el paquete de contratos del espacio de trabajo',
        "import { z } from '@aquagestion/contratos';\nexport const x = z;",
      ],
      [
        'express (la 128 lo declara en backend/package.json)',
        "import express from 'express';\nexport const x = express;",
      ],
      ['export ... from de un paquete declarado', "export { z } from 'zod';"],
      ['export * from de un paquete declarado', "export * from 'zod';"],
      ['export * as ... from de un paquete declarado', "export * as zeta from 'zod';"],
      ['import() con cadena de un paquete declarado', "export const cargar = () => import('zod');"],
      ['import() con plantilla sin ${} de un paquete declarado', 'export const cargar = () => import(`zod`);'],
      ['require() de un paquete declarado', "export const m = require('zod');"],
      ['import x = require() de un paquete declarado', "import zeta = require('zod');\nexport const x = zeta;"],
      ['una ruta relativa', "import { a } from './otro-modulo';\nexport const x = a;"],
      ['una ruta relativa al nivel superior', "import { a } from '../otro/modulo';\nexport const x = a;"],
      [
        'una ruta relativa con un segmento llamado como un paquete no declarado',
        "import { a } from './lodash';\nexport const x = a;",
      ],
      ['require() de una ruta relativa', "export const m = require('./otro-modulo');"],
    ];

    describe.each(ARCHIVOS)('en %s', (_nombre, archivo) => {
      it.each(PASAN)('criterio 128: %s pasa el lint', async (_caso, codigo) => {
        expect(await errores(obtener(), codigo, archivo), codigo).toEqual([]);
      });
    });

    it.each([
      [
        'import type de un paquete no declarado',
        "import type { Foo } from 'paquete-no-declarado';\nexport type X = Foo;",
      ],
      [
        'import { type X } de un paquete no declarado',
        "import { type Foo } from 'paquete-no-declarado';\nexport type X = Foo;",
      ],
      ['export type { X } from de un paquete no declarado', "export type { Foo } from 'paquete-no-declarado';"],
      ['import type de un alias', "import type { Foo } from '#interno';\nexport type X = Foo;"],
    ])('criterio 128: %s sigue permitido', async (_caso, codigo) => {
      for (const [, archivo] of ARCHIVOS) expect(await errores(obtener(), codigo, archivo), archivo).toEqual([]);
    });
  });

  describe('criterio 128: lo que falla (paquetes que no se declaran en backend/package.json)', () => {
    const FALLAN = [
      ['postgres (ejemplo de la especificacion)', "import postgres from 'postgres';\nexport const x = postgres;"],
      [
        'pg-protocol, dependencia de pg que no se declara (ejemplo de la especificacion)',
        "import x from 'pg-protocol';\nexport const y = x;",
      ],
      ['require(knex) (ejemplo de la especificacion)', "export const m = require('knex');"],
      ['un alias #interno (ejemplo de la especificacion)', "import { y } from '#interno';\nexport const x = y;"],
      ['un alias #interno/modulo', "import { y } from '#interno/modulo';\nexport const x = y;"],
      ['un alias ~/', "import { y } from '~/interno';\nexport const x = y;"],
      ['un alias @/', "import { y } from '@/interno';\nexport const x = y;"],
      ['un paquete cualquiera (lodash)', "import _ from 'lodash';\nexport const x = _;"],
      ['una subruta de un paquete no declarado', "import fp from 'lodash/fp';\nexport const x = fp;"],
      ['un paquete con ambito no declarado', "import { a } from '@acme/paquete';\nexport const x = a;"],
      [
        'una subruta de un paquete con ambito no declarado',
        "import { a } from '@acme/paquete/sub/ruta';\nexport const x = a;",
      ],
      [
        'un paquete del ambito de uno declarado pero distinto (@nestjs/otro)',
        "import { a } from '@nestjs/otro';\nexport const x = a;",
      ],
      [
        'un nombre que solo empieza como uno declarado (@nestjs/common-extra)',
        "import { a } from '@nestjs/common-extra';\nexport const x = a;",
      ],
      [
        'un nombre que solo empieza como uno declarado (zod-extra)',
        "import { a } from 'zod-extra';\nexport const x = a;",
      ],
      [
        'un nombre que solo empieza como uno declarado (express-session)',
        "import session from 'express-session';\nexport const x = session;",
      ],
      ['typescript, declarado en la raiz pero no en backend', "import ts from 'typescript';\nexport const x = ts;"],
      [
        'react, declarado en frontend pero no en backend',
        "import { useState } from 'react';\nexport const x = useState;",
      ],
      ['vitest, declarado en la raiz pero no en backend', "import { it } from 'vitest';\nexport const x = it;"],
      ['un import de efecto', "import 'paquete-no-declarado';"],
      ['export ... from', "export { a } from 'paquete-no-declarado';"],
      ['export * from', "export * from 'paquete-no-declarado';"],
      ['export * as ... from', "export * as todo from 'paquete-no-declarado';"],
      ['import() con cadena', "export const cargar = () => import('paquete-no-declarado');"],
      ['import() con comillas dobles', 'export const cargar = () => import("paquete-no-declarado");'],
      ['import() con plantilla sin ${}', 'export const cargar = () => import(`paquete-no-declarado`);'],
      ['import() con await', "export async function cargar() {\n  return await import('paquete-no-declarado');\n}"],
      ['require()', "export const m = require('paquete-no-declarado');"],
      ['import x = require()', "import algo = require('paquete-no-declarado');\nexport const x = algo;"],
      [
        'un import de valor junto con un tipo',
        "import { a, type B } from 'paquete-no-declarado';\nexport const x = a;",
      ],
      ['un import por defecto y de todo', "import * as todo from 'paquete-no-declarado';\nexport const x = todo;"],
    ];

    describe.each(ARCHIVOS)('en %s', (_nombre, archivo) => {
      it.each(FALLAN)('criterio 128: %s falla el lint', async (_caso, codigo) => {
        expect((await errores(obtener(), codigo, archivo)).length, codigo).toBeGreaterThan(0);
      });
    });

    it.each([
      ['mjs', "import _ from 'lodash';\nexport const x = _;"],
      ['cts', "const _ = require('lodash');\nmodule.exports = _;"],
      ['cjs', "const _ = require('lodash');\nmodule.exports = _;"],
      ['js', "import _ from 'lodash';\nexport const x = _;"],
      ['tsx', "import _ from 'lodash';\nexport const x = _;"],
    ])('criterio 128: un archivo .%s de un modulo con un paquete no declarado falla el lint', async (ext, codigo) => {
      expect((await errores(obtener(), codigo, enModulos(ext))).length, codigo).toBeGreaterThan(0);
    });
  });

  describe('criterio 128: las pruebas y lo que no es backend/src/ no estan sujetos', () => {
    const CODIGO = "import _ from 'lodash';\nimport postgres from 'postgres';\nexport const x = [_, postgres];";

    it.each([
      ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
      ['una prueba .test.mjs dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.mjs'],
      ['una prueba de cli/', 'backend/src/cli/ejemplo.test.ts'],
      ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
      ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
    ])('criterio 128: nada se aplica en %s', async (_nombre, archivo) => {
      expect(await errores(obtener(), CODIGO, archivo)).toEqual([]);
    });
  });
});

describe('criterio 128: la regla lee <cwd>/backend/package.json (repositorios temporales, paso protegido)', () => {
  let carpeta;
  let eslint;

  beforeEach(() => {
    carpeta = carpetaTemporal('aqua-paquetes-');
    // Un arbol minimo: un modulo cualquiera; el package.json de cada prueba lo escribe ella.
    escribir(carpeta, 'backend/src/modulos/ejemplo/otro.ts', 'export const o = 1;\n');
  });
  afterEach(() => {
    borrarCarpeta(carpeta);
  });

  const escribirPaquete = (cwd, paquete, ruta = 'backend/package.json') =>
    escribir(cwd, ruta, `${JSON.stringify(paquete, null, 2)}\n`);
  const lintear = (codigo, archivo = MODULO) => {
    eslint ??= eslintProtegidoEn(carpeta);
    return erroresEn(eslint, carpeta, codigo, archivo);
  };
  const importa = (nombre) => `import algo from '${nombre}';\nexport const x = algo;`;

  it.each([
    ['dependencies', { dependencies: { 'declarado-aqui': '^1.0.0' } }],
    ['devDependencies', { devDependencies: { 'declarado-aqui': '^1.0.0' } }],
    ['optionalDependencies', { optionalDependencies: { 'declarado-aqui': '^1.0.0' } }],
    ['peerDependencies', { peerDependencies: { 'declarado-aqui': '^1.0.0' } }],
    ['bundleDependencies', { bundleDependencies: ['declarado-aqui'] }],
    ['bundledDependencies', { bundledDependencies: ['declarado-aqui'] }],
  ])('criterio 128: un paquete declarado en %s pasa y uno no declarado falla', async (_seccion, seccion) => {
    escribirPaquete(carpeta, { name: '@aquagestion/backend', ...seccion });

    expect(await lintear(importa('declarado-aqui')), 'declarado').toEqual([]);
    expect(await lintear(importa('declarado-aqui/lib/sub.js')), 'subruta de un declarado').toEqual([]);
    expect(await lintear("export const m = require('declarado-aqui');"), 'require de un declarado').toEqual([]);
    expect((await lintear(importa('no-declarado-aqui'))).length, 'no declarado').toBeGreaterThan(0);
  });

  it('criterio 128: el nombre del paquete es @ambito/nombre: declarar uno del ambito no admite otro del mismo ambito', async () => {
    escribirPaquete(carpeta, { name: '@aquagestion/backend', dependencies: { '@ambito/nombre': '^1.0.0' } });

    expect(await lintear(importa('@ambito/nombre'))).toEqual([]);
    expect(await lintear(importa('@ambito/nombre/sub/ruta.js'))).toEqual([]);
    expect((await lintear(importa('@ambito/otro'))).length, '@ambito/otro').toBeGreaterThan(0);
  });

  it('criterio 128: declarar un paquete no admite los que solo empiezan con su nombre', async () => {
    escribirPaquete(carpeta, { name: '@aquagestion/backend', dependencies: { declarado: '^1.0.0' } });

    expect(await lintear(importa('declarado'))).toEqual([]);
    expect((await lintear(importa('declarado-extra'))).length).toBeGreaterThan(0);
    expect((await lintear(importa('declarados'))).length).toBeGreaterThan(0);
  });

  it.each([
    ['package.json de la raiz', 'package.json'],
    ['frontend/package.json', 'frontend/package.json'],
    ['e2e/package.json', 'e2e/package.json'],
    ['scripts/package.json', 'scripts/package.json'],
    ['packages/contratos/package.json', 'packages/contratos/package.json'],
  ])(
    'criterio 128: un paquete declarado solo en %s (y presente en node_modules de la raiz) falla',
    async (_nombre, ruta) => {
      escribirPaquete(carpeta, { name: '@aquagestion/backend', dependencies: { 'declarado-aqui': '^1.0.0' } });
      escribirPaquete(
        carpeta,
        {
          name: 'otro',
          dependencies: { 'solo-en-otro-espacio': '^1.0.0' },
          devDependencies: { 'solo-en-otro-espacio-dev': '^1' },
        },
        ruta,
      );
      escribir(carpeta, 'node_modules/solo-en-otro-espacio/package.json', '{ "name": "solo-en-otro-espacio" }\n');
      escribir(carpeta, 'node_modules/solo-en-otro-espacio/index.js', 'module.exports = 1;\n');

      expect((await lintear(importa('solo-en-otro-espacio'))).length, ruta).toBeGreaterThan(0);
      expect((await lintear(importa('solo-en-otro-espacio-dev'))).length, ruta).toBeGreaterThan(0);
      expect((await lintear("export const m = require('solo-en-otro-espacio');")).length, ruta).toBeGreaterThan(0);
      expect(await lintear(importa('declarado-aqui')), 'el declarado en backend sigue pasando').toEqual([]);
    },
  );

  it('criterio 128: una dependencia transitiva presente en node_modules (como pg-protocol) falla si backend no la declara', async () => {
    escribirPaquete(carpeta, { name: '@aquagestion/backend', dependencies: { pg: '^8.0.0' } });
    escribir(carpeta, 'node_modules/pg-protocol/package.json', '{ "name": "pg-protocol" }\n');

    expect(await lintear(importa('pg'))).toEqual([]);
    expect((await lintear(importa('pg-protocol'))).length).toBeGreaterThan(0);
  });

  it('criterio 128: una carpeta backend/src/modulos distinta tambien usa el package.json de backend', async () => {
    escribirPaquete(carpeta, { name: '@aquagestion/backend', dependencies: { 'declarado-aqui': '^1.0.0' } });
    const profundo = 'backend/src/modulos/ejemplo/a/b/c/profundo.service.ts';

    expect(await lintear(importa('declarado-aqui'), profundo)).toEqual([]);
    expect((await lintear(importa('no-declarado-aqui'), profundo)).length).toBeGreaterThan(0);
  });

  it('criterio 128: las pruebas (*.test.ts) y backend/test/ no estan sujetas aunque el paquete no se declare', async () => {
    escribirPaquete(carpeta, { name: '@aquagestion/backend', dependencies: { 'declarado-aqui': '^1.0.0' } });

    expect(await lintear(importa('no-declarado-aqui'), 'backend/src/modulos/ejemplo/otro.service.test.ts')).toEqual([]);
    expect(await lintear(importa('no-declarado-aqui'), 'backend/test/utilidades/ejemplo.ts')).toEqual([]);
  });

  it('criterio 128: un archivo fuera de backend/src (packages/contratos/src) no esta sujeto', async () => {
    escribirPaquete(carpeta, { name: '@aquagestion/backend', dependencies: { 'declarado-aqui': '^1.0.0' } });

    expect(await lintear(importa('no-declarado-aqui'), 'packages/contratos/src/ejemplo.ts')).toEqual([]);
  });
});
