// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 169 (ataque ronda 17, F1), utilidades de prueba: `leerEntornoBases` (`base-pruebas.ts`) y `leerUrlAppConfigurada`
// (`base-datos.ts`) leen el `.env` como lo lee el backend con `dotenv`, de modo que el U+FEFF inicial no se queda pegado a la primera
// clave. Con el codigo de `6e3d69e` la primera clave quedaba como "\uFEFFDATABASE_URL" y las utilidades usaban la URL por defecto (puerto
// 5432) o ninguna. Las dos utilidades se corrigen en el mismo commit que esta prueba (T170): no cambia ninguna otra conducta.
// Ronda 18 (criterio 172, T176): las utilidades leen con `dotenv.parse` (antes, `parseEnv` tras quitar el BOM a mano); por eso el caso del
// U+FEFF que no esta al principio pasa a esperar lo que lee `dotenv.parse` del mismo texto. Los demas casos no cambian de resultado.
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

/** (e1): U+FEFF, las variables activas con 5433 y `\r\n` (la primera es `DATABASE_URL`). */
const E1 = `${U}${VARIABLES_5433.join('\r\n')}\r\n`;
const LINEA_APP = VARIABLES_5433.find((linea) => linea.startsWith('DATABASE_URL_APP=')) ?? '';
const RESTO = VARIABLES_5433.filter((linea) => !linea.startsWith('DATABASE_URL_APP='));
/** `U` + `DATABASE_URL_APP=...:5433/...` + `\r\n` + lo demas. */
const APP_PRIMERA = `${U}${LINEA_APP}\r\n${RESTO.join('\r\n')}\r\n`;

