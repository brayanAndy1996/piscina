// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 171 (ataque ronda 17, O1; complementa los criterios 5, 41 y 43 a 47 de 000 y el 63 y el 148), precision P-44:
// `scripts/lib/punto-de-entrada.mjs` exporta `esPuntoDeEntrada(urlDelModulo, argv1, opciones)` y `rutasIguales(a, b, plataforma)`; los cinco
// scripts (`crear-bases`, `completar-env`, `compilar-contratos-si-falta`, `verificar-pruebas-protegidas`, `verificar-sin-secretos`) deciden si
// son el punto de entrada con `esPuntoDeEntrada(import.meta.url)`, de modo que lanzados por una ruta con un enlace o una union hacen su trabajo.
// Aqui: (p1) a (p5) de la funcion de `scripts/lib/`, `rutasIguales`, (r1) a (r5) como comando por un enlace a la raiz real del repositorio,
// (r6) la prueba estatica y (r7) solo en Windows. Los enlaces se crean en carpetas temporales del sistema y se borran al final.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TIPO_ENLACE_CARPETA,
  borrarEnlaceDeCarpeta,
  carpetaTemporal,
  casosDeEsPuntoDeEntrada,
  crearEnlace,
  esWindows,
  omitirSiHayMotivo,
} from './ayuda-enlaces-ronda17.mjs';

const raizReal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUTA_MODULO = path.join(raizReal, 'scripts', 'lib', 'punto-de-entrada.mjs');

/** El modulo de P-44, con una falla clara si todavia no existe (falta la funcionalidad, no un error de configuracion). */
async function cargarModulo() {
  if (!fs.existsSync(RUTA_MODULO)) {
    throw new Error(
      'Falta la funcionalidad de la 001: no existe scripts/lib/punto-de-entrada.mjs (P-44, criterio 171).',
    );
  }
  return import(/* @vite-ignore */ pathToFileURL(RUTA_MODULO).href);
}

function exigirFuncion(modulo, nombre) {
  if (typeof modulo[nombre] !== 'function') {
    throw new Error(`Falta la funcionalidad de la 001: scripts/lib/punto-de-entrada.mjs no exporta ${nombre} (P-44).`);
  }
  return modulo[nombre];
}

let modulo = null;
let errorDeCarga = null;
beforeAll(async () => {
  try {
    modulo = await cargarModulo();
  } catch (error) {
    errorDeCarga = error;
  }
});

const obtener = (nombre) => () => {
  if (errorDeCarga) throw errorDeCarga;
  return exigirFuncion(modulo, nombre);
};

casosDeEsPuntoDeEntrada('scripts/lib/punto-de-entrada.mjs', obtener('esPuntoDeEntrada'));

describe('criterio 171: rutasIguales(a, b, plataforma)', () => {
  const A = 'C:\\Repo\\scripts\\x.mjs';
  const B = 'c:\\repo\\SCRIPTS\\x.mjs';

  it('(p5) en win32 no distingue mayusculas', () => {
    expect(obtener('rutasIguales')()(A, B, 'win32')).toBe(true);
  });

  it('(p5) en linux compara exacto', () => {
    expect(obtener('rutasIguales')()(A, B, 'linux')).toBe(false);
    expect(obtener('rutasIguales')()(A, A, 'linux')).toBe(true);
  });

  it('en win32 dos rutas distintas siguen siendo distintas', () => {
    expect(obtener('rutasIguales')()(A, 'C:\\Repo\\scripts\\y.mjs', 'win32')).toBe(false);
  });
});

