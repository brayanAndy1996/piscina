// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 172 (ataque ronda 18, F1 y F2), P-45, utilidades de prueba, prueba (s3): `leerEntornoBases` (`base-pruebas.ts`) y
// `leerUrlAppConfigurada` (`base-datos.ts`) leen el `.env` con `dotenv.parse`, el mismo analizador que usa el backend, sin la linea propia
// que quitaba el BOM. Con una variable repetida (archivos concatenados, U+FEFF o U+00A0 delante, `export`, dos puntos) o con un salto de
// linea entre la clave y el `=`, toman lo mismo que `dotenv`: la ultima. Con el codigo de `d8b5cdd` (`parseEnv`) tomaban la primera
// (puerto 5432) o ninguna. Las dos utilidades se corrigen en el mismo commit que esta prueba (T176): no cambia ninguna otra conducta.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { URL_APP_POR_DEFECTO, leerUrlAppConfigurada } from './base-datos';
import { leerEntornoBases } from './base-pruebas';

const U = '\uFEFF';
const RAIZ = path.resolve(__dirname, '..', '..', '..');

const EJEMPLO_REAL = fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8');
/** Las lineas de variables activas de `.env.example`, en su orden, con `5432` cambiado por `5433`. */
const VARIABLES_5433 = EJEMPLO_REAL.split(/\r?\n/)
  .filter((linea) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(linea))
  .map((linea) => linea.replaceAll('5432', '5433'));

const valorDe = (nombre: string): string => {
  const linea = VARIABLES_5433.find((candidata) => candidata.startsWith(`${nombre}=`)) ?? '';
  return linea.slice(nombre.length + 1);
};
const URL_5433 = valorDe('DATABASE_URL');
const URL_APP_5433 = valorDe('DATABASE_URL_APP');
const URL_PRUEBAS_5433 = valorDe('DATABASE_URL_PRUEBAS');

type Caso = readonly [string, string];

/**
 * Conjunto (d) del criterio 172 para la variable `nombre`: la primera linea con 5432, las demas variables de `.env.example`, y una
 * segunda definicion con 5433 de seis formas; con `DATABASE_URL`, ademas (d7), el salto de linea entre la clave y el `=`.
 */
function conjuntoD(nombre: string, conSaltoDeLinea: boolean): Caso[] {
  const nuevo = valorDe(nombre);
  const viejo = nuevo.replaceAll('5433', '5432');
  const resto = VARIABLES_5433.filter((linea) => !linea.startsWith(`${nombre}=`));
  const primera = `${nombre}=${viejo}\n${resto.join('\n')}\n`;
  const casos: Caso[] = [
    ['d1 (archivos concatenados, U+FEFF delante)', `${primera}${U}${nombre}=${nuevo}\n`],
    ['d2 (U+00A0 delante)', `${primera}\u00A0${nombre}=${nuevo}\n`],
    ['d3 (la misma linea dos veces)', `${primera}${nombre}=${nuevo}\n`],
    ['d4 (tabulacion delante)', `${primera}\t${nombre}=${nuevo}\n`],
    ['d5 (la segunda con dos puntos y un espacio)', `${primera}${nombre}: ${nuevo}\n`],
    ['d6 (la segunda con export)', `${primera}export ${nombre}=${nuevo}\n`],
  ];
  if (conSaltoDeLinea) {
    casos.push(
      ['d7 (F2: salto de linea antes del =, \\r\\n)', `${nombre}\r\n=${nuevo}\r\n${resto.join('\r\n')}\r\n`],
      ['d7 (F2: espacio, tabulacion y salto de linea antes del =)', `${nombre} \t\n = ${nuevo}\n${resto.join('\n')}\n`],
    );
  }
  return casos;
}

const D_DATABASE_URL = conjuntoD('DATABASE_URL', true);
const D_DATABASE_URL_APP = conjuntoD('DATABASE_URL_APP', false);

describe('criterio 172 (s3): las utilidades de prueba leen el .env con dotenv.parse', () => {
  let carpeta: string;
  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-lectura18-'));
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });
  const escribirEnv = (texto: string): void => fs.writeFileSync(path.join(carpeta, '.env'), texto);

  it('el conjunto se arma como dice la especificacion: dotenv.parse da la definicion de 5433', () => {
    expect(URL_5433).toMatch(/:5433\/aquagestion$/);
    expect(URL_APP_5433).toMatch(/:5433\/aquagestion$/);
    expect(D_DATABASE_URL).toHaveLength(8);
    expect(D_DATABASE_URL_APP).toHaveLength(6);
    for (const [nombre, texto] of D_DATABASE_URL) {
      expect(dotenv.parse(texto)['DATABASE_URL'], `dotenv.parse de ${nombre}`).toBe(URL_5433);
    }
    for (const [nombre, texto] of D_DATABASE_URL_APP) {
      expect(dotenv.parse(texto)['DATABASE_URL_APP'], `dotenv.parse de ${nombre}`).toBe(URL_APP_5433);
    }
  });

  describe('leerEntornoBases(carpeta, {}) con (d1) a (d7)', () => {
    it.each(D_DATABASE_URL)('%s: DATABASE_URL es la de 5433', (_nombre, texto) => {
      escribirEnv(texto);

      const entorno = leerEntornoBases(carpeta, {});

      expect(entorno['DATABASE_URL']).toBe(URL_5433);
      expect(entorno['DATABASE_URL_PRUEBAS']).toBe(URL_PRUEBAS_5433);
    });

    it.each(D_DATABASE_URL)('%s: lo que manda el entorno sigue mandando', (_nombre, texto) => {
      escribirEnv(texto);

      const entorno = leerEntornoBases(carpeta, { DATABASE_URL: 'del-entorno' });

      expect(entorno['DATABASE_URL']).toBe('del-entorno');
    });
  });

  describe('leerUrlAppConfigurada(carpeta, {}) con (d1) a (d6) para DATABASE_URL_APP', () => {
    it.each(D_DATABASE_URL_APP)(
      '%s: devuelve la definicion de 5433, no la primera ni la por defecto',
      (_nombre, texto) => {
        escribirEnv(texto);

        const url = leerUrlAppConfigurada(carpeta, {});

        expect(url).toBe(URL_APP_5433);
        expect(url).toMatch(/:5433\//);
        expect(url).not.toBe(URL_APP_POR_DEFECTO);
      },
    );

    it.each(D_DATABASE_URL_APP)('%s: la del entorno manda sobre la del .env', (_nombre, texto) => {
      escribirEnv(texto);

      expect(leerUrlAppConfigurada(carpeta, { DATABASE_URL_APP: 'postgresql://a:b@h:1/c' })).toBe(
        'postgresql://a:b@h:1/c',
      );
    });
  });

  it('leen igual que dotenv.parse con un U+FEFF en medio que no es el de dos archivos concatenados', () => {
    const texto = `PUERTO_API=3000\r\n${U}DATABASE_URL=postgresql://x:y@127.0.0.1:5433/aquagestion\r\n`;
    escribirEnv(texto);

    expect(leerEntornoBases(carpeta, {})['DATABASE_URL']).toBe(dotenv.parse(texto)['DATABASE_URL']);
  });
});