describe('criterio 169: las utilidades de prueba leen el .env sin el BOM inicial', () => {
  let carpeta: string;
  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-lectura17-'));
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });
  const escribirEnv = (texto: string): void => fs.writeFileSync(path.join(carpeta, '.env'), texto);

  it('el conjunto se arma como dice la especificacion', () => {
    expect(LINEA_APP).toMatch(
      /^DATABASE_URL_APP=postgresql:\/\/aquagestion_app:aquagestion_app@127\.0\.0\.1:5433\/aquagestion$/,
    );
    expect(E1.charCodeAt(0)).toBe(0xfeff);
    expect(E1.slice(1, 13)).toBe('DATABASE_URL');
    expect(APP_PRIMERA.slice(1, 18)).toBe('DATABASE_URL_APP=');
    expect(APP_PRIMERA).toContain('\r\nDATABASE_URL=');
    expect(EJEMPLO_REAL.charCodeAt(0)).not.toBe(0xfeff);
  });

  describe('leerEntornoBases(carpeta, {})', () => {
    it('(e1) devuelve DATABASE_URL y DATABASE_URL_PRUEBAS con 5433', () => {
      escribirEnv(E1);

      const entorno = leerEntornoBases(carpeta, {});

      expect(entorno['DATABASE_URL']).toMatch(/:5433\/aquagestion$/);
      expect(entorno['DATABASE_URL_PRUEBAS']).toMatch(/:5433\/aquagestion_pruebas$/);
    });

    it('con DATABASE_URL_APP primera y el BOM delante, lee las dos URL de las bases', () => {
      escribirEnv(APP_PRIMERA);

      const entorno = leerEntornoBases(carpeta, {});

      expect(entorno['DATABASE_URL']).toMatch(/:5433\/aquagestion$/);
      expect(entorno['DATABASE_URL_PRUEBAS']).toMatch(/:5433\/aquagestion_pruebas$/);
    });

    it('con una variable ya definida en el entorno, manda la del entorno', () => {
      escribirEnv(E1);

      const entorno = leerEntornoBases(carpeta, { DATABASE_URL: 'del-entorno' });

      expect(entorno['DATABASE_URL']).toBe('del-entorno');
      expect(entorno['DATABASE_URL_PRUEBAS']).toMatch(/:5433\/aquagestion_pruebas$/);
    });

    it('(e7) un .env sin BOM se lee igual que antes y solo se devuelven las dos variables de las bases', () => {
      escribirEnv(`${VARIABLES_5433.join('\r\n')}\r\n`);

      const entorno = leerEntornoBases(carpeta, {});

      expect(entorno).toEqual({
        DATABASE_URL: VARIABLES_5433[0]?.slice('DATABASE_URL='.length),
        DATABASE_URL_PRUEBAS: VARIABLES_5433.find((linea) => linea.startsWith('DATABASE_URL_PRUEBAS='))?.slice(
          'DATABASE_URL_PRUEBAS='.length,
        ),
      });
    });

    it('(e8) solo el BOM, y sin .env, no definen nada', () => {
      escribirEnv(U);
      expect(leerEntornoBases(carpeta, {})).toEqual({ DATABASE_URL: undefined, DATABASE_URL_PRUEBAS: undefined });
      fs.rmSync(path.join(carpeta, '.env'));
      expect(leerEntornoBases(carpeta, {})).toEqual({ DATABASE_URL: undefined, DATABASE_URL_PRUEBAS: undefined });
    });

    it('un U+FEFF que no esta al principio no se quita (solo se quita el inicial)', () => {
      // Ronda 18 (criterio 172, T176): `dotenv` si lee esa linea (su `\s` incluye U+FEFF), asi que ahora se espera lo mismo que
      // `dotenv.parse`; esperar `undefined` exigia leer distinto que el backend (la falla F1 de la ronda 18).
      const texto = `PUERTO_API=3000\r\n${U}DATABASE_URL=postgresql://x:y@127.0.0.1:5433/aquagestion\r\n`;
      escribirEnv(texto);

      const entorno = leerEntornoBases(carpeta, {});

      expect(dotenv.parse(texto)['DATABASE_URL']).toBe('postgresql://x:y@127.0.0.1:5433/aquagestion');
      expect(entorno['DATABASE_URL']).toBe(dotenv.parse(texto)['DATABASE_URL']);
      expect(entorno['DATABASE_URL']).toBe('postgresql://x:y@127.0.0.1:5433/aquagestion');
    });
  });

  describe('leerUrlAppConfigurada(carpeta, {})', () => {
    it('(e1) devuelve la DATABASE_URL_APP del .env, con 5433 y no la de .env.example', () => {
      escribirEnv(E1);

      const url = leerUrlAppConfigurada(carpeta, {});

      expect(url).toMatch(/:5433\/aquagestion$/);
      expect(url).not.toBe(URL_APP_POR_DEFECTO);
    });

    it('con DATABASE_URL_APP primera y el BOM delante, devuelve la del .env con 5433 (no la por defecto)', () => {
      escribirEnv(APP_PRIMERA);

      const url = leerUrlAppConfigurada(carpeta, {});

      expect(url).toBe(LINEA_APP.slice('DATABASE_URL_APP='.length));
      expect(url).toMatch(/:5433\/aquagestion$/);
    });

    it('la del entorno manda sobre la del .env', () => {
      escribirEnv(APP_PRIMERA);

      expect(leerUrlAppConfigurada(carpeta, { DATABASE_URL_APP: 'postgresql://a:b@h:1/c' })).toBe(
        'postgresql://a:b@h:1/c',
      );
    });

    it('(e7) un .env sin BOM se lee igual que antes', () => {
      escribirEnv(`${LINEA_APP}\r\n`);

      expect(leerUrlAppConfigurada(carpeta, {})).toBe(LINEA_APP.slice('DATABASE_URL_APP='.length));
    });

    it('(e8) solo el BOM, o sin .env, devuelve la URL por defecto', () => {
      escribirEnv(U);
      expect(leerUrlAppConfigurada(carpeta, {})).toBe(URL_APP_POR_DEFECTO);
      fs.rmSync(path.join(carpeta, '.env'));
      expect(leerUrlAppConfigurada(carpeta, {})).toBe(URL_APP_POR_DEFECTO);
    });
  });
});
