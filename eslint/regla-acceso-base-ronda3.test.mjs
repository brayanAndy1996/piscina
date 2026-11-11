// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 95 (ataque ronda 3, F2 y O1; reemplaza el alcance de archivos y de modulos del criterio 85 y complementa el 28) y
// criterio 97 (complementa el 95). Dado el codigo de backend/src/ (sin las pruebas):
//   - las reglas de los criterios 28 y 85 y las del SQL (73, 83, 84 y 92 a 94) se aplican a los archivos
//     backend/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}, no solo a .ts;
//   - un especificador de modulo que, con `\` cambiada por `/`, contiene `node_modules/` seguido de un paquete prohibido del
//     criterio 85 (pg, pg/..., pg-pool, @prisma/...) o de `.prisma/...` cuenta como ese paquete, tambien como ruta absoluta o URL
//     `file:`;
//   - fuera de backend/src/cli/, el lint falla con cualquier importacion (de valor o de tipo, por cualquiera de las vias del
//     criterio 85) de un archivo de backend/src/cli/, con la ruta resuelta respecto del archivo que importa;
//   - fuera de backend/src/infraestructura/prisma/ (tambien en cli/), el lint falla con cualquier importacion de un archivo de
//     esa carpeta que no sea su `index` (se aceptan `.../infraestructura/prisma` y `.../infraestructura/prisma/index`, con o sin
//     extension).
// Criterio 97: un archivo .mjs y otro .cts de backend/src/modulos/ con `import pg from 'pg'` hacen fallar el paso protegido
// (y la configuracion principal).
// Se prueba con las dos configuraciones (eslint.config.mjs y la del paso protegido), por su efecto observable.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI, CONFIGURACIONES, MODULO, PRISMA, errores, raiz } from './ayuda-lint-ronda3.mjs';

const EXTENSIONES = ['ts', 'tsx', 'mts', 'cts', 'js', 'mjs', 'cjs'];
// Los archivos .cjs y .cts se analizan como CommonJS o TypeScript: se usa `require`, valido en todas las extensiones.
const ESM = new Set(['ts', 'tsx', 'mts', 'js', 'mjs']);

const enModulos = (ext) => `backend/src/modulos/ejemplo/ejemplo.service.${ext}`;
const enPrisma = (ext) => `backend/src/infraestructura/prisma/base-datos.${ext}`;
const enCli = (ext) => `backend/src/cli/superadmin.${ext}`;
const RAIZ_POSIX = raiz.replaceAll('\\', '/');

