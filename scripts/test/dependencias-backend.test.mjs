// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 127 (ataque ronda 5, O1; complementa los criterios 85 y 96), precision P-30, y las funciones de la lista negra del criterio
// 129 y de nombres de paquete del criterio 128 que comparten el mismo archivo:
//   - `scripts/lib/dependencias-backend.mjs` (solo `node:*`) tiene la lista versionada de los paquetes que `backend/package.json`
//     puede declarar (`DEPENDENCIAS_BACKEND_PERMITIDAS`: las de hoy mas `express`) y exporta `SECCIONES_DE_DEPENDENCIAS`,
//     `dependenciasNoPermitidas`, `problemasDeDependencias`, `nombreDePaquete`, `CLIENTES_DE_BASE_PROHIBIDOS` y
//     `esClienteDeBaseProhibido`;
//   - el paso protegido (`scripts/comprobar-fuentes-protegidas.mjs`, que ejecuta `npm run lint:protegido` antes de ESLint) termina con
//     codigo 1 si `backend/package.json` declara, en `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`,
//     `bundleDependencies` o `bundledDependencies`, un paquete que no esta en la lista, nombrando el paquete y el archivo de la
//     lista;
//   - la lista permitida no contiene ningun paquete de la lista negra del criterio 129.
// Todo se prueba con carpetas temporales (y repositorios git temporales para el script); el `backend/package.json` real se lee sin
// modificarlo. Las reglas de lint de los criterios 128 y 129 estan en eslint/regla-paquetes-declarados.test.mjs y
// eslint/regla-clientes-de-base.test.mjs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { RepoTemporal } from './ayuda-git.mjs';

const raizScripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raizRepo = path.resolve(raizScripts, '..');
const RUTA_LIB = path.join(raizScripts, 'lib', 'dependencias-backend.mjs');

/** Dependencias de `backend/package.json` antes de la ronda 5 (las de hoy): la lista permitida debe incluirlas todas. */
const DEPENDENCIAS_DE_HOY = [
  '@aquagestion/contratos',
  '@nestjs/common',
  '@nestjs/core',
  '@nestjs/platform-express',
  '@nestjs/throttler',
  '@node-rs/argon2',
  '@prisma/adapter-pg',
  '@prisma/client',
  'dotenv',
  'helmet',
  'jsonwebtoken',
  'nestjs-pino',
  'pg',
  'pino',
  'pino-http',
  'reflect-metadata',
  'rxjs',
  'zod',
  '@nestjs/cli',
  '@nestjs/testing',
  '@types/express',
  '@types/jsonwebtoken',
  '@types/pg',
  '@types/supertest',
  'pino-pretty',
  'prisma',
  'supertest',
  'tsx',
];

const SECCIONES = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundleDependencies',
  'bundledDependencies',
];
const SECCIONES_CON_OBJETO = SECCIONES.slice(0, 4);
const SECCIONES_CON_ARREGLO = SECCIONES.slice(4);

/** Carga la funcionalidad con un mensaje claro si todavia no existe. */
async function cargarLib() {
  if (!fs.existsSync(RUTA_LIB)) {
    throw new Error('Falta la funcionalidad de la 001 (P-30): no existe scripts/lib/dependencias-backend.mjs.');
  }
  const modulo = await import(pathToFileURL(RUTA_LIB).href);
  for (const nombre of [
    'DEPENDENCIAS_BACKEND_PERMITIDAS',
    'SECCIONES_DE_DEPENDENCIAS',
    'dependenciasNoPermitidas',
    'problemasDeDependencias',
    'nombreDePaquete',
    'CLIENTES_DE_BASE_PROHIBIDOS',
    'esClienteDeBaseProhibido',
  ]) {
    if (modulo[nombre] === undefined) {
      throw new Error(
        `Falta la funcionalidad de la 001 (P-30): scripts/lib/dependencias-backend.mjs no exporta ${nombre}.`,
      );
    }
  }
  return modulo;
}

