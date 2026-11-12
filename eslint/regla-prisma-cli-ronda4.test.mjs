// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 113 (ataque ronda 4, F7; complementa los criterios 92 y 95): `Prisma` en cli/ solo como acceso con punto a un nombre
// fijo. Dado el codigo de backend/src/cli/, las reglas siguen los alias y los espacios de nombres del cliente generado y de
// `@prisma/...` (`import { Prisma as P }`, `import * as G` y `G.Prisma`, la importacion por defecto) y `npm run lint` falla si:
//   - `Prisma` (o un alias, o `G.Prisma`), o el espacio de nombres `G`, se usa como valor de otra forma que como objeto de un
//     acceso con punto a un nombre fijo: asignado (`const P = Prisma`, `x.p = Prisma`), pasado como argumento
//     (`Reflect.get(Prisma, 'raw')`, `Object.getOwnPropertyDescriptor(Prisma, 'raw')`, `f(G)`), propagado (`...Prisma`),
//     devuelto, exportado como valor o con acceso calculado (`Prisma[x]`, `Prisma['raw']`, `G['Prisma']`);
//   - se desestructura de `Prisma` o de `G.Prisma` alguno de `sql`, `raw`, `join`, `empty` o `Sql` (con o sin alias:
//     `const { sql: s } = Prisma`), con una clave calculada o con un resto (`...resto`);
//   - una expresion que empieza por `Prisma` (o un alias) o por `G` accede, en cualquier punto de la cadena, a `constructor`,
//     `prototype` o `__proto__` (`Prisma.empty.constructor`, `Prisma.sql\`x\`.constructor`), o se pasa a `Reflect.*`,
//     `Object.getPrototypeOf`, `Object.getOwnPropertyDescriptor(s)`, `Object.entries`, `Object.values`, `Object.keys` u
//     `Object.assign`;
//   - el cliente generado o `@prisma/...` se cargan con `require(...)` o `import(...)` en lugar de un `import` estatico.
// Se mantienen las prohibiciones del criterio 92 sobre `Prisma.raw`, `Prisma.Sql` como valor, `Prisma.join` con separador y
// `Prisma.sql` como funcion, tambien con los alias. Pasan, en cli/, `import { PrismaClient } from '../generated/prisma/client'`,
// `new PrismaClient(...)`, `import { Prisma as P } ...; cliente.$queryRaw(P.sql\`SELECT 1\`)` e `import type { Prisma } ...`.
// Un ejemplo que falla por cada forma del ataque y los que pasan. Se prueba con las dos configuraciones.
import { describe, expect, it } from 'vitest';
import { CLI, CONFIGURACIONES, PRISMA, errores } from './ayuda-lint-ronda4.mjs';
import { erroresDeclarandoLoImportado } from './ayuda-lint-ronda5.mjs';

const CLIENTE = "'../generated/prisma/client'";
const RUNTIME = "'@prisma/client/runtime/client'";
const IMPORTA_PRISMA = `import { Prisma } from ${CLIENTE};`;
const IMPORTA_ALIAS = `import { Prisma as P } from ${CLIENTE};`;
const IMPORTA_ESPACIO = `import * as G from ${CLIENTE};`;