describe.each(CONFIGURACIONES)('criterio 95 con %s', (_configuracion, obtener) => {
  describe('criterio 95: las reglas se aplican a todas las extensiones', () => {
    for (const ext of EXTENSIONES) {
      describe(`extension .${ext}`, () => {
        const requerir = "const pg = require('pg');\nmodule.exports = pg;";
        const importar = ESM.has(ext) ? "import pg from 'pg';\nexport const x = pg;" : requerir;

        it(`criterio 95: importar pg en un modulo .${ext} falla el lint, y no en prisma/ ni en cli/`, async () => {
          expect(await errores(obtener(), importar, enPrisma(ext))).toEqual([]);
          expect(await errores(obtener(), importar, enCli(ext))).toEqual([]);
          expect((await errores(obtener(), importar, enModulos(ext))).length, importar).toBeGreaterThan(0);
        });

        it(`criterio 95: require('pg') en un modulo .${ext} falla el lint`, async () => {
          expect((await errores(obtener(), requerir, enModulos(ext))).length, requerir).toBeGreaterThan(0);
        });

        it(`criterio 95: require('@prisma/client') en un modulo .${ext} falla el lint`, async () => {
          const codigo = "const prisma = require('@prisma/client');\nmodule.exports = prisma;";

          expect((await errores(obtener(), codigo, enModulos(ext))).length, codigo).toBeGreaterThan(0);
        });

        it(`criterio 28: require del cliente generado en un modulo .${ext} falla el lint`, async () => {
          const codigo = "const cliente = require('../../generated/prisma/client');\nmodule.exports = cliente;";

          expect((await errores(obtener(), codigo, enModulos(ext))).length, codigo).toBeGreaterThan(0);
          expect(await errores(obtener(), codigo, enPrisma(ext))).toEqual([]);
        });

        it(`criterio 73: un $queryRaw con SET ROLE en un modulo .${ext} falla el lint, y no en prisma/`, async () => {
          const codigo = ESM.has(ext)
            ? 'export const f = (cliente) => cliente.$queryRaw`SET ROLE postgres`;'
            : 'module.exports = (cliente) => cliente.$queryRaw`SET ROLE postgres`;';

          expect(await errores(obtener(), codigo, enPrisma(ext))).toEqual([]);
          expect((await errores(obtener(), codigo, enModulos(ext))).length, codigo).toBeGreaterThan(0);
          expect((await errores(obtener(), codigo, enCli(ext))).length, 'cli/').toBeGreaterThan(0);
        });

        it(`criterio 92: $queryRawUnsafe en un modulo .${ext} falla el lint`, async () => {
          const codigo = 'module.exports = (cliente, q) => cliente.$queryRawUnsafe(q);';

          expect(await errores(obtener(), codigo, enPrisma(ext))).toEqual([]);
          expect((await errores(obtener(), codigo, enModulos(ext))).length, codigo).toBeGreaterThan(0);
        });

        it(`criterio 95: un archivo de prueba .${ext} no esta sujeto a estas reglas`, async () => {
          const codigo = "const pg = require('pg');\nmodule.exports = pg;";

          expect(await errores(obtener(), codigo, `backend/src/modulos/ejemplo/ejemplo.service.test.${ext}`)).toEqual(
            [],
          );
        });
      });
    }
  });

  describe('criterio 95: rutas hacia node_modules', () => {
    // Cada caso: [descripcion, codigo]. El codigo falla en un modulo y en cli/ no (pg y @prisma se pueden importar ahi).
    const RUTAS = [
      ["require('../../node_modules/pg')", "export const m = require('../../node_modules/pg');"],
      [
        "require('../../node_modules/pg/lib/index.js')",
        "export const m = require('../../node_modules/pg/lib/index.js');",
      ],
      ["require('../../node_modules/pg-pool')", "export const m = require('../../node_modules/pg-pool');"],
      [
        "import('../../../node_modules/@prisma/client/index.js')",
        "export const cargar = () => import('../../../node_modules/@prisma/client/index.js');",
      ],
      [
        "import('file:///srv/app/node_modules/pg-pool/index.js')",
        "export const cargar = () => import('file:///srv/app/node_modules/pg-pool/index.js');",
      ],
      [
        'import estatico de node_modules/pg',
        "import pg from '../../node_modules/pg/lib/index.js';\nexport const x = pg;",
      ],
      [
        'export from node_modules/@prisma/adapter-pg',
        "export { PrismaPg } from '../../../node_modules/@prisma/adapter-pg/dist/index.mjs';",
      ],
      ['node_modules/.prisma/client', "export const m = require('../../../node_modules/.prisma/client/index.js');"],
      ['ruta absoluta de Unix', "export const m = require('/srv/app/node_modules/pg/lib/index.js');"],
      [
        'ruta absoluta de Windows con barras invertidas',
        "export const m = require('C:\\\\app\\\\node_modules\\\\pg\\\\lib\\\\index.js');",
      ],
      ['barras invertidas relativas', "export const m = require('..\\\\..\\\\node_modules\\\\pg');"],
      [
        'node_modules mas adentro de la ruta',
        "export const m = require('../../../../otra/node_modules/pg-pool/index.js');",
      ],
      ['import x = require', "import pg = require('../../node_modules/pg');\nexport const x = pg;"],
      ['plantilla sin ${} en import()', 'export const cargar = () => import(`../../node_modules/pg`);'],
    ];

    it.each(RUTAS)('criterio 95: %s en un modulo falla el lint', async (_nombre, codigo) => {
      expect((await errores(obtener(), codigo, MODULO)).length, codigo).toBeGreaterThan(0);
    });

    it.each(RUTAS)(
      'criterio 95: %s no falla dentro de backend/src/infraestructura/prisma/ ni en cli/',
      async (_nombre, codigo) => {
        expect(await errores(obtener(), codigo, PRISMA), 'prisma/').toEqual([]);
        expect(await errores(obtener(), codigo, CLI), 'cli/').toEqual([]);
      },
    );

    it.each(RUTAS)('criterio 95: %s no falla en un archivo de prueba', async (_nombre, codigo) => {
      expect(await errores(obtener(), codigo, 'backend/src/modulos/ejemplo/ejemplo.service.test.ts')).toEqual([]);
    });

    it.each([
      ['un paquete que no esta prohibido', "export const m = require('../../node_modules/lodash/index.js');"],
      [
        '@nestjs/common dentro de node_modules',
        "export const m = require('../../node_modules/@nestjs/common/index.js');",
      ],
    ])('criterio 95: %s pasa el lint', async (_nombre, codigo) => {
      expect(await errores(obtener(), codigo, MODULO)).toEqual([]);
    });
  });

  describe('criterio 95: nada fuera de cli/ importa un archivo de backend/src/cli/', () => {
    const IMPORTACIONES = [
      [
        'import de un valor',
        "import { crearClienteDelDueno } from '../../cli/conexion';\nexport const x = crearClienteDelDueno;",
      ],
      [
        'import de un valor con extension .js',
        "import { enPlataforma } from '../../cli/conexion.js';\nexport const x = enPlataforma;",
      ],
      ['import de un tipo', "import type { Conexion } from '../../cli/conexion';\nexport type T = Conexion;"],
      ['import con type en linea', "import { type Conexion } from '../../cli/conexion';\nexport type T = Conexion;"],
      ['import por defecto', "import conexion from '../../cli/conexion';\nexport const x = conexion;"],
      ['import sin enlaces (efecto)', "import '../../cli/conexion';"],
      ['export ... from', "export { crearClienteDelDueno } from '../../cli/conexion';"],
      ['export * from', "export * from '../../cli/conexion';"],
      ['export type ... from', "export type { Conexion } from '../../cli/conexion';"],
      ['import() dinamico', "export const cargar = () => import('../../cli/conexion');"],
      ['import() con plantilla sin ${}', 'export const cargar = () => import(`../../cli/conexion`);'],
      ['require()', "export const m = require('../../cli/conexion');"],
      ['require() con extension', "export const m = require('../../cli/conexion.js');"],
      ['import x = require()', "import conexion = require('../../cli/conexion');\nexport const x = conexion;"],
      ['una ruta con segmentos ..', "import { x } from '../../infraestructura/../cli/conexion';\nexport { x };"],
      ['otro archivo de cli', "import { argumentos } from '../../cli/superadmin-datos';\nexport const x = argumentos;"],
      [
        'una ruta absoluta',
        `export const cargar = () => import(${JSON.stringify(`${RAIZ_POSIX}/backend/src/cli/conexion`)});`,
      ],
      [
        'una URL file:',
        `export const cargar = () => import(${JSON.stringify(`file://${RAIZ_POSIX.startsWith('/') ? '' : '/'}${RAIZ_POSIX}/backend/src/cli/conexion.js`)});`,
      ],
    ];

    it.each(IMPORTACIONES)('criterio 95: %s falla el lint en un modulo', async (_nombre, codigo) => {
      expect((await errores(obtener(), codigo, MODULO)).length, codigo).toBeGreaterThan(0);
    });

    it('criterio 95: la ruta se resuelve respecto del archivo que importa (desde backend/src/main.ts es ./cli/conexion)', async () => {
      const codigo = "import { enPlataforma } from './cli/conexion';\nexport const x = enPlataforma;";

      expect((await errores(obtener(), codigo, 'backend/src/main.ts')).length).toBeGreaterThan(0);
      expect(
        (
          await errores(
            obtener(),
            "import { x } from '../cli/conexion.js';\nexport { x };",
            'backend/src/modulos/ejemplo.ts',
          )
        ).length,
      ).toBeGreaterThan(0);
    });

    it('criterio 95: desde infraestructura/prisma/ tampoco se puede importar cli/', async () => {
      const codigo = "import { enPlataforma } from '../../cli/conexion';\nexport const x = enPlataforma;";

      expect((await errores(obtener(), codigo, PRISMA)).length).toBeGreaterThan(0);
    });

    it('criterio 95: dentro de cli/ se puede importar otro archivo de cli/', async () => {
      const codigo = [
        "import { crearClienteDelDueno } from './conexion';",
        "import { argumentos } from './superadmin-datos.js';",
        'export const x = [crearClienteDelDueno, argumentos];',
      ].join('\n');

      expect(await errores(obtener(), codigo, CLI)).toEqual([]);
    });

    it.each([
      ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts', '../../cli/conexion'],
      ['una prueba dentro de backend/src/cli', 'backend/src/cli/conexion.test.ts', './conexion'],
      ['las pruebas de integracion', 'backend/test/integracion/cli/ejemplo.test.ts', '../../../src/cli/conexion'],
      ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts', '../../src/cli/conexion'],
    ])('criterio 95: %s puede importar archivos de cli/', async (_nombre, archivo, ruta) => {
      const codigo = `import { enPlataforma } from '${ruta}';\nexport const x = enPlataforma;`;

      expect(await errores(obtener(), codigo, archivo)).toEqual([]);
    });
  });

  describe('criterio 95: nada fuera de infraestructura/prisma/ importa sus archivos internos, salvo el index', () => {
    const INTERNOS = [
      [
        'prisma.service',
        "import { PrismaService } from '../../infraestructura/prisma/prisma.service';\nexport const x = PrismaService;",
      ],
      [
        'base-datos',
        "import { BaseDatos } from '../../infraestructura/prisma/base-datos';\nexport const x = BaseDatos;",
      ],
      ['tipos', "import { Algo } from '../../infraestructura/prisma/tipos';\nexport const x = Algo;"],
      [
        'base-datos con extension .js',
        "import { BaseDatos } from '../../infraestructura/prisma/base-datos.js';\nexport const x = BaseDatos;",
      ],
      [
        'errores',
        "import { ErrorRolBaseDatosInseguro } from '../../infraestructura/prisma/errores';\nexport const x = ErrorRolBaseDatosInseguro;",
      ],
      [
        'rol-seguro',
        "import { problemasDelRol } from '../../infraestructura/prisma/rol-seguro';\nexport const x = problemasDelRol;",
      ],
      [
        'un tipo de tipos',
        "import type { ClienteTransaccion } from '../../infraestructura/prisma/tipos';\nexport type T = ClienteTransaccion;",
      ],
      [
        'un tipo en linea de base-datos',
        "import { type BaseDatos } from '../../infraestructura/prisma/base-datos';\nexport type T = BaseDatos;",
      ],
      ['export ... from', "export { BaseDatos } from '../../infraestructura/prisma/base-datos';"],
      ['export type ... from', "export type { ClienteTransaccion } from '../../infraestructura/prisma/tipos';"],
      ['import() dinamico', "export const cargar = () => import('../../infraestructura/prisma/base-datos');"],
      ['require()', "export const m = require('../../infraestructura/prisma/base-datos');"],
      ['import x = require()', "import bd = require('../../infraestructura/prisma/base-datos');\nexport const x = bd;"],
      [
        'una ruta con segmentos ..',
        "import { BaseDatos } from '../../infraestructura/prisma/../prisma/base-datos';\nexport const x = BaseDatos;",
      ],
      [
        'otra extension: .ts',
        "import { BaseDatos } from '../../infraestructura/prisma/base-datos.ts';\nexport const x = BaseDatos;",
      ],
      [
        'una ruta absoluta',
        `export const cargar = () => import(${JSON.stringify(`${RAIZ_POSIX}/backend/src/infraestructura/prisma/base-datos`)});`,
      ],
    ];

    it.each(INTERNOS)('criterio 95: %s falla el lint en un modulo', async (_nombre, codigo) => {
      expect((await errores(obtener(), codigo, MODULO)).length, codigo).toBeGreaterThan(0);
    });

    it('criterio 95: la ruta se resuelve respecto del archivo que importa (desde backend/src/main.ts)', async () => {
      const codigo = "import { BaseDatos } from './infraestructura/prisma/base-datos';\nexport const x = BaseDatos;";

      expect((await errores(obtener(), codigo, 'backend/src/main.ts')).length).toBeGreaterThan(0);
    });

    it('criterio 95: tambien se rechaza desde backend/src/cli/', async () => {
      const codigo = "import { BaseDatos } from '../infraestructura/prisma/base-datos';\nexport const x = BaseDatos;";

      expect((await errores(obtener(), codigo, CLI)).length).toBeGreaterThan(0);
    });

    it.each([
      ['la carpeta', "import { BaseDatos } from '../../infraestructura/prisma';\nexport const x = BaseDatos;"],
      ['index', "import { BaseDatos } from '../../infraestructura/prisma/index';\nexport const x = BaseDatos;"],
      ['index.ts', "import { BaseDatos } from '../../infraestructura/prisma/index.ts';\nexport const x = BaseDatos;"],
      ['index.js', "import { BaseDatos } from '../../infraestructura/prisma/index.js';\nexport const x = BaseDatos;"],
      [
        'un tipo desde index',
        "import type { ClienteTransaccion } from '../infraestructura/prisma/index';\nexport type T = ClienteTransaccion;",
      ],
      ['export ... from la carpeta', "export { BaseDatos } from '../../infraestructura/prisma';"],
      ['import() de la carpeta', "export const cargar = () => import('../../infraestructura/prisma');"],
    ])('criterio 95: importar %s pasa el lint en un modulo', async (_nombre, codigo) => {
      expect(await errores(obtener(), codigo, MODULO)).toEqual([]);
    });

    it('criterio 95: desde cli/ tambien se puede importar el index', async () => {
      const codigo = "import { BaseDatos } from '../infraestructura/prisma/index';\nexport const x = BaseDatos;";

      expect(await errores(obtener(), codigo, CLI)).toEqual([]);
    });

    it('criterio 95: dentro de infraestructura/prisma/ se pueden importar los archivos de la propia carpeta', async () => {
      const codigo = [
        "import { PrismaService } from './prisma.service';",
        "import { BaseDatos } from './base-datos';",
        "import { Algo } from './tipos.js';",
        'export const x = [PrismaService, BaseDatos, Algo];',
      ].join('\n');

      expect(await errores(obtener(), codigo, PRISMA)).toEqual([]);
    });

    it.each([
      [
        'una prueba dentro de backend/src',
        'backend/src/modulos/ejemplo/ejemplo.service.test.ts',
        '../../infraestructura/prisma/base-datos',
      ],
      [
        'las pruebas de integracion',
        'backend/test/integracion/ejemplo.test.ts',
        '../../src/infraestructura/prisma/base-datos',
      ],
      ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts', '../../src/infraestructura/prisma/index'],
    ])('criterio 95: %s puede importar los internos', async (_nombre, archivo, ruta) => {
      const codigo = `import { Algo } from '${ruta}';\nexport const x = Algo;`;

      expect(await errores(obtener(), codigo, archivo)).toEqual([]);
    });
  });

  describe('criterio 95: lo que sigue pasando en cli/ (de los ejemplos de la especificacion)', () => {
    it('criterio 95: en cli/, PrismaPg y PrismaClient se importan', async () => {
      const codigo = [
        "import { PrismaPg } from '@prisma/adapter-pg';",
        "import { PrismaClient } from '../generated/prisma/client';",
        'export const x = [PrismaPg, PrismaClient];',
      ].join('\n');

      expect(await errores(obtener(), codigo, CLI)).toEqual([]);
    });
  });
});

