// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterios 110, 118 y 119 (ataque ronda 4, F4 y observaciones):
//   - 110 (ajusta el alcance de los criterios 92 y 95 y de los `ignores` de los criterios 28, 73, 83 a 85 y 92 a 95): las reglas y
//     el paso protegido eximen solo los archivos cuyo nombre termina exactamente en `.test.ts`, `.test.mts`, `.test.cts`,
//     `.test.js`, `.test.mjs` o `.test.cjs`, y los de backend/test/; un archivo como `atajo.test.util.ts`, `x.test.d.ts` o
//     `x.test.tsx` ya no esta exento. `backend/tsconfig.build.json` excluye exactamente esos mismos patrones (`**/*.test.ts`,
//     `**/*.test.mts`, `**/*.test.cts`) y `test`, y no excluye nada mas bajo `src` que pueda llevar codigo. Un archivo de
//     backend/src/ que no es prueba no puede importar (por cualquiera de las vias del criterio 85, tambien `import type`) un
//     archivo de pruebas: un especificador cuya ruta resuelta, con o sin extension, termina en `.test`, `.test.<extension>` o cae
//     dentro de backend/test/.
//   - 118 (ajusta el alcance de los `ignores` de los criterios 92 a 96): la exencion `backend/src/generated/**` pasa a ser
//     `backend/src/generated/prisma/**`; un archivo `backend/src/generated/otra/x.ts` con `import pg from 'pg'` falla.
//   - 119 (ajusta el alcance de los criterios 95 y 97): las reglas, el analizador del paso protegido y el bloque de JavaScript de
//     eslint.config.mjs cubren backend/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}. Un `.jsx` de backend/src/modulos/ con
//     `import pg from 'pg'` y otro con `$queryRaw` con SET ROLE hacen fallar el paso protegido.
// Se prueba con las dos configuraciones (eslint.config.mjs y la del paso protegido).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  CLI,
  CONFIGURACIONES,
  MODULO,
  RUTA_CONFIG_PROTEGIDA,
  errores,
  obtenerEslintProtegido,
  raiz,
} from './ayuda-lint-ronda4.mjs';

const IMPORTA_PG = "import pg from 'pg';\nexport const x = pg;";
const REQUIERE_PG = "const pg = require('pg');\nmodule.exports = pg;";
const SET_ROLE = 'export const f = (cliente) => cliente.$queryRaw`SET ROLE postgres`;';

const exentas = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'];
const comoCodigo = (ext) => (ext === 'cts' || ext === 'cjs' ? REQUIERE_PG : IMPORTA_PG);
const comoSetRole = (ext) =>
  ext === 'cts' || ext === 'cjs' ? 'module.exports = (cliente) => cliente.$queryRaw`SET ROLE postgres`;' : SET_ROLE;

