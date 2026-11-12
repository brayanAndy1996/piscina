// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 172 (ataque ronda 18, F1 y F2; REEMPLAZA la regla de lectura del criterio 169), P-45, parte de `scripts/lib/entorno.mjs`:
// `analizarEnv(texto)` es `dotenv.parse(texto)` (el mismo analizador que usa el backend), cargado con `createRequire` la primera vez que
// hace falta (el hook importa el modulo antes de `npm ci`: no hay `import ... from 'dotenv'`) y, si `dotenv` no esta instalado, lanza
// un `Error` que nombra `dotenv` y pide `npm ci`. `scripts/package.json` declara `dotenv` con el mismo rango que el backend. Nadie mas
// analiza el `.env` por su cuenta (prueba estatica).
// Pruebas (s1), (s2), (s4), (s5) y (s6) del criterio; (s3) esta en `backend/test/utilidades/lectura-env-ronda18.test.ts`.
// Con el codigo de `d8b5cdd` (`analizarEnv` = `parseEnv(quitarBom(texto))`): (d1) a (d7) daban `URL_5432` (scripts) o nada, y parte de (f)
// daba claves o valores distintos.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as entorno from '../lib/entorno.mjs';
import {
  CANTIDAD_DEL_FUZZ,
  CONJUNTO_A,
  CONJUNTO_D,
  EJEMPLO_REAL,
  U,
  URL_5433,
  compararConDotenv,
  dotenv,
  raizReal,
  textosDelFuzz,
} from './ayuda-env-ronda18.mjs';

/** Una funcion de P-43 con una falla clara si todavia no existe (falta la funcionalidad, no un error de importacion). */
function funcion(nombre) {
  if (typeof entorno[nombre] !== 'function') {
    throw new Error(
      `Falta la funcionalidad de la 001: scripts/lib/entorno.mjs no exporta ${nombre} (P-43 y P-45, criterio 172).`,
    );
  }
  return entorno[nombre];
}
const analizarEnv = (texto) => funcion('analizarEnv')(texto);

/** Las seis opciones de P-45 escritas en la prueba (los scripts no importan codigo de `backend/src`). */
const opcionesDeConfig = (ruta, processEnv) => ({
  path: ruta,
  encoding: 'utf8',
  override: false,
  quiet: true,
  debug: false,
  fast: false,
  processEnv,
});

describe('criterio 172: los conjuntos (d) y (f) se arman como dice la especificacion', () => {
  it('(d1) a (d7): dotenv.parse da DATABASE_URL igual a URL_5433 (si no, se detiene e informa)', () => {
    expect(URL_5433).toMatch(/:5433\/aquagestion$/);
    expect(CONJUNTO_D).toHaveLength(8);
    for (const [nombre, texto] of CONJUNTO_D) {
      expect(dotenv.parse(texto)['DATABASE_URL'], `dotenv.parse de ${nombre}`).toBe(URL_5433);
    }
  });

  it('(d1) a (d7) definen todas las variables de .env.example', () => {
    const esperadas = Object.keys(dotenv.parse(EJEMPLO_REAL)).sort();
    for (const [nombre, texto] of CONJUNTO_D) {
      expect(Object.keys(dotenv.parse(texto)).sort(), nombre).toEqual(esperadas);
    }
  });

  it('(f) son 20 000 textos de 1 a 9 piezas, siempre los mismos (semilla fija)', () => {
    const primera = textosDelFuzz();
    const segunda = textosDelFuzz();
    expect(primera).toHaveLength(CANTIDAD_DEL_FUZZ);
    expect(segunda).toEqual(primera);
    expect(primera.every((texto) => texto.length >= 1)).toBe(true);
    expect(new Set(primera).size).toBeGreaterThan(5000);
  });
});