describe.each(CONFIGURACIONES)('criterio 97 con %s', (_configuracion, obtener) => {
  it.each([
    ['un archivo .mjs', 'backend/src/modulos/ejemplo/ejemplo.mjs'],
    ['un archivo .cts', 'backend/src/modulos/ejemplo/ejemplo.cts'],
    ['un archivo .cjs', 'backend/src/modulos/ejemplo/ejemplo.cjs'],
    ['un archivo .js', 'backend/src/modulos/ejemplo/ejemplo.js'],
    ['un archivo .tsx', 'backend/src/modulos/ejemplo/ejemplo.tsx'],
    ['un archivo .mts', 'backend/src/modulos/ejemplo/ejemplo.mts'],
  ])('criterio 97: %s de backend/src/modulos/ con import pg from pg falla el lint', async (_nombre, archivo) => {
    const extension = path.extname(archivo);
    const codigo = ['.cjs'].includes(extension)
      ? "const pg = require('pg');\nmodule.exports = pg;"
      : "import pg from 'pg';\nexport const x = pg;";

    expect((await errores(obtener(), codigo, archivo)).length, `${archivo}: ${codigo}`).toBeGreaterThan(0);
  });

  it('criterio 97: el mismo .cts no produce un error de sintaxis ni se ignora: se analiza', async () => {
    const [resultado] = await obtener().lintText("import pg from 'pg';\nexport const x = pg;", {
      filePath: path.join(raiz, 'backend/src/modulos/ejemplo/ejemplo.cts'),
    });

    expect(resultado.messages.filter((mensaje) => mensaje.fatal)).toEqual([]);
    expect(
      resultado.messages.some((mensaje) => /File ignored|no matching configuration/i.test(mensaje.message)),
      'el archivo .cts se ignoro: ninguna configuracion lo cubre',
    ).toBe(false);
  });
});