describe.each(CONFIGURACIONES)('criterios 110, 118 y 119 con %s', (_configuracion, obtener) => {
  describe('criterio 110: solo los nombres que terminan exactamente en .test.<ts|mts|cts|js|mjs|cjs> estan exentos', () => {
    it.each(exentas)(
      'criterio 110: ejemplo.service.test.%s esta exento (import de pg, SET ROLE y mas)',
      async (ext) => {
        const archivo = `backend/src/modulos/ejemplo/ejemplo.service.test.${ext}`;

        expect(await errores(obtener(), comoCodigo(ext), archivo)).toEqual([]);
        expect(await errores(obtener(), comoSetRole(ext), archivo)).toEqual([]);
      },
    );

    it.each(exentas)(
      'criterio 110: ejemplo.service.test.%s esta exento tambien en cli/ y en infraestructura/',
      async (ext) => {
        for (const carpeta of ['cli', 'infraestructura/entorno', 'comun']) {
          expect(
            await errores(obtener(), comoCodigo(ext), `backend/src/${carpeta}/ejemplo.test.${ext}`),
            carpeta,
          ).toEqual([]);
        }
      },
    );

    it.each([
      ['atajo.test.util.ts (ejemplo de la especificacion)', 'backend/src/modulos/ejemplo/atajo.test.util.ts'],
      ['x.test.d.ts (ejemplo de la especificacion)', 'backend/src/modulos/ejemplo/x.test.d.ts'],
      ['x.test.tsx (ejemplo de la especificacion)', 'backend/src/modulos/ejemplo/x.test.tsx'],
      ['x.test.jsx', 'backend/src/modulos/ejemplo/x.test.jsx'],
      ['x.test.util.js', 'backend/src/modulos/ejemplo/x.test.util.js'],
      ['x.test.util.mjs', 'backend/src/modulos/ejemplo/x.test.util.mjs'],
      ['x.test.helpers.ts', 'backend/src/modulos/ejemplo/x.test.helpers.ts'],
      ['x.test.ts.ts', 'backend/src/modulos/ejemplo/x.test.ts.ts'],
      ['x.tests.ts', 'backend/src/modulos/ejemplo/x.tests.ts'],
      ['x.spec.ts', 'backend/src/modulos/ejemplo/x.spec.ts'],
      ['xtest.ts', 'backend/src/modulos/ejemplo/xtest.ts'],
      ['x-test.ts', 'backend/src/modulos/ejemplo/x-test.ts'],
      ['x.test-util.ts', 'backend/src/modulos/ejemplo/x.test-util.ts'],
      ['test.util.ts', 'backend/src/modulos/ejemplo/test.util.ts'],
      // (precision del criterio 110, 11/11/2026) `x.test.util.ts` y `x.test.d.ts` en cli/ ya no se prueban aqui: en cli/ `import pg
      // from 'pg'` esta permitido, asi que ESLint no da error por ellos. Su rechazo es un error del paso protegido (comprobacion
      // previa de nombres), que se prueba en scripts/test/fuentes-protegidas-nombres-test.test.mjs.
    ])('criterio 110: %s ya no esta exento (import de pg falla el lint)', async (_nombre, archivo) => {
      expect((await errores(obtener(), IMPORTA_PG, archivo)).length, archivo).toBeGreaterThan(0);
    });

    it('criterio 110: atajo.test.util.ts con SET ROLE tambien falla el lint', async () => {
      expect(
        (await errores(obtener(), SET_ROLE, 'backend/src/modulos/ejemplo/atajo.test.util.ts')).length,
      ).toBeGreaterThan(0);
    });

    it.each([
      ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
      ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
      ['un archivo de backend/test/ sin .test', 'backend/test/otro/auxiliar.ts'],
    ])('criterio 110: %s (backend/test/) sigue exento', async (_nombre, archivo) => {
      expect(await errores(obtener(), IMPORTA_PG, archivo)).toEqual([]);
    });
  });

  describe('criterio 110: un archivo que no es prueba no puede importar un archivo de pruebas', () => {
    const rechazados = [
      [
        "import { x } from './atajo.test' (ejemplo de la especificacion)",
        "import { x } from './atajo.test';\nexport const y = x;",
      ],
      [
        "require('./ejemplo.service.test.ts') (ejemplo de la especificacion)",
        "export const m = require('./ejemplo.service.test.ts');",
      ],
      [
        "import('../../../test/utilidades/base-datos') (ejemplo de la especificacion)",
        "export const cargar = () => import('../../../test/utilidades/base-datos');",
      ],
      ['import con la extension .ts', "import { x } from './atajo.test.ts';\nexport const y = x;"],
      ['import con la extension .js', "import { x } from './atajo.test.js';\nexport const y = x;"],
      ['import con la extension .mjs', "import { x } from './atajo.test.mjs';\nexport const y = x;"],
      ['import con la extension .cjs', "import { x } from './atajo.test.cjs';\nexport const y = x;"],
      ['import con la extension .tsx', "import { x } from './atajo.test.tsx';\nexport const y = x;"],
      ['import con la extension .jsx', "import { x } from './atajo.test.jsx';\nexport const y = x;"],
      ['import con la extension .mts', "import { x } from './atajo.test.mts';\nexport const y = x;"],
      ['import con la extension .cts', "import { x } from './atajo.test.cts';\nexport const y = x;"],
      ['import type', "import type { X } from './atajo.test';\nexport type Y = X;"],
      ['import con type en linea', "import { type X } from './atajo.test';\nexport type Y = X;"],
      ['import de efecto', "import './atajo.test';"],
      ['import por defecto', "import atajo from './atajo.test';\nexport const y = atajo;"],
      ['export ... from', "export { x } from './atajo.test';"],
      ['export * from', "export * from './atajo.test';"],
      ['export type ... from', "export type { X } from './atajo.test';"],
      ['import() con una plantilla sin ${}', 'export const cargar = () => import(`./atajo.test`);'],
      ['require() sin extension', "export const m = require('./atajo.test');"],
      ['import x = require()', "import atajo = require('./atajo.test');\nexport const y = atajo;"],
      ['un archivo de prueba de otra carpeta', "import { x } from '../otro/otro.service.test';\nexport const y = x;"],
      ['una ruta con segmentos ..', "import { x } from '../ejemplo/../ejemplo/atajo.test';\nexport const y = x;"],
      [
        'una carpeta de backend/test/ (integracion)',
        "import { x } from '../../../test/integracion/salud/salud.test';\nexport const y = x;",
      ],
      [
        'un archivo de backend/test/ sin .test (utilidades)',
        "import { x } from '../../../test/utilidades/aplicacion';\nexport const y = x;",
      ],
      [
        'backend/test/ con la extension',
        "import { x } from '../../../test/utilidades/aplicacion.ts';\nexport const y = x;",
      ],
      ['backend/test/ con import()', "export const cargar = () => import('../../../test/utilidades/datos.js');"],
      ['backend/test/ con require()', "export const m = require('../../../test/utilidades/datos');"],
      ['backend/test/ con export * from', "export * from '../../../test/utilidades/datos';"],
    ];

    it.each(rechazados)('criterio 110: %s falla el lint en un modulo', async (_nombre, codigo) => {
      expect((await errores(obtener(), codigo, MODULO)).length, codigo).toBeGreaterThan(0);
    });

    it.each([
      [
        'import de un archivo .test.ts',
        "import { x } from '../ejemplo/atajo.test';\nexport const y = x;",
        'backend/src/main.ts',
      ],
      [
        'import de un archivo .test',
        "import { x } from './cli/conexion.test';\nexport const y = x;",
        'backend/src/main.ts',
      ],
      [
        'import de backend/test/',
        "import { x } from '../test/utilidades/datos';\nexport const y = x;",
        'backend/src/main.ts',
      ],
      ['import de un archivo .test', "import { x } from './conexion.test';\nexport const y = x;", CLI],
      ['import de backend/test/', "import { x } from '../../test/utilidades/datos';\nexport const y = x;", CLI],
      [
        'import de un archivo .test desde infraestructura/prisma/ (no es prueba)',
        "import { x } from './base-datos.test';\nexport const y = x;",
        'backend/src/infraestructura/prisma/base-datos.ts',
      ],
    ])('criterio 110: %s falla el lint desde un archivo que no es prueba (%#)', async (_nombre, codigo, archivo) => {
      expect((await errores(obtener(), codigo, archivo)).length, `${archivo}: ${codigo}`).toBeGreaterThan(0);
    });

    it.each([
      ['un nombre que solo contiene la palabra test', "import { x } from './testigo';\nexport const y = x;"],
      ['un nombre que termina en test sin punto', "import { x } from './retest';\nexport const y = x;"],
      ['un nombre con .testing', "import { x } from './datos.testing';\nexport const y = x;"],
      ['un nombre con .tests', "import { x } from './datos.tests';\nexport const y = x;"],
      ['un nombre con .test en medio de otro segmento', "import { x } from './datos.test-util';\nexport const y = x;"],
      ['una carpeta que se llama pruebas', "import { x } from '../pruebas/datos';\nexport const y = x;"],
      ['un nombre que empieza por test', "import { x } from './test-datos';\nexport const y = x;"],
      ['un archivo llamado test.ts (sin punto antes)', "import { x } from './test';\nexport const y = x;"],
      ['un modulo normal', "import { x } from '../otro/otro.service';\nexport const y = x;"],
    ])('criterio 110: %s no se confunde con un archivo de pruebas', async (_nombre, codigo) => {
      expect(await errores(obtener(), codigo, MODULO)).toEqual([]);
    });

    it.each([
      [
        'una prueba dentro de backend/src',
        'backend/src/modulos/ejemplo/ejemplo.service.test.ts',
        "import { x } from './atajo.test';\nexport const y = x;",
      ],
      [
        'una prueba que importa backend/test/',
        'backend/src/modulos/ejemplo/ejemplo.service.test.ts',
        "import { x } from '../../../test/utilidades/datos';\nexport const y = x;",
      ],
      [
        'una prueba de cli',
        'backend/src/cli/conexion.test.ts',
        "import { x } from '../../test/utilidades/datos';\nexport const y = x;",
      ],
      [
        'una prueba de backend/test/',
        'backend/test/integracion/ejemplo.test.ts',
        "import { x } from '../../src/modulos/ejemplo/ejemplo.service.test';\nexport const y = x;",
      ],
    ])('criterio 110: %s puede importar archivos de pruebas', async (_nombre, archivo, codigo) => {
      expect(await errores(obtener(), codigo, archivo)).toEqual([]);
    });
  });

  describe('criterio 118: solo el cliente generado (backend/src/generated/prisma/**) queda fuera de las reglas', () => {
    it.each([
      ['backend/src/generated/otra/x.ts (ejemplo de la especificacion)', 'backend/src/generated/otra/x.ts'],
      ['backend/src/generated/x.ts', 'backend/src/generated/x.ts'],
      ['backend/src/generated/otra/sub/x.ts', 'backend/src/generated/otra/sub/x.ts'],
      ['backend/src/generated/prisma-otro/x.ts', 'backend/src/generated/prisma-otro/x.ts'],
      ['backend/src/generated/prismas/x.ts', 'backend/src/generated/prismas/x.ts'],
      ['backend/src/generated/otra/x.js', 'backend/src/generated/otra/x.js'],
      ['backend/src/generated/otra/x.mjs', 'backend/src/generated/otra/x.mjs'],
    ])('criterio 118: %s con import de pg falla el lint', async (_nombre, archivo) => {
      expect((await errores(obtener(), IMPORTA_PG, archivo)).length, archivo).toBeGreaterThan(0);
    });

    it('criterio 118: backend/src/generated/otra/x.ts con SET ROLE tambien falla el lint', async () => {
      expect((await errores(obtener(), SET_ROLE, 'backend/src/generated/otra/x.ts')).length).toBeGreaterThan(0);
    });

    it.each([
      'backend/src/generated/prisma/client.ts',
      'backend/src/generated/prisma/internal/class.ts',
      'backend/src/generated/prisma/models/Academia.ts',
    ])('criterio 118: %s (el cliente generado) sigue exento', async (archivo) => {
      expect(await errores(obtener(), `${IMPORTA_PG}\nexport const y = require('pg');`, archivo)).toEqual([]);
    });
  });

  describe('criterio 119: tambien .jsx', () => {
    it.each([
      ['un modulo', 'backend/src/modulos/ejemplo/ejemplo.service.jsx'],
      ['cobro', 'backend/src/modulos/cobro/cobro.jsx'],
      ['comun', 'backend/src/comun/ayuda.jsx'],
      ['main', 'backend/src/main.jsx'],
    ])('criterio 119: un .jsx de %s con import de pg falla el lint', async (_nombre, archivo) => {
      expect((await errores(obtener(), IMPORTA_PG, archivo)).length, archivo).toBeGreaterThan(0);
    });

    it('criterio 119: un .jsx de backend/src/modulos/ con $queryRaw y SET ROLE falla el lint', async () => {
      expect(
        (await errores(obtener(), SET_ROLE, 'backend/src/modulos/ejemplo/ejemplo.service.jsx')).length,
      ).toBeGreaterThan(0);
    });

    it('criterio 119: un .jsx de backend/src/modulos/ con require(pg), $queryRawUnsafe o una importacion de cli/ falla el lint', async () => {
      const archivo = 'backend/src/modulos/ejemplo/ejemplo.service.jsx';

      expect((await errores(obtener(), "export const m = require('pg');", archivo)).length, 'require').toBeGreaterThan(
        0,
      );
      expect(
        (await errores(obtener(), 'export const f = (c, q) => c.$queryRawUnsafe(q);', archivo)).length,
        'unsafe',
      ).toBeGreaterThan(0);
      expect(
        (await errores(obtener(), "import { x } from '../../cli/conexion';\nexport const y = x;", archivo)).length,
        'cli',
      ).toBeGreaterThan(0);
    });

    it('criterio 119: un .jsx con sintaxis JSX y un import de pg falla por la regla (no por un error de analisis)', async () => {
      const codigo = "import pg from 'pg';\nexport const Vista = () => <div>{String(pg)}</div>;";

      // `errores` exige que no haya errores fatales de analisis: el analizador debe aceptar JSX en un .jsx y en un .tsx.
      expect((await errores(obtener(), codigo, 'backend/src/modulos/ejemplo/vista.jsx')).length).toBeGreaterThan(0);
      expect((await errores(obtener(), codigo, 'backend/src/modulos/ejemplo/vista.tsx')).length).toBeGreaterThan(0);
    });

    it('criterio 119: un .jsx puede importar el punto autorizado y la plantilla etiquetada directa', async () => {
      const codigo =
        "import { sql } from '../../infraestructura/prisma';\nexport const f = (cliente) => cliente.$queryRaw(sql`SELECT 1`);\nexport const g = (cliente) => cliente.$queryRaw`SELECT 1`;";

      expect(await errores(obtener(), codigo, 'backend/src/modulos/ejemplo/ejemplo.service.jsx')).toEqual([]);
    });
  });
});

