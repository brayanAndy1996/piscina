// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 169 (ataque ronda 17, F1; AMPLIA el criterio 63 y complementa el 148), precision P-43, parte de `scripts/lib/entorno.mjs`:
// `quitarBom(texto)` quita un U+FEFF solo si es el primer caracter; `analizarEnv(texto)` es `parseEnv(quitarBom(texto))`; `cargarEnv` y
// todo lector de un `.env` de `scripts/` usan `analizarEnv`, de modo que un `.env` guardado con BOM (PowerShell 5.1) se lee como lo lee el
// backend con `dotenv`. Reproduccion (e1): `U` + las variables activas de `.env.example` con el puerto 5433 y `\r\n`: con el codigo de
// `6e3d69e`, `cargarEnv` dejaba `DATABASE_URL` sin definir (la clave quedaba como `"\uFEFFDATABASE_URL"`).
// Si para algun texto del conjunto (a) `parseEnv` (sin el BOM) y `dotenv.parse` dieran claves o valores distintos, el test-writer se
// detiene e informa: la prueba de coherencia de abajo lo comprueba y no ajusta el conjunto para esconderlo.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as entorno from '../lib/entorno.mjs';

const raizReal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** El `dotenv` instalado del backend (el workspace `scripts` no lo declara). */
const dotenv = createRequire(path.join(raizReal, 'backend', 'package.json'))('dotenv');
const U = '\uFEFF';

/** Una funcion de P-43 con una falla clara si todavia no existe (falta la funcionalidad, no un error de importacion). */
function funcion(nombre) {
  if (typeof entorno[nombre] !== 'function') {
    throw new Error(
      `Falta la funcionalidad de la 001: scripts/lib/entorno.mjs no exporta ${nombre} (P-43, criterio 169).`,
    );
  }
  return entorno[nombre];
}
const quitarBom = (texto) => funcion('quitarBom')(texto);
const analizarEnv = (texto) => funcion('analizarEnv')(texto);

const EJEMPLO_REAL = fs.readFileSync(path.join(raizReal, '.env.example'), 'utf8');

/** Las lineas de variables activas de `.env.example`, en su orden, con `5432` cambiado por `5433`. */
const VARIABLES_5433 = EJEMPLO_REAL.split(/\r?\n/)
  .filter((linea) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(linea))
  .map((linea) => linea.replaceAll('5432', '5433'));

const entreComillas = (linea, comilla) => linea.replace(/=(.*)$/, `=${comilla}$1${comilla}`);

/** Conjunto (a) del criterio 169: [nombre, texto]. */
const CONJUNTO_A = [
  ['e1 (BOM, \\r\\n, \\r\\n final)', `${U}${VARIABLES_5433.join('\r\n')}\r\n`],
  ['e2 (BOM, comentario inicial, \\n)', `${U}# Configuración\n${VARIABLES_5433.join('\n')}\n`],
  ['e3 (BOM, export DATABASE_URL)', `${U}export ${VARIABLES_5433[0]}\n${VARIABLES_5433.slice(1).join('\n')}\n`],
  [
    'e4 (BOM, DATABASE_URL entre comillas dobles)',
    `${U}${entreComillas(VARIABLES_5433[0], '"')}\n${VARIABLES_5433.slice(1).join('\n')}\n`,
  ],
  [
    'e4 (BOM, DATABASE_URL entre comillas simples)',
    `${U}${entreComillas(VARIABLES_5433[0], "'")}\n${VARIABLES_5433.slice(1).join('\n')}\n`,
  ],
  [
    'e5 (BOM, PUERTO_API con comentario en la linea)',
    `${U}PUERTO_API=3000 # comentario\n${VARIABLES_5433.join('\n')}\n`,
  ],
  ['e6 (BOM, primera linea en blanco)', `${U}\n${VARIABLES_5433.join('\n')}\n`],
  ['e7 (control sin BOM, \\r\\n)', `${VARIABLES_5433.join('\r\n')}\r\n`],
  ['e8 (solo el BOM)', U],
  ['e8 (texto vacio)', ''],
];

const E1 = CONJUNTO_A[0][1];