describe.each(CONFIGURACIONES)('criterio 113 con %s', (_configuracion, obtener) => {
  /** Falla en cli/ y esta limpio en backend/src/infraestructura/prisma/ (alli estas reglas no se aplican). */
  async function falla(codigo) {
    // (ajustado por el criterio 128, decision del orquestador tras la ronda 5) Si el ejemplo importa un paquete no declarado
    // (`@prisma/adapter-neon`), prisma/ se revisa en un repositorio temporal cuyo backend/package.json lo declara.
    expect(
      await erroresDeclarandoLoImportado(codigo, PRISMA, () => errores(obtener(), codigo, PRISMA)),
      `en prisma/ no debia fallar: ${codigo}`,
    ).toEqual([]);
    expect((await errores(obtener(), codigo, CLI)).length, `el lint no rechazo en cli/: ${codigo}`).toBeGreaterThan(0);
  }
  async function pasa(codigo) {
    // (ajustado por el criterio 128, decision del orquestador tras la ronda 5) Un ejemplo que importa un paquete no declarado
    // (`pg-pool`) se revisa en un repositorio temporal cuyo backend/package.json lo declara.
    expect(
      await erroresDeclarandoLoImportado(codigo, CLI, () => errores(obtener(), codigo, CLI)),
      `el lint rechazo en cli/: ${codigo}`,
    ).toEqual([]);
  }

  describe('criterio 113: Prisma (o un alias, o G.Prisma, o G) usado como valor de otra forma que un acceso con punto', () => {
    it.each([
      [
        'asignado a una constante (ejemplo de la especificacion)',
        `${IMPORTA_PRISMA}\nconst P = Prisma;\nexport const x = P;`,
      ],
      [
        'asignado a una propiedad (x.p = Prisma)',
        `${IMPORTA_PRISMA}\nexport const guardar = (x) => {\n  x.p = Prisma;\n};`,
      ],
      ['asignado a una variable con let', `${IMPORTA_PRISMA}\nlet atajo;\natajo = Prisma;\nexport { atajo };`],
      ['un alias asignado', `${IMPORTA_ALIAS}\nconst Q = P;\nexport const x = Q;`],
      ['G.Prisma asignado', `${IMPORTA_ESPACIO}\nconst P = G.Prisma;\nexport const x = P;`],
      ['G asignado', `${IMPORTA_ESPACIO}\nconst todo = G;\nexport const x = todo;`],
      ['dentro de un objeto literal', `${IMPORTA_PRISMA}\nexport const x = { p: Prisma };`],
      ['dentro de un arreglo', `${IMPORTA_PRISMA}\nexport const x = [Prisma];`],
      ['como valor por defecto de un parametro', `${IMPORTA_PRISMA}\nexport const f = (p = Prisma) => p;`],
      [
        'pasado como argumento a una funcion (f(G), ejemplo de la especificacion)',
        `${IMPORTA_ESPACIO}\nexport const x = f(G);`,
      ],
      ['Prisma pasado como argumento a una funcion', `${IMPORTA_PRISMA}\nexport const x = usar(Prisma);`],
      [
        'Reflect.get(Prisma, "raw") (ejemplo de la especificacion)',
        `${IMPORTA_PRISMA}\nexport const x = Reflect.get(Prisma, 'raw');`,
      ],
      [
        'Object.getOwnPropertyDescriptor(Prisma, "raw") (ejemplo de la especificacion)',
        `${IMPORTA_PRISMA}\nexport const x = Object.getOwnPropertyDescriptor(Prisma, 'raw');`,
      ],
      ['Reflect.ownKeys(Prisma)', `${IMPORTA_PRISMA}\nexport const x = Reflect.ownKeys(Prisma);`],
      ['Reflect.get sobre un alias', `${IMPORTA_ALIAS}\nexport const x = Reflect.get(P, 'raw');`],
      ['Reflect.get sobre G.Prisma', `${IMPORTA_ESPACIO}\nexport const x = Reflect.get(G.Prisma, 'raw');`],
      ['Object.keys(Prisma)', `${IMPORTA_PRISMA}\nexport const x = Object.keys(Prisma);`],
      ['Object.values(Prisma)', `${IMPORTA_PRISMA}\nexport const x = Object.values(Prisma);`],
      ['Object.entries(Prisma)', `${IMPORTA_PRISMA}\nexport const x = Object.entries(Prisma);`],
      ['Object.assign({}, Prisma)', `${IMPORTA_PRISMA}\nexport const x = Object.assign({}, Prisma);`],
      [
        'Object.getOwnPropertyDescriptors(Prisma)',
        `${IMPORTA_PRISMA}\nexport const x = Object.getOwnPropertyDescriptors(Prisma);`,
      ],
      [
        'Object.getPrototypeOf(Prisma.empty)',
        `${IMPORTA_PRISMA}\nexport const x = Object.getPrototypeOf(Prisma.empty);`,
      ],
      ['Object.keys(G)', `${IMPORTA_ESPACIO}\nexport const x = Object.keys(G);`],
      ['propagado (...Prisma, ejemplo de la especificacion)', `${IMPORTA_PRISMA}\nexport const x = { ...Prisma };`],
      ['propagado en un arreglo', `${IMPORTA_PRISMA}\nexport const x = [...Prisma];`],
      ['propagado como argumentos', `${IMPORTA_PRISMA}\nexport const x = f(...Prisma);`],
      ['devuelto por una funcion', `${IMPORTA_PRISMA}\nexport const obtener = () => Prisma;`],
      ['devuelto con return', `${IMPORTA_PRISMA}\nexport function obtener() {\n  return Prisma;\n}`],
      ['devuelto el espacio de nombres', `${IMPORTA_ESPACIO}\nexport function obtener() {\n  return G;\n}`],
      ['exportado como valor con export { Prisma }', `${IMPORTA_PRISMA}\nexport { Prisma };`],
      ['exportado con un nombre nuevo', `${IMPORTA_PRISMA}\nexport { Prisma as ClientePrisma };`],
      ['exportado por defecto', `${IMPORTA_PRISMA}\nexport default Prisma;`],
      ['acceso calculado con una variable (Prisma[x])', `${IMPORTA_PRISMA}\nexport const f = (x) => Prisma[x];`],
      ['acceso calculado con un literal (Prisma["raw"])', `${IMPORTA_PRISMA}\nexport const x = Prisma['raw'];`],
      ['acceso calculado con un literal sobre un alias', `${IMPORTA_ALIAS}\nexport const x = P['raw'];`],
      [
        'acceso calculado G["Prisma"] (ejemplo de la especificacion)',
        `${IMPORTA_ESPACIO}\nexport const x = G['Prisma'];`,
      ],
      ['acceso calculado con una plantilla', `${IMPORTA_PRISMA}\nexport const x = Prisma[\`raw\`];`],
      ['acceso opcional calculado', `${IMPORTA_PRISMA}\nexport const f = (x) => Prisma?.[x];`],
      ['usado como condicion (valor)', `${IMPORTA_PRISMA}\nexport const x = Prisma ? 1 : 2;`],
      ['usado con typeof', `${IMPORTA_PRISMA}\nexport const x = typeof Prisma;`],
      ['usado con ??', `${IMPORTA_PRISMA}\nexport const x = Prisma ?? null;`],
      ['usado en una comparacion', `${IMPORTA_PRISMA}\nexport const x = (y) => y === Prisma;`],
      ['usado con la importacion por defecto', `import P from ${CLIENTE};\nexport const x = P;`],
      ['usado con la importacion por defecto de @prisma/...', `import P from ${RUNTIME};\nexport const x = [P];`],
    ])('criterio 113: %s falla el lint', async (_nombre, codigo) => {
      await falla(codigo);
    });
  });

  describe('criterio 113: desestructurar sql, raw, join, empty o Sql de Prisma (o G.Prisma), una clave calculada o un resto', () => {
    it.each([
      [
        'sql con alias (ejemplo de la especificacion)',
        `${IMPORTA_PRISMA}\nconst { sql: s } = Prisma;\nexport const x = s;`,
      ],
      ['sql', `${IMPORTA_PRISMA}\nconst { sql } = Prisma;\nexport const x = sql;`],
      ['raw', `${IMPORTA_PRISMA}\nconst { raw } = Prisma;\nexport const x = raw;`],
      ['join', `${IMPORTA_PRISMA}\nconst { join } = Prisma;\nexport const x = join;`],
      ['empty', `${IMPORTA_PRISMA}\nconst { empty } = Prisma;\nexport const x = empty;`],
      ['Sql', `${IMPORTA_PRISMA}\nconst { Sql } = Prisma;\nexport const x = Sql;`],
      ['raw con alias', `${IMPORTA_PRISMA}\nconst { raw: sinFiltro } = Prisma;\nexport const x = sinFiltro;`],
      [
        'raw junto con un nombre que si pasa',
        `${IMPORTA_PRISMA}\nconst { Decimal, raw } = Prisma;\nexport const x = [Decimal, raw];`,
      ],
      ['raw de un alias', `${IMPORTA_ALIAS}\nconst { raw } = P;\nexport const x = raw;`],
      ['raw de G.Prisma', `${IMPORTA_ESPACIO}\nconst { raw } = G.Prisma;\nexport const x = raw;`],
      ['sql de G.Prisma con alias', `${IMPORTA_ESPACIO}\nconst { sql: s } = G.Prisma;\nexport const x = s;`],
      [
        'una clave calculada',
        `${IMPORTA_PRISMA}\nexport const f = (nombre) => {\n  const { [nombre]: valor } = Prisma;\n  return valor;\n};`,
      ],
      [
        'un resto (...resto)',
        `${IMPORTA_PRISMA}\nconst { Decimal, ...resto } = Prisma;\nexport const x = [Decimal, resto];`,
      ],
      ['solo un resto', `${IMPORTA_PRISMA}\nconst { ...todo } = Prisma;\nexport const x = todo;`],
      ['un resto de G.Prisma', `${IMPORTA_ESPACIO}\nconst { ...todo } = G.Prisma;\nexport const x = todo;`],
      ['en los parametros de una funcion', `${IMPORTA_PRISMA}\nexport const f = ({ raw } = Prisma) => raw;`],
      ['una asignacion de desestructuracion', `${IMPORTA_PRISMA}\nlet raw;\n({ raw } = Prisma);\nexport { raw };`],
      ['desestructurar G para llegar a Prisma', `${IMPORTA_ESPACIO}\nconst { Prisma } = G;\nexport const x = Prisma;`],
    ])('criterio 113: desestructurar %s falla el lint', async (_nombre, codigo) => {
      await falla(codigo);
    });
  });

  describe('criterio 113: constructor, prototype y __proto__ en cualquier punto de la cadena', () => {
    it.each([
      [
        'Prisma.empty.constructor (ejemplo de la especificacion)',
        `${IMPORTA_PRISMA}\nexport const x = Prisma.empty.constructor;`,
      ],
      [
        'Prisma.sql`x`.constructor (ejemplo de la especificacion)',
        `${IMPORTA_PRISMA}\nexport const x = Prisma.sql\`x\`.constructor;`,
      ],
      ['Prisma.empty.constructor llamada', `${IMPORTA_PRISMA}\nexport const x = Prisma.empty.constructor('SELECT 1');`],
      ['Prisma.empty.constructor.name', `${IMPORTA_PRISMA}\nexport const x = Prisma.empty.constructor.name;`],
      ['Prisma.prototype', `${IMPORTA_PRISMA}\nexport const x = Prisma.prototype;`],
      ['Prisma.__proto__', `${IMPORTA_PRISMA}\nexport const x = Prisma.__proto__;`],
      ['Prisma.constructor', `${IMPORTA_PRISMA}\nexport const x = Prisma.constructor;`],
      ['Prisma.sql.prototype', `${IMPORTA_PRISMA}\nexport const x = Prisma.sql.prototype;`],
      ['Prisma.Decimal.prototype', `${IMPORTA_PRISMA}\nexport const x = Prisma.Decimal.prototype;`],
      [
        'Prisma.sql`x`.__proto__.constructor',
        `${IMPORTA_PRISMA}\nexport const x = Prisma.sql\`x\`.__proto__.constructor;`,
      ],
      ['un alias .empty.constructor', `${IMPORTA_ALIAS}\nexport const x = P.empty.constructor;`],
      ['G.Prisma.empty.constructor', `${IMPORTA_ESPACIO}\nexport const x = G.Prisma.empty.constructor;`],
      ['G.constructor', `${IMPORTA_ESPACIO}\nexport const x = G.constructor;`],
      ['G.Prisma.prototype', `${IMPORTA_ESPACIO}\nexport const x = G.Prisma.prototype;`],
      ['acceso opcional a constructor', `${IMPORTA_PRISMA}\nexport const x = Prisma.empty?.constructor;`],
      [
        'cadena con una llamada y luego constructor',
        `${IMPORTA_PRISMA}\nexport const x = Prisma.join([1]).constructor;`,
      ],
    ])('criterio 113: %s falla el lint', async (_nombre, codigo) => {
      await falla(codigo);
    });
  });

  describe('criterio 113: el cliente generado o @prisma/... cargado con require() o import() en lugar de un import estatico', () => {
    it.each([
      ['require del cliente generado', `const g = require(${CLIENTE});\nexport const x = g;`],
      [
        'require del cliente generado con extension',
        "const g = require('../generated/prisma/client.js');\nexport const x = g;",
      ],
      ['require y acceso directo', `export const x = require(${CLIENTE}).Prisma;`],
      ['require de @prisma/client', "const g = require('@prisma/client');\nexport const x = g;"],
      ['require de @prisma/client/runtime', `const g = require(${RUNTIME});\nexport const x = g;`],
      ['import() del cliente generado', `export const cargar = () => import(${CLIENTE});`],
      [
        'import() del cliente generado con una plantilla',
        'export const cargar = () => import(`../generated/prisma/client`);',
      ],
      ['import() de @prisma/client/runtime', `export const cargar = () => import(${RUNTIME});`],
      ['import() con await', `export const cargar = async () => (await import(${CLIENTE})).Prisma;`],
      ['import x = require()', `import g = require(${CLIENTE});\nexport const x = g;`],
      [
        'require del cliente generado desde una carpeta distinta',
        "export const g = require('../../generated/prisma/client');",
      ],
      // Casos que el criterio 85 dejaba pasar en cli/ y que, por la decision del orquestador tras la ronda 4 (11/11/2026), ahora
      // fallan (el 113 manda). Cada via con cada modulo de la lista de la especificacion.
      ['import() de @prisma/client', "export const cargar = () => import('@prisma/client');"],
      [
        'import() de @prisma/client/runtime/library',
        "export const cargar = () => import('@prisma/client/runtime/library');",
      ],
      ['import() de @prisma/adapter-pg', "export const cargar = () => import('@prisma/adapter-pg');"],
      ['import() de otro @prisma/...', "export const cargar = () => import('@prisma/adapter-neon');"],
      ['import() con comillas dobles', 'export const cargar = () => import("../generated/prisma/client");'],
      ['require de @prisma/client/runtime/library', "export const g = require('@prisma/client/runtime/library');"],
      ['require de @prisma/adapter-pg', "export const g = require('@prisma/adapter-pg');"],
      ['require de otro @prisma/...', "export const g = require('@prisma/adapter-neon');"],
      [
        'require de @prisma/client precedido de eslint-disable-next-line',
        "// eslint-disable-next-line @typescript-eslint/no-require-imports\nexport const g = require('@prisma/client');",
      ],
      ['import P = require() de @prisma/client', "import P = require('@prisma/client');\nexport const x = P;"],
      ['import P = require() de @prisma/adapter-pg', "import P = require('@prisma/adapter-pg');\nexport const x = P;"],
      [
        'import P = require() de @prisma/client/runtime/library',
        "import P = require('@prisma/client/runtime/library');\nexport const x = P;",
      ],
      [
        'import * as Prisma exportado como valor (ejemplo de la especificacion)',
        `import * as Prisma from ${CLIENTE};\nexport const x = Prisma;`,
      ],
    ])('criterio 113: %s falla el lint en cli/', async (_nombre, codigo) => {
      await falla(codigo);
    });
  });

  describe('criterio 113 (precision): import(), require() y createRequire que no se pueden seguir fallan en cli/', () => {
    it.each([
      ['import(ruta)', 'export const cargar = (ruta) => import(ruta);'],
      ['import(ruta) con await', 'export const cargar = async (ruta) => (await import(ruta)).default;'],
      [
        'import con una plantilla con ${} (ejemplo de la especificacion)',
        'export const cargar = (x) => import(`../generated/${x}/client`);',
      ],
      ['import con una concatenacion', "export const cargar = (x) => import('../' + x);"],
      ['import con una llamada', 'export const cargar = (x) => import(x.toString());'],
      [
        'import con una constante',
        "const ruta = '../generated/prisma/client';\nexport const cargar = () => import(ruta);",
      ],
      ['require(ruta)', 'export const cargar = (ruta) => require(ruta);'],
      [
        'require con una concatenacion (ejemplo de la especificacion)',
        "export const cargar = (x) => require('../' + x);",
      ],
      ['require con una plantilla con ${}', 'export const cargar = (x) => require(`./${x}`);'],
      ['require con una llamada', 'export const cargar = (x) => require(x.toString());'],
      ['require con una constante', "const ruta = 'pg';\nexport const m = require(ruta);"],
      [
        "createRequire importado de 'node:module'",
        "import { createRequire } from 'node:module';\nexport const requerir = createRequire(import.meta.url);",
      ],
      [
        "createRequire importado de 'module'",
        "import { createRequire } from 'module';\nexport const requerir = createRequire(import.meta.url);",
      ],
      [
        "createRequire con alias importado de 'module' (ejemplo de la especificacion)",
        "import { createRequire as c } from 'module';\nexport const requerir = c(import.meta.url);",
      ],
      [
        "createRequire con alias importado de 'node:module'",
        "import { createRequire as crear } from 'node:module';\nexport const requerir = crear(import.meta.url);",
      ],
      [
        "createRequire de import * as m from 'node:module' (ejemplo de la especificacion)",
        "import * as m from 'node:module';\nexport const requerir = m.createRequire(import.meta.url);",
      ],
      [
        "createRequire de import * as m from 'module'",
        "import * as m from 'module';\nexport const requerir = m.createRequire(import.meta.url);",
      ],
      [
        'createRequire de la importacion por defecto',
        "import modulo from 'node:module';\nexport const requerir = modulo.createRequire(import.meta.url);",
      ],
      [
        'createRequire importado y no usado',
        "import { createRequire } from 'node:module';\nexport const x = typeof createRequire;",
      ],
      ["createRequire reexportado con export { } from 'node:module'", "export { createRequire } from 'node:module';"],
      [
        'la funcion que devuelve createRequire llamada de inmediato (ejemplo de la especificacion)',
        "import { createRequire } from 'node:module';\nexport const g = createRequire(import.meta.url)('../generated/prisma/client');",
      ],
      [
        'la funcion que devuelve createRequire guardada y llamada (ejemplo de la especificacion)',
        "import { createRequire } from 'node:module';\nconst r = createRequire(__filename);\nexport const pg = r('pg');",
      ],
      [
        'la funcion que devuelve createRequire, con un alias y un espacio de nombres',
        "import * as m from 'node:module';\nconst r = m.createRequire(import.meta.url);\nexport const g = r('@prisma/client');",
      ],
      [
        'createRequire obtenido con require()',
        "const { createRequire } = require('node:module');\nexport const r = createRequire(__filename);",
      ],
      [
        'createRequire obtenido con import() dinamico',
        "export const r = async () => (await import('node:module')).createRequire(__filename);",
      ],
    ])('criterio 113: %s falla el lint en cli/', async (_nombre, codigo) => {
      await falla(codigo);
    });
  });

  describe('criterio 113: se mantienen las prohibiciones del criterio 92, tambien con los alias', () => {
    it.each([
      ['Prisma.raw', `${IMPORTA_PRISMA}\nexport const x = (c) => c.$executeRaw(Prisma.raw('RESET ALL'));`],
      [
        'P.raw con Prisma as P (ejemplo de la especificacion)',
        `${IMPORTA_ALIAS}\nexport const x = (c) => c.$executeRaw(P.raw('RESET ALL'));`,
      ],
      [
        'G.Prisma.raw con import * as G (ejemplo de la especificacion)',
        `${IMPORTA_ESPACIO}\nexport const x = (c) => c.$executeRaw(G.Prisma.raw('RESET ALL'));`,
      ],
      ['Prisma.Sql como valor', `${IMPORTA_PRISMA}\nexport const x = Prisma.Sql;`],
      ['new P.Sql', `${IMPORTA_ALIAS}\nexport const x = new P.Sql(['SELECT 1'], []);`],
      ['G.Prisma.Sql como valor', `${IMPORTA_ESPACIO}\nexport const x = G.Prisma.Sql;`],
      ['Prisma.join con separador', `${IMPORTA_PRISMA}\nexport const x = (ids) => Prisma.join(ids, '; RESET ALL; ');`],
      ['P.join con separador', `${IMPORTA_ALIAS}\nexport const x = (ids) => P.join(ids, '; RESET ALL; ');`],
      ['G.Prisma.join con separador', `${IMPORTA_ESPACIO}\nexport const x = (ids) => G.Prisma.join(ids, '; ');`],
      ['Prisma.sql como funcion', `${IMPORTA_PRISMA}\nexport const x = Prisma.sql(['SELECT 1']);`],
      ['P.sql como funcion', `${IMPORTA_ALIAS}\nexport const x = P.sql(['SELECT 1']);`],
      ['G.Prisma.sql como funcion', `${IMPORTA_ESPACIO}\nexport const x = G.Prisma.sql(['SELECT 1']);`],
      [
        'raw importado del cliente generado con un alias',
        `import { raw as sinFiltro } from ${CLIENTE};\nexport const x = sinFiltro;`,
      ],
    ])('criterio 113: %s falla el lint', async (_nombre, codigo) => {
      await falla(codigo);
    });
  });

  describe('criterio 113: lo que pasa en cli/', () => {
    it.each([
      [
        'PrismaClient con new (ejemplo de la especificacion)',
        `import { PrismaClient } from ${CLIENTE};\nexport const crear = (adaptador) => new PrismaClient({ adapter: adaptador });`,
      ],
      ['PrismaClient importado', `import { PrismaClient } from ${CLIENTE};\nexport const x = PrismaClient;`],
      [
        'PrismaClient y PrismaPg',
        `import { PrismaPg } from '@prisma/adapter-pg';\nimport { PrismaClient } from ${CLIENTE};\nexport const x = [PrismaPg, PrismaClient];`,
      ],
      [
        'Prisma as P con P.sql como etiqueta (ejemplo de la especificacion)',
        `${IMPORTA_ALIAS}\nexport const f = (cliente) => cliente.$queryRaw(P.sql\`SELECT 1\`);`,
      ],
      ['Prisma.sql como etiqueta', `${IMPORTA_PRISMA}\nexport const f = (id) => Prisma.sql\`SELECT \${id}\`;`],
      ['G.Prisma.sql como etiqueta', `${IMPORTA_ESPACIO}\nexport const f = (id) => G.Prisma.sql\`SELECT \${id}\`;`],
      [
        'import type { Prisma } (ejemplo de la especificacion)',
        `import type { Prisma } from ${CLIENTE};\nexport type Json = Prisma.JsonValue;`,
      ],
      ['import { type Prisma }', `import { type Prisma } from ${CLIENTE};\nexport type Json = Prisma.JsonValue;`],
      ['Prisma.Sql como tipo', `import type { Prisma } from ${CLIENTE};\nexport type Consulta = Prisma.Sql;`],
      [
        'Prisma como tipo en parametros',
        `${IMPORTA_PRISMA}\nexport const f = (cliente: Prisma.TransactionClient) => cliente;`,
      ],
      [
        'Prisma.join con un solo argumento',
        `${IMPORTA_PRISMA}\nexport const f = (ids) => Prisma.sql\`SELECT \${Prisma.join(ids)}\`;`,
      ],
      [
        'Prisma.empty como valor de una interpolacion',
        `${IMPORTA_PRISMA}\nexport const f = (id) => Prisma.sql\`SELECT \${id} \${Prisma.empty}\`;`,
      ],
      [
        'instanceof con un error de Prisma',
        `${IMPORTA_PRISMA}\nexport const esDePrisma = (error) => error instanceof Prisma.PrismaClientKnownRequestError;`,
      ],
      ['new Prisma.Decimal', `${IMPORTA_PRISMA}\nexport const x = new Prisma.Decimal('10.50');`],
      ['Prisma.ModelName con punto', `${IMPORTA_PRISMA}\nexport const x = Prisma.ModelName;`],
      // Precision del criterio 113 (11/11/2026): lo que sigue pasando con las cargas que no se pueden seguir.
      ['import pg from pg (ejemplo de la especificacion)', "import pg from 'pg';\nexport const x = pg;"],
      ['import { Pool } from pg', "import { Pool } from 'pg';\nexport const x = Pool;"],
      ['import pg-pool', "import Pool from 'pg-pool';\nexport const x = Pool;"],
      [
        'import * as G con G.Prisma.sql como etiqueta (ejemplo de la especificacion)',
        `${IMPORTA_ESPACIO}\nexport const f = (cliente) => cliente.$queryRaw(G.Prisma.sql\`SELECT 1\`);`,
      ],
      ['import * as G con G.PrismaClient', `${IMPORTA_ESPACIO}\nexport const x = G.PrismaClient;`],
      [
        'import por defecto de pg junto con el cliente',
        `import pg from 'pg';\nimport { PrismaClient } from ${CLIENTE};\nexport const x = [pg, PrismaClient];`,
      ],
      ['import() con una cadena literal de un modulo propio', "export const cargar = () => import('./otro-modulo');"],
      [
        'import() con una plantilla sin ${} de un modulo propio',
        'export const cargar = () => import(`./otro-modulo`);',
      ],
      ['require() con una cadena literal de un modulo propio', "export const m = require('./otro-modulo');"],
      [
        'import de otro nombre de node:module',
        "import { builtinModules } from 'node:module';\nexport const x = builtinModules;",
      ],
      ['import de node:fs', "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;"],
      [
        'import de un enum del cliente generado',
        `import { EstadoAcademia } from '../generated/prisma/enums';\nexport const x = EstadoAcademia;`,
      ],
    ])('criterio 113: %s pasa el lint', async (_nombre, codigo) => {
      await pasa(codigo);
    });
  });
});