describe('criterio 119: el paso protegido cubre .jsx en su configuracion', () => {
  it('criterio 119: la configuracion del paso protegido se aplica a un archivo .jsx de backend/src/modulos/', async () => {
    const configuracion = await obtenerEslintProtegido().calculateConfigForFile(
      path.join(raiz, 'backend/src/modulos/ejemplo/ejemplo.service.jsx'),
    );

    expect(configuracion, 'el .jsx no tiene configuracion en el paso protegido').toBeDefined();
    expect(Object.keys(configuracion?.rules ?? {}).length).toBeGreaterThan(0);
  });

  it('criterio 119: eslint.config.mjs tambien aplica reglas a un .jsx de backend/src/modulos/', async () => {
    const { obtenerEslintPrincipal } = await import('./ayuda-lint-ronda4.mjs');
    const configuracion = await obtenerEslintPrincipal().calculateConfigForFile(
      path.join(raiz, 'backend/src/modulos/ejemplo/ejemplo.service.jsx'),
    );

    expect(configuracion, 'el .jsx no tiene configuracion en eslint.config.mjs').toBeDefined();
    expect(Object.keys(configuracion?.rules ?? {}).length).toBeGreaterThan(0);
  });
});

describe('criterio 110: backend/tsconfig.build.json excluye exactamente los patrones de las pruebas', () => {
  const leer = () => {
    const ruta = path.join(raiz, 'backend', 'tsconfig.build.json');
    const { config, error } = ts.readConfigFile(ruta, ts.sys.readFile);
    if (error) throw new Error(`No se pudo leer ${ruta}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
    return config;
  };

  it('criterio 110: exclude contiene **/*.test.ts, **/*.test.mts, **/*.test.cts y test', () => {
    const exclude = leer().exclude ?? [];

    for (const patron of ['**/*.test.ts', '**/*.test.mts', '**/*.test.cts', 'test']) {
      expect(exclude, `falta ${patron}`).toContain(patron);
    }
  });

  it('criterio 110: exclude no excluye nada mas bajo src que pueda llevar codigo (solo node_modules y dist, fuera de src)', () => {
    const exclude = leer().exclude ?? [];
    const permitidos = new Set(['node_modules', 'dist', 'test', '**/*.test.ts', '**/*.test.mts', '**/*.test.cts']);

    expect(exclude.filter((patron) => !permitidos.has(patron))).toEqual([]);
  });

  it('criterio 110: exclude no usa un comodin que excluya mas que las pruebas (**/*.test.*, **/*.test.tsx, src/**)', () => {
    const exclude = leer().exclude ?? [];

    for (const patron of ['**/*.test.*', '**/*.test.tsx', '**/*.test*', '**/*.test.d.ts', 'src', 'src/**', '**/*']) {
      expect(exclude, patron).not.toContain(patron);
    }
  });

  it('criterio 110: sigue incluyendo src', () => {
    expect(leer().include).toContain('src');
  });
});

describe('criterio 118 y 119: el paso protegido existe', () => {
  it('criterio 118: eslint.protegido.config.mjs existe y ya no exime backend/src/generated/** entero', () => {
    expect(fs.existsSync(RUTA_CONFIG_PROTEGIDA)).toBe(true);
    const texto = fs.readFileSync(RUTA_CONFIG_PROTEGIDA, 'utf8');

    expect(texto).not.toMatch(/backend\/src\/generated\/\*\*(?!\/)/);
  });
});