describe('criterio 171: los cinco scripts por una ruta con un enlace a la raiz del repositorio (r1 a r5, r7)', () => {
  let base;
  let enlace;
  let motivoEnlace = null;
  /** Carpeta del proyecto de prueba para (r1): con .env.example y sin .env. */
  let carpetaSinEnv;
  /** Carpeta para (r5): sin packages/contratos/dist. */
  let carpetaSinContratos;

  beforeAll(() => {
    base = carpetaTemporal();
    enlace = path.join(base, 'repo');
    motivoEnlace = crearEnlace(raizReal, enlace, TIPO_ENLACE_CARPETA).motivo;
    carpetaSinEnv = path.join(base, 'sin-env');
    fs.mkdirSync(carpetaSinEnv);
    fs.copyFileSync(path.join(raizReal, '.env.example'), path.join(carpetaSinEnv, '.env.example'));
    carpetaSinContratos = path.join(base, 'sin-contratos');
    fs.mkdirSync(carpetaSinContratos);
  });

  afterAll(() => {
    if (!base) return;
    // Primero se quita el enlace sin seguirlo; solo despues se borra la carpeta temporal (nunca se toca el repositorio real).
    if (motivoEnlace === null && fs.existsSync(enlace)) borrarEnlaceDeCarpeta(enlace);
    fs.rmSync(base, { recursive: true, force: true });
  });

  const ejecutar = (argumentos, opciones = {}) =>
    spawnSync(process.execPath, argumentos, { encoding: 'utf8', timeout: 60_000, ...opciones });

  it('(r1) completar-env.mjs por el enlace crea el .env: codigo 0 y la salida dice que se creo', (contexto) => {
    omitirSiHayMotivo(contexto, motivoEnlace);

    const resultado = ejecutar([path.join(enlace, 'scripts', 'completar-env.mjs'), carpetaSinEnv]);

    expect(resultado.status).toBe(0);
    expect(resultado.stdout).toContain('se creó');
    expect(fs.existsSync(path.join(carpetaSinEnv, '.env'))).toBe(true);
  });

  it('(r2) crear-bases.mjs por el enlace, con las tres URL vacias: codigo 1 y la salida de error nombra DATABASE_URL', (contexto) => {
    omitirSiHayMotivo(contexto, motivoEnlace);

    const resultado = ejecutar([path.join(enlace, 'scripts', 'crear-bases.mjs')], {
      env: { ...process.env, DATABASE_URL: '', DATABASE_URL_PRUEBAS: '', DATABASE_URL_APP: '' },
    });

    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('DATABASE_URL');
  });

  it('(r3) verificar-sin-secretos.mjs por el enlace, con cwd en el enlace: codigo 0 y "Sin archivos de secretos en git."', (contexto) => {
    omitirSiHayMotivo(contexto, motivoEnlace);

    const resultado = ejecutar([path.join(enlace, 'scripts', 'verificar-sin-secretos.mjs')], { cwd: enlace });

    expect(resultado.status).toBe(0);
    expect(resultado.stdout).toContain('Sin archivos de secretos en git.');
  });

  it('(r4) verificar-pruebas-protegidas.mjs por el enlace con una referencia que no existe: codigo 2 y un mensaje que la nombra', (contexto) => {
    omitirSiHayMotivo(contexto, motivoEnlace);
    const referencia = 'referencia-que-no-existe-r17';

    const resultado = ejecutar(
      [path.join(enlace, 'scripts', 'verificar-pruebas-protegidas.mjs'), '--desde', referencia],
      { cwd: enlace },
    );

    expect(resultado.status).toBe(2);
    expect(resultado.stderr).toContain(referencia);
  });

  it('(r5) compilar-contratos-si-falta.mjs por el enlace, en una carpeta sin packages/contratos/dist: intenta compilar', (contexto) => {
    omitirSiHayMotivo(contexto, motivoEnlace);

    const resultado = ejecutar([path.join(enlace, 'scripts', 'compilar-contratos-si-falta.mjs'), carpetaSinContratos]);

    // El codigo de salida no se mira (npm falla en una carpeta sin package.json): solo que el script hizo su trabajo.
    expect(resultado.stdout).toContain('Compilando @aquagestion/contratos');
  });

  it('(r7) solo en Windows: con cwd en la union y la ruta relativa scripts/verificar-sin-secretos.mjs, hace lo mismo que (r3)', (contexto) => {
    if (!esWindows) {
      contexto.skip('en Linux y Mac `process.cwd()` devuelve la ruta real: el caso solo existe en Windows');
    }
    omitirSiHayMotivo(contexto, motivoEnlace);

    const resultado = ejecutar([path.join('scripts', 'verificar-sin-secretos.mjs')], { cwd: enlace });

    expect(resultado.status).toBe(0);
    expect(resultado.stdout).toContain('Sin archivos de secretos en git.');
  });
});

describe('criterio 171 (r6): nadie mas compara process.argv[1] a mano en scripts/', () => {
  const CINCO_SCRIPTS = [
    'crear-bases.mjs',
    'completar-env.mjs',
    'compilar-contratos-si-falta.mjs',
    'verificar-pruebas-protegidas.mjs',
    'verificar-sin-secretos.mjs',
  ];

  /** Archivos de `scripts/` sin `scripts/test/` ni `node_modules`, en rutas relativas con `/`. */
  function archivosDeScripts() {
    const resultado = [];
    const recorrer = (carpeta) => {
      for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
        if (entrada.name === 'node_modules') continue;
        const ruta = path.join(carpeta, entrada.name);
        if (entrada.isDirectory()) {
          if (carpeta === path.join(raizReal, 'scripts') && entrada.name === 'test') continue;
          recorrer(ruta);
        } else if (/\.(mjs|js|cjs|ts|mts)$/.test(entrada.name)) {
          resultado.push(path.relative(raizReal, ruta).split(path.sep).join('/'));
        }
      }
    };
    recorrer(path.join(raizReal, 'scripts'));
    return resultado.sort();
  }

  const leer = (relativa) => fs.readFileSync(path.join(raizReal, relativa), 'utf8');

  it('process.argv[1] aparece solo en scripts/lib/punto-de-entrada.mjs', () => {
    const conArgv = archivosDeScripts().filter((relativa) => leer(relativa).includes('process.argv[1]'));
    expect(conArgv).toEqual(['scripts/lib/punto-de-entrada.mjs']);
  });

  it.each(CINCO_SCRIPTS)(
    '%s importa esPuntoDeEntrada de ./lib/punto-de-entrada.mjs y lo llama con import.meta.url',
    (nombre) => {
      const texto = leer(`scripts/${nombre}`);
      expect(texto).toMatch(
        /import\s*\{[^}]*\besPuntoDeEntrada\b[^}]*\}\s*from\s*['"]\.\/lib\/punto-de-entrada\.mjs['"]/,
      );
      expect(texto).toContain('esPuntoDeEntrada(import.meta.url)');
    },
  );
});
