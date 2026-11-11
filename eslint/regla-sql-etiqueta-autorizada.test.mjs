// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 112 (ataque ronda 4, F6; ajusta el alcance del criterio 92 en cuanto a que `sql` y que `Prisma.sql` se aceptan), parte
// de la regla de lint. Dado el codigo de backend/src/ fuera de infraestructura/prisma/ y de las pruebas:
//   - `$queryRaw` y `$executeRaw` llamados con un argumento (no como etiqueta) solo aceptan, como ese unico argumento, una
//     plantilla etiquetada con:
//       * en los modulos: la funcion `sql` importada del punto autorizado (`.../infraestructura/prisma` o
//         `.../infraestructura/prisma/index`), con su nombre, con alias (`import { sql as s }`) o como `<espacio>.sql` de un
//         `import * as <espacio>` de ese punto; la regla lo decide por el ambito (`scope`) de ESLint, no por el nombre, asi que
//         una `sql` declarada en el archivo, un parametro llamado `sql` o una `sql` importada de otro sitio no se aceptan;
//       * en cli/: `Prisma.sql`, con `Prisma` importado del cliente generado, o la `sql` del punto autorizado;
//     cualquier otro argumento (un objeto, una llamada, una variable, otra etiqueta) hace fallar el lint;
//   - la regla del texto del SQL (criterios 73, 83, 84, 93, 94 y 109) sigue analizando toda plantilla cuya etiqueta sea un
//     identificador `sql` (venga de donde venga), una propiedad `.sql`, `.$queryRaw` o `.$executeRaw`, o un alias de `sql` del
//     punto autorizado: analizar de mas no abre caminos.
// Se prueba con las dos configuraciones (eslint.config.mjs y la del paso protegido).
import { describe, expect, it } from 'vitest';
import { CLI, CONFIGURACIONES, MODULO, PRISMA, PUNTO, PUNTO_DESDE_CLI, errores } from './ayuda-lint-ronda4.mjs';

const PRISMA_CLIENTE_DESDE_CLI = '../generated/prisma/client';

