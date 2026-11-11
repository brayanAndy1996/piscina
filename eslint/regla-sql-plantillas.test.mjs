// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 92 (ataque ronda 3, O1, F1 y F4; reemplaza el alcance de los criterios 73, 83 y 84 en cuanto a que texto se
// analiza): el SQL solo llega a la base en plantillas etiquetadas. Dado el codigo de backend/src/ (sin las pruebas), fuera de
// backend/src/infraestructura/prisma/ (tambien en backend/src/cli/), `npm run lint` falla si:
//   - se nombra `$queryRawUnsafe` o `$executeRawUnsafe` de cualquier forma (punto, corchetes con un literal,
//     desestructuracion, o una cadena o plantilla cuyo texto los contiene);
//   - `$queryRaw` o `$executeRaw` se usan de otra forma que como etiqueta directa de una plantilla o como llamada cuyo unico
//     argumento es una plantilla etiquetada con `Prisma.sql` o `sql` (variable, corchetes, desestructurado, .call/.apply/.bind,
//     llamado con una variable, una cadena, un arreglo o el resultado de otra funcion);
//   - `Prisma.sql` o `sql` se llaman como funcion;
//   - se usa como valor `Prisma.raw`, `Prisma.Sql` o `Prisma.join` con mas de un argumento, o se importan `raw`, `join` o `Sql`
//     de `generated/prisma` o de `@prisma/...` (con cualquier alias). `Prisma.Sql` como tipo sigue permitido.
// Pasan, entre otros: `stream.on('end', ...)`, `res.setHeader('Set-Cookie', ...)`, `const accion = 'commit'`, textos con
// "reset" o "commit", `/SET ROLE/i` y String.raw`SET ROLE x`.
// (Criterio 112, ataque ronda 4) Los ejemplos que pasan y usaban `Prisma.sql`, `sql` o `Prisma.join` sin importarlos ahora los
// importan: en un modulo, `sql` y `join` del punto autorizado; en cli/, `Prisma` del cliente generado. No se quito ningun ejemplo
// ni cambio el resultado de ninguno que falla.
// Se prueba con las dos configuraciones (eslint.config.mjs y la del paso protegido, criterio 96), sin fijar el nombre de las
// reglas. Un ejemplo "falla" si da error en un modulo y en cli/ y esta limpio en backend/src/infraestructura/prisma/ (asi el
// error es de la regla y no de otra cosa del ejemplo).
import { describe, expect, it } from 'vitest';
import {
  CLI,
  CONFIGURACIONES,
  MODULO,
  PRISMA,
  errores,
  esRechazadoFueraDePrisma,
  pasaElLint,
} from './ayuda-lint-ronda3.mjs';

