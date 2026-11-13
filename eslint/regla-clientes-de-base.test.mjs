// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 129 (ataque ronda 5, O1; complementa los criterios 85, 95 y 128): lista negra de clientes de base. Dado el codigo de
// `backend/src/` (sin las pruebas), fuera de `backend/src/infraestructura/prisma/` y de `backend/src/cli/`, `npm run lint` (tambien
// el paso protegido) falla si un archivo importa, de valor o de tipo, por cualquiera de las vias del criterio 85 y tambien como ruta
// a `node_modules/` (criterio 95), un paquete de la lista negra de clientes de base (`CLIENTES_DE_BASE_PROHIBIDOS`, P-30), con o sin
// subruta: `postgres`; `knex`; `kysely` y `kysely-...`; `slonik`, `slonik-...` y `@slonik/...`; `@neondatabase/...`; `@vercel/postgres`
// y `@vercel/postgres-...`; todo nombre que empiece por `mysql` (`mysql`, `mysql2`); `sequelize` y `sequelize-...`; `typeorm` y
// `@typeorm/...`; `drizzle-orm` (tambien `drizzle-orm/node-postgres` y las demas subrutas) y `drizzle-...`; `pg-promise`; `pg-native`;
// `@databases/...`; `@mikro-orm/...`; y `@electric-sql/pglite`. Es una segunda capa sobre el criterio 128, por si alguno llega a
// declararse. Prueba de la regla como en el criterio 92: un ejemplo que falla por cada entrada de la lista (con `import`; y para
// `postgres` y `@neondatabase/serverless`, tambien con `require`, `import()`, `import type` y la ruta a `node_modules/`), y
// `import { Injectable } from '@nestjs/common'` pasa.
//
// Nota sobre `pg-promise` y `pg-native` (y `pg-protocol` en las pruebas del 128): el criterio 85 ya rechaza en un modulo todo `pg-...`,
// asi que en un modulo su rechazo puede venir del 85 y no del 129; no se pueden aislar porque el 129 no se aplica en `prisma/` ni en
// `cli/`. El resto de la lista negra (postgres, knex, kysely, ...) si se prueba sin esa ayuda.
//
// Como el criterio 128 ya rechaza cualquier paquete no declarado, la lista negra se prueba de dos maneras:
//   - con el repositorio real (las dos configuraciones): cada ejemplo falla en un modulo; y las rutas a `node_modules/` (relativas, que
//     el criterio 128 no mira) fallan en un modulo y pasan en infraestructura/prisma/ y en cli/;
//   - con un repositorio temporal cuyo `backend/package.json` DECLARA todos los paquetes de los ejemplos (asi el criterio 128 no
//     interviene y solo puede rechazar la lista negra): fallan en un modulo, y pasan en infraestructura/prisma/ y en cli/.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLI,
  CONFIGURACIONES,
  MODULO,
  PRISMA,
  borrarCarpeta,
  carpetaTemporal,
  erroresEn,
  errores,
  escribir,
  eslintProtegidoEn,
} from './ayuda-lint-ronda4.mjs';
import { eslintPrincipalEn } from './ayuda-lint-ronda5.mjs';

/** Un paquete (o subruta) de cada entrada de la lista negra, con la forma de la entrada como la escribe la especificacion. */
const POR_ENTRADA = [
  ['postgres', 'postgres'],
  ['postgres con subruta', 'postgres/cjs/src/index.js'],
  ['knex', 'knex'],
  ['knex con subruta', 'knex/lib/client'],
  ['kysely', 'kysely'],
  ['kysely-...', 'kysely-postgres-js'],
  ['slonik', 'slonik'],
  ['slonik-...', 'slonik-interceptor-query-logging'],
  ['@slonik/...', '@slonik/driver'],
  ['@neondatabase/serverless', '@neondatabase/serverless'],
  ['@neondatabase/... otro paquete', '@neondatabase/otro-paquete'],
  ['@vercel/postgres', '@vercel/postgres'],
  ['@vercel/postgres-...', '@vercel/postgres-kysely'],
  ['mysql', 'mysql'],
  ['mysql2', 'mysql2'],
  ['mysql2 con subruta', 'mysql2/promise'],
  ['sequelize', 'sequelize'],
  ['sequelize-...', 'sequelize-typescript'],
  ['typeorm', 'typeorm'],
  ['@typeorm/...', '@typeorm/otro'],
  ['drizzle-orm', 'drizzle-orm'],
  ['drizzle-orm/node-postgres (ejemplo de la especificacion)', 'drizzle-orm/node-postgres'],
  ['drizzle-orm/pg-core', 'drizzle-orm/pg-core'],
  ['drizzle-...', 'drizzle-kit'],
  ['pg-promise', 'pg-promise'],
  ['pg-native', 'pg-native'],
  ['@databases/...', '@databases/pg'],
  ['@mikro-orm/...', '@mikro-orm/core'],
  ['@electric-sql/pglite', '@electric-sql/pglite'],
];

const importar = (paquete) => `import cliente from '${paquete}';\nexport const x = cliente;`;

