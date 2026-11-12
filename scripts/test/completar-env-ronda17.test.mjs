// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 170 (ataque ronda 17, F1; AMPLIA el criterio 63; R17-1 y R17-2 aceptadas por el orquestador), precision P-43:
// `completarEnv` y `npm run env:completar` leen con `analizarEnv`, conservan byte a byte lo que ya habia (BOM y `\r\n` incluidos, sin un
// segundo U+FEFF) y se niegan a escribir en un `.env` que parece UTF-16 o tiene un byte 00 (codigo 1). En la ronda 17, ademas, nunca
// agregaban una variable que `dotenv` lee del archivo (`clavesPosiblesEnv` era la regla amplia: en la duda, existe y no se agrega, y el
// resultado llevaba `ilegibles`).
// Ronda 18 (criterios 172 y 173, T176): `analizarEnv` es `dotenv.parse` y una variable cuenta como existente exactamente si esta en
// `analizarEnv(actual)`; `clavesPosiblesEnv` ya no decide que se agrega, solo alimenta el aviso `ilegibles`, que pasa a ser parte de
// `agregadas`. Por eso, en (b4), el texto con un valor entre comillas dobles en varias lineas que contiene `DATABASE_URL=dentro` (que
// `dotenv` no lee) ahora SI agrega `DATABASE_URL`; los otros cuatro textos de (b4), que `dotenv` lee, siguen dejando el archivo igual.
// Con el codigo de `6e3d69e`, con (e1) como `.env` el comando agregaba `DATABASE_URL` (5432) y `dotenv` tomaba la ultima.
// Pruebas (b1) a (b6) del criterio; `dotenv.parse` es el del backend.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completarEnv } from '../completar-env.mjs';
import * as entorno from '../lib/entorno.mjs';

const raizReal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(raizReal, 'scripts', 'completar-env.mjs');
const dotenv = createRequire(path.join(raizReal, 'backend', 'package.json'))('dotenv');
const U = '\uFEFF';

function funcion(nombre) {
  if (typeof entorno[nombre] !== 'function') {
    throw new Error(
      `Falta la funcionalidad de la 001: scripts/lib/entorno.mjs no exporta ${nombre} (P-43, criterio 170).`,
    );
  }
  return entorno[nombre];
}

const EJEMPLO_REAL = fs.readFileSync(path.join(raizReal, '.env.example'), 'utf8');
const VARIABLES_5433 = EJEMPLO_REAL.split(/\r?\n/)
  .filter((linea) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(linea))
  .map((linea) => linea.replaceAll('5432', '5433'));
const nombreDe = (linea) => linea.slice(0, linea.indexOf('='));
const NOMBRES_REALES = VARIABLES_5433.map(nombreDe);
const entreComillas = (linea, comilla) => linea.replace(/=(.*)$/, `=${comilla}$1${comilla}`);

/** Conjunto (a): [nombre, texto]. */
const CONJUNTO_A = [
  ['e1', `${U}${VARIABLES_5433.join('\r\n')}\r\n`],
  ['e2', `${U}# Configuración\n${VARIABLES_5433.join('\n')}\n`],
  ['e3', `${U}export ${VARIABLES_5433[0]}\n${VARIABLES_5433.slice(1).join('\n')}\n`],
  ['e4 comillas dobles', `${U}${entreComillas(VARIABLES_5433[0], '"')}\n${VARIABLES_5433.slice(1).join('\n')}\n`],
  ['e4 comillas simples', `${U}${entreComillas(VARIABLES_5433[0], "'")}\n${VARIABLES_5433.slice(1).join('\n')}\n`],
  // (e5): la linea con el BOM es la unica de PUERTO_API (la lista no la repite), asi que si el BOM no se quita `completarEnv` la agregaria.
  [
    'e5',
    `${U}PUERTO_API=3000 # comentario\n${VARIABLES_5433.filter((linea) => nombreDe(linea) !== 'PUERTO_API').join('\n')}\n`,
  ],
  ['e6', `${U}\n${VARIABLES_5433.join('\n')}\n`],
  ['e7 (control sin BOM, \\r\\n)', `${VARIABLES_5433.join('\r\n')}\r\n`],
  ['e8 (solo el BOM)', U],
  ['e8 (texto vacio)', ''],
];
const E1 = CONJUNTO_A[0][1];