describe.each(CONFIGURACIONES)('criterio 92 con %s', (_nombre, obtener) => {
  describe('criterio 92: se nombra $queryRawUnsafe o $executeRawUnsafe', () => {
    it.each([
      ['acceso con punto a $queryRawUnsafe', 'export const f = (c, q) => c.$queryRawUnsafe(q);'],
      ['acceso con punto a $executeRawUnsafe', 'export const f = (c, q) => c.$executeRawUnsafe(q);'],
      ['la cadena del SQL literal en $queryRawUnsafe', "export const f = (c) => c.$queryRawUnsafe('SELECT 1');"],
      [
        'tx.cliente.$queryRawUnsafe con una expresion regular',
        'export const f = (tx) => tx.cliente.$queryRawUnsafe(/SET ROLE postgres/.source);',
      ],
      ['corchetes con un literal', "export const f = (cliente, q) => cliente['$executeRawUnsafe'](q);"],
      [
        'corchetes con un literal de $queryRawUnsafe',
        'export const f = (cliente, q) => cliente["$queryRawUnsafe"](q);',
      ],
      [
        'desestructuracion de $queryRawUnsafe',
        'export const f = (cliente) => {\n  const { $queryRawUnsafe } = cliente;\n  return $queryRawUnsafe;\n};',
      ],
      [
        'desestructuracion de $executeRawUnsafe con alias',
        'export const f = (cliente) => {\n  const { $executeRawUnsafe: ejecutar } = cliente;\n  return ejecutar;\n};',
      ],
      ['desestructuracion en los parametros', 'export const f = ({ $queryRawUnsafe }) => $queryRawUnsafe;'],
      ['una cadena cuyo texto contiene $queryRawUnsafe', "export const nombre = '$queryRawUnsafe';"],
      ['una cadena cuyo texto contiene $executeRawUnsafe', "export const nombre = 'metodo: $executeRawUnsafe';"],
      [
        'una plantilla cuyo texto contiene $queryRawUnsafe',
        'export const nombre = (x) => `llamar a $queryRawUnsafe con ${x}`;',
      ],
    ])('criterio 92: %s falla el lint', async (_descripcion, codigo) => {
      await esRechazadoFueraDePrisma(obtener(), codigo);
    });
  });

  describe('criterio 92: $queryRaw y $executeRaw solo como etiqueta o con Prisma.sql / sql', () => {
    for (const metodo of ['$queryRaw', '$executeRaw']) {
      it.each([
        [
          `${metodo} guardado en una variable`,
          `export const f = (cliente) => {\n  const q = cliente.${metodo};\n  return q;\n};`,
        ],
        [
          `${metodo} guardado en una variable y usado como etiqueta`,
          `export const f = async (tx) => {\n  const q = tx.cliente.${metodo};\n  return await q\`SELECT 1\`;\n};`,
        ],
        [
          `${metodo} con corchetes y una plantilla etiquetada`,
          `export const f = (cliente) => cliente['${metodo}']\`SELECT 1\`;`,
        ],
        [`${metodo} con corchetes y una llamada`, `export const f = (cliente, q) => cliente['${metodo}'](q);`],
        [
          `${metodo} desestructurado`,
          `export const f = (cliente) => {\n  const { ${metodo} } = cliente;\n  return ${metodo};\n};`,
        ],
        [`${metodo} desestructurado en los parametros`, `export const f = ({ ${metodo} }) => ${metodo};`],
        [`${metodo}.call`, `export const f = (cliente) => cliente.${metodo}.call(cliente, ['SELECT 1']);`],
        [`${metodo}.apply`, `export const f = (cliente) => cliente.${metodo}.apply(cliente, [['SELECT 1']]);`],
        [`${metodo}.bind`, `export const f = (cliente) => cliente.${metodo}.bind(cliente);`],
        [`${metodo} llamado con una variable`, `export const f = (cliente, consulta) => cliente.${metodo}(consulta);`],
        [`${metodo} llamado con una cadena`, `export const f = (cliente) => cliente.${metodo}('SELECT 1');`],
        [`${metodo} llamado con un arreglo`, `export const f = (cliente) => cliente.${metodo}(['SELECT 1']);`],
        [
          `${metodo} llamado con el resultado de otra funcion`,
          `export const f = (cliente, armar) => cliente.${metodo}(armar());`,
        ],
        [
          `${metodo} llamado con una plantilla sin etiqueta`,
          `export const f = (cliente) => cliente.${metodo}(\`SELECT 1\`);`,
        ],
        [
          `${metodo} llamado con una plantilla con otra etiqueta`,
          `export const f = (cliente) => cliente.${metodo}(String.raw\`SELECT 1\`);`,
        ],
        [
          `${metodo} llamado con Prisma.sql y un segundo argumento`,
          `export const f = (cliente, x) => cliente.${metodo}(Prisma.sql\`SELECT 1\`, x);`,
        ],
        [`${metodo} pasado como argumento`, `export const f = (cliente, usar) => usar(cliente.${metodo});`],
      ])('criterio 92: %s falla el lint', async (_descripcion, codigo) => {
        await esRechazadoFueraDePrisma(obtener(), codigo);
      });
    }
  });

  describe('criterio 92: Prisma.sql y sql solo como etiqueta', () => {
    it.each([
      ['Prisma.sql llamado como funcion con un arreglo', "export const f = () => Prisma.sql(['SELECT 1']);"],
      ['Prisma.sql llamado como funcion con una cadena', "export const f = () => Prisma.sql('SELECT 1');"],
      ['sql llamado como funcion', "export const f = () => sql(['SELECT 1']);"],
      [
        '$queryRaw con Prisma.sql llamado como funcion',
        "export const f = (cliente) => cliente.$queryRaw(Prisma.sql(['SELECT 1']));",
      ],
    ])('criterio 92: %s falla el lint', async (_descripcion, codigo) => {
      await esRechazadoFueraDePrisma(obtener(), codigo);
    });
  });

  describe('criterio 92: Prisma.raw, Prisma.Sql y Prisma.join', () => {
    it.each([
      ['Prisma.raw', "export const f = (cliente) => cliente.$executeRaw(Prisma.raw('RESET ALL'));"],
      ['Prisma.raw guardado en una variable', 'export const f = () => {\n  const r = Prisma.raw;\n  return r;\n};'],
      ['new Prisma.Sql', "export const f = () => new Prisma.Sql(['SELECT 1'], []);"],
      ['Prisma.Sql como valor', 'export const f = () => Prisma.Sql;'],
      ['Prisma.join con un separador', "export const f = (ids) => Prisma.join(ids, '; RESET ALL; ');"],
      ['Prisma.join con tres argumentos', 'export const f = (ids, a, b) => Prisma.join(ids, a, b);'],
    ])('criterio 92: %s falla el lint', async (_descripcion, codigo) => {
      await esRechazadoFueraDePrisma(obtener(), codigo);
    });
  });

  describe('criterio 92: raw, join y Sql importados de generated/prisma o de @prisma (en cli/, donde se pueden importar)', () => {
    // En cli/ importar del cliente generado o de @prisma esta permitido (criterio 85): el rechazo es de este criterio.
    it.each([
      ['raw de @prisma/client', "import { raw } from '@prisma/client/runtime/client';\nexport const x = raw;"],
      ['join de @prisma/client', "import { join } from '@prisma/client/runtime/client';\nexport const x = join;"],
      ['Sql de @prisma/client', "import { Sql } from '@prisma/client/runtime/client';\nexport const x = Sql;"],
      ['raw del cliente generado', "import { raw } from '../generated/prisma/client';\nexport const x = raw;"],
      [
        'raw con un alias',
        "import { raw as sinFiltro } from '../generated/prisma/client';\nexport const x = sinFiltro;",
      ],
      ['join con un alias', "import { join as unir } from '@prisma/client/runtime/client';\nexport const x = unir;"],
      ['Sql con un alias', "import { Sql as Consulta } from '../generated/prisma/client';\nexport const x = Consulta;"],
      [
        'raw junto con otro nombre',
        "import { PrismaClient, raw } from '../generated/prisma/client';\nexport const x = [PrismaClient, raw];",
      ],
    ])('criterio 92: importar %s falla el lint en cli/', async (_descripcion, codigo) => {
      expect(await errores(obtener(), codigo, PRISMA), 'en prisma/ no debia fallar').toEqual([]);
      expect((await errores(obtener(), codigo, CLI)).length, 'cli/').toBeGreaterThan(0);
    });

    it('criterio 92: en cli/ siguen pasando PrismaClient y PrismaPg', async () => {
      const codigo = [
        "import { PrismaPg } from '@prisma/adapter-pg';",
        "import { PrismaClient } from '../generated/prisma/client';",
        'export const x = [PrismaPg, PrismaClient];',
      ].join('\n');

      expect(await errores(obtener(), codigo, CLI)).toEqual([]);
    });
  });

  describe('criterio 92: ejemplos de la especificacion que fallan', () => {
    it.each([
      ['$queryRaw con SET LOCAL ROLE', 'export const f = (tx) => tx.cliente.$queryRaw`SET LOCAL ROLE postgres`;'],
      [
        '$queryRawUnsafe con una expresion regular .source',
        'export const f = (tx) => tx.cliente.$queryRawUnsafe(/SET ROLE postgres/.source);',
      ],
      ['$executeRaw con una variable', 'export const f = (tx, consulta) => tx.cliente.$executeRaw(consulta);'],
      [
        '$queryRaw guardado y usado como etiqueta',
        'export const f = async (tx) => {\n  const q = tx.cliente.$queryRaw;\n  return await q`SELECT 1`;\n};',
      ],
      [
        '$executeRaw con Prisma.raw (en cli/)',
        "export const f = (cliente) => cliente.$executeRaw(Prisma.raw('RESET ALL'));",
      ],
      ['Prisma.join con un separador (en cli/)', "export const f = (ids) => Prisma.join(ids, '; RESET ALL; ');"],
    ])('criterio 92: %s falla el lint', async (_descripcion, codigo) => {
      await esRechazadoFueraDePrisma(obtener(), codigo);
    });
  });

  describe('criterio 92: lo que pasa el lint', () => {
    it.each([
      ['stream.on con "end"', "export const f = (stream, fin) => {\n  stream.on('end', fin);\n};"],
      [
        'addEventListener con "abort"',
        "export const f = (signal, fin) => {\n  signal.addEventListener('abort', fin);\n};",
      ],
      ['setHeader con "Set-Cookie"', "export const f = (res, valor) => {\n  res.setHeader('Set-Cookie', valor);\n};"],
      ['una constante "release"', "export const evento = 'release';"],
      ['una constante "commit"', "export const accion = 'commit';"],
      ['una constante "rollback" y "begin"', "export const acciones = ['rollback', 'begin', 'savepoint'];"],
      [
        'un mensaje con "reset"',
        "export const f = () => {\n  throw new Error('No se pudo hacer reset de la clave');\n};",
      ],
      ['un texto con "commit"', "export const aviso = 'Haz commit de los cambios';"],
      ['un texto de interfaz con SET ROLE', "export const ayuda = 'Para esto usa SET ROLE postgres en psql';"],
      ['una expresion regular con SET ROLE', 'export const patron = /SET ROLE/i;'],
      ['String.raw con SET ROLE', 'export const texto = String.raw`SET ROLE x`;'],
      ['una cadena con DECLARE y WITH HOLD', "export const texto = 'DECLARE c CURSOR WITH HOLD FOR SELECT 1';"],
      ['una plantilla sin etiqueta con COMMIT', 'export const texto = (id) => `COMMIT ${id}`;'],
    ])('criterio 92: %s pasa el lint', async (_descripcion, codigo) => {
      await pasaElLint(obtener(), codigo);
    });

    it.each([
      [
        '$queryRaw como etiqueta con un valor',
        'export const f = (tx, id) => tx.cliente.$queryRaw`SELECT * FROM auditoria WHERE id = ${id}::uuid`;',
      ],
      [
        '$executeRaw como etiqueta',
        'export const f = (tx, id) => tx.cliente.$executeRaw`UPDATE configuraciones SET valor = ${id}`;',
      ],
      [
        '$queryRaw como etiqueta con un tipo generico',
        'export const f = (tx) => tx.cliente.$queryRaw<{ n: number }[]>`SELECT 1 AS n`;',
      ],
      // (criterio 112) En un modulo no hay `Prisma` de valor: la plantilla etiquetada que se pasa como unico argumento usa la `sql`
      // importada del punto autorizado (antes, `Prisma.sql` y `sql` se usaban sin importarlos), y `Prisma.join(ids)` pasa a
      // `join(ids)` del mismo punto autorizado.
      [
        '$queryRaw con sql del punto autorizado (criterio 112; antes Prisma.sql)',
        "import { sql } from '../../infraestructura/prisma';\nexport const f = (cliente) => cliente.$queryRaw(sql`SELECT 1`);",
      ],
      [
        '$executeRaw con sql importada del punto autorizado (criterio 112)',
        "import { sql } from '../../infraestructura/prisma';\nexport const f = (cliente) => cliente.$executeRaw(sql`SELECT 1`);",
      ],
      [
        'join con un solo argumento, del punto autorizado (criterio 112; antes Prisma.join)',
        "import { join, sql } from '../../infraestructura/prisma';\nexport const f = (ids) => sql`SELECT ${join(ids)}`;",
      ],
      ['Prisma.sql como etiqueta', 'export const f = (id) => Prisma.sql`SELECT ${id}`;'],
      [
        'Prisma.Sql como tipo',
        "import type { Prisma } from '../../generated/prisma/client';\nexport type Consulta = Prisma.Sql;",
      ],
      [
        'bloqueos de transaccion',
        'export const f = (tx, clave) => tx.cliente.$queryRaw`SELECT pg_advisory_xact_lock(${clave})`;',
      ],
    ])('criterio 92: %s pasa el lint en un modulo', async (_descripcion, codigo) => {
      expect(await errores(obtener(), codigo, MODULO)).toEqual([]);
    });

    it.each([
      // (criterio 112) En cli/, `Prisma.sql` se acepta con `Prisma` importado del cliente generado.
      [
        '$queryRaw con Prisma.sql (criterio 112: con Prisma importado del cliente generado)',
        "import { Prisma } from '../generated/prisma/client';\nexport const f = (cliente) => cliente.$queryRaw(Prisma.sql`SELECT 1`);",
      ],
      [
        '$queryRaw como etiqueta',
        'export const f = (cliente, id) => cliente.$queryRaw`SELECT 1 WHERE id = ${id}::uuid`;',
      ],
    ])('criterio 92: %s pasa el lint en cli/', async (_descripcion, codigo) => {
      expect(await errores(obtener(), codigo, CLI)).toEqual([]);
    });
  });

  describe('criterio 92: donde no se aplica', () => {
    const CODIGO = [
      'export const f = (cliente, q) => {',
      '  const { $queryRawUnsafe } = cliente;',
      "  cliente['$executeRawUnsafe'](q);",
      '  cliente.$queryRaw(q);',
      "  return [$queryRawUnsafe, Prisma.raw('RESET ALL'), Prisma.sql([q])];",
      '};',
    ].join('\n');

    it('criterio 92: nada de lo anterior se aplica dentro de backend/src/infraestructura/prisma/', async () => {
      expect(await errores(obtener(), CODIGO, PRISMA)).toEqual([]);
    });

    it.each([
      ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
      ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
      ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
    ])('criterio 92: nada de lo anterior se aplica en %s', async (_nombre, archivo) => {
      expect(await errores(obtener(), CODIGO, archivo)).toEqual([]);
    });
  });
});
