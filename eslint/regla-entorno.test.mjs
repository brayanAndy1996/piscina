// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 117 (ataque ronda 4, observacion; complementa el criterio 99): la carga del `.env` no esta al alcance de los modulos.
// Dado el codigo de backend/src/, `npm run lint` (tambien el paso protegido) falla si un archivo que no es
// `backend/src/main.ts`, ni esta en `backend/src/cli/` o en `backend/src/infraestructura/entorno/`, ni es una prueba, importa
// `.../infraestructura/entorno/cargar-env` o el paquete `dotenv` (`dotenv`, `dotenv/config`), por cualquiera de las vias del
// criterio 85. Prueba: la regla con un modulo que importa cada uno (falla) y con `main.ts` y un archivo de `cli/` (pasan).
// (Que el `index` cargado no tenga `cargarEnvRaiz` lo prueba backend/src/infraestructura/entorno/indice-ronda4.test.ts.)
import { describe, expect, it } from 'vitest';
import { CLI, CONFIGURACIONES, MODULO, PRINCIPAL, enEntorno, errores } from './ayuda-lint-ronda4.mjs';

const CARGAR_ENV = '../../infraestructura/entorno/cargar-env';

describe.each(CONFIGURACIONES)('criterio 117 con %s', (_configuracion, obtener) => {
  const rechazados = [
    ['import de cargar-env', `import { cargarEnvRaiz } from '${CARGAR_ENV}';\nexport const x = cargarEnvRaiz;`],
    [
      'import de cargar-env con extension .js',
      `import { cargarEnvRaiz } from '${CARGAR_ENV}.js';\nexport const x = cargarEnvRaiz;`,
    ],
    [
      'import de cargar-env con extension .ts',
      `import { cargarEnvRaiz } from '${CARGAR_ENV}.ts';\nexport const x = cargarEnvRaiz;`,
    ],
    ['import de un tipo de cargar-env', `import type { Algo } from '${CARGAR_ENV}';\nexport type T = Algo;`],
    ['import con type en linea de cargar-env', `import { type Algo } from '${CARGAR_ENV}';\nexport type T = Algo;`],
    ['import por defecto de cargar-env', `import cargar from '${CARGAR_ENV}';\nexport const x = cargar;`],
    ['import de efecto de cargar-env', `import '${CARGAR_ENV}';`],
    ['export ... from cargar-env', `export { cargarEnvRaiz } from '${CARGAR_ENV}';`],
    ['export * from cargar-env', `export * from '${CARGAR_ENV}';`],
    ['import() de cargar-env', `export const cargar = () => import('${CARGAR_ENV}');`],
    ['import() con plantilla sin ${} de cargar-env', `export const cargar = () => import(\`${CARGAR_ENV}\`);`],
    ['require() de cargar-env', `export const m = require('${CARGAR_ENV}');`],
    ['import x = require() de cargar-env', `import cargar = require('${CARGAR_ENV}');\nexport const x = cargar;`],
    [
      'una ruta con segmentos .. hacia cargar-env',
      "import { cargarEnvRaiz } from '../../infraestructura/prisma/../entorno/cargar-env';\nexport const x = cargarEnvRaiz;",
    ],
    ['dotenv', "import dotenv from 'dotenv';\nexport const x = dotenv;"],
    ['{ config } de dotenv', "import { config } from 'dotenv';\nexport const x = config;"],
    ['import * de dotenv', "import * as d from 'dotenv';\nexport const x = d;"],
    ['dotenv/config (efecto)', "import 'dotenv/config';"],
    ['dotenv/config', "import config from 'dotenv/config';\nexport const x = config;"],
    ['dotenv/lib/main.js', "import { parse } from 'dotenv/lib/main.js';\nexport const x = parse;"],
    [
      'import de un tipo de dotenv',
      "import type { DotenvConfigOptions } from 'dotenv';\nexport type T = DotenvConfigOptions;",
    ],
    ['export ... from dotenv', "export { config } from 'dotenv';"],
    ['export * from dotenv', "export * from 'dotenv';"],
    ['import() de dotenv', "export const cargar = () => import('dotenv');"],
    ['import() de dotenv/config', "export const cargar = () => import('dotenv/config');"],
    ['require() de dotenv', "export const m = require('dotenv');"],
    ['require() de dotenv/config', "export const m = require('dotenv/config');"],
    ['import x = require() de dotenv', "import d = require('dotenv');\nexport const x = d;"],
  ];

  it.each(rechazados)('criterio 117: %s falla el lint en un modulo', async (_nombre, codigo) => {
    expect((await errores(obtener(), codigo, MODULO)).length, codigo).toBeGreaterThan(0);
  });

  it.each([
    ['otra carpeta de modulos', 'backend/src/modulos/cobro/cobro.service.ts'],
    ['la carpeta infraestructura/seguridad', 'backend/src/infraestructura/seguridad/ejemplo.ts'],
    ['comun/', 'backend/src/comun/ejemplo.ts'],
    ['app.module.ts', 'backend/src/app.module.ts'],
    ['crear-app.ts', 'backend/src/crear-app.ts'],
  ])('criterio 117: importar dotenv falla el lint en %s', async (_nombre, archivo) => {
    const codigo = "import dotenv from 'dotenv';\nexport const x = dotenv;";
    expect((await errores(obtener(), codigo, archivo)).length, archivo).toBeGreaterThan(0);
  });

  describe('criterio 117: donde si se puede importar cargar-env y dotenv', () => {
    const desde = {
      main: PRINCIPAL,
      cli: CLI,
      entorno: enEntorno(),
    };
    const ruta = (origen, archivo) => {
      if (origen === 'main') return `./infraestructura/entorno/${archivo}`;
      if (origen === 'cli') return `../infraestructura/entorno/${archivo}`;
      return `./${archivo}`;
    };

    it.each(['main', 'cli', 'entorno'])('criterio 117: %s puede importar cargar-env', async (origen) => {
      const codigo = `import { cargarEnvRaiz } from '${ruta(origen, 'cargar-env')}';\nexport const x = cargarEnvRaiz;`;

      expect(await errores(obtener(), codigo, desde[origen])).toEqual([]);
    });

    it.each(['main', 'cli', 'entorno'])(
      'criterio 117: %s puede importar cargar-env con import() y require()',
      async (origen) => {
        const codigo = `export const a = () => import('${ruta(origen, 'cargar-env')}');\nexport const b = require('${ruta(origen, 'cargar-env')}');`;

        expect(await errores(obtener(), codigo, desde[origen])).toEqual([]);
      },
    );

    it.each(['main', 'cli', 'entorno'])('criterio 117: %s puede importar dotenv', async (origen) => {
      const codigo = "import dotenv from 'dotenv';\nimport 'dotenv/config';\nexport const x = dotenv;";

      expect(await errores(obtener(), codigo, desde[origen])).toEqual([]);
    });
  });

  describe('criterio 117: otros casos', () => {
    it('criterio 117: un modulo puede seguir importando el index de infraestructura/entorno', async () => {
      const codigo =
        "import { ENTORNO, retirarVariablesSensibles, validarEntorno } from '../../infraestructura/entorno';\nexport const x = [ENTORNO, retirarVariablesSensibles, validarEntorno];";

      expect(await errores(obtener(), codigo, MODULO)).toEqual([]);
    });

    it('criterio 117: un modulo puede importar otros archivos de infraestructura/entorno que no son cargar-env', async () => {
      const codigo =
        "import { leerNodeEnv } from '../../infraestructura/entorno/node-env';\nexport const x = leerNodeEnv;";

      expect(await errores(obtener(), codigo, MODULO)).toEqual([]);
    });

    it('criterio 117: una ruta que solo se parece a dotenv no se confunde con el paquete', async () => {
      const codigo = "import { x } from './dotenvoltura';\nexport const y = x;";

      expect(await errores(obtener(), codigo, MODULO)).toEqual([]);
    });

    it.each([
      ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
      ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
      ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
    ])('criterio 117: una prueba (%s) puede importar cargar-env y dotenv', async (_nombre, archivo) => {
      const codigo = `import { cargarEnvRaiz } from '../../src/infraestructura/entorno/cargar-env';\nimport dotenv from 'dotenv';\nexport const x = [cargarEnvRaiz, dotenv];`;

      expect(await errores(obtener(), codigo, archivo)).toEqual([]);
    });
  });
});
