// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterios 111 y 118 (ataque ronda 4, F5 y observaciones) y precision P-28: comprobacion previa del paso protegido.
//   - `scripts/lib/fuentes-protegidas.mjs` (solo `node:*`) exporta `enlacesSimbolicos(raices)` (rutas de los enlaces encontrados
//     bajo cada raiz, recorriendo con `lstat` sin seguir enlaces; una raiz que no existe no es error) y
//     `entradasAjenasEnGenerated(carpeta)` (las entradas de `backend/src/generated/` que no son la carpeta `prisma`).
//   - `scripts/comprobar-fuentes-protegidas.mjs` las aplica a `backend/src` y `packages/contratos/src`, consulta
//     `git ls-files -- backend/src/generated` y termina con codigo 1 nombrando cada ruta si encuentra algo. Si `git` no esta
//     disponible, falla con el motivo.
//   - el script `lint:protegido` de package.json lo ejecuta antes de ESLint.
// Los casos con enlaces simbolicos se omiten con aviso si el sistema no los permite (Windows sin modo de desarrollador: EPERM).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { RepoTemporal } from './ayuda-git.mjs';

const raizScripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raizRepo = path.resolve(raizScripts, '..');

/** Carga el modulo de la funcionalidad con un mensaje claro si todavia no existe. */
async function cargarLib() {
  const ruta = path.join(raizScripts, 'lib', 'fuentes-protegidas.mjs');
  if (!fs.existsSync(ruta)) {
    throw new Error('Falta la funcionalidad de la 001 (P-28): no existe scripts/lib/fuentes-protegidas.mjs.');
  }
  const modulo = await import(pathToFileURL(ruta).href);
  for (const nombre of ['enlacesSimbolicos', 'entradasAjenasEnGenerated']) {
    if (typeof modulo[nombre] !== 'function') {
      throw new Error(
        `Falta la funcionalidad de la 001 (P-28): scripts/lib/fuentes-protegidas.mjs no exporta ${nombre}.`,
      );
    }
  }
  return modulo;
}