const carpetas = [];
function carpetaTemporal() {
  const carpeta = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-deps-')));
  carpetas.push(carpeta);
  return carpeta;
}
afterEach(() => {
  for (const carpeta of carpetas.splice(0))
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Escribe `<raiz>/backend/package.json` con el contenido dado. */
function escribirPaquete(raiz, contenido) {
  const ruta = path.join(raiz, 'backend', 'package.json');
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(contenido, null, 2));
}

/** Un `package.json` con `nombre` declarado en la seccion indicada (objeto o arreglo, segun la seccion). */
function paqueteCon(seccion, nombre) {
  return {
    name: '@aquagestion/backend',
    [seccion]: SECCIONES_CON_ARREGLO.includes(seccion) ? [nombre] : { [nombre]: '^1.0.0' },
  };
}

describe('criterio 127 (P-30): scripts/lib/dependencias-backend.mjs es un modulo con solo node:* y rutas relativas', () => {
  it('criterio 127: existe y solo importa modulos node:* o rutas relativas (se carga sin node_modules)', () => {
    expect(fs.existsSync(RUTA_LIB), 'falta scripts/lib/dependencias-backend.mjs').toBe(true);
    const texto = fs.readFileSync(RUTA_LIB, 'utf8');
    const especificadores = [
      ...texto.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g),
      ...texto.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g),
      ...texto.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((coincidencia) => coincidencia[1]);
    const ajenos = especificadores.filter((especificador) => !/^(node:|\.{1,2}\/)/.test(especificador));
    expect(ajenos, 'importa algo que no es node:* ni una ruta relativa').toEqual([]);
  });
});

describe('criterio 127 (P-30): la lista de dependencias permitidas', () => {
  it('criterio 127: es una lista de textos no vacios, sin repetidos', async () => {
    const { DEPENDENCIAS_BACKEND_PERMITIDAS: lista } = await cargarLib();

    expect(Array.isArray(lista)).toBe(true);
    expect(lista.length).toBeGreaterThan(0);
    for (const nombre of lista) expect(typeof nombre === 'string' && nombre.length > 0, String(nombre)).toBe(true);
    expect(new Set(lista).size, 'hay paquetes repetidos').toBe(lista.length);
  });

  it('criterio 127: tiene todas las dependencias de hoy del backend mas express', async () => {
    const { DEPENDENCIAS_BACKEND_PERMITIDAS: lista } = await cargarLib();

    expect(DEPENDENCIAS_DE_HOY.filter((nombre) => !lista.includes(nombre))).toEqual([]);
    expect(lista).toContain('express');
  });

  it('criterio 127: el backend/package.json real cumple (problemasDeDependencias de la raiz del repositorio da [])', async () => {
    const { problemasDeDependencias } = await cargarLib();

    expect(problemasDeDependencias(raizRepo)).toEqual([]);
  });

  it('criterio 128: el backend/package.json real declara express (hoy se importa como valor sin estar declarado)', () => {
    const paquete = JSON.parse(fs.readFileSync(path.join(raizRepo, 'backend', 'package.json'), 'utf8'));

    const declaradas = SECCIONES_CON_OBJETO.flatMap((seccion) => Object.keys(paquete[seccion] ?? {}));
    expect(declaradas).toContain('express');
  });

  it('criterio 127: cada paquete que declara hoy el backend/package.json real esta en la lista', async () => {
    const { DEPENDENCIAS_BACKEND_PERMITIDAS: lista } = await cargarLib();
    const paquete = JSON.parse(fs.readFileSync(path.join(raizRepo, 'backend', 'package.json'), 'utf8'));

    const declaradas = SECCIONES_CON_OBJETO.flatMap((seccion) => Object.keys(paquete[seccion] ?? {}));
    expect(declaradas.filter((nombre) => !lista.includes(nombre))).toEqual([]);
  });

  it('criterio 127 y 129: la lista permitida y la lista negra no comparten ningun paquete', async () => {
    const { DEPENDENCIAS_BACKEND_PERMITIDAS: lista, esClienteDeBaseProhibido } = await cargarLib();

    expect(lista.filter((nombre) => esClienteDeBaseProhibido(nombre))).toEqual([]);
  });
});

