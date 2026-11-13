// spec: 001-academias-aislamiento (pruebas protegidas)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 175 (ataque ronda 18, O1; complementa el criterio 117 y el 5 de 000), P-45: `dotenv` 18 arma las opciones de `config` con
// `{ ...opcionesDelEntorno(process.env), ...opciones }` (las de `DOTENV_ENCODING`, `DOTENV_PATH`, `DOTENV_QUIET`, `DOTENV_DEBUG`,
// `DOTENV_OVERRIDE` y `DOTENV_FAST`, o sus formas `DOTENV_CONFIG_*`): lo escrito en la llamada manda. Por eso
// `backend/src/infraestructura/entorno/opciones-dotenv.ts` exporta `opcionesDotenv(ruta)`, que devuelve exactamente las seis opciones
// escritas (no importa `dotenv`), y los tres cargadores del backend y `e2e/playwright.config.ts` las pasan todas.
// Pruebas (o1), (o2) y (o3) del criterio. Con el codigo de `d8b5cdd`, (o1) y (o2) fallan porque `opciones-dotenv.ts` no existe y (o3) no
// encuentra las opciones.

interface OpcionesDotenvModulo {
  readonly opcionesDotenv: (ruta: string) => {
    path: string;
    encoding: string;
    override: boolean;
    quiet: boolean;
    debug: boolean;
    fast: boolean;
  };
}

const cargar = (): Promise<OpcionesDotenvModulo> =>
  cargarFuncionalidad<OpcionesDotenvModulo>('infraestructura/entorno/opciones-dotenv.ts', ['opcionesDotenv']);

const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');

describe('criterio 175 (o1): opcionesDotenv(ruta) devuelve las seis opciones escritas', () => {
  it('opcionesDotenv("/x/.env") es igual al objeto de P-45', async () => {
    const { opcionesDotenv } = await cargar();

    expect(opcionesDotenv('/x/.env')).toEqual({
      path: '/x/.env',
      encoding: 'utf8',
      override: false,
      quiet: true,
      debug: false,
      fast: false,
    });
  });

  it('lleva la ruta que recibe, sea cual sea, y devuelve un objeto nuevo en cada llamada', async () => {
    const { opcionesDotenv } = await cargar();

    const a = opcionesDotenv('C:\\Repo\\.env');
    const b = opcionesDotenv('C:\\Repo\\.env');

    expect(a.path).toBe('C:\\Repo\\.env');
    expect(Object.keys(a).sort()).toEqual(['debug', 'encoding', 'fast', 'override', 'path', 'quiet']);
    expect(a).not.toBe(b);
  });
});