/** Formas adicionales (criterio 85) de importar un paquete: [descripcion, funcion(paquete) -> codigo]. */
const VIAS = [
  ['import de valor', importar],
  ['import por defecto y de todo', (p) => `import * as todo from '${p}';\nexport const x = todo;`],
  ['import de efecto', (p) => `import '${p}';`],
  ['import { type X } (de tipo)', (p) => `import { type Cliente } from '${p}';\nexport type X = Cliente;`],
  ['import type (de tipo)', (p) => `import type { Cliente } from '${p}';\nexport type X = Cliente;`],
  ['export type { X } from (de tipo)', (p) => `export type { Cliente } from '${p}';`],
  ['export { X } from', (p) => `export { Cliente } from '${p}';`],
  ['export * from', (p) => `export * from '${p}';`],
  ['export * as X from', (p) => `export * as todo from '${p}';`],
  ['import() con cadena', (p) => `export const cargar = () => import('${p}');`],
  ['import() con plantilla sin ${}', (p) => `export const cargar = () => import(\`${p}\`);`],
  ['require()', (p) => `export const m = require('${p}');`],
  ['import x = require()', (p) => `import algo = require('${p}');\nexport const x = algo;`],
];

/** Rutas a node_modules/ (criterio 95) de un paquete de la lista negra. */
const RUTAS_A_NODE_MODULES = (paquete) => [
  ['require() relativo', `export const m = require('../../node_modules/${paquete}');`],
  ['require() relativo a un archivo', `export const m = require('../../node_modules/${paquete}/index.js');`],
  [
    'import estatico relativo',
    `import cliente from '../../node_modules/${paquete}/index.js';\nexport const x = cliente;`,
  ],
  ['import() relativo', `export const cargar = () => import('../../../node_modules/${paquete}/index.js');`],
  ['import() con plantilla sin ${}', `export const cargar = () => import(\`../../node_modules/${paquete}\`);`],
  ['import type relativo', `import type { C } from '../../node_modules/${paquete}/index.js';\nexport type X = C;`],
  ['export ... from relativo', `export { C } from '../../node_modules/${paquete}/index.js';`],
  ['ruta absoluta de Unix', `export const m = require('/srv/app/node_modules/${paquete}/index.js');`],
  ['URL file:', `export const cargar = () => import('file:///srv/app/node_modules/${paquete}/index.js');`],
  [
    'ruta absoluta de Windows con barras invertidas',
    `export const m = require('C:\\\\app\\\\node_modules\\\\${paquete.replaceAll('/', '\\\\')}\\\\index.js');`,
  ],
  [
    'barras invertidas relativas',
    `export const m = require('..\\\\..\\\\node_modules\\\\${paquete.replaceAll('/', '\\\\')}');`,
  ],
  [
    'node_modules mas adentro de la ruta',
    `export const m = require('../../../../otra/node_modules/${paquete}/index.js');`,
  ],
];

describe.each(CONFIGURACIONES)('criterio 129 con %s (repositorio real)', (_configuracion, obtener) => {
  describe('criterio 129: un ejemplo por cada entrada de la lista negra, con import, falla en un modulo', () => {
    it.each(POR_ENTRADA)('criterio 129: import de %s falla el lint', async (_entrada, paquete) => {
      expect((await errores(obtener(), importar(paquete), MODULO)).length, paquete).toBeGreaterThan(0);
    });
  });

  describe('criterio 129: postgres y @neondatabase/serverless por todas las vias del criterio 85', () => {
    for (const paquete of ['postgres', '@neondatabase/serverless']) {
      it.each(VIAS)(`criterio 129: ${paquete} con %s falla el lint en un modulo`, async (_via, armar) => {
        expect((await errores(obtener(), armar(paquete), MODULO)).length, armar(paquete)).toBeGreaterThan(0);
      });
    }
  });

  describe('criterio 129: la ruta a node_modules/ de un paquete de la lista negra (criterio 95)', () => {
    for (const paquete of ['postgres', '@neondatabase/serverless']) {
      it.each(RUTAS_A_NODE_MODULES(paquete))(
        `criterio 129: ${paquete} por %s falla en un modulo y no falla en infraestructura/prisma/ ni en cli/`,
        async (_via, codigo) => {
          expect((await errores(obtener(), codigo, MODULO)).length, `modulo: ${codigo}`).toBeGreaterThan(0);
          expect(await errores(obtener(), codigo, PRISMA), `prisma/: ${codigo}`).toEqual([]);
          expect(await errores(obtener(), codigo, CLI), `cli/: ${codigo}`).toEqual([]);
        },
      );
    }

    it.each([
      ['mysql2', 'mysql2'],
      ['drizzle-orm/node-postgres', 'drizzle-orm/node-postgres'],
      ['@slonik/driver', '@slonik/driver'],
      ['kysely-postgres-js', 'kysely-postgres-js'],
    ])('criterio 129: la ruta a node_modules/%s falla en un modulo', async (_nombre, paquete) => {
      const codigo = `export const m = require('../../node_modules/${paquete}/index.js');`;

      expect((await errores(obtener(), codigo, MODULO)).length, codigo).toBeGreaterThan(0);
    });
  });

  describe('criterio 129: lo que sigue permitido', () => {
    it.each([
      [
        '@nestjs/common (ejemplo de la especificacion)',
        "import { Injectable } from '@nestjs/common';\nexport const x = Injectable;",
      ],
      [
        'una ruta relativa cuyo segmento se llama como un cliente de base',
        "import { a } from './postgres';\nexport const x = a;",
      ],
      ['una ruta relativa a una carpeta knex', "import { a } from '../knex/cliente';\nexport const x = a;"],
      [
        'una ruta a node_modules de un paquete que no es cliente de base',
        "export const m = require('../../node_modules/zod/index.js');",
      ],
      ['zod', "import { z } from 'zod';\nexport const x = z;"],
    ])('criterio 129: %s pasa el lint en un modulo', async (_caso, codigo) => {
      expect(await errores(obtener(), codigo, MODULO), codigo).toEqual([]);
    });

    it('criterio 129: nada de la lista negra se aplica en una prueba', async () => {
      const codigo = "import postgres from 'postgres';\nimport knex from 'knex';\nexport const x = [postgres, knex];";

      expect(await errores(obtener(), codigo, 'backend/src/modulos/ejemplo/ejemplo.service.test.ts')).toEqual([]);
      expect(await errores(obtener(), codigo, 'backend/test/integracion/ejemplo.test.ts')).toEqual([]);
    });
  });
});

