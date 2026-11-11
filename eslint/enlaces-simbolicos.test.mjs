// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 111 (ataque ronda 4, F5; complementa los criterios 95 y 96), parte de las reglas de acceso: las reglas de acceso
// (criterios 85 y 95, y la del criterio 110) resuelven con `fs.realpathSync` la ruta del archivo que se revisa, la raiz
// (`context.cwd`) y la ruta importada cuando el archivo existe (probando las extensiones del criterio 95 y `.jsx`, y
// `index.<extension>` si es una carpeta); si no existe, usan la resolucion lexica de hoy. Asi, una importacion que pasa por un
// enlace fuera de `backend/src/` que apunta a `backend/src/cli/` o a un interno de `infraestructura/prisma/` falla como si se
// escribiera la ruta real.
// Prueba (regla con una carpeta temporal como `cwd`, con `backend/src/cli/conexion.ts` y un enlace `backend/enlace ->
// backend/src/cli`, donde un modulo con `import { crearClienteDelDueno } from '../../../enlace/conexion'` falla). Si el sistema no
// permite crear enlaces (Windows sin modo de desarrollador: EPERM), esos casos se omiten con aviso; corren en Linux.
// La comprobacion del script que rechaza los enlaces en backend/src/ esta en scripts/test/fuentes-protegidas.test.mjs.
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  borrarCarpeta,
  carpetaTemporal,
  crearEnlace,
  eslintProtegidoEn,
  erroresEn,
  escribir,
  sePuedenCrearEnlaces,
} from './ayuda-lint-ronda4.mjs';

const posible = sePuedenCrearEnlaces();
const MODULO = 'backend/src/modulos/ejemplo/ejemplo.service.ts';
const IMPORTA_PG = "import pg from 'pg';\nexport const x = pg;";