describe('criterio 175 (o2): las variables DOTENV_* no cambian como se carga el .env', () => {
  const NOMBRES = [
    'DOTENV_OVERRIDE',
    'DOTENV_CONFIG_OVERRIDE',
    'DOTENV_PATH',
    'DOTENV_ENCODING',
    'DOTENV_QUIET',
    'DOTENV_DEBUG',
    'DOTENV_FAST',
  ] as const;
  let carpeta: string;
  let guardadas: Record<string, string | undefined>;

  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-opciones18-'));
    guardadas = {};
    for (const nombre of NOMBRES) guardadas[nombre] = process.env[nombre];
  });
  afterEach(() => {
    for (const nombre of NOMBRES) {
      const valor = guardadas[nombre];
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
    vi.restoreAllMocks();
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  function prepararAtaque(): { ruta: string } {
    const ruta = path.join(carpeta, '.env');
    const otro = path.join(carpeta, 'otro.env');
    fs.writeFileSync(ruta, 'DATABASE_URL=del-archivo\nSUPERADMIN_NOMBRE=Ñandú\n', 'utf8');
    fs.writeFileSync(otro, 'OTRA=del-otro\n', 'utf8');
    process.env['DOTENV_OVERRIDE'] = 'true';
    process.env['DOTENV_CONFIG_OVERRIDE'] = 'true';
    process.env['DOTENV_PATH'] = otro;
    process.env['DOTENV_ENCODING'] = 'latin1';
    process.env['DOTENV_QUIET'] = 'false';
    process.env['DOTENV_DEBUG'] = 'true';
    process.env['DOTENV_FAST'] = 'true';
    return { ruta };
  }

  it('comprobacion previa: sin las demas opciones el ataque se reproduce (el .env pisa lo que fijo la CI)', () => {
    const { ruta } = prepararAtaque();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const processEnv: Record<string, string> = { DATABASE_URL: 'de-la-ci' };

    dotenv.config({ path: ruta, processEnv });

    expect(
      processEnv['DATABASE_URL'],
      'la comprobacion previa no reproduce el ataque: DOTENV_OVERRIDE no pisa DATABASE_URL (el test-writer se detiene e informa)',
    ).toBe('del-archivo');
  });

  it('con opcionesDotenv: DATABASE_URL queda en de-la-ci, SUPERADMIN_NOMBRE en Ñandú, OTRA sin definir y no se imprime nada', async () => {
    const { opcionesDotenv } = await cargar();
    const { ruta } = prepararAtaque();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const processEnv: Record<string, string> = { DATABASE_URL: 'de-la-ci' };

    dotenv.config({ ...opcionesDotenv(ruta), processEnv });

    expect(processEnv['DATABASE_URL']).toBe('de-la-ci');
    expect(processEnv['SUPERADMIN_NOMBRE']).toBe('Ñandú');
    expect(processEnv['OTRA']).toBeUndefined();
    expect(Object.keys(processEnv).sort()).toEqual(['DATABASE_URL', 'SUPERADMIN_NOMBRE']);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('criterio 175 (o3): prueba estatica, nadie mas carga el .env con dotenv.config', () => {
  const CODIGO = /\.(ts|mts|cts|js|mjs|cjs)$/;
  const esPrueba = (nombre: string): boolean => /\.test\./.test(nombre);
  const relativa = (ruta: string): string => path.relative(RAIZ, ruta).split(path.sep).join('/');
  const leer = (rel: string): string => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

  /** Archivos de codigo bajo `carpeta`; con `recursivo` falso, solo los de la propia carpeta. */
  function archivos(carpeta: string, { recursivo, sinPruebas }: { recursivo: boolean; sinPruebas: boolean }): string[] {
    const resultado: string[] = [];
    const recorrer = (actual: string): void => {
      for (const entrada of fs.readdirSync(actual, { withFileTypes: true })) {
        if (entrada.name === 'node_modules') continue;
        const ruta = path.join(actual, entrada.name);
        if (entrada.isDirectory()) {
          if (recursivo) recorrer(ruta);
        } else if (CODIGO.test(entrada.name) && !(sinPruebas && esPrueba(entrada.name))) {
          resultado.push(relativa(ruta));
        }
      }
    };
    recorrer(path.join(RAIZ, carpeta));
    return resultado;
  }

  const ALCANCE = (): string[] => [
    ...archivos('backend/src', { recursivo: true, sinPruebas: true }),
    'backend/prisma.config.ts',
    ...archivos('backend/prisma', { recursivo: true, sinPruebas: true }),
    ...archivos('e2e', { recursivo: false, sinPruebas: false }),
  ];

  const IMPORTA_DOTENV = /(?:\bfrom\s+|\bimport\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])dotenv(?:\/[^'"]*)?\1/;

  const LOS_CUATRO = [
    'backend/prisma.config.ts',
    'backend/src/cli/conexion.ts',
    'backend/src/infraestructura/entorno/cargar-env.ts',
    'e2e/playwright.config.ts',
  ];

  const SEIS_OPCIONES = [
    ['path', /\bpath\b/],
    ['encoding: utf8', /\bencoding\s*:\s*['"]utf8['"]/],
    ['override: false', /\boverride\s*:\s*false\b/],
    ['quiet: true', /\bquiet\s*:\s*true\b/],
    ['debug: false', /\bdebug\s*:\s*false\b/],
    ['fast: false', /\bfast\s*:\s*false\b/],
  ] as const;

  it('los unicos archivos que importan dotenv son cargar-env.ts, cli/conexion.ts, prisma.config.ts y e2e/playwright.config.ts', () => {
    const importan = ALCANCE()
      .filter((rel) =>
        leer(rel)
          .split(/\r?\n/)
          .some((linea) => IMPORTA_DOTENV.test(linea)),
      )
      .sort();

    expect(importan).toEqual(LOS_CUATRO);
  });

  it('la expresion de la prueba reconoce las formas de importar dotenv', () => {
    expect(IMPORTA_DOTENV.test("import dotenv from 'dotenv';")).toBe(true);
    expect(IMPORTA_DOTENV.test("import { config as cargarEnv } from 'dotenv';")).toBe(true);
    expect(IMPORTA_DOTENV.test("import 'dotenv/config';")).toBe(true);
    expect(IMPORTA_DOTENV.test("const d = require('dotenv');")).toBe(true);
    expect(IMPORTA_DOTENV.test("const d = await import('dotenv');")).toBe(true);
    expect(IMPORTA_DOTENV.test("import { x } from './dotenvoltura';")).toBe(false);
  });

  it.each([
    'backend/src/infraestructura/entorno/cargar-env.ts',
    'backend/src/cli/conexion.ts',
    'backend/prisma.config.ts',
  ])('%s llama a dotenv.config con opcionesDotenv( o con las seis opciones escritas', (rel) => {
    const texto = leer(rel);
    const conLaAyuda = texto.includes('opcionesDotenv(');
    const faltantes = SEIS_OPCIONES.filter(([, patron]) => !patron.test(texto)).map(([nombre]) => nombre);

    expect(
      conLaAyuda || faltantes.length === 0,
      `${rel} debe usar opcionesDotenv( o escribir las seis opciones (faltan: ${faltantes.join(', ')})`,
    ).toBe(true);
  });

  it('e2e/playwright.config.ts escribe las seis opciones', () => {
    const texto = leer('e2e/playwright.config.ts');
    const faltantes = SEIS_OPCIONES.filter(([, patron]) => !patron.test(texto)).map(([nombre]) => nombre);

    expect(faltantes, 'opciones de dotenv.config que faltan en e2e/playwright.config.ts').toEqual([]);
  });

  it('opciones-dotenv.ts no importa dotenv (ni un tipo)', () => {
    const rel = 'backend/src/infraestructura/entorno/opciones-dotenv.ts';
    expect(fs.existsSync(path.join(RAIZ, rel)), `falta ${rel}`).toBe(true);

    expect(leer(rel)).not.toMatch(/['"]dotenv(?:\/[^'"]*)?['"]/);
  });
});
