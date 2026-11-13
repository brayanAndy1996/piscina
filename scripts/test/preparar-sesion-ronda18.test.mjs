// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 174 (ataque ronda 18, F1; REEMPLAZA la copia de la regla del criterio 169 en el hook; R18-1 y R18-2 aceptadas por el
// orquestador), P-45, parte del hook de sesion (`.claude/hooks/preparar-sesion.mjs`): el hook lee el `.env` con `dotenv` cuando esta
// instalado (`cargarAnalizadorEnv`) y, antes de `npm ci`, con un lector minimo (`analizarEnvMinimo`) que da exactamente lo que daria
// `dotenv.parse` o se niega (lanza, sin valores en el mensaje). `entornoParaHijos` gana un tercer parametro (el analizador) y lanza si
// el analizador lanza; `entornoParaInstalar` usa una copia del entorno si `entornoParaHijos` lanza (el paso de `npm ci` no depende de
// leer el `.env`). El hook no importa `dotenv` de forma estatica (criterio 47 de 000).
// Pruebas (h1) a (h9) del criterio. Con el codigo de `d8b5cdd`, (h1) a (h3) y (h5) a (h9) fallan porque las funciones no existen y (h4) da
// `URL_5432` o nada. `casos de la parte de enlaces y BOM` siguen en `preparar-sesion-ronda17.test.mjs`.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as hook from '../../.claude/hooks/preparar-sesion.mjs';
import { TIPO_ENLACE_CARPETA, borrarEnlaceDeCarpeta, carpetaTemporal, crearEnlace } from './ayuda-enlaces-ronda17.mjs';
import {
  CONJUNTO_A,
  CONJUNTO_D,
  D1,
  EJEMPLO_REAL,
  URL_5433,
  U,
  comparable,
  dotenv,
  raizReal,
  textosDelFuzz,
} from './ayuda-env-ronda18.mjs';

const RUTA_HOOK = path.join(raizReal, '.claude', 'hooks', 'preparar-sesion.mjs');

function exigirFuncion(nombre) {
  if (typeof hook[nombre] !== 'function') {
    throw new Error(
      `Falta la funcionalidad de la 001: .claude/hooks/preparar-sesion.mjs no exporta ${nombre} (P-45, criterio 174).`,
    );
  }
  return hook[nombre];
}
const analizarEnvMinimo = (texto) => exigirFuncion('analizarEnvMinimo')(texto);
const cargarAnalizadorEnv = (...argumentos) => exigirFuncion('cargarAnalizadorEnv')(...argumentos);
const entornoParaHijos = (...argumentos) => exigirFuncion('entornoParaHijos')(...argumentos);
const entornoParaInstalar = (...argumentos) => exigirFuncion('entornoParaInstalar')(...argumentos);

const conjuntoA = (nombre) => CONJUNTO_A.find(([etiqueta]) => etiqueta.startsWith(nombre));
const conjuntoAtodos = (nombre) => CONJUNTO_A.filter(([etiqueta]) => etiqueta.startsWith(nombre));

/** Lo que agrega el hook a un `.env` recien creado cuando existe el navegador de la nube. */
const CON_CHROMIUM = `${EJEMPLO_REAL}\n# Navegador preinstalado en la nube para las pruebas E2E (lo agrega el hook de sesión).\nCHROMIUM_EJECUTABLE=/opt/pw-browsers/chromium\n`;

describe('criterio 174 (h1): cargarAnalizadorEnv() en el repositorio usa dotenv', () => {
  it('da origen dotenv', () => {
    expect(cargarAnalizadorEnv().origen).toBe('dotenv');
  });

  it.each(CONJUNTO_D)('%s: su analizar da lo mismo que dotenv.parse del backend (URL_5433)', (_nombre, texto) => {
    const analizador = cargarAnalizadorEnv();

    const valores = analizador.analizar(texto);

    expect(valores).toEqual(dotenv.parse(texto));
    expect(valores['DATABASE_URL']).toBe(URL_5433);
  });

  it('no lanza con una raiz que no existe y usa el lector minimo', () => {
    const inexistente = path.join(os.tmpdir(), 'aqua-no-existe-r18', 'tampoco');

    const analizador = cargarAnalizadorEnv(inexistente);

    expect(analizador.origen).toBe('minimo');
    expect(analizador.analizar('A=1\n')).toEqual({ A: '1' });
  });
});