describe('criterio 172 (s1): analizarEnv es dotenv.parse', () => {
  it.each([...CONJUNTO_A, ...CONJUNTO_D])('%s: analizarEnv(texto) es igual a dotenv.parse(texto)', (_nombre, texto) => {
    expect(analizarEnv(texto)).toEqual(dotenv.parse(texto));
  });

  it('(f) analizarEnv da lo mismo que dotenv.parse en los 20 000 textos del fuzz con semilla fija', () => {
    const textos = textosDelFuzz();
    funcion('analizarEnv');

    const { diferentes, ejemplos } = compararConDotenv(textos, analizarEnv);

    expect(
      diferentes,
      `${diferentes} de ${textos.length} textos del fuzz dan claves o valores distintos que dotenv.parse; por ejemplo: ${ejemplos.join(' ; ')}`,
    ).toBe(0);
  });

  describe('cargarEnv(env, carpeta) deja el entorno igual a dotenv.parse y a dotenv.config', () => {
    let carpeta;
    beforeEach(() => {
      carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-dotenv18-'));
    });
    afterEach(() => {
      fs.rmSync(carpeta, { recursive: true, force: true });
    });

    it.each([...CONJUNTO_A, ...CONJUNTO_D])(
      '%s: env igual a dotenv.parse(texto) y a lo que carga dotenv.config con las seis opciones',
      (_nombre, texto) => {
        const ruta = path.join(carpeta, '.env');
        fs.writeFileSync(ruta, texto);
        const env = {};

        entorno.cargarEnv(env, carpeta);

        const cargadoPorConfig = {};
        dotenv.config(opcionesDeConfig(ruta, cargadoPorConfig));
        expect(env).toEqual(dotenv.parse(texto));
        expect(env).toEqual(cargadoPorConfig);
      },
    );

    it('sigue sin sobrescribir lo ya definido y sin .env no hace nada', () => {
      fs.writeFileSync(path.join(carpeta, '.env'), CONJUNTO_D[0][1]);
      const env = { DATABASE_URL: 'definida-antes' };

      entorno.cargarEnv(env, carpeta);

      expect(env['DATABASE_URL']).toBe('definida-antes');
      expect(env['DATABASE_URL_PRUEBAS']).toMatch(/:5433\/aquagestion_pruebas$/);
      const otra = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-dotenv18-sin-'));
      try {
        const vacio = {};
        entorno.cargarEnv(vacio, otra);
        expect(vacio).toEqual({});
      } finally {
        fs.rmSync(otra, { recursive: true, force: true });
      }
    });
  });
});

describe('criterio 172 (s2): reproduccion F1 y F2', () => {
  let carpeta;
  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-dotenv18-f-'));
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  it.each(CONJUNTO_D)(
    '%s: cargarEnv da DATABASE_URL con 5433, leerUrlsBases da el puerto 5433 y la app no difiere del desarrollo',
    (_nombre, texto) => {
      fs.writeFileSync(path.join(carpeta, '.env'), texto);
      const env = {};

      entorno.cargarEnv(env, carpeta);

      expect(env['DATABASE_URL']).toBe(URL_5433);
      const { desarrollo } = entorno.leerUrlsBases(env);
      expect(desarrollo.puerto).toBe(5433);
      expect(entorno.diferenciasConDesarrollo(entorno.leerUrlApp(env), desarrollo)).toEqual([]);
    },
  );
});

describe('criterio 172 (s4): la misma version de dotenv que el backend, sin depender del hoisting', () => {
  const leerJson = (...partes) => JSON.parse(fs.readFileSync(path.join(raizReal, ...partes), 'utf8'));

  it('scripts/package.json declara dotenv en dependencies con el mismo rango que backend/package.json', () => {
    const delBackend = leerJson('backend', 'package.json').dependencies?.['dotenv'];
    const deScripts = leerJson('scripts', 'package.json').dependencies?.['dotenv'];

    expect(typeof delBackend).toBe('string');
    expect(deScripts, 'scripts/package.json debe declarar dotenv en dependencies').toBe(delBackend);
  });

  it('la version que se resuelve desde scripts/package.json es la misma que desde backend/package.json', () => {
    const version = (carpeta) =>
      createRequire(path.join(raizReal, carpeta, 'package.json'))('dotenv/package.json').version;

    expect(version('scripts')).toBe(version('backend'));
  });
});

