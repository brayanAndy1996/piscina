// spec: 001-academias-aislamiento (pruebas protegidas)
// Ataque ronda 17, parte del hook de sesion (`.claude/hooks/preparar-sesion.mjs`), precisiones P-43 y P-44:
// - Criterio 169: `entornoParaHijos(raiz, entorno = process.env)` pasa a exportarse y lee el `.env` de `raiz` quitando el U+FEFF inicial
//   (con su propia copia de la regla: el hook no importa modulos del repositorio de forma estatica, criterio 47 de 000), sin sobrescribir
//   lo ya definido y sin modificar el objeto recibido.
// - Criterio 171: el hook exporta su propia copia de `esPuntoDeEntrada` (misma firma y mismo resultado que la de `scripts/lib/`), la llama
//   con `esPuntoDeEntrada(import.meta.url)` y es el unico lugar del hook donde aparece `process.argv[1]`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as hook from '../../.claude/hooks/preparar-sesion.mjs';
import { casosDeEsPuntoDeEntrada } from './ayuda-enlaces-ronda17.mjs';

const raizReal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUTA_HOOK = path.join(raizReal, '.claude', 'hooks', 'preparar-sesion.mjs');
const U = '\uFEFF';

function exigirFuncion(nombre) {
  if (typeof hook[nombre] !== 'function') {
    throw new Error(
      `Falta la funcionalidad de la 001: .claude/hooks/preparar-sesion.mjs no exporta ${nombre} (P-43 y P-44, criterios 169 y 171).`,
    );
  }
  return hook[nombre];
}

const EJEMPLO_REAL = fs.readFileSync(path.join(raizReal, '.env.example'), 'utf8');
const VARIABLES_5433 = EJEMPLO_REAL.split(/\r?\n/)
  .filter((linea) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(linea))
  .map((linea) => linea.replaceAll('5432', '5433'));
const E1 = `${U}${VARIABLES_5433.join('\r\n')}\r\n`;

describe('criterio 169 (P-43): entornoParaHijos del hook lee el .env sin el BOM', () => {
  let carpeta;
  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-hook17-'));
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });
  const escribirEnv = (texto) => fs.writeFileSync(path.join(carpeta, '.env'), texto);

  it('(e1) con entorno vacio: DATABASE_URL, DATABASE_URL_PRUEBAS y DATABASE_URL_APP llevan el puerto 5433', () => {
    escribirEnv(E1);

    const resultado = exigirFuncion('entornoParaHijos')(carpeta, {});

    expect(resultado['DATABASE_URL']).toMatch(/:5433\/aquagestion$/);
    expect(resultado['DATABASE_URL_PRUEBAS']).toMatch(/:5433\/aquagestion_pruebas$/);
    expect(resultado['DATABASE_URL_APP']).toMatch(
      /^postgresql:\/\/aquagestion_app:aquagestion_app@127\.0\.0\.1:5433\/aquagestion$/,
    );
  });

  it('un U+FEFF delante de DATABASE_URL_APP (primera variable) tampoco la esconde', () => {
    escribirEnv(`${U}${VARIABLES_5433.filter((l) => l.startsWith('DATABASE_URL_APP='))[0]}\r\nPUERTO_API=3999\r\n`);

    const resultado = exigirFuncion('entornoParaHijos')(carpeta, {});

    expect(resultado['DATABASE_URL_APP']).toMatch(/:5433\/aquagestion$/);
    expect(resultado['PUERTO_API']).toBe('3999');
  });

  it('(e7) un .env sin BOM se lee igual que antes', () => {
    escribirEnv(`${VARIABLES_5433.join('\r\n')}\r\n`);

    const resultado = exigirFuncion('entornoParaHijos')(carpeta, {});

    expect(resultado['DATABASE_URL']).toMatch(/:5433\/aquagestion$/);
    expect(resultado['PUERTO_API']).toBe('3000');
  });

  it('no sobrescribe lo que ya esta definido en el entorno recibido', () => {
    escribirEnv(E1);

    const resultado = exigirFuncion('entornoParaHijos')(carpeta, { DATABASE_URL: 'definida-antes', OTRA: '1' });

    expect(resultado['DATABASE_URL']).toBe('definida-antes');
    expect(resultado['OTRA']).toBe('1');
    expect(resultado['DATABASE_URL_PRUEBAS']).toMatch(/:5433\//);
  });

  it('devuelve una copia: no modifica el objeto que recibe', () => {
    escribirEnv(E1);
    const recibido = { A: '1' };

    const resultado = exigirFuncion('entornoParaHijos')(carpeta, recibido);

    expect(resultado).not.toBe(recibido);
    expect(recibido).toEqual({ A: '1' });
    expect(resultado['A']).toBe('1');
  });

  it('sin .env devuelve una copia del entorno recibido', () => {
    const recibido = { A: '1' };

    const resultado = exigirFuncion('entornoParaHijos')(carpeta, recibido);

    expect(resultado).toEqual({ A: '1' });
    expect(resultado).not.toBe(recibido);
  });
});

casosDeEsPuntoDeEntrada('.claude/hooks/preparar-sesion.mjs', () => exigirFuncion('esPuntoDeEntrada'));

describe('criterio 171 (r6, parte del hook): sin comparaciones a mano y sin imports estaticos del repositorio', () => {
  const texto = () => fs.readFileSync(RUTA_HOOK, 'utf8');

  it('process.argv[1] aparece una sola vez en el hook (en su copia de esPuntoDeEntrada)', () => {
    expect(texto().split('process.argv[1]')).toHaveLength(2);
  });

  it('el hook ejecuta su parte de comando solo con esPuntoDeEntrada(import.meta.url)', () => {
    expect(texto()).toContain('esPuntoDeEntrada(import.meta.url)');
  });

  it('el hook no importa modulos de scripts/ de forma estatica (criterio 47 de 000)', () => {
    const importesEstaticos = texto()
      .split(/\r?\n/)
      .filter((linea) => /^\s*import\b[^(]*\bfrom\s+['"]/.test(linea));
    for (const linea of importesEstaticos) {
      expect(linea, 'import estatico de un modulo del repositorio').not.toMatch(/from\s+['"]\.{1,2}\//);
    }
  });
});