// Con las dos configuraciones: el paso protegido y la principal (eslint.config.mjs), esta ultima en un repositorio temporal para que
// la lista negra se pruebe por nombre tambien con ella sin depender del criterio 128.
describe.each([
  ['paso protegido (eslint.protegido.config.mjs)', eslintProtegidoEn],
  ['eslint.config.mjs', eslintPrincipalEn],
])(
  'criterio 129 con %s: con todos los paquetes declarados en backend/package.json solo interviene la lista negra (repositorio temporal)',
  (_configuracion, crearEslint) => {
    let carpeta;
    let eslint;

    beforeAll(() => {
      carpeta = carpetaTemporal('aqua-clientes-');
      // Todos los paquetes de los ejemplos, mas uno que no es cliente de base, declarados: el criterio 128 no rechaza nada.
      const declarados = Object.fromEntries(
        [
          ...POR_ENTRADA.map(([, paquete]) =>
            paquete
              .split('/')
              .slice(0, paquete.startsWith('@') ? 2 : 1)
              .join('/'),
          ),
          '@nestjs/common',
        ].map((nombre) => [nombre, '^1.0.0']),
      );
      escribir(
        carpeta,
        'backend/package.json',
        `${JSON.stringify({ name: '@aquagestion/backend', dependencies: declarados }, null, 2)}\n`,
      );
      escribir(carpeta, 'backend/src/modulos/ejemplo/otro.ts', 'export const o = 1;\n');
      eslint = crearEslint(carpeta);
    });
    afterAll(() => {
      borrarCarpeta(carpeta);
    });

    const lintear = (codigo, archivo) => erroresEn(eslint, carpeta, codigo, archivo);

    it('criterio 129 (control): un paquete declarado que no es cliente de base pasa en un modulo', async () => {
      expect(
        await lintear("import { Injectable } from '@nestjs/common';\nexport const x = Injectable;", MODULO),
      ).toEqual([]);
    });

    it.each(POR_ENTRADA)(
      'criterio 129: aunque %s este declarado, su import falla en un modulo',
      async (_entrada, paquete) => {
        expect((await lintear(importar(paquete), MODULO)).length, paquete).toBeGreaterThan(0);
      },
    );

    it.each(POR_ENTRADA)(
      'criterio 129: aunque %s este declarado, su import no falla en infraestructura/prisma/ ni en cli/',
      async (_entrada, paquete) => {
        expect(await lintear(importar(paquete), PRISMA), `prisma/: ${paquete}`).toEqual([]);
        expect(await lintear(importar(paquete), CLI), `cli/: ${paquete}`).toEqual([]);
      },
    );

    for (const paquete of ['postgres', '@neondatabase/serverless']) {
      it.each(VIAS)(
        `criterio 129: ${paquete} declarado, con %s, falla en un modulo y pasa en prisma/ y en cli/`,
        async (_via, armar) => {
          const codigo = armar(paquete);

          expect((await lintear(codigo, MODULO)).length, `modulo: ${codigo}`).toBeGreaterThan(0);
          expect(await lintear(codigo, PRISMA), `prisma/: ${codigo}`).toEqual([]);
          expect(await lintear(codigo, CLI), `cli/: ${codigo}`).toEqual([]);
        },
      );
    }

    it('criterio 129: una prueba sigue exenta aunque importe un cliente de base declarado', async () => {
      expect(await lintear(importar('postgres'), 'backend/src/modulos/ejemplo/ejemplo.service.test.ts')).toEqual([]);
    });
  },
);
