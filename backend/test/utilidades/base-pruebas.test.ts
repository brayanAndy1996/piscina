import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { leerEntornoBases, validarBasePruebas } from './base-pruebas';

const DESARROLLO = 'postgresql://u:p@127.0.0.1:1/aquagestion';
const PRUEBAS = 'postgresql://u:p@127.0.0.1:1/aquagestion_pruebas';

describe('validarBasePruebas', () => {
  it('devuelve la URL de pruebas cuando la configuración es válida', () => {
    expect(validarBasePruebas({ DATABASE_URL: DESARROLLO, DATABASE_URL_PRUEBAS: PRUEBAS })).toBe(PRUEBAS);
  });

  it.each([undefined, '', '   '])('rechaza DATABASE_URL_PRUEBAS ausente o vacía (%j)', (valor) => {
    expect(() => validarBasePruebas({ DATABASE_URL: DESARROLLO, DATABASE_URL_PRUEBAS: valor })).toThrow(
      /falta DATABASE_URL_PRUEBAS/,
    );
  });

  it('rechaza una base de pruebas igual a la de desarrollo', () => {
    expect(() => validarBasePruebas({ DATABASE_URL: PRUEBAS, DATABASE_URL_PRUEBAS: PRUEBAS })).toThrow(
      /igual a DATABASE_URL/,
    );
  });

  it.each([
    'postgresql://u:p@127.0.0.1:1/aquagestion_desarrollo',
    'postgresql://u:p@127.0.0.1:1/pruebas_aquagestion',
    'postgresql://u:p@127.0.0.1:1/aquagestion_pruebas2',
    'postgresql://u:p@127.0.0.1:1/aquagestion_PRUEBAS',
    'postgresql://u:p@127.0.0.1:1/',
  ])('rechaza una base cuyo nombre no termina en _pruebas (%s)', (url) => {
    expect(() => validarBasePruebas({ DATABASE_URL: DESARROLLO, DATABASE_URL_PRUEBAS: url })).toThrow(/_pruebas/);
  });

  it('rechaza una URL que no se puede interpretar', () => {
    expect(() => validarBasePruebas({ DATABASE_URL: DESARROLLO, DATABASE_URL_PRUEBAS: 'no es url' })).toThrow(
      /no es una URL/,
    );
  });

  it('no incluye contraseñas en los mensajes', () => {
    try {
      validarBasePruebas({
        DATABASE_URL: 'postgresql://u:clave-privada@h/b',
        DATABASE_URL_PRUEBAS: 'postgresql://u:clave-privada@h/b',
      });
    } catch (error) {
      expect((error as Error).message).not.toContain('clave-privada');
    }
  });
});

describe('leerEntornoBases', () => {
  it('toma el .env de la raíz sin sobrescribir las variables ya definidas', () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-env-'));
    try {
      fs.writeFileSync(
        path.join(carpeta, '.env'),
        `DATABASE_URL=${DESARROLLO}\nDATABASE_URL_PRUEBAS=${PRUEBAS}\nOTRA=1\n`,
      );
      const entorno = leerEntornoBases(carpeta, { DATABASE_URL_PRUEBAS: 'postgresql://x:y@h/otra_pruebas' });
      expect(entorno['DATABASE_URL']).toBe(DESARROLLO);
      expect(entorno['DATABASE_URL_PRUEBAS']).toBe('postgresql://x:y@h/otra_pruebas');
      expect(entorno['OTRA']).toBeUndefined();
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  });
});

/**
 * Ejecuta las pruebas de integración como lo haría un desarrollador, con una configuración dada, y devuelve el
 * resultado. Todas las URL apuntan a un puerto sin servidor: si algo intentara conectarse, fallaría de otra forma.
 */
function ejecutarIntegracionCon(variables: Record<string, string>) {
  const raiz = path.resolve(__dirname, '..', '..', '..');
  const requerir = createRequire(path.join(raiz, 'package.json'));
  const vitest = path.join(path.dirname(requerir.resolve('vitest/package.json')), 'vitest.mjs');
  const entorno: Record<string, string | undefined> = {
    ...process.env,
    ...variables,
    VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true',
  };
  for (const clave of Object.keys(entorno)) if (clave.startsWith('VITEST')) delete entorno[clave];
  return spawnSync(process.execPath, [vitest, 'run', '--project', 'backend-integracion'], {
    cwd: raiz,
    env: entorno,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('protección de la base de pruebas al ejecutar las pruebas de integración', () => {
  it.each([
    ['falta DATABASE_URL_PRUEBAS', { DATABASE_URL: DESARROLLO, DATABASE_URL_PRUEBAS: '' }],
    ['DATABASE_URL_PRUEBAS es igual a DATABASE_URL', { DATABASE_URL: DESARROLLO, DATABASE_URL_PRUEBAS: DESARROLLO }],
    [
      'la base no termina en _pruebas',
      { DATABASE_URL: PRUEBAS, DATABASE_URL_PRUEBAS: 'postgresql://u:p@127.0.0.1:1/aquagestion_otra' },
    ],
  ])(
    'no ejecuta ninguna prueba y falla con un mensaje claro cuando %s',
    (_motivo, variables) => {
      const resultado = ejecutarIntegracionCon(variables);
      const salida = `${resultado.stdout}\n${resultado.stderr}`;

      expect(resultado.status).not.toBe(0);
      expect(salida).toContain('Pruebas de integración canceladas');
      // Ninguna prueba llegó a correr.
      expect(salida).not.toMatch(/Tests\s+\d+ (passed|failed)/);
      expect(salida).not.toContain('GET /api/salud');
    },
    90_000,
  );
});