const CLAVE_B = 'claveSecretaR17';
const URL_B = `postgresql://aquagestion:${CLAVE_B}@127.0.0.1:5433/aquagestion`;
const EJEMPLO_B = [
  '# Base de datos.',
  'DATABASE_URL=postgresql://aquagestion:aquagestion@127.0.0.1:5432/aquagestion',
  '',
  '# Puerto de la API.',
  'PUERTO_API=3000',
  '',
  '# Secreto de las sesiones.',
  'JWT_SECRETO=solo-desarrollo',
  '',
].join('\n');

/**
 * Conjunto (b): formas raras del `.env`. Las cuatro primeras las lee `dotenv` (y desde el criterio 172 tambien los scripts); la ultima
 * (valor entre comillas dobles en varias lineas) no define `DATABASE_URL`: esa linea queda dentro del valor de `JWT_SECRETO`.
 * Cada texto ya trae PUERTO_API y JWT_SECRETO.
 */
const CONJUNTO_B = [
  ['dos archivos con BOM concatenados', `PUERTO_API=1\nJWT_SECRETO=x\n${U}DATABASE_URL=${URL_B}\n`],
  ['U+00A0 al principio de la linea', `PUERTO_API=1\nJWT_SECRETO=x\n\u00A0DATABASE_URL=${URL_B}\n`],
  ['dos puntos en lugar de =', `PUERTO_API=1\nJWT_SECRETO=x\nDATABASE_URL: ${URL_B}\n`],
  ['tabulacion al principio de la linea', `PUERTO_API=1\nJWT_SECRETO=x\n\tDATABASE_URL=${URL_B}\n`],
  [
    'valor entre comillas dobles en varias lineas con la linea DATABASE_URL=dentro',
    'JWT_SECRETO="uno\nDATABASE_URL=dentro\nfin"\nPUERTO_API=1\n',
  ],
];