const carpetas = [];
function carpetaTemporal() {
  const carpeta = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-fuentes-')));
  carpetas.push(carpeta);
  return carpeta;
}
afterEach(() => {
  for (const carpeta of carpetas.splice(0))
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function escribir(raiz, relativa, contenido = '') {
  const ruta = path.join(raiz, ...relativa.split('/'));
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, contenido);
  return ruta;
}

/** Crea un enlace; devuelve false si el sistema no lo permite (EPERM). */
function enlazar(destino, ruta, tipo) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  try {
    fs.symlinkSync(destino, ruta, tipo === 'carpeta' ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file');
    return true;
  } catch (error) {
    if (error && ['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return false;
    throw error;
  }
}

let enlacesPosibles;
function sePuedenCrearEnlaces() {
  if (enlacesPosibles !== undefined) return enlacesPosibles;
  const carpeta = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-sonda-')));
  try {
    escribir(carpeta, 'destino/x.txt', 'x');
    enlacesPosibles =
      enlazar(path.join(carpeta, 'destino'), path.join(carpeta, 'enlace-carpeta'), 'carpeta') &&
      enlazar(path.join(carpeta, 'destino', 'x.txt'), path.join(carpeta, 'enlace-archivo'), 'archivo');
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
  if (!enlacesPosibles) {
    console.warn('[criterio 111] AVISO: el sistema no permite crear enlaces simbolicos (EPERM); esos casos se omiten.');
  }
  return enlacesPosibles;
}
const posible = sePuedenCrearEnlaces();

/** Resultado de la lista (rutas absolutas o relativas a la raiz) comparado con una ruta absoluta esperada. */
function incluye(lista, esperada, raiz) {
  const candidatas = lista.flatMap((ruta) => [
    path.resolve(ruta),
    path.resolve(raiz, ruta),
    path.resolve(path.dirname(raiz), ruta),
  ]);
  return candidatas.includes(path.resolve(esperada));
}

describe.skipIf(!posible)('criterio 111 (P-28): enlacesSimbolicos(raices)', () => {
  it('criterio 111: encuentra un enlace a carpeta y otro a archivo en el primer nivel', async () => {
    const { enlacesSimbolicos } = await cargarLib();
    const raiz = carpetaTemporal();
    escribir(raiz, 'fuera/destino/x.ts', 'export const x = 1;');
    escribir(raiz, 'src/real.ts', 'export const r = 1;');
    const enlaceCarpeta = path.join(raiz, 'src', 'enlace-carpeta');
    const enlaceArchivo = path.join(raiz, 'src', 'enlace-archivo.ts');
    expect(enlazar(path.join(raiz, 'fuera', 'destino'), enlaceCarpeta, 'carpeta')).toBe(true);
    expect(enlazar(path.join(raiz, 'src', 'real.ts'), enlaceArchivo, 'archivo')).toBe(true);

    const encontrados = enlacesSimbolicos([path.join(raiz, 'src')]);

    expect(encontrados).toHaveLength(2);
    expect(incluye(encontrados, enlaceCarpeta, path.join(raiz, 'src')), 'el enlace a carpeta').toBe(true);
    expect(incluye(encontrados, enlaceArchivo, path.join(raiz, 'src')), 'el enlace a archivo').toBe(true);
  });

  it('criterio 111: encuentra los enlaces anidados en cualquier nivel', async () => {
    const { enlacesSimbolicos } = await cargarLib();
    const raiz = carpetaTemporal();
    escribir(raiz, 'fuera/destino/x.ts', 'export const x = 1;');
    escribir(raiz, 'src/a/b/c/real.ts', 'export const r = 1;');
    const profundoCarpeta = path.join(raiz, 'src', 'a', 'b', 'c', 'enlace-carpeta');
    const profundoArchivo = path.join(raiz, 'src', 'a', 'b', 'enlace.ts');
    const medio = path.join(raiz, 'src', 'a', 'enlace-medio');
    expect(enlazar(path.join(raiz, 'fuera', 'destino'), profundoCarpeta, 'carpeta')).toBe(true);
    expect(enlazar(path.join(raiz, 'src', 'a', 'b', 'c', 'real.ts'), profundoArchivo, 'archivo')).toBe(true);
    expect(enlazar(path.join(raiz, 'fuera', 'destino'), medio, 'carpeta')).toBe(true);

    const encontrados = enlacesSimbolicos([path.join(raiz, 'src')]);

    expect(encontrados).toHaveLength(3);
    for (const esperado of [profundoCarpeta, profundoArchivo, medio]) {
      expect(incluye(encontrados, esperado, path.join(raiz, 'src')), esperado).toBe(true);
    }
  });

  it('criterio 111: no sigue los enlaces: un enlace a una carpeta que tiene otro enlace dentro cuenta como uno solo', async () => {
    const { enlacesSimbolicos } = await cargarLib();
    const raiz = carpetaTemporal();
    escribir(raiz, 'fuera/destino/x.ts', 'export const x = 1;');
    escribir(raiz, 'src/real.ts', 'export const r = 1;');
    expect(
      enlazar(path.join(raiz, 'src', 'real.ts'), path.join(raiz, 'fuera', 'destino', 'interno.ts'), 'archivo'),
    ).toBe(true);
    const enlace = path.join(raiz, 'src', 'enlace-carpeta');
    expect(enlazar(path.join(raiz, 'fuera', 'destino'), enlace, 'carpeta')).toBe(true);

    const encontrados = enlacesSimbolicos([path.join(raiz, 'src')]);

    expect(encontrados).toHaveLength(1);
    expect(incluye(encontrados, enlace, path.join(raiz, 'src'))).toBe(true);
  });

  it('criterio 111: encuentra un enlace roto (cuyo destino no existe)', async () => {
    const { enlacesSimbolicos } = await cargarLib();
    const raiz = carpetaTemporal();
    escribir(raiz, 'src/real.ts', 'export const r = 1;');
    const roto = path.join(raiz, 'src', 'roto.ts');
    expect(enlazar(path.join(raiz, 'no-existe.ts'), roto, 'archivo')).toBe(true);

    const encontrados = enlacesSimbolicos([path.join(raiz, 'src')]);

    expect(encontrados).toHaveLength(1);
    expect(incluye(encontrados, roto, path.join(raiz, 'src'))).toBe(true);
  });

  it('criterio 111: recorre varias raices y junta los enlaces de todas', async () => {
    const { enlacesSimbolicos } = await cargarLib();
    const raiz = carpetaTemporal();
    escribir(raiz, 'fuera/x.ts', 'export const x = 1;');
    escribir(raiz, 'uno/real.ts');
    escribir(raiz, 'dos/real.ts');
    const enlaceUno = path.join(raiz, 'uno', 'enlace.ts');
    const enlaceDos = path.join(raiz, 'dos', 'sub', 'enlace.ts');
    expect(enlazar(path.join(raiz, 'fuera', 'x.ts'), enlaceUno, 'archivo')).toBe(true);
    expect(enlazar(path.join(raiz, 'fuera', 'x.ts'), enlaceDos, 'archivo')).toBe(true);

    const encontrados = enlacesSimbolicos([path.join(raiz, 'uno'), path.join(raiz, 'dos')]);

    expect(encontrados).toHaveLength(2);
    expect(incluye(encontrados, enlaceUno, path.join(raiz, 'uno'))).toBe(true);
    expect(incluye(encontrados, enlaceDos, path.join(raiz, 'dos'))).toBe(true);
  });
});

describe('criterio 111 (P-28): enlacesSimbolicos(raices) sin enlaces', () => {
  it('criterio 111: sin enlaces devuelve una lista vacia (carpetas y archivos normales, anidados)', async () => {
    const { enlacesSimbolicos } = await cargarLib();
    const raiz = carpetaTemporal();
    escribir(raiz, 'src/a/b/c/real.ts', 'export const r = 1;');
    escribir(raiz, 'src/otro.ts');

    expect(enlacesSimbolicos([path.join(raiz, 'src')])).toEqual([]);
  });

  it('criterio 111: una raiz que no existe no es error y da una lista vacia', async () => {
    const { enlacesSimbolicos } = await cargarLib();
    const raiz = carpetaTemporal();

    expect(enlacesSimbolicos([path.join(raiz, 'no-existe')])).toEqual([]);
    expect(enlacesSimbolicos([])).toEqual([]);
  });

  it('criterio 111: una raiz que no existe junto con una que si existe revisa la que existe', async () => {
    const { enlacesSimbolicos } = await cargarLib();
    const raiz = carpetaTemporal();
    escribir(raiz, 'src/real.ts');

    expect(enlacesSimbolicos([path.join(raiz, 'no-existe'), path.join(raiz, 'src')])).toEqual([]);
  });

  it('criterio 111: una carpeta vacia da una lista vacia', async () => {
    const { enlacesSimbolicos } = await cargarLib();
    const raiz = carpetaTemporal();
    fs.mkdirSync(path.join(raiz, 'src'));

    expect(enlacesSimbolicos([path.join(raiz, 'src')])).toEqual([]);
  });
});

describe('criterio 118 (P-28): entradasAjenasEnGenerated(carpeta)', () => {
  it('criterio 118: con solo la carpeta prisma devuelve una lista vacia', async () => {
    const { entradasAjenasEnGenerated } = await cargarLib();
    const carpeta = carpetaTemporal();
    escribir(carpeta, 'prisma/client.ts');
    escribir(carpeta, 'prisma/internal/class.ts');

    expect(entradasAjenasEnGenerated(carpeta)).toEqual([]);
  });

  it('criterio 118: una carpeta ajena junto a prisma se lista', async () => {
    const { entradasAjenasEnGenerated } = await cargarLib();
    const carpeta = carpetaTemporal();
    escribir(carpeta, 'prisma/client.ts');
    escribir(carpeta, 'otra/x.ts');

    const ajenas = entradasAjenasEnGenerated(carpeta);

    expect(ajenas).toHaveLength(1);
    expect(ajenas[0]).toContain('otra');
  });

  it('criterio 118: un archivo suelto junto a prisma se lista', async () => {
    const { entradasAjenasEnGenerated } = await cargarLib();
    const carpeta = carpetaTemporal();
    escribir(carpeta, 'prisma/client.ts');
    escribir(carpeta, 'x.ts');

    const ajenas = entradasAjenasEnGenerated(carpeta);

    expect(ajenas).toHaveLength(1);
    expect(ajenas[0]).toContain('x.ts');
  });

  it('criterio 118: varias entradas ajenas se listan todas', async () => {
    const { entradasAjenasEnGenerated } = await cargarLib();
    const carpeta = carpetaTemporal();
    escribir(carpeta, 'prisma/client.ts');
    escribir(carpeta, 'otra/x.ts');
    escribir(carpeta, 'y.ts');
    escribir(carpeta, 'prisma-otro/z.ts');

    const ajenas = entradasAjenasEnGenerated(carpeta).join('\n');

    expect(ajenas).toContain('otra');
    expect(ajenas).toContain('y.ts');
    expect(ajenas).toContain('prisma-otro');
  });

  it('criterio 118: un archivo llamado prisma (no una carpeta) se lista', async () => {
    const { entradasAjenasEnGenerated } = await cargarLib();
    const carpeta = carpetaTemporal();
    escribir(carpeta, 'prisma', 'no soy una carpeta');

    expect(entradasAjenasEnGenerated(carpeta)).toHaveLength(1);
  });

  it.skipIf(!posible)('criterio 118: un enlace llamado prisma (no una carpeta) se lista', async () => {
    const { entradasAjenasEnGenerated } = await cargarLib();
    const carpeta = carpetaTemporal();
    escribir(carpeta, 'real/x.ts');
    expect(enlazar(path.join(carpeta, 'real'), path.join(carpeta, 'prisma'), 'carpeta')).toBe(true);

    expect(entradasAjenasEnGenerated(carpeta).length).toBeGreaterThan(0);
  });

  it('criterio 118: una carpeta que no existe da una lista vacia (todavia no se ejecuto prisma generate)', async () => {
    const { entradasAjenasEnGenerated } = await cargarLib();
    const carpeta = carpetaTemporal();

    expect(entradasAjenasEnGenerated(path.join(carpeta, 'no-existe'))).toEqual([]);
  });

  it('criterio 118: una carpeta vacia da una lista vacia', async () => {
    const { entradasAjenasEnGenerated } = await cargarLib();
    const carpeta = carpetaTemporal();

    expect(entradasAjenasEnGenerated(carpeta)).toEqual([]);
  });
});

describe('criterios 111 y 118 (P-28): scripts/comprobar-fuentes-protegidas.mjs', () => {
  let repo;
  afterEach(() => {
    repo?.limpiar();
    repo = undefined;
  });

  /** Repositorio temporal con una copia de `scripts/` y un `.gitignore` como el real. */
  function prepararRepo() {
    const existe = fs.existsSync(path.join(raizScripts, 'comprobar-fuentes-protegidas.mjs'));
    if (!existe)
      throw new Error('Falta la funcionalidad de la 001 (P-28): no existe scripts/comprobar-fuentes-protegidas.mjs.');
    repo = new RepoTemporal();
    fs.cpSync(path.join(raizScripts, 'lib'), repo.ruta('scripts/lib'), { recursive: true });
    fs.copyFileSync(
      path.join(raizScripts, 'comprobar-fuentes-protegidas.mjs'),
      repo.ruta('scripts/comprobar-fuentes-protegidas.mjs'),
    );
    repo.escribir('scripts/package.json', '{ "type": "module" }\n');
    repo.escribir('.gitignore', 'backend/src/generated/\nnode_modules/\n');
    repo.escribir('backend/src/modulos/ejemplo/ejemplo.service.ts', 'export const m = 1;\n');
    repo.escribir('packages/contratos/src/index.ts', 'export const c = 1;\n');
    // (ajustado por el criterio 128, decision del orquestador tras la ronda 5; criterio 127, P-30) La comprobacion previa tambien revisa las
    // dependencias de backend/package.json (P-30): el repositorio temporal lo crea con solo paquetes de la lista permitida.
    repo.escribir('backend/package.json', '{ "name": "@aquagestion/backend", "dependencies": { "zod": "^4.6.7" } }\n');
    return repo;
  }

  function ejecutar(r, entornoExtra = {}) {
    const entorno = {
      ...process.env,
      GIT_CONFIG_GLOBAL: r.configuracionGlobal,
      GIT_CONFIG_NOSYSTEM: '1',
      ...entornoExtra,
    };
    for (const clave of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete entorno[clave];
    const resultado = spawnSync(process.execPath, [r.ruta('scripts/comprobar-fuentes-protegidas.mjs')], {
      cwd: r.dir,
      encoding: 'utf8',
      env: entorno,
    });
    return { codigo: resultado.status, texto: `${resultado.stdout}${resultado.stderr}` };
  }

  it('criterios 111 y 118: sin enlaces y con generated/prisma solamente, termina con codigo 0', () => {
    const r = prepararRepo();
    r.commit('base');
    r.escribir('backend/src/generated/prisma/client.ts', 'export const g = 1;\n'); // ignorado por .gitignore

    const { codigo, texto } = ejecutar(r);

    expect(texto.trim()).toBe('');
    expect(codigo).toBe(0);
  });

  it('criterio 118: sin la carpeta generated (prisma generate todavia no corrio), termina con codigo 0', () => {
    const r = prepararRepo();
    r.commit('base');

    expect(ejecutar(r).codigo).toBe(0);
  });

  it.skipIf(!posible)('criterio 111: un enlace a carpeta en backend/src termina con codigo 1 nombrando la ruta', () => {
    const r = prepararRepo();
    r.commit('base');
    expect(enlazar(r.ruta('backend/src/modulos/ejemplo'), r.ruta('backend/src/enlace-a-carpeta'), 'carpeta')).toBe(
      true,
    );

    const { codigo, texto } = ejecutar(r);

    expect(codigo).toBe(1);
    expect(texto).toContain('enlace-a-carpeta');
  });

  it.skipIf(!posible)('criterio 111: un enlace a archivo en backend/src termina con codigo 1 nombrando la ruta', () => {
    const r = prepararRepo();
    r.commit('base');
    expect(
      enlazar(
        r.ruta('backend/src/modulos/ejemplo/ejemplo.service.ts'),
        r.ruta('backend/src/modulos/atajo.ts'),
        'archivo',
      ),
    ).toBe(true);

    const { codigo, texto } = ejecutar(r);

    expect(codigo).toBe(1);
    expect(texto).toContain('atajo.ts');
  });

  it.skipIf(!posible)(
    'criterio 111: un enlace en packages/contratos/src termina con codigo 1 nombrando la ruta',
    () => {
      const r = prepararRepo();
      r.commit('base');
      expect(
        enlazar(r.ruta('packages/contratos/src/index.ts'), r.ruta('packages/contratos/src/alias.ts'), 'archivo'),
      ).toBe(true);

      const { codigo, texto } = ejecutar(r);

      expect(codigo).toBe(1);
      expect(texto).toContain('alias.ts');
    },
  );

  it.skipIf(!posible)('criterio 111: un enlace anidado profundo termina con codigo 1 nombrando la ruta', () => {
    const r = prepararRepo();
    r.commit('base');
    expect(
      enlazar(
        r.ruta('backend/src/modulos/ejemplo'),
        r.ruta('backend/src/modulos/ejemplo/a/b/enlace-profundo'),
        'carpeta',
      ),
    ).toBe(true);

    const { codigo, texto } = ejecutar(r);

    expect(codigo).toBe(1);
    expect(texto).toContain('enlace-profundo');
  });

  it.skipIf(!posible)('criterio 111: dos enlaces se nombran los dos', () => {
    const r = prepararRepo();
    r.commit('base');
    expect(enlazar(r.ruta('backend/src/modulos/ejemplo'), r.ruta('backend/src/primero'), 'carpeta')).toBe(true);
    expect(
      enlazar(r.ruta('packages/contratos/src/index.ts'), r.ruta('packages/contratos/src/segundo.ts'), 'archivo'),
    ).toBe(true);

    const { codigo, texto } = ejecutar(r);

    expect(codigo).toBe(1);
    expect(texto).toContain('primero');
    expect(texto).toContain('segundo.ts');
  });

  it('criterio 118: un archivo de generated agregado al repositorio (git add -f) termina con codigo 1 nombrando la ruta', () => {
    const r = prepararRepo();
    r.escribir('backend/src/generated/prisma/agregado.ts', 'export const g = 1;\n');
    r.git('add', '-f', 'backend/src/generated/prisma/agregado.ts');

    const { codigo, texto } = ejecutar(r);

    expect(codigo).toBe(1);
    expect(texto).toContain('backend/src/generated/prisma/agregado.ts');
  });

  it('criterio 118: un archivo de generated agregado y ya confirmado tambien', () => {
    const r = prepararRepo();
    r.escribir('backend/src/generated/otra/x.ts', 'export const g = 1;\n');
    r.git('add', '-f', 'backend/src/generated/otra/x.ts');
    r.git('commit', '-q', '-m', 'agregado a la fuerza');

    const { codigo, texto } = ejecutar(r);

    expect(codigo).toBe(1);
    expect(texto).toContain('backend/src/generated/otra/x.ts');
  });

  it('criterio 118: una carpeta ajena en generated (aunque no este en git) termina con codigo 1 nombrando la ruta', () => {
    const r = prepararRepo();
    r.commit('base');
    r.escribir('backend/src/generated/prisma/client.ts', 'export const g = 1;\n');
    r.escribir('backend/src/generated/otra/x.ts', 'import pg from "pg";\n');

    const { codigo, texto } = ejecutar(r);

    expect(codigo).toBe(1);
    expect(texto).toContain('otra');
  });

  it('criterio 118: un archivo suelto en generated (no esta en git) termina con codigo 1 nombrando la ruta', () => {
    const r = prepararRepo();
    r.commit('base');
    r.escribir('backend/src/generated/suelto.ts', 'export const g = 1;\n');

    const { codigo, texto } = ejecutar(r);

    expect(codigo).toBe(1);
    expect(texto).toContain('suelto.ts');
  });

  it('criterio 118: si git no esta disponible termina con codigo 1 y dice el motivo', () => {
    const r = prepararRepo();
    r.commit('base');

    // PATH vacio: el ejecutable `git` no se encuentra (node se invoca con su ruta absoluta).
    const { codigo, texto } = ejecutar(r, { PATH: '', Path: '' });

    expect(codigo).toBe(1);
    expect(texto.toLowerCase()).toContain('git');
  });
});

describe('criterio 111: el script lint:protegido ejecuta la comprobacion antes de ESLint', () => {
  const paquete = JSON.parse(fs.readFileSync(path.join(raizRepo, 'package.json'), 'utf8'));

  it('criterio 111: lint:protegido ejecuta scripts/comprobar-fuentes-protegidas.mjs y despues eslint --no-inline-config', () => {
    const comando = paquete.scripts['lint:protegido'] ?? '';
    const comprobacion = comando.search(/comprobar-fuentes-protegidas\.mjs/);
    const eslint = comando.search(/eslint[^&|;]*--no-inline-config/);

    expect(comprobacion, `no hay comprobacion previa en: ${comando}`).toBeGreaterThanOrEqual(0);
    expect(eslint).toBeGreaterThan(comprobacion);
    expect(comando.slice(comprobacion, eslint)).toContain('&&');
    expect(comando).toMatch(/node\s+scripts\/comprobar-fuentes-protegidas\.mjs/);
  });

  it('criterio 111: npm run lint sigue ejecutando lint:protegido', () => {
    expect(paquete.scripts['lint']).toMatch(/lint:protegido/);
  });

  it('criterio 111: la comprobacion sobre el repositorio real termina con codigo 0 (sin enlaces ni archivos ajenos en generated)', () => {
    const script = path.join(raizScripts, 'comprobar-fuentes-protegidas.mjs');
    if (!fs.existsSync(script)) {
      throw new Error('Falta la funcionalidad de la 001 (P-28): no existe scripts/comprobar-fuentes-protegidas.mjs.');
    }

    const resultado = spawnSync(process.execPath, [script], { cwd: raizRepo, encoding: 'utf8' });

    expect(`${resultado.stdout}${resultado.stderr}`.trim()).toBe('');
    expect(resultado.status).toBe(0);
  });
});