describe('criterio 174 (h2) y (h3): sin dotenv instalado usa el lector minimo; despues de instalar, dotenv', () => {
  let carpeta;
  let enlace;
  let motivoSinDotenv = null;
  let motivoEnlace = null;

  beforeAll(() => {
    carpeta = carpetaTemporal('aqua-hook18-');
    fs.mkdirSync(path.join(carpeta, 'scripts'));
    fs.writeFileSync(path.join(carpeta, 'scripts', 'package.json'), '{"name":"x","private":true}');
    try {
      const resolucion = createRequire(path.join(carpeta, 'scripts', 'package.json')).resolve('dotenv');
      motivoSinDotenv = `desde ${carpeta} se resuelve un dotenv (${resolucion}): la prueba no puede simular su ausencia`;
    } catch {
      // lo esperado: no se encuentra dotenv
    }
  });
  afterAll(() => {
    if (enlace) {
      try {
        borrarEnlaceDeCarpeta(enlace);
      } catch {
        // si ya no esta, no importa
      }
    }
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  it('(h2) sin node_modules: origen minimo, y su analizar lee una forma simple', (contexto) => {
    if (motivoSinDotenv) contexto.skip(motivoSinDotenv);

    const analizador = cargarAnalizadorEnv(carpeta);

    expect(analizador.origen).toBe('minimo');
    expect(analizador.analizar('A=1\nB=dos palabras\n')).toEqual({ A: '1', B: 'dos palabras' });
  });

  it('(h3) despues de crear node_modules/dotenv en el mismo proceso: origen dotenv (no recuerda el fallo)', (contexto) => {
    if (motivoSinDotenv) contexto.skip(motivoSinDotenv);
    const antes = cargarAnalizadorEnv(carpeta);
    expect(antes.origen, 'antes de instalar debe usar el lector minimo').toBe('minimo');
    const carpetaDotenv = path.dirname(
      createRequire(path.join(raizReal, 'backend', 'package.json')).resolve('dotenv/package.json'),
    );
    fs.mkdirSync(path.join(carpeta, 'node_modules'), { recursive: true });
    enlace = path.join(carpeta, 'node_modules', 'dotenv');
    motivoEnlace = crearEnlace(carpetaDotenv, enlace, TIPO_ENLACE_CARPETA).motivo;
    if (motivoEnlace) {
      enlace = undefined;
      contexto.skip(motivoEnlace);
    }

    const despues = cargarAnalizadorEnv(carpeta);

    expect(despues.origen).toBe('dotenv');
    expect(despues.analizar(D1)).toEqual(dotenv.parse(D1));
  });
});

describe('criterio 174 (h4): entornoParaHijos lee como el backend', () => {
  let carpeta;
  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-hook18-env-'));
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  it.each(CONJUNTO_D)('%s: DATABASE_URL es URL_5433', (_nombre, texto) => {
    fs.writeFileSync(path.join(carpeta, '.env'), texto);

    const resultado = entornoParaHijos(carpeta, {});

    expect(resultado['DATABASE_URL']).toBe(URL_5433);
  });
});

describe('criterio 174 (h5): analizarEnvMinimo acepta la forma simple y da lo mismo que dotenv.parse', () => {
  const ACEPTADOS = [
    ['.env.example real', EJEMPLO_REAL],
    conjuntoA('e1'),
    conjuntoA('e2'),
    conjuntoA('e3'),
    conjuntoA('e6'),
    conjuntoA('e7'),
    ...conjuntoAtodos('e8'),
    ['.env.example seguido de lo que agrega el hook (CHROMIUM_EJECUTABLE)', CON_CHROMIUM],
  ];

  it('el conjunto se arma como dice la especificacion', () => {
    expect(ACEPTADOS.every((caso) => Array.isArray(caso))).toBe(true);
    expect(ACEPTADOS).toHaveLength(9);
    expect(CON_CHROMIUM).toContain('CHROMIUM_EJECUTABLE=/opt/pw-browsers/chromium\n');
  });

  it.each(ACEPTADOS)('%s: no lanza y es igual a dotenv.parse', (_nombre, texto) => {
    expect(analizarEnvMinimo(texto)).toEqual(dotenv.parse(texto));
  });
});

describe('criterio 174 (h6): analizarEnvMinimo se niega con lo que solo lee dotenv', () => {
  const NEGADOS = [...CONJUNTO_D, ...conjuntoAtodos('e4'), conjuntoA('e5')];

  it('el conjunto se arma como dice la especificacion', () => {
    expect(NEGADOS).toHaveLength(8 + 2 + 1);
  });

  it.each(NEGADOS)('%s: lanza un Error que pide npm ci y no muestra valores', (_nombre, texto) => {
    exigirFuncion('analizarEnvMinimo');
    let error;
    try {
      analizarEnvMinimo(texto);
    } catch (e) {
      error = e;
    }

    expect(error, 'analizarEnvMinimo debe negarse').toBeInstanceOf(Error);
    expect(error.message).toContain('npm ci');
    expect(error.message).not.toContain('5433');
    expect(error.message).not.toContain('5432');
    expect(error.message).not.toContain('aquagestion@');
  });
});

describe('criterio 174 (h7): propiedad, o lanza o da lo mismo que dotenv.parse', () => {
  /** Recorre los textos: cuantos acepta `analizarEnvMinimo` y cuales de esos dan algo distinto de `dotenv.parse`. */
  function recorrer(textos) {
    exigirFuncion('analizarEnvMinimo');
    const distintos = [];
    let aceptados = 0;
    for (const texto of textos) {
      let valores;
      try {
        valores = analizarEnvMinimo(texto);
      } catch (error) {
        if (!(error instanceof Error)) distintos.push(`${JSON.stringify(texto)}: se nego con algo que no es un Error`);
        continue;
      }
      aceptados += 1;
      if (comparable(valores) !== comparable(dotenv.parse(texto))) {
        distintos.push(
          `${JSON.stringify(texto)} -> ${comparable(valores)} (dotenv: ${comparable(dotenv.parse(texto))})`,
        );
      }
    }
    return { aceptados, distintos };
  }

  it('en los conjuntos (a) y (d)', () => {
    const textos = [...CONJUNTO_A, ...CONJUNTO_D].map(([, texto]) => texto);

    const { aceptados, distintos } = recorrer(textos);

    console.info(`(h7) analizarEnvMinimo acepto ${aceptados} de ${textos.length} textos de (a) y (d)`);
    expect(distintos.slice(0, 5), 'textos aceptados que dan algo distinto de dotenv.parse').toEqual([]);
  });

  it('en los 20 000 textos del fuzz (f): nunca devuelve algo distinto de dotenv.parse y acepta al menos uno', () => {
    const textos = textosDelFuzz();

    const { aceptados, distintos } = recorrer(textos);

    console.info(`(h7) analizarEnvMinimo acepto ${aceptados} de ${textos.length} textos de (f)`);
    expect(distintos.slice(0, 5), 'textos aceptados que dan algo distinto de dotenv.parse').toEqual([]);
    expect(aceptados, 'debe aceptar al menos uno de los textos de (f)').toBeGreaterThanOrEqual(1);
  });
});

describe('criterio 174 (h8): entornoParaHijos y entornoParaInstalar con el lector minimo', () => {
  let carpeta;
  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-hook18-min-'));
    fs.writeFileSync(path.join(carpeta, '.env'), D1);
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  const minimo = () => ({ origen: 'minimo', analizar: analizarEnvMinimo });

  it('entornoParaHijos con (d1) lanza el error de (h6)', () => {
    let error;
    try {
      entornoParaHijos(carpeta, {}, minimo());
    } catch (e) {
      error = e;
    }

    expect(error, 'entornoParaHijos debe lanzar si el analizador lanza').toBeInstanceOf(Error);
    expect(error.message).toContain('npm ci');
    expect(error.message).not.toContain('5433');
    expect(error.message).not.toContain('5432');
    expect(error.message).not.toContain('aquagestion@');
  });

  it('entornoParaInstalar con los mismos argumentos no lanza y devuelve una copia del entorno', () => {
    const recibido = { A: '1' };

    const resultado = entornoParaInstalar(carpeta, recibido, minimo());

    expect(resultado).toEqual({ A: '1' });
    expect(resultado).not.toBe(recibido);
    expect(recibido).toEqual({ A: '1' });
  });

  it('entornoParaInstalar con dotenv completa el entorno con el .env, como entornoParaHijos', () => {
    const resultado = entornoParaInstalar(carpeta, { A: '1' }, cargarAnalizadorEnv());

    expect(resultado['A']).toBe('1');
    expect(resultado['DATABASE_URL']).toBe(URL_5433);
  });

  it('entornoParaHijos con un analizador que lee bien no sobrescribe lo ya definido', () => {
    fs.writeFileSync(path.join(carpeta, '.env'), `${U}A=1\nB=2\n`);

    const resultado = entornoParaHijos(carpeta, { B: 'definida-antes' }, minimo());

    expect(resultado).toEqual({ A: '1', B: 'definida-antes' });
  });
});

describe('criterio 174 (h9): prueba estatica del hook', () => {
  const texto = () => fs.readFileSync(RUTA_HOOK, 'utf8');

  it('no tiene import ... from dotenv ni import dotenv', () => {
    for (const linea of texto().split(/\r?\n/)) {
      expect(linea, 'import estatico de dotenv').not.toMatch(/\bimport\b[^(]*\bfrom\s+['"]dotenv(?:\/[^'"]*)?['"]/);
      expect(linea, 'import estatico de dotenv').not.toMatch(/^\s*import\s+['"]dotenv(?:\/[^'"]*)?['"]/);
    }
  });

  it('la sentencia que ejecuta npm ci usa entornoParaInstalar y no entornoParaHijos', () => {
    const fuente = texto();
    const inicio = fuente.indexOf("['ci']");
    expect(inicio, "el hook debe ejecutar npm con ['ci']").toBeGreaterThan(-1);
    const sentencia = fuente.slice(inicio, fuente.indexOf(';', inicio));

    expect(sentencia).toContain('entornoParaInstalar(');
    expect(sentencia).not.toContain('entornoParaHijos(');
  });
});