describe('criterio 170: completarEnv y env:completar con un .env con BOM o con formas que dotenv lee', () => {
  let carpeta;
  const ruta = (nombre) => path.join(carpeta, nombre);
  const bytesEnv = () => fs.readFileSync(ruta('.env'));
  const textoEnv = () => bytesEnv().toString('utf8');
  const escribir = (contenido) => fs.writeFileSync(ruta('.env'), contenido);
  const ejecutar = () => spawnSync(process.execPath, [SCRIPT, carpeta], { encoding: 'utf8' });
  const prepararEjemplo = (texto) => fs.writeFileSync(ruta('.env.example'), texto);

  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-env17-'));
    prepararEjemplo(EJEMPLO_REAL);
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  describe('(b1) reproduccion: (e1) como .env', () => {
    it('el comando termina con 0, dice que no hacia falta agregar nada y deja el archivo igual byte a byte', () => {
      escribir(E1);
      const antes = Buffer.from(bytesEnv());

      const resultado = ejecutar();

      expect(resultado.status).toBe(0);
      expect(resultado.stdout).toMatch(/No hizo falta agregar nada/);
      expect(resultado.stdout).not.toContain('Se agregaron');
      expect(bytesEnv().equals(antes)).toBe(true);
    });

    it('dotenv.parse del archivo da DATABASE_URL terminada en :5433/aquagestion', () => {
      escribir(E1);

      ejecutar();

      expect(dotenv.parse(textoEnv())['DATABASE_URL']).toMatch(/:5433\/aquagestion$/);
    });

    it('completarEnv devuelve sin-cambios, sin agregadas y sin la clave ilegibles', () => {
      escribir(E1);

      const resultado = completarEnv(carpeta);

      expect(resultado).toEqual({ accion: 'sin-cambios', agregadas: [] });
    });
  });

  describe('(b2) falta de verdad: (e1) sin la linea de DATABASE_URL', () => {
    const sinDatabaseUrl = () => `${U}${VARIABLES_5433.slice(1).join('\r\n')}\r\n`;

    it('agrega solo DATABASE_URL, conserva los bytes de antes y deja un unico U+FEFF en la posicion 0', () => {
      escribir(sinDatabaseUrl());
      expect(VARIABLES_5433.slice(1)[0]).toMatch(/^DATABASE_URL_PRUEBAS=/);
      const antes = Buffer.from(bytesEnv());

      const resultado = completarEnv(carpeta);

      expect(resultado.accion).toBe('completado');
      expect(resultado.agregadas).toEqual(['DATABASE_URL']);
      const despues = bytesEnv();
      expect(despues.subarray(0, antes.length).equals(antes)).toBe(true);
      const texto = despues.toString('utf8');
      expect(texto.split(U)).toHaveLength(2);
      expect(texto.indexOf(U)).toBe(0);
      expect(texto.slice(antes.toString('utf8').length)).not.toContain('\r');
    });

    it('dotenv.parse da la DATABASE_URL de .env.example y DATABASE_URL_PRUEBAS con 5433', () => {
      escribir(sinDatabaseUrl());

      completarEnv(carpeta);

      const valores = dotenv.parse(textoEnv());
      expect(valores['DATABASE_URL']).toBe(dotenv.parse(EJEMPLO_REAL)['DATABASE_URL']);
      expect(valores['DATABASE_URL_PRUEBAS']).toMatch(/:5433\/aquagestion_pruebas$/);
    });

    it('repetirlo da sin-cambios y no cambia el archivo', () => {
      escribir(sinDatabaseUrl());
      completarEnv(carpeta);
      const primero = Buffer.from(bytesEnv());

      const resultado = completarEnv(carpeta);

      expect(resultado.accion).toBe('sin-cambios');
      expect(bytesEnv().equals(primero)).toBe(true);
    });
  });

  describe('(b3) los textos (e2) a (e6) como .env', () => {
    it.each(CONJUNTO_A.slice(1, 7))(
      '%s: no agrega nada que dotenv.parse(antes) tuviera y no cambia sus valores',
      (_nombre, texto) => {
        escribir(texto);
        const antes = dotenv.parse(texto);

        const resultado = completarEnv(carpeta);

        for (const agregada of resultado.agregadas) {
          expect(Object.keys(antes), `se agrego ${agregada}, que dotenv ya leia`).not.toContain(agregada);
        }
        const despues = dotenv.parse(textoEnv());
        for (const clave of Object.keys(antes)) {
          expect(despues[clave], `valor de ${clave}`).toBe(antes[clave]);
        }
        expect(textoEnv().startsWith(texto)).toBe(true);
      },
    );

    it('e5: PUERTO_API aparece una sola vez, tras el BOM, y completarEnv no la agrega ni cambia su valor 3000', () => {
      const texto = CONJUNTO_A.find(([nombre]) => nombre === 'e5')[1];
      expect(texto.split('PUERTO_API=')).toHaveLength(2);
      expect(texto.indexOf('PUERTO_API=')).toBe(1);
      escribir(texto);
      expect(dotenv.parse(texto)['PUERTO_API']).toBe('3000');

      const resultado = completarEnv(carpeta);

      expect(resultado.agregadas).not.toContain('PUERTO_API');
      expect(dotenv.parse(textoEnv())['PUERTO_API']).toBe('3000');
    });

    it.each(CONJUNTO_A.slice(1, 7))(
      '%s sin la ultima variable: agrega solo esa, al final, y los bytes de antes quedan iguales',
      (_nombre, texto) => {
        const ultima = VARIABLES_5433[VARIABLES_5433.length - 1];
        const sinUltima = texto.replace(`${ultima}\n`, '');
        expect(sinUltima).not.toBe(texto);
        escribir(sinUltima);
        const antes = dotenv.parse(sinUltima);

        const resultado = completarEnv(carpeta);

        expect(resultado.agregadas).toEqual([nombreDe(ultima)]);
        expect(textoEnv().startsWith(sinUltima)).toBe(true);
        for (const clave of Object.keys(antes)) expect(dotenv.parse(textoEnv())[clave]).toBe(antes[clave]);
        expect(dotenv.parse(textoEnv())[nombreDe(ultima)]).toBe(dotenv.parse(EJEMPLO_REAL)[nombreDe(ultima)]);
      },
    );
  });

  describe('(e8) solo el BOM como .env', () => {
    it('agrega todas las variables y el archivo queda igual a U+FEFF seguido de lo que completarEnv escribe en un .env vacio', () => {
      const otra = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-env17-vacio-'));
      try {
        fs.writeFileSync(path.join(otra, '.env.example'), EJEMPLO_REAL);
        fs.writeFileSync(path.join(otra, '.env'), '');
        const enVacio = completarEnv(otra);
        const esperado = fs.readFileSync(path.join(otra, '.env'), 'utf8');
        expect(enVacio.agregadas).toEqual(NOMBRES_REALES);
        escribir(U);

        const resultado = completarEnv(carpeta);

        expect(resultado.accion).toBe('completado');
        expect(resultado.agregadas).toEqual(enVacio.agregadas);
        expect(textoEnv()).toBe(`${U}${esperado}`);
        expect(textoEnv().split(U)).toHaveLength(2);
      } finally {
        fs.rmSync(otra, { recursive: true, force: true });
      }
    });
  });

  describe('(b4) formas que dotenv puede leer y parseEnv quiza no (conjunto (b))', () => {
    beforeEach(() => {
      prepararEjemplo(EJEMPLO_B);
    });

    it.each(CONJUNTO_B)('%s: las claves de dotenv.parse estan en clavesPosiblesEnv', (_nombre, texto) => {
      const posibles = funcion('clavesPosiblesEnv')(texto);
      for (const clave of Object.keys(dotenv.parse(texto))) {
        expect(posibles.has(clave), `clavesPosiblesEnv debe incluir ${clave}`).toBe(true);
      }
    });

    it.each(CONJUNTO_B)('%s: no agrega ninguna clave de dotenv.parse(antes) ni cambia su valor', (_nombre, texto) => {
      escribir(texto);
      const antes = dotenv.parse(texto);

      const resultado = completarEnv(carpeta);

      for (const agregada of resultado.agregadas) {
        expect(Object.keys(antes), `se agrego ${agregada}, que dotenv ya leia`).not.toContain(agregada);
      }
      const despues = dotenv.parse(textoEnv());
      for (const clave of Object.keys(antes)) expect(despues[clave], `valor de ${clave}`).toBe(antes[clave]);
      expect(textoEnv().startsWith(texto)).toBe(true);
    });

    // Ronda 18 (criterio 173, T176): resultado explicito por texto. Desde 172, `analizarEnv` es `dotenv.parse` y la condicion de antes ("la lee
    // dotenv y no analizarEnv") no se cumple nunca. Los cuatro textos que `dotenv` lee: sin `ilegibles` y `agregadas: []`. El del valor entre
    // comillas en varias lineas: `dotenv` no lee `DATABASE_URL`, asi que se agrega y `ilegibles` la nombra.
    const LEIDOS_POR_DOTENV = CONJUNTO_B.slice(0, 4);
    const DENTRO_DE_UN_VALOR = CONJUNTO_B[4];

    it.each(CONJUNTO_B)(
      '%s: si DATABASE_URL la lee dotenv y no analizarEnv, el resultado lleva ilegibles',
      (nombre, texto) => {
        escribir(texto);
        const leeDotenv = Object.keys(dotenv.parse(texto)).includes('DATABASE_URL');
        const esElDelValor = nombre === DENTRO_DE_UN_VALOR[0];
        expect(leeDotenv, 'segun dotenv.parse, DATABASE_URL se lee solo en los cuatro primeros textos').toBe(
          !esElDelValor,
        );

        const resultado = completarEnv(carpeta);

        if (esElDelValor) {
          expect(resultado.agregadas).toEqual(['DATABASE_URL']);
          expect(resultado.ilegibles).toEqual(['DATABASE_URL']);
        } else {
          expect(LEIDOS_POR_DOTENV.map(([etiqueta]) => etiqueta)).toContain(nombre);
          expect(resultado.ilegibles).toBeUndefined();
          expect(resultado.agregadas).toEqual([]);
        }
      },
    );

    // Ronda 18 (criterio 173, T176): nuevo resultado por texto. Los cuatro que `dotenv` lee: lo de antes (codigo 0, archivo igual, sin
    // "Se agregaron" ni la clave). El del valor entre comillas en varias lineas: "Se agregaron" con `DATABASE_URL`, el archivo empieza con los
    // bytes de antes y `dotenv.parse` da la `DATABASE_URL` de `EJEMPLO_B`. El nombre de la prueba se conserva.
    it.each(CONJUNTO_B)(
      '%s como comando: termina con 0, nombra la variable ilegible sin su valor y deja el archivo igual',
      (nombre, texto) => {
        escribir(texto);
        const antes = Buffer.from(bytesEnv());
        const esElDelValor = nombre === DENTRO_DE_UN_VALOR[0];

        const resultado = ejecutar();

        expect(resultado.status).toBe(0);
        const salida = `${resultado.stdout}\n${resultado.stderr}`;
        expect(salida).not.toContain(CLAVE_B);
        if (esElDelValor) {
          expect(resultado.stdout).toContain('Se agregaron');
          expect(salida).toContain('DATABASE_URL');
          expect(salida).not.toContain('127.0.0.1');
          expect(bytesEnv().subarray(0, antes.length).equals(antes)).toBe(true);
          expect(dotenv.parse(textoEnv())['DATABASE_URL']).toBe(dotenv.parse(EJEMPLO_B)['DATABASE_URL']);
        } else {
          expect(bytesEnv().equals(antes)).toBe(true);
          expect(salida).not.toContain('Se agregaron');
        }
      },
    );
  });

  describe('(b5) la inclusion de (b4) para todos los textos de (a)', () => {
    it.each(CONJUNTO_A)('%s: las claves de dotenv.parse estan en clavesPosiblesEnv', (_nombre, texto) => {
      const posibles = funcion('clavesPosiblesEnv')(texto);
      for (const clave of Object.keys(dotenv.parse(texto))) {
        expect(posibles.has(clave), `clavesPosiblesEnv debe incluir ${clave}`).toBe(true);
      }
    });
  });

  describe('clavesPosiblesEnv (P-43): regla amplia, nunca lanza', () => {
    it('incluye las claves con export, espacios, tabulacion, U+00A0, U+FEFF, dos puntos y los separadores \\r, U+2028 y U+2029', () => {
      const posibles = funcion('clavesPosiblesEnv')(
        ['A=1', 'export  B=2', '  C = 3', '\tD=4', '\u00A0E=5', `${U}F=6`, 'G: 7', 'H.I-J=8'].join('\n') +
          '\rK=9\u2028L=10\u2029M=11',
      );
      for (const clave of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H.I-J', 'K', 'L', 'M']) {
        expect(posibles.has(clave), `debe incluir ${clave}`).toBe(true);
      }
    });

    it('no incluye comentarios ni lineas sin = ni :', () => {
      const posibles = funcion('clavesPosiblesEnv')('# COMENTADA=1\nsolo texto\n\n');
      expect([...posibles]).toEqual([]);
    });

    it('incluye una linea que esta dentro de un valor entre comillas de varias lineas', () => {
      expect(funcion('clavesPosiblesEnv')('X="uno\nDATABASE_URL=dentro\nfin"\n').has('DATABASE_URL')).toBe(true);
    });

    it.each([
      ['vacio', ''],
      ['solo el BOM', U],
      ['byte nulo', 'A=1\0B=2'],
      ['solo saltos', '\r\n\r\n'],
    ])('con %s no lanza y devuelve un Set', (_nombre, texto) => {
      const posibles = funcion('clavesPosiblesEnv')(texto);
      expect(posibles).toBeInstanceOf(Set);
    });
  });

  describe('(b6) .env que no es UTF-8 (R17-2)', () => {
    const utf16Le = () =>
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${VARIABLES_5433[0]}\r\n`, 'utf16le')]);
    const utf16Be = () =>
      Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(`${VARIABLES_5433[0]}\r\n`, 'utf16le').swap16()]);
    const conByteCero = () =>
      Buffer.concat([Buffer.from(`${VARIABLES_5433[0]}\r\n`), Buffer.from([0]), Buffer.from('PUERTO_API=3000\r\n')]);

    it.each([
      ['FF FE + UTF-16LE', utf16Le],
      ['FE FF + UTF-16BE', utf16Be],
      ['un byte 00 en medio', conByteCero],
    ])(
      '%s: completarEnv lanza un error que nombra el .env y UTF-8, y el archivo queda byte a byte igual',
      (_nombre, crear) => {
        const contenido = crear();
        fs.writeFileSync(ruta('.env'), contenido);

        let error;
        try {
          completarEnv(carpeta);
        } catch (e) {
          error = e;
        }

        expect(error, 'completarEnv debe lanzar con un .env que no es UTF-8').toBeInstanceOf(Error);
        expect(error.message).toContain('.env');
        expect(error.message).toContain('UTF-8');
        expect(bytesEnv().equals(contenido)).toBe(true);
      },
    );

    it.each([
      ['FF FE + UTF-16LE', utf16Le],
      ['FE FF + UTF-16BE', utf16Be],
      ['un byte 00 en medio', conByteCero],
    ])('%s como comando: termina con 1, el error menciona UTF-8 y el archivo queda igual', (_nombre, crear) => {
      const contenido = crear();
      fs.writeFileSync(ruta('.env'), contenido);

      const resultado = ejecutar();

      expect(resultado.status).toBe(1);
      expect(resultado.stderr).toContain('UTF-8');
      expect(resultado.stdout).not.toContain('Se agregaron');
      expect(bytesEnv().equals(contenido)).toBe(true);
    });

    it('un .env UTF-8 con BOM y sin bytes 00 no se rechaza', () => {
      escribir(E1);
      expect(() => completarEnv(carpeta)).not.toThrow();
    });
  });
});