describe.each(CONFIGURACIONES)('criterio 112 (regla) con %s', (_configuracion, obtener) => {
  /** Rechazado en el archivo indicado y limpio en backend/src/infraestructura/prisma/. */
  async function rechazado(codigo, archivos) {
    expect(await errores(obtener(), codigo, PRISMA), `en prisma/ no debia fallar: ${codigo}`).toEqual([]);
    for (const archivo of archivos) {
      expect(
        (await errores(obtener(), codigo, archivo)).length,
        `el lint no rechazo en ${archivo}: ${codigo}`,
      ).toBeGreaterThan(0);
    }
  }
  async function pasa(codigo, archivos) {
    for (const archivo of archivos) {
      expect(await errores(obtener(), codigo, archivo), `el lint rechazo en ${archivo}: ${codigo}`).toEqual([]);
    }
  }

  describe('criterio 112: en un modulo, lo que NO se acepta como argumento de $queryRaw / $executeRaw', () => {
    for (const metodo of ['$queryRaw', '$executeRaw']) {
      it.each([
        [
          'una sql declarada en el archivo (ejemplo de la especificacion, con SET ROLE)',
          `const sql = (s) => ({ text: s[0] });\nexport const f = (cliente) => cliente.${metodo}(sql\`SET ROLE postgres\`);`,
        ],
        [
          'una sql declarada en el archivo (SQL inofensivo: falla solo por la etiqueta)',
          `const sql = (s) => ({ text: s[0] });\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        [
          'una sql declarada con function',
          `function sql(s) {\n  return { text: s[0] };\n}\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        [
          'una sql declarada con let',
          `let sql = (s) => ({ text: s[0] });\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        ['un parametro llamado sql', `export const f = (cliente, sql) => cliente.${metodo}(sql\`SELECT 1\`);`],
        [
          'una sql importada de otro sitio',
          `import { sql } from '../../otro/sitio';\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        [
          'una sql importada de un paquete',
          `import { sql } from 'sql-template-tag';\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        [
          'una sql del punto autorizado tapada por un parametro del mismo nombre',
          `import { sql } from '${PUNTO}';\nexport const f = (cliente, sql) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        [
          'una sql del punto autorizado tapada por una declaracion en un bloque',
          `import { sql } from '${PUNTO}';\nexport const f = (cliente) => {\n  const sql = (s) => ({ text: s[0] });\n  return cliente.${metodo}(sql\`SELECT 1\`);\n};`,
        ],
        [
          'Prisma.sql sin Prisma de valor (ejemplo de la especificacion)',
          `export const f = (cliente) => cliente.${metodo}(Prisma.sql\`SELECT 1\`);`,
        ],
        [
          'otra.sql de un espacio de nombres de otro sitio',
          `import * as otro from '../../otro/sitio';\nexport const f = (cliente) => cliente.${metodo}(otro.sql\`SELECT 1\`);`,
        ],
        [
          'un objeto con sql como propiedad',
          `export const f = (cliente, objeto) => cliente.${metodo}(objeto.sql\`SELECT 1\`);`,
        ],
        [
          'una variable (ejemplo de la especificacion)',
          `export const f = (cliente, consulta) => cliente.${metodo}(consulta);`,
        ],
        [
          'otra etiqueta (ejemplo de la especificacion)',
          `export const f = (cliente) => cliente.${metodo}(otra\`SELECT 1\`);`,
        ],
        [
          'otra etiqueta que es una propiedad',
          `export const f = (cliente, util) => cliente.${metodo}(util.etiqueta\`SELECT 1\`);`,
        ],
        ['un objeto literal', `export const f = (cliente) => cliente.${metodo}({ text: 'SELECT 1', values: [] });`],
        ['una llamada', `export const f = (cliente, armar) => cliente.${metodo}(armar());`],
        [
          'el resultado de join del punto autorizado (una llamada)',
          `import { join } from '${PUNTO}';\nexport const f = (cliente, ids) => cliente.${metodo}(join(ids));`,
        ],
        [
          'vacio del punto autorizado como variable',
          `import { vacio } from '${PUNTO}';\nexport const f = (cliente) => cliente.${metodo}(vacio);`,
        ],
        [
          'una variable que guarda un fragmento del punto autorizado',
          `import { sql } from '${PUNTO}';\nexport const f = (cliente) => {\n  const consulta = sql\`SELECT 1\`;\n  return cliente.${metodo}(consulta);\n};`,
        ],
        [
          'la sql del punto autorizado pero con un segundo argumento',
          `import { sql } from '${PUNTO}';\nexport const f = (cliente, x) => cliente.${metodo}(sql\`SELECT 1\`, x);`,
        ],
        [
          'una sql del punto autorizado llamada como funcion',
          `import { sql } from '${PUNTO}';\nexport const f = (cliente) => cliente.${metodo}(sql(['SELECT 1']));`,
        ],
        ['una plantilla sin etiqueta', `export const f = (cliente) => cliente.${metodo}(\`SELECT 1\`);`],
      ])('criterio 112: %s falla el lint', async (_nombre, codigo) => {
        await rechazado(codigo, [MODULO]);
      });
    }
  });

  describe('criterio 112: en un modulo, lo que SI se acepta', () => {
    for (const metodo of ['$queryRaw', '$executeRaw']) {
      it.each([
        [
          'la sql importada del punto autorizado (ejemplo de la especificacion)',
          `import { sql } from '${PUNTO}';\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        [
          'la sql importada de .../infraestructura/prisma/index',
          `import { sql } from '${PUNTO}/index';\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        [
          'la sql importada con la extension del archivo del index',
          `import { sql } from '${PUNTO}/index.js';\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        [
          'la sql con un alias (import { sql as s })',
          `import { sql as s } from '${PUNTO}';\nexport const f = (cliente) => cliente.${metodo}(s\`SELECT 1\`);`,
        ],
        [
          'la sql como <espacio>.sql de un import * as',
          `import * as bd from '${PUNTO}';\nexport const f = (cliente) => cliente.${metodo}(bd.sql\`SELECT 1\`);`,
        ],
        [
          'la sql con valores interpolados',
          `import { sql } from '${PUNTO}';\nexport const f = (cliente, id) => cliente.${metodo}(sql\`SELECT * FROM t WHERE id = \${id}::uuid\`);`,
        ],
        [
          'la sql con fragmentos interpolados (join y vacio)',
          `import { join, sql, vacio } from '${PUNTO}';\nexport const f = (cliente, ids, desde) => {\n  const filtro = desde ? sql\`AND fecha_hora >= \${desde}\` : vacio;\n  return cliente.${metodo}(sql\`SELECT * FROM t WHERE id IN (\${join(ids)}) \${filtro}\`);\n};`,
        ],
        ['la plantilla etiquetada directa', `export const f = (cliente) => cliente.${metodo}\`SELECT 1\`;`],
        [
          'la plantilla etiquetada directa con un tipo generico',
          `export const f = (cliente) => cliente.${metodo}<{ n: number }[]>\`SELECT 1 AS n\`;`,
        ],
        [
          'la sql importada junto con otros nombres del punto autorizado',
          `import { Decimal, esViolacionDeUnicidad, sql } from '${PUNTO}';\nexport const f = (cliente) => [Decimal, esViolacionDeUnicidad, cliente.${metodo}(sql\`SELECT 1\`)];`,
        ],
      ])('criterio 112: %s pasa el lint', async (_nombre, codigo) => {
        await pasa(codigo, [MODULO]);
      });
    }
  });

  describe('criterio 112: en cli/', () => {
    for (const metodo of ['$queryRaw', '$executeRaw']) {
      it.each([
        [
          'Prisma.sql con Prisma importado del cliente generado (ejemplo de la especificacion)',
          `import { Prisma } from '${PRISMA_CLIENTE_DESDE_CLI}';\nexport const f = (cliente) => cliente.${metodo}(Prisma.sql\`SELECT 1\`);`,
        ],
        [
          'Prisma.sql con Prisma y un alias',
          `import { Prisma as P } from '${PRISMA_CLIENTE_DESDE_CLI}';\nexport const f = (cliente) => cliente.${metodo}(P.sql\`SELECT 1\`);`,
        ],
        [
          'Prisma.sql con Prisma como espacio de nombres (G.Prisma.sql)',
          `import * as G from '${PRISMA_CLIENTE_DESDE_CLI}';\nexport const f = (cliente) => cliente.${metodo}(G.Prisma.sql\`SELECT 1\`);`,
        ],
        [
          'la sql del punto autorizado',
          `import { sql } from '${PUNTO_DESDE_CLI}';\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        ['la plantilla etiquetada directa', `export const f = (cliente) => cliente.${metodo}\`SELECT 1\`;`],
      ])('criterio 112: %s pasa el lint', async (_nombre, codigo) => {
        await pasa(codigo, [CLI]);
      });

      it.each([
        ['Prisma.sql sin importar Prisma', `export const f = (cliente) => cliente.${metodo}(Prisma.sql\`SELECT 1\`);`],
        [
          'Prisma.sql con Prisma importado de otro sitio',
          `import { Prisma } from '../otro/sitio';\nexport const f = (cliente) => cliente.${metodo}(Prisma.sql\`SELECT 1\`);`,
        ],
        [
          'una sql declarada en el archivo',
          `const sql = (s) => ({ text: s[0] });\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        [
          'un parametro llamado Prisma',
          `export const f = (cliente, Prisma) => cliente.${metodo}(Prisma.sql\`SELECT 1\`);`,
        ],
        [
          'una sql importada de otro sitio',
          `import { sql } from '../otro/sitio';\nexport const f = (cliente) => cliente.${metodo}(sql\`SELECT 1\`);`,
        ],
        ['una variable', `export const f = (cliente, consulta) => cliente.${metodo}(consulta);`],
        ['otra etiqueta', `export const f = (cliente) => cliente.${metodo}(otra\`SELECT 1\`);`],
        ['un objeto', `export const f = (cliente) => cliente.${metodo}({ text: 'SELECT 1', values: [] });`],
        ['una llamada', `export const f = (cliente, armar) => cliente.${metodo}(armar());`],
      ])('criterio 112: %s falla el lint en cli/', async (_nombre, codigo) => {
        await rechazado(codigo, [CLI]);
      });
    }
  });

  describe('criterio 112: la regla del texto del SQL sigue analizando toda plantilla con una etiqueta sql', () => {
    it.each([
      [
        'un identificador sql declarado en el archivo',
        'const sql = (s) => s;\nexport const x = sql`SET ROLE postgres`;',
      ],
      ['un parametro llamado sql', 'export const f = (sql) => sql`SET ROLE postgres`;'],
      [
        'una sql importada de otro sitio',
        "import { sql } from '../../otro/sitio';\nexport const x = sql`SET ROLE postgres`;",
      ],
      ['una propiedad .sql de cualquier objeto', 'export const f = (util) => util.sql`SET ROLE postgres`;'],
      [
        'un alias de la sql del punto autorizado',
        `import { sql as s } from '${PUNTO}';\nexport const x = s\`SET ROLE postgres\`;`,
      ],
      ['la sql del punto autorizado', `import { sql } from '${PUNTO}';\nexport const x = sql\`SET ROLE postgres\`;`],
      [
        'el espacio de nombres del punto autorizado (.sql)',
        `import * as bd from '${PUNTO}';\nexport const x = bd.sql\`SET ROLE postgres\`;`,
      ],
      ['.$queryRaw', 'export const f = (cliente) => cliente.$queryRaw`SET ROLE postgres`;'],
      ['.$executeRaw', 'export const f = (cliente) => cliente.$executeRaw`SET ROLE postgres`;'],
      [
        'SQL de sesion como argumento de una sql local',
        "const sql = (s) => s;\nexport const f = (cliente) => cliente.$queryRaw(sql`SELECT set_config('app.plataforma', 'si', false)`);",
      ],
    ])('criterio 112: %s con SET ROLE falla el lint', async (_nombre, codigo) => {
      await rechazado(codigo, [MODULO, CLI]);
    });
  });
});