describe('criterio 127 (P-30): SECCIONES_DE_DEPENDENCIAS y dependenciasNoPermitidas', () => {
  it('criterio 127: SECCIONES_DE_DEPENDENCIAS son exactamente las seis secciones de npm', async () => {
    const { SECCIONES_DE_DEPENDENCIAS } = await cargarLib();

    expect([...SECCIONES_DE_DEPENDENCIAS].sort()).toEqual([...SECCIONES].sort());
  });

  it.each(SECCIONES)(
    'criterio 127: un paquete fuera de la lista en %s se informa, y uno de la lista no',
    async (seccion) => {
      const { dependenciasNoPermitidas } = await cargarLib();
      const permitidas = ['uno-permitido', '@ambito/permitido'];
      const mezcla = (nombres) => ({
        name: 'x',
        [seccion]: SECCIONES_CON_ARREGLO.includes(seccion)
          ? nombres
          : Object.fromEntries(nombres.map((nombre) => [nombre, '^1.0.0'])),
      });

      expect(dependenciasNoPermitidas(mezcla(['uno-permitido', 'otro-ajeno']), permitidas)).toEqual(['otro-ajeno']);
      expect(dependenciasNoPermitidas(mezcla(['uno-permitido', '@ambito/permitido']), permitidas)).toEqual([]);
      expect(dependenciasNoPermitidas(mezcla(['@ambito/ajeno', 'uno-permitido']), permitidas)).toEqual([
        '@ambito/ajeno',
      ]);
    },
  );

  it('criterio 127: sin la lista como segundo argumento usa DEPENDENCIAS_BACKEND_PERMITIDAS', async () => {
    const { dependenciasNoPermitidas, DEPENDENCIAS_BACKEND_PERMITIDAS: lista } = await cargarLib();
    const propios = lista.slice(0, 3);

    const resultado = dependenciasNoPermitidas({
      dependencies: { ...Object.fromEntries(propios.map((nombre) => [nombre, '^1'])), knex: '^3.0.0' },
      devDependencies: { 'paquete-que-no-esta-en-la-lista': '^1.0.0' },
    });

    expect([...resultado].sort()).toEqual(['knex', 'paquete-que-no-esta-en-la-lista']);
  });

  it('criterio 127: informa los paquetes de varias secciones a la vez', async () => {
    const { dependenciasNoPermitidas } = await cargarLib();

    const resultado = dependenciasNoPermitidas(
      {
        dependencies: { a: '1', ok: '1' },
        devDependencies: { b: '1' },
        optionalDependencies: { c: '1' },
        peerDependencies: { d: '1' },
        bundleDependencies: ['e'],
        bundledDependencies: ['f'],
      },
      ['ok'],
    );

    expect([...resultado].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('criterio 127: un package.json sin dependencias, o con secciones vacias, no informa nada', async () => {
    const { dependenciasNoPermitidas } = await cargarLib();

    expect(dependenciasNoPermitidas({ name: 'x' }, ['ok'])).toEqual([]);
    expect(dependenciasNoPermitidas({ dependencies: {}, bundleDependencies: [] }, ['ok'])).toEqual([]);
  });

  it('criterio 127: bundleDependencies y bundledDependencies solo se leen si son un arreglo (true no es un paquete)', async () => {
    const { dependenciasNoPermitidas } = await cargarLib();

    expect(dependenciasNoPermitidas({ bundleDependencies: true }, ['ok'])).toEqual([]);
    expect(dependenciasNoPermitidas({ bundledDependencies: false }, ['ok'])).toEqual([]);
    expect(dependenciasNoPermitidas({ bundledDependencies: ['ajeno'] }, ['ok'])).toEqual(['ajeno']);
  });
});

describe('criterio 127 (P-30): problemasDeDependencias(raiz) con carpetas temporales', () => {
  it.each(SECCIONES)(
    'criterio 127: un paquete fuera de la lista en %s da un problema que lo nombra',
    async (seccion) => {
      const { problemasDeDependencias } = await cargarLib();
      const raiz = carpetaTemporal();
      escribirPaquete(raiz, paqueteCon(seccion, 'paquete-ajeno-de-prueba'));

      const problemas = problemasDeDependencias(raiz);

      expect(problemas.length).toBeGreaterThan(0);
      expect(problemas.join('\n')).toContain('paquete-ajeno-de-prueba');
    },
  );

  it.each(SECCIONES)('criterio 127: un paquete de la lista en %s no da ningun problema', async (seccion) => {
    const { problemasDeDependencias, DEPENDENCIAS_BACKEND_PERMITIDAS: lista } = await cargarLib();
    const raiz = carpetaTemporal();
    escribirPaquete(raiz, paqueteCon(seccion, lista[0]));

    expect(problemasDeDependencias(raiz)).toEqual([]);
  });

  it('criterio 127: varios paquetes ajenos se nombran todos', async () => {
    const { problemasDeDependencias } = await cargarLib();
    const raiz = carpetaTemporal();
    escribirPaquete(raiz, {
      name: 'x',
      dependencies: { 'ajeno-uno': '^1.0.0', '@ambito/ajeno-dos': '^2.0.0' },
      devDependencies: { 'ajeno-tres': '^3.0.0' },
    });

    const texto = problemasDeDependencias(raiz).join('\n');

    for (const nombre of ['ajeno-uno', '@ambito/ajeno-dos', 'ajeno-tres']) expect(texto, nombre).toContain(nombre);
  });

  it('criterio 127: un cliente de base (postgres) declarado tambien se informa', async () => {
    const { problemasDeDependencias } = await cargarLib();
    const raiz = carpetaTemporal();
    escribirPaquete(raiz, paqueteCon('dependencies', 'postgres'));

    expect(problemasDeDependencias(raiz).join('\n')).toContain('postgres');
  });
});

describe('criterio 128 (P-30): nombreDePaquete(especificador)', () => {
  it.each([
    ['@nestjs/common', '@nestjs/common'],
    ['@nestjs/common/x', '@nestjs/common'],
    ['@nestjs/common/decorators/index.js', '@nestjs/common'],
    ['pg', 'pg'],
    ['pg/lib/x', 'pg'],
    ['zod', 'zod'],
    ['zod/v4', 'zod'],
    ['reflect-metadata', 'reflect-metadata'],
    ['@ambito/nombre/sub/ruta', '@ambito/nombre'],
    ['#interno', '#interno'],
  ])('criterio 128: nombreDePaquete(%j) es %j', async (especificador, esperado) => {
    const { nombreDePaquete } = await cargarLib();

    expect(nombreDePaquete(especificador)).toBe(esperado);
  });

  it.each([
    ['./relativo'],
    ['../relativo/otro'],
    ['.'],
    ['..'],
    ['/ruta/absoluta/x.js'],
    ['C:\\app\\x.js'],
    ['file:///srv/app/x.js'],
    ['node:fs'],
    ['node:crypto'],
    ['node:fs/promises'],
    ['fs'],
    ['path'],
    ['crypto'],
    ['fs/promises'],
  ])('criterio 128: nombreDePaquete(%j) es null (relativo, absoluto, file: o de Node)', async (especificador) => {
    const { nombreDePaquete } = await cargarLib();

    expect(nombreDePaquete(especificador)).toBeNull();
  });
});

describe('criterio 129 (P-30): CLIENTES_DE_BASE_PROHIBIDOS y esClienteDeBaseProhibido', () => {
  it('criterio 129: CLIENTES_DE_BASE_PROHIBIDOS es una lista no vacia de textos o expresiones regulares', async () => {
    const { CLIENTES_DE_BASE_PROHIBIDOS: lista } = await cargarLib();

    expect(Array.isArray(lista)).toBe(true);
    expect(lista.length).toBeGreaterThan(0);
    for (const entrada of lista) expect(typeof entrada === 'string' || entrada instanceof RegExp).toBe(true);
  });

  it.each([
    ['postgres'],
    ['postgres/cjs/src/index.js'],
    ['knex'],
    ['knex/lib/client'],
    ['kysely'],
    ['kysely-postgres-js'],
    ['kysely/helpers/postgres'],
    ['slonik'],
    ['slonik-interceptor-query-logging'],
    ['@slonik/driver'],
    ['@slonik/pg-driver/sub'],
    ['@neondatabase/serverless'],
    ['@neondatabase/serverless/index.js'],
    ['@neondatabase/otro-paquete'],
    ['@vercel/postgres'],
    ['@vercel/postgres-kysely'],
    ['@vercel/postgres/sub'],
    ['mysql'],
    ['mysql2'],
    ['mysql2/promise'],
    ['sequelize'],
    ['sequelize-typescript'],
    ['sequelize/lib/x'],
    ['typeorm'],
    ['typeorm/driver/postgres'],
    ['@typeorm/otro'],
    ['drizzle-orm'],
    ['drizzle-orm/node-postgres'],
    ['drizzle-orm/pg-core'],
    ['drizzle-kit'],
    ['drizzle-zod'],
    ['pg-promise'],
    ['pg-promise/lib/x'],
    ['pg-native'],
    ['@databases/pg'],
    ['@databases/sql'],
    ['@mikro-orm/core'],
    ['@mikro-orm/postgresql'],
    ['@electric-sql/pglite'],
    ['@electric-sql/pglite/worker'],
  ])('criterio 129: esClienteDeBaseProhibido(%j) es true', async (nombre) => {
    const { esClienteDeBaseProhibido } = await cargarLib();

    expect(esClienteDeBaseProhibido(nombre)).toBe(true);
  });

  it.each([
    ['@nestjs/common'],
    ['@nestjs/platform-express'],
    ['zod'],
    ['express'],
    ['pino'],
    ['reflect-metadata'],
    ['jsonwebtoken'],
    ['@node-rs/argon2'],
    ['@prisma/client'],
    ['pg'],
    ['pg-pool'],
    ['pg-protocol'],
    ['postgres-array'],
    ['node:fs'],
    ['./postgres'],
    ['@ambito/nombre'],
  ])('criterio 129: esClienteDeBaseProhibido(%j) es false', async (nombre) => {
    const { esClienteDeBaseProhibido } = await cargarLib();

    expect(esClienteDeBaseProhibido(nombre)).toBe(false);
  });
});

describe('criterio 127 (P-30): scripts/comprobar-fuentes-protegidas.mjs rechaza las dependencias fuera de la lista', () => {
  let repo;
  afterEach(() => {
    repo?.limpiar();
    repo = undefined;
  });

  /** Repositorio temporal con una copia de `scripts/`, un `.gitignore` como el real y un `backend/package.json` con `paquete`. */
  function prepararRepo(paquete) {
    for (const archivo of ['comprobar-fuentes-protegidas.mjs', path.join('lib', 'dependencias-backend.mjs')]) {
      if (!fs.existsSync(path.join(raizScripts, archivo))) {
        throw new Error(`Falta la funcionalidad de la 001 (P-30): no existe scripts/${archivo.replaceAll('\\', '/')}.`);
      }
    }
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
    repo.escribir('backend/package.json', `${JSON.stringify(paquete, null, 2)}\n`);
    repo.commit('base');
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
    return { codigo: resultado.status, texto: `${resultado.stdout}${resultado.stderr}` };
  }

  it.each(SECCIONES)(
    'criterio 127: un paquete fuera de la lista en %s termina con codigo 1 nombrando el paquete y el archivo de la lista',
    (seccion) => {
      const r = prepararRepo(paqueteCon(seccion, 'paquete-ajeno-de-prueba'));

      const { codigo, texto } = ejecutar(r);

      expect(codigo, texto).toBe(1);
      expect(texto).toContain('paquete-ajeno-de-prueba');
      expect(texto).toContain('dependencias-backend.mjs');
    },
  );

  it('criterio 127: un paquete de la lista (zod) y sin nada mas ajeno termina con codigo 0 y sin salida', () => {
    const r = prepararRepo({ name: '@aquagestion/backend', dependencies: { zod: '^4.6.7' } });

    const { codigo, texto } = ejecutar(r);

    expect(texto.trim()).toBe('');
    expect(codigo).toBe(0);
  });

  it('criterio 127: se informan juntos un paquete fuera de la lista y uno de la lista negra', () => {
    const r = prepararRepo({
      name: '@aquagestion/backend',
      dependencies: { zod: '^4.6.7', knex: '^3.0.0' },
      devDependencies: { 'paquete-ajeno-de-prueba': '^1.0.0' },
    });

    const { codigo, texto } = ejecutar(r);

    expect(codigo).toBe(1);
    expect(texto).toContain('knex');
    expect(texto).toContain('paquete-ajeno-de-prueba');
  });
});
