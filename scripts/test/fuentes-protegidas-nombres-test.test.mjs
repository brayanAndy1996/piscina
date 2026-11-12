// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 110, precision del orquestador tras la ronda 4 (11/11/2026): nombres con `.test.` que no son pruebas. Dentro de
// `backend/src/` y de `packages/contratos/src/`, es un error del paso protegido (criterio 96; `npm run lint:protegido`, a traves de
// su comprobacion previa `scripts/comprobar-fuentes-protegidas.mjs`) cualquier archivo cuyo nombre contenga `.test.` y no termine
// exactamente en `.test.ts`, `.test.mts`, `.test.cts`, `.test.js`, `.test.mjs` o `.test.cjs`, en cualquier carpeta y sea cual sea su
// contenido. El paso termina con codigo 1 con un mensaje que nombra la ruta y pide renombrar el archivo. La comprobacion no depende
// de que ESLint revise ese tipo de archivo (tambien cuentan `x.test.d.ts`, `x.test.tsx`, `x.test.jsx` o `x.test.json`).
// Prueba: `backend/src/cli/atajo.test.util.ts` con `import pg from 'pg'`, `backend/src/cli/x.test.d.ts`,
// `backend/src/modulos/ejemplo/x.test.tsx` y `packages/contratos/src/x.test.util.ts` (aunque esten vacios) terminan con codigo 1;
// siguen pasando `backend/src/cli/ejemplo.test.ts` y `packages/contratos/src/esquemas.test.ts`.
// Todo se hace en un repositorio git temporal con una copia de scripts/: no se deja ningun archivo en el repositorio del proyecto.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { RepoTemporal } from './ayuda-git.mjs';

const raizScripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raizRepo = path.resolve(raizScripts, '..');

const IMPORTA_PG = "import pg from 'pg';\nexport const x = pg;\n";