describe('criterio 169: el conjunto (a) se arma como dice la especificacion', () => {
  it('.env.example real tiene las variables activas esperadas y no empieza con U+FEFF', () => {
    expect(EJEMPLO_REAL.charCodeAt(0)).not.toBe(0xfeff);
    expect(VARIABLES_5433[0]).toMatch(/^DATABASE_URL=.*:5433\/aquagestion$/);
    expect(VARIABLES_5433.some((linea) => linea.startsWith('DATABASE_URL_PRUEBAS='))).toBe(true);
    expect(VARIABLES_5433.some((linea) => linea.startsWith('DATABASE_URL_APP='))).toBe(true);
    expect(VARIABLES_5433.join('\n')).not.toContain('5432');
  });

  it('(e1) empieza con U+FEFF, tiene \\r\\n y termina con \\r\\n', () => {
    expect(E1.charCodeAt(0)).toBe(0xfeff);
    expect(E1.slice(1, 13)).toBe('DATABASE_URL');
    expect(E1).toContain('\r\n');
    expect(E1.endsWith('\r\n')).toBe(true);
    expect(E1.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });
});

describe('criterio 169 (P-43): quitarBom(texto)', () => {
  it('quita un U+FEFF al principio', () => {
    expect(quitarBom(`${U}A=1`)).toBe('A=1');
  });

  it('con dos U+FEFF al principio quita solo uno', () => {
    expect(quitarBom(`${U}${U}A=1`)).toBe(`${U}A=1`);
  });

  it('no quita un U+FEFF que no es el primer caracter', () => {
    expect(quitarBom(`A=1\n${U}B=2`)).toBe(`A=1\n${U}B=2`);
    expect(quitarBom(`A${U}`)).toBe(`A${U}`);
  });

  it('sin U+FEFF devuelve el mismo texto', () => {
    expect(quitarBom('A=1\r\n')).toBe('A=1\r\n');
    expect(quitarBom('')).toBe('');
  });

  it('un texto que solo tiene el BOM queda vacio', () => {
    expect(quitarBom(U)).toBe('');
  });
});

describe('criterio 169 (P-43): analizarEnv(texto) y la coherencia con dotenv', () => {
  it('analizarEnv(U + texto) es lo mismo que analizarEnv(texto): la primera clave no lleva el BOM', () => {
    const valores = analizarEnv(`${U}DATABASE_URL=a\r\nOTRA=b\r\n`);
    expect(Object.keys(valores)).toEqual(['DATABASE_URL', 'OTRA']);
    expect(valores).toEqual(analizarEnv('DATABASE_URL=a\r\nOTRA=b\r\n'));
  });

  it.each(CONJUNTO_A)('%s: las claves y los valores de analizarEnv son los de dotenv.parse', (_nombre, texto) => {
    const propios = analizarEnv(texto);
    const delBackend = dotenv.parse(texto);

    expect(Object.keys(propios).sort()).toEqual(Object.keys(delBackend).sort());
    for (const clave of Object.keys(delBackend)) {
      expect(propios[clave], `valor de ${clave}`).toBe(delBackend[clave]);
    }
  });

  it('(e1) da DATABASE_URL con 5433 y todas las variables activas de .env.example', () => {
    const valores = analizarEnv(E1);
    expect(valores['DATABASE_URL']).toMatch(/:5433\/aquagestion$/);
    expect(Object.keys(valores).sort()).toEqual(
      VARIABLES_5433.map((linea) => linea.slice(0, linea.indexOf('='))).sort(),
    );
  });
});

describe('criterio 169: cargarEnv lee el .env como el backend', () => {
  let carpeta;
  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-bom-'));
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  const escribirEnv = (texto) => fs.writeFileSync(path.join(carpeta, '.env'), texto);

  it('(e1) con env vacio: DATABASE_URL termina en :5433/aquagestion', () => {
    escribirEnv(E1);
    const env = {};

    entorno.cargarEnv(env, carpeta);

    expect(env['DATABASE_URL']).toMatch(/:5433\/aquagestion$/);
  });

  it('(e1) leerUrlsBases(env) y leerUrlApp(env) no lanzan y la app no difiere del desarrollo', () => {
    escribirEnv(E1);
    const env = {};
    entorno.cargarEnv(env, carpeta);

    expect(() => entorno.leerUrlsBases(env)).not.toThrow();
    expect(() => entorno.leerUrlApp(env)).not.toThrow();
    const { desarrollo, pruebas } = entorno.leerUrlsBases(env);
    expect(desarrollo.puerto).toBe(5433);
    expect(pruebas.puerto).toBe(5433);
    expect(entorno.diferenciasConDesarrollo(entorno.leerUrlApp(env), desarrollo)).toEqual([]);
  });

  it.each(CONJUNTO_A.slice(0, 8))('%s: el entorno queda igual a dotenv.parse del mismo texto', (_nombre, texto) => {
    escribirEnv(texto);
    const env = {};

    entorno.cargarEnv(env, carpeta);

    expect(env).toEqual(dotenv.parse(texto));
  });

  it('(e8) solo el BOM y el texto vacio no definen nada', () => {
    for (const texto of [U, '']) {
      escribirEnv(texto);
      const env = {};
      entorno.cargarEnv(env, carpeta);
      expect(env).toEqual({});
    }
  });

  it('sigue sin sobrescribir las variables ya definidas', () => {
    escribirEnv(E1);
    const env = { DATABASE_URL: 'definida-antes' };

    entorno.cargarEnv(env, carpeta);

    expect(env['DATABASE_URL']).toBe('definida-antes');
    expect(env['DATABASE_URL_PRUEBAS']).toMatch(/:5433\/aquagestion_pruebas$/);
  });

  it('sin .env no hace nada', () => {
    const env = {};
    entorno.cargarEnv(env, carpeta);
    expect(env).toEqual({});
  });
});

describe('criterio 169: nadie mas analiza el .env por su cuenta (prueba estatica de parseEnv)', () => {
  const PERMITIDOS = [
    '.claude/hooks/preparar-sesion.mjs',
    'backend/test/utilidades/base-datos.ts',
    'backend/test/utilidades/base-pruebas.ts',
    'scripts/lib/entorno.mjs',
  ];

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

  const buscados = () => [
    ...archivos('scripts', { excluirCarpeta: (relativa) => relativa === 'scripts/test' }),
    ...archivos('.claude/hooks'),
    ...archivos('backend/test/utilidades', { excluirArchivo: (nombre) => /\.test\./.test(nombre) }),
  ];

  it('el texto parseEnv aparece solo en entorno.mjs, el hook y las dos utilidades de prueba', () => {
    const conParseEnv = buscados()
      .filter((relativa) => fs.readFileSync(path.join(raizReal, relativa), 'utf8').includes('parseEnv'))
      .sort();

    expect(conParseEnv).toEqual(PERMITIDOS);
  });

  it('completar-env.mjs lee con analizarEnv', () => {
    const texto = fs.readFileSync(path.join(raizReal, 'scripts', 'completar-env.mjs'), 'utf8');
    expect(texto).toContain('analizarEnv');
  });
});