describe.skipIf(!posible)('criterio 111: las reglas de acceso resuelven los enlaces simbolicos con realpath', () => {
  let carpeta;
  let eslint;

  /** Arbol minimo: cli/conexion, los internos de prisma/ y un modulo; mas los enlaces que cada prueba necesite. */
  beforeEach(() => {
    carpeta = carpetaTemporal();
    escribir(carpeta, 'backend/src/cli/conexion.ts', 'export const crearClienteDelDueno = 1;\n');
    escribir(carpeta, 'backend/src/cli/subcarpeta/index.ts', 'export const dentro = 1;\n');
    escribir(carpeta, 'backend/src/cli/vista.jsx', 'export const vista = 1;\n');
    escribir(carpeta, 'backend/src/infraestructura/prisma/index.ts', 'export const sql = 1;\n');
    escribir(carpeta, 'backend/src/infraestructura/prisma/base-datos.ts', 'export const interno = 1;\n');
    escribir(carpeta, 'backend/src/modulos/ejemplo/ejemplo.service.ts', 'export const m = 1;\n');
    escribir(carpeta, 'backend/src/modulos/ejemplo/otro.ts', 'export const o = 1;\n');
    eslint = eslintProtegidoEn(carpeta);
  });
  afterEach(() => {
    borrarCarpeta(carpeta);
  });

  const lintear = (codigo, archivo = MODULO) => erroresEn(eslint, carpeta, codigo, archivo);
  const enlazarCarpeta = (destino, enlace) =>
    expect(crearEnlace(path.join(carpeta, destino), path.join(carpeta, enlace), 'carpeta')).toBe(true);
  const enlazarArchivo = (destino, enlace) =>
    expect(crearEnlace(path.join(carpeta, destino), path.join(carpeta, enlace), 'archivo')).toBe(true);

  describe('criterio 111: una importacion por un enlace hacia backend/src/cli/ falla como si fuera la ruta real', () => {
    it('criterio 111 (control): sin enlace, la misma ruta escrita en una carpeta real no falla', async () => {
      escribir(carpeta, 'backend/enlace/conexion.ts', 'export const crearClienteDelDueno = 1;\n');

      const encontrados = await lintear(
        "import { crearClienteDelDueno } from '../../../enlace/conexion';\nexport const x = crearClienteDelDueno;",
      );

      expect(encontrados).toEqual([]);
    });

    it('criterio 111 (control): la ruta real a cli/ falla (la regla del criterio 95 funciona en la carpeta temporal)', async () => {
      const encontrados = await lintear(
        "import { crearClienteDelDueno } from '../../cli/conexion';\nexport const x = crearClienteDelDueno;",
      );

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111: import por backend/enlace -> backend/src/cli (ejemplo de la especificacion)', async () => {
      enlazarCarpeta('backend/src/cli', 'backend/enlace');

      const encontrados = await lintear(
        "import { crearClienteDelDueno } from '../../../enlace/conexion';\nexport const x = crearClienteDelDueno;",
      );

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it.each([
      ['import con la extension', "import { c } from '../../../enlace/conexion.ts';\nexport const x = c;"],
      ['import de tipo', "import type { C } from '../../../enlace/conexion';\nexport type X = C;"],
      ['import de efecto', "import '../../../enlace/conexion';"],
      ['export ... from', "export { crearClienteDelDueno } from '../../../enlace/conexion';"],
      ['export * from', "export * from '../../../enlace/conexion';"],
      ['import()', "export const cargar = () => import('../../../enlace/conexion');"],
      ['require()', "export const m = require('../../../enlace/conexion');"],
      ['import x = require()', "import c = require('../../../enlace/conexion');\nexport const x = c;"],
    ])('criterio 111: %s por un enlace a cli/ falla el lint', async (_nombre, codigo) => {
      enlazarCarpeta('backend/src/cli', 'backend/enlace');

      expect((await lintear(codigo)).length, codigo).toBeGreaterThan(0);
    });

    it('criterio 111: un enlace a un archivo de cli/ (backend/atajo.ts -> backend/src/cli/conexion.ts) falla', async () => {
      enlazarArchivo('backend/src/cli/conexion.ts', 'backend/atajo.ts');

      const encontrados = await lintear("import { c } from '../../../atajo';\nexport const x = c;");

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111: un enlace a una carpeta de cli/ con index (la ruta se resuelve a index.<extension>) falla', async () => {
      enlazarCarpeta('backend/src/cli/subcarpeta', 'backend/enlace-sub');

      const encontrados = await lintear("import { dentro } from '../../../enlace-sub';\nexport const x = dentro;");

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111: un enlace a un archivo .jsx de cli/ (la resolucion prueba tambien .jsx) falla', async () => {
      enlazarCarpeta('backend/src/cli', 'backend/enlace');

      const encontrados = await lintear("import { vista } from '../../../enlace/vista';\nexport const x = vista;");

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111: un enlace dentro de backend/src (backend/src/modulos/atajo -> backend/src/cli) falla', async () => {
      enlazarCarpeta('backend/src/cli', 'backend/src/modulos/atajo');

      const encontrados = await lintear("import { c } from '../atajo/conexion';\nexport const x = c;");

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111: un enlace que apunta a otro enlace que apunta a cli/ (cadena de enlaces) falla', async () => {
      enlazarCarpeta('backend/src/cli', 'backend/enlace-uno');
      enlazarCarpeta('backend/enlace-uno', 'backend/enlace-dos');

      const encontrados = await lintear("import { c } from '../../../enlace-dos/conexion';\nexport const x = c;");

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111: un enlace con una ruta relativa (backend/enlace -> src/cli) falla', async () => {
      expect(crearEnlace(path.join('src', 'cli'), path.join(carpeta, 'backend', 'enlace'), 'carpeta')).toBe(true);

      const encontrados = await lintear("import { c } from '../../../enlace/conexion';\nexport const x = c;");

      expect(encontrados.length).toBeGreaterThan(0);
    });
  });

  describe('criterio 111: una importacion por un enlace hacia un interno de infraestructura/prisma/ falla', () => {
    it('criterio 111 (control): la ruta real a un interno de prisma/ falla', async () => {
      const encontrados = await lintear(
        "import { interno } from '../../infraestructura/prisma/base-datos';\nexport const x = interno;",
      );

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111: backend/enlace-prisma -> backend/src/infraestructura/prisma, importando base-datos, falla', async () => {
      enlazarCarpeta('backend/src/infraestructura/prisma', 'backend/enlace-prisma');

      const encontrados = await lintear(
        "import { interno } from '../../../enlace-prisma/base-datos';\nexport const x = interno;",
      );

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111: un enlace al archivo interno de prisma/ falla', async () => {
      enlazarArchivo('backend/src/infraestructura/prisma/base-datos.ts', 'backend/interno.ts');

      const encontrados = await lintear("import { interno } from '../../../interno';\nexport const x = interno;");

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111 (control): el index de prisma/ por un enlace sigue permitido (es el punto autorizado)', async () => {
      enlazarCarpeta('backend/src/infraestructura/prisma', 'backend/enlace-prisma');

      const encontrados = await lintear("import { sql } from '../../../enlace-prisma';\nexport const x = sql;");

      expect(encontrados).toEqual([]);
    });
  });

  describe('criterio 111: los enlaces tambien cuentan para el archivo que se revisa y para la raiz', () => {
    it('criterio 111: un modulo que importa pg falla; el mismo codigo desde un enlace a una carpeta de cli/ se evalua por su ruta real (cli/)', async () => {
      // `backend/src/cli/atajo` -> `backend/src/modulos/ejemplo`: el archivo esta lexicamente en cli/ (donde pg se puede importar),
      // pero fisicamente es un modulo, y las reglas lo tratan por su ruta real.
      enlazarCarpeta('backend/src/modulos/ejemplo', 'backend/src/cli/atajo');

      const encontrados = await lintear(IMPORTA_PG, 'backend/src/cli/atajo/ejemplo.service.ts');

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111 (control): el mismo import de pg en un archivo real de cli/ pasa', async () => {
      expect(await lintear(IMPORTA_PG, 'backend/src/cli/conexion.ts')).toEqual([]);
    });

    it('criterio 111: con la raiz (cwd) detras de un enlace, importar cli/ desde un modulo sigue fallando y el index de prisma/ sigue pasando', async () => {
      const enlaceDeLaRaiz = `${carpeta}-enlace`;
      expect(crearEnlace(carpeta, enlaceDeLaRaiz, 'carpeta')).toBe(true);
      try {
        const eslintEnLaRaiz = eslintProtegidoEn(enlaceDeLaRaiz);
        const falla = await erroresEn(
          eslintEnLaRaiz,
          enlaceDeLaRaiz,
          "import { c } from '../../cli/conexion';\nexport const x = c;",
          MODULO,
        );
        const pasa = await erroresEn(
          eslintEnLaRaiz,
          enlaceDeLaRaiz,
          "import { sql } from '../../infraestructura/prisma';\nexport const x = sql;",
          MODULO,
        );

        expect(falla.length, 'cli/ desde un modulo').toBeGreaterThan(0);
        expect(pasa, 'el index de prisma/').toEqual([]);
      } finally {
        borrarCarpeta(enlaceDeLaRaiz);
      }
    });
  });

  describe('criterio 111: si el archivo importado no existe se usa la resolucion lexica de hoy', () => {
    it('criterio 111: importar un archivo inexistente de cli/ falla (por la ruta escrita)', async () => {
      const encontrados = await lintear("import { c } from '../../cli/no-existe';\nexport const x = c;");

      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('criterio 111: importar un archivo inexistente de otro modulo pasa', async () => {
      const encontrados = await lintear("import { c } from './no-existe';\nexport const x = c;");

      expect(encontrados).toEqual([]);
    });
  });

  describe('criterio 111: lo permitido sigue permitido', () => {
    it('criterio 111: importar otro archivo del mismo modulo pasa', async () => {
      expect(await lintear("import { o } from './otro';\nexport const x = o;")).toEqual([]);
    });

    it('criterio 111: un enlace entre archivos que no son de cli/ ni de prisma/ pasa', async () => {
      enlazarArchivo('backend/src/modulos/ejemplo/otro.ts', 'backend/src/modulos/ejemplo/alias.ts');

      expect(await lintear("import { o } from './alias';\nexport const x = o;")).toEqual([]);
    });
  });
});