describe('criterio 110 (precision): nombres con .test. que no son pruebas hacen fallar la comprobacion previa del paso protegido', () => {
  let repo;
  afterEach(() => {
    repo?.limpiar();
    repo = undefined;
  });

  /** Repositorio temporal con una copia de `scripts/` (la comprobacion y sus bibliotecas) y un `.gitignore` como el real. */
  function prepararRepo() {
    if (!fs.existsSync(path.join(raizScripts, 'comprobar-fuentes-protegidas.mjs'))) {
      throw new Error(
        'Falta la comprobacion previa del paso protegido: no existe scripts/comprobar-fuentes-protegidas.mjs.',
      );
    }
    repo = new RepoTemporal();
    fs.cpSync(path.join(raizScripts, 'lib'), repo.ruta('scripts/lib'), { recursive: true });
    for (const entrada of fs.readdirSync(raizScripts, { withFileTypes: true })) {
      if (entrada.isFile() && entrada.name.endsWith('.mjs')) {
        fs.copyFileSync(path.join(raizScripts, entrada.name), repo.ruta(`scripts/${entrada.name}`));
      }
    }
    repo.escribir('scripts/package.json', '{ "type": "module" }\n');
    repo.escribir('.gitignore', 'backend/src/generated/\nnode_modules/\n');
    repo.escribir('backend/src/modulos/ejemplo/ejemplo.service.ts', 'export const m = 1;\n');
    repo.escribir('packages/contratos/src/index.ts', 'export const c = 1;\n');
    // (ajustado por el criterio 128, decision del orquestador tras la ronda 5; criterio 127, P-30) La comprobacion previa tambien revisa las
    // dependencias de backend/package.json (P-30): el repositorio temporal lo crea con solo paquetes de la lista permitida.
    repo.escribir('backend/package.json', '{ "name": "@aquagestion/backend", "dependencies": { "zod": "^4.6.7" } }\n');
    return repo;
  }

  function ejecutar(r) {
    const entorno = { ...process.env, GIT_CONFIG_GLOBAL: r.configuracionGlobal, GIT_CONFIG_NOSYSTEM: '1' };
    for (const clave of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete entorno[clave];
    const resultado = spawnSync(process.execPath, [r.ruta('scripts/comprobar-fuentes-protegidas.mjs')], {
      cwd: r.dir,
      encoding: 'utf8',
      env: entorno,
    });
    return { codigo: resultado.status, texto: `${resultado.stdout}${resultado.stderr}`.replaceAll('\\', '/') };
  }

  describe('fallan con codigo 1, nombran la ruta y piden renombrar', () => {
    it.each([
      [
        'backend/src/cli/atajo.test.util.ts con import de pg (ejemplo de la especificacion)',
        'backend/src/cli/atajo.test.util.ts',
        IMPORTA_PG,
      ],
      ['backend/src/cli/x.test.d.ts vacio (ejemplo de la especificacion)', 'backend/src/cli/x.test.d.ts', ''],
      [
        'backend/src/modulos/ejemplo/x.test.tsx vacio (ejemplo de la especificacion)',
        'backend/src/modulos/ejemplo/x.test.tsx',
        '',
      ],
      [
        'packages/contratos/src/x.test.util.ts vacio (ejemplo de la especificacion)',
        'packages/contratos/src/x.test.util.ts',
        '',
      ],
      ['x.test.jsx', 'backend/src/modulos/ejemplo/x.test.jsx', ''],
      ['x.test.json', 'backend/src/modulos/ejemplo/x.test.json', '{}\n'],
      ['x.test.util.js', 'backend/src/modulos/ejemplo/x.test.util.js', ''],
      ['x.test.util.mjs en cli/', 'backend/src/cli/x.test.util.mjs', ''],
      ['x.test.ts.ts (termina en .ts pero no en .test.ts)', 'backend/src/modulos/ejemplo/x.test.ts.ts', ''],
      ['x.test.ts.bak', 'backend/src/modulos/ejemplo/x.test.ts.bak', ''],
      ['x.test.helpers.ts en una carpeta profunda', 'backend/src/modulos/ejemplo/a/b/c/x.test.helpers.ts', ''],
      ['x.test.d.ts en packages/contratos/src', 'packages/contratos/src/esquemas/x.test.d.ts', ''],
      ['x.test.tsx en packages/contratos/src', 'packages/contratos/src/x.test.tsx', ''],
      ['x.test.txt (cualquier extension)', 'backend/src/comun/x.test.txt', 'nada\n'],
      ['x.test.util.ts en la raiz de backend/src', 'backend/src/x.test.util.ts', ''],
    ])('criterio 110: %s', (_nombre, ruta, contenido) => {
      const r = prepararRepo();
      r.escribir(ruta, contenido);
      r.commit('base');

      const { codigo, texto } = ejecutar(r);

      expect(codigo, texto).toBe(1);
      expect(texto, 'el mensaje debe nombrar la ruta').toContain(ruta);
      expect(texto, 'el mensaje debe pedir renombrar el archivo').toMatch(/renombr/i);
    });

    it('criterio 110: falla igual si el archivo no esta en git (sin commit ni add)', () => {
      const r = prepararRepo();
      r.commit('base');
      r.escribir('backend/src/cli/atajo.test.util.ts', IMPORTA_PG);

      const { codigo, texto } = ejecutar(r);

      expect(codigo, texto).toBe(1);
      expect(texto).toContain('backend/src/cli/atajo.test.util.ts');
    });

    it('criterio 110: varios archivos con .test. que no son pruebas se nombran todos', () => {
      const r = prepararRepo();
      r.escribir('backend/src/cli/atajo.test.util.ts', IMPORTA_PG);
      r.escribir('backend/src/cli/x.test.d.ts', '');
      r.escribir('packages/contratos/src/x.test.util.ts', '');
      r.commit('base');

      const { codigo, texto } = ejecutar(r);

      expect(codigo, texto).toBe(1);
      expect(texto).toContain('backend/src/cli/atajo.test.util.ts');
      expect(texto).toContain('backend/src/cli/x.test.d.ts');
      expect(texto).toContain('packages/contratos/src/x.test.util.ts');
    });

    it('criterio 110: un archivo mal nombrado junto a pruebas bien nombradas solo nombra al mal nombrado', () => {
      const r = prepararRepo();
      r.escribir('backend/src/cli/ejemplo.test.ts', IMPORTA_PG);
      r.escribir('backend/src/cli/atajo.test.util.ts', IMPORTA_PG);
      r.commit('base');

      const { codigo, texto } = ejecutar(r);

      expect(codigo, texto).toBe(1);
      expect(texto).toContain('atajo.test.util.ts');
      expect(texto).not.toContain('cli/ejemplo.test.ts');
    });
  });

  describe('pasan con codigo 0 y sin mensajes', () => {
    it('criterio 110: backend/src/cli/ejemplo.test.ts y packages/contratos/src/esquemas.test.ts (ejemplos de la especificacion)', () => {
      const r = prepararRepo();
      r.escribir('backend/src/cli/ejemplo.test.ts', IMPORTA_PG);
      r.escribir('packages/contratos/src/esquemas.test.ts', 'export const e = 1;\n');
      r.commit('base');

      const { codigo, texto } = ejecutar(r);

      expect(texto.trim()).toBe('');
      expect(codigo).toBe(0);
    });

    it.each(['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'])(
      'criterio 110: ejemplo.service.test.%s (extension exenta) en backend/src y en packages/contratos/src',
      (extension) => {
        const r = prepararRepo();
        r.escribir(`backend/src/modulos/ejemplo/ejemplo.service.test.${extension}`, '');
        r.escribir(`backend/src/cli/ejemplo.test.${extension}`, '');
        r.escribir(`packages/contratos/src/esquemas.test.${extension}`, '');
        r.commit('base');

        const { codigo, texto } = ejecutar(r);

        expect(texto.trim()).toBe('');
        expect(codigo).toBe(0);
      },
    );

    it.each([
      ['testigo.ts', 'backend/src/modulos/ejemplo/testigo.ts'],
      ['retest.ts', 'backend/src/modulos/ejemplo/retest.ts'],
      ['contest.service.ts', 'backend/src/modulos/ejemplo/contest.service.ts'],
      ['datos.tests.ts (.tests, no .test.)', 'backend/src/modulos/ejemplo/datos.tests.ts'],
      ['datos.testing.ts', 'backend/src/modulos/ejemplo/datos.testing.ts'],
      ['x.test-util.ts (.test-, no .test.)', 'backend/src/modulos/ejemplo/x.test-util.ts'],
      ['test.util.ts (sin punto antes de test)', 'backend/src/modulos/ejemplo/test.util.ts'],
      ['x-test.ts', 'backend/src/modulos/ejemplo/x-test.ts'],
      ['x.spec.ts', 'backend/src/modulos/ejemplo/x.spec.ts'],
    ])('criterio 110: %s no se confunde con una prueba mal nombrada', (_nombre, ruta) => {
      const r = prepararRepo();
      r.escribir(ruta, '');
      r.commit('base');

      const { codigo, texto } = ejecutar(r);

      expect(texto.trim()).toBe('');
      expect(codigo).toBe(0);
    });

    it('criterio 110: fuera de backend/src y packages/contratos/src no se revisa (backend/test/ lleva sus propios nombres)', () => {
      const r = prepararRepo();
      r.escribir('backend/test/utilidades/x.test.util.ts', '');
      r.escribir('packages/contratos/test/x.test.util.ts', '');
      r.commit('base');

      const { codigo, texto } = ejecutar(r);

      expect(texto.trim()).toBe('');
      expect(codigo).toBe(0);
    });
  });

  describe('lint:protegido y el repositorio real', () => {
    it('criterio 110: lint:protegido ejecuta la comprobacion previa antes de ESLint (por ella se detectan estos nombres)', () => {
      const paquete = JSON.parse(fs.readFileSync(path.join(raizRepo, 'package.json'), 'utf8'));
      const comando = paquete.scripts['lint:protegido'] ?? '';

      expect(comando).toMatch(/node\s+scripts\/comprobar-fuentes-protegidas\.mjs\s*&&\s*eslint/);
    });

    it('criterio 110: el repositorio real no tiene archivos con .test. que no sean pruebas en backend/src ni packages/contratos/src', () => {
      const permitidos = /\.test\.(ts|mts|cts|js|mjs|cjs)$/;
      const malos = [];
      const recorrer = (carpeta) => {
        if (!fs.existsSync(carpeta)) return;
        for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
          const ruta = path.join(carpeta, entrada.name);
          if (entrada.isDirectory()) recorrer(ruta);
          else if (entrada.name.includes('.test.') && !permitidos.test(entrada.name))
            malos.push(path.relative(raizRepo, ruta));
        }
      };
      recorrer(path.join(raizRepo, 'backend', 'src'));
      recorrer(path.join(raizRepo, 'packages', 'contratos', 'src'));

      expect(malos).toEqual([]);
    });
  });
});