describe('criterio 172 (s5): sin dotenv no se lee el .env (carga perezosa)', () => {
  const RUTA_ENTORNO = path.join(raizReal, 'scripts', 'lib', 'entorno.mjs');

  it('el texto de scripts/lib/entorno.mjs no importa dotenv de forma estatica', () => {
    const lineas = fs.readFileSync(RUTA_ENTORNO, 'utf8').split(/\r?\n/);

    for (const linea of lineas) {
      expect(linea, 'import estatico de dotenv').not.toMatch(/\bimport\b[^(]*\bfrom\s+['"]dotenv(?:\/[^'"]*)?['"]/);
      expect(linea, 'import estatico de dotenv').not.toMatch(/^\s*import\s+['"]dotenv(?:\/[^'"]*)?['"]/);
    }
  });

  describe('una copia del archivo donde dotenv no se encuentra', () => {
    let base;
    beforeEach(() => {
      base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-dotenv18-perezosa-')));
    });
    afterEach(() => {
      fs.rmSync(base, { recursive: true, force: true });
    });

    it('se importa sin error, quitarBom funciona y analizarEnv lanza un Error que nombra dotenv y pide npm', async (contexto) => {
      const copia = path.join(base, 'scripts', 'lib', 'entorno.mjs');
      fs.mkdirSync(path.dirname(copia), { recursive: true });
      fs.copyFileSync(RUTA_ENTORNO, copia);
      let resolucion = null;
      try {
        resolucion = createRequire(copia).resolve('dotenv');
      } catch {
        // lo esperado: desde la copia no se encuentra dotenv
      }
      if (resolucion) {
        contexto.skip(`desde ${copia} se resuelve un dotenv (${resolucion}): la prueba no puede simular su ausencia`);
        return;
      }

      const modulo = await import(/* @vite-ignore */ pathToFileURL(copia).href);

      expect(modulo.quitarBom(`${U}A=1`)).toBe('A=1');
      let error;
      try {
        modulo.analizarEnv('A=1');
      } catch (e) {
        error = e;
      }
      expect(error, 'analizarEnv debe lanzar si dotenv no esta instalado').toBeInstanceOf(Error);
      expect(error.message).toContain('dotenv');
      expect(error.message).toContain('npm');
    });
  });
});

describe('criterio 172 (s6): nadie mas analiza el .env por su cuenta (prueba estatica)', () => {
  /** Archivos de codigo bajo `carpeta` (relativa a la raiz), sin los excluidos; rutas relativas con `/`. */
  function archivos(carpeta, { excluirCarpeta = () => false, excluirArchivo = () => false } = {}) {
    const resultado = [];
    const recorrer = (actual) => {
      for (const entrada of fs.readdirSync(actual, { withFileTypes: true })) {
        if (entrada.name === 'node_modules') continue;
        const ruta = path.join(actual, entrada.name);
        const relativa = path.relative(raizReal, ruta).split(path.sep).join('/');
        if (entrada.isDirectory()) {
          if (!excluirCarpeta(relativa)) recorrer(ruta);
        } else if (/\.(mjs|js|cjs|ts|mts)$/.test(entrada.name) && !excluirArchivo(entrada.name)) {
          resultado.push(relativa);
        }
      }
    };
    recorrer(path.join(raizReal, carpeta));
    return resultado;
  }

  const sinPruebasDeScripts = () => archivos('scripts', { excluirCarpeta: (relativa) => relativa === 'scripts/test' });
  const leer = (relativa) => fs.readFileSync(path.join(raizReal, relativa), 'utf8');

  it('parseEnv no aparece en scripts/ (sin scripts/test/), .claude/hooks/ ni backend/test/utilidades/ (sin *.test.*)', () => {
    const buscados = [
      ...sinPruebasDeScripts(),
      ...archivos('.claude/hooks'),
      ...archivos('backend/test/utilidades', { excluirArchivo: (nombre) => /\.test\./.test(nombre) }),
    ];

    const conParseEnv = buscados.filter((relativa) => leer(relativa).includes('parseEnv')).sort();

    expect(conParseEnv).toEqual([]);
  });

  // Se busca el dotenv cargado como modulo (`from 'dotenv'`, `import 'dotenv'`, `require('dotenv')`, `import('dotenv')`,
  // `createRequire(...)('dotenv')`), no el literal suelto: `scripts/lib/dependencias-backend.mjs` lista los nombres de paquetes que
  // el backend puede declarar (entre ellos 'dotenv') y no carga nada.
  const CARGA_DE_DOTENV = /(?:\bfrom\s+|\bimport\s+|[\w)\]]\s*\(\s*)(['"])dotenv(?:\/[^'"]*)?\1/;

  it("en scripts/ (sin scripts/test/) el modulo 'dotenv' se carga solo en scripts/lib/entorno.mjs", () => {
    const conCarga = sinPruebasDeScripts()
      .filter((relativa) =>
        leer(relativa)
          .split(/\r?\n/)
          .some((linea) => CARGA_DE_DOTENV.test(linea)),
      )
      .sort();

    expect(conCarga).toEqual(['scripts/lib/entorno.mjs']);
  });

  it('un lector de la carga: la expresion de la prueba reconoce las formas de cargar dotenv y no la lista de nombres', () => {
    expect(CARGA_DE_DOTENV.test("import dotenv from 'dotenv';")).toBe(true);
    expect(CARGA_DE_DOTENV.test('import "dotenv";')).toBe(true);
    expect(CARGA_DE_DOTENV.test("const d = require('dotenv');")).toBe(true);
    expect(CARGA_DE_DOTENV.test("const d = createRequire(import.meta.url)('dotenv');")).toBe(true);
    expect(CARGA_DE_DOTENV.test("const m = await import('dotenv');")).toBe(true);
    expect(CARGA_DE_DOTENV.test("  'dotenv',")).toBe(false);
  });

  it('completar-env.mjs y crear-bases.mjs leen el .env con analizarEnv o cargarEnv de entorno.mjs', () => {
    expect(leer('scripts/completar-env.mjs')).toContain('analizarEnv');
    expect(leer('scripts/crear-bases.mjs')).toMatch(/cargarEnv|analizarEnv/);
  });
});
