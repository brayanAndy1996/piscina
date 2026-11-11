// spec: 001-academias-aislamiento (pruebas protegidas)
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ErrorEntorno, validarEntorno } from './entorno';

// Criterios 78 y 79 (ataque ronda 1, O4): NODE_ENV de una lista cerrada y secreto de firma robusto en produccion.

const URL_APP = 'postgresql://aquagestion_app:clave-app-secreta@127.0.0.1:5432/aquagestion';
// 43 caracteres base64url, sin espacios, con mas de 10 distintos y fuera de la lista de secretos publicos.
const SECRETO_ROBUSTO = 'Qm9r3xT7vLw0YzP2sNf8JdH5cAe1UiKbGtR6oXyVn4M';
const BASE = { DATABASE_URL_APP: URL_APP, JWT_SECRETO: SECRETO_ROBUSTO };
const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');

function leer(ruta: string): string {
  return fs.readFileSync(path.join(RAIZ, ruta), 'utf8');
}

/** El mensaje del ErrorEntorno (todos los problemas) o `undefined` si el entorno es valido. */
function problema(env: Record<string, string | undefined>): string | undefined {
  try {
    validarEntorno(env);
    return undefined;
  } catch (error) {
    if (error instanceof ErrorEntorno) return `${error.message}\n${error.problemas.join('\n')}`;
    throw error;
  }
}

function nodeEnvDe(env: Record<string, string | undefined>): unknown {
  return (validarEntorno(env) as unknown as Record<string, unknown>)['NODE_ENV'];
}

describe('criterio 78: NODE_ENV de una lista cerrada', () => {
  it('criterio 78: sin NODE_ENV el entorno es valido y NODE_ENV queda sin definir (fuera de produccion)', () => {
    expect(problema(BASE)).toBeUndefined();
    expect(nodeEnvDe(BASE)).toBeUndefined();
    expect(nodeEnvDe({ ...BASE, NODE_ENV: undefined })).toBeUndefined();
  });

  it.each(['development', 'test', 'production'])(
    'criterio 78: NODE_ENV=%s es valido y se conserva tal cual',
    (valor) => {
      expect(problema({ ...BASE, NODE_ENV: valor })).toBeUndefined();
      expect(nodeEnvDe({ ...BASE, NODE_ENV: valor })).toBe(valor);
    },
  );

  it.each([
    ['Production', 'Production'],
    ['PRODUCTION', 'PRODUCTION'],
    ['Development', 'Development'],
    ['TEST', 'TEST'],
    ['con un espacio al comienzo', ' production'],
    ['con un espacio al final', 'production '],
    ['con un salto de linea al final', 'production\n'],
    ['prod', 'prod'],
    ['staging', 'staging'],
    ['vacia', ''],
    ['solo espacios', '   '],
  ])(
    'criterio 78: NODE_ENV %s: la API no arranca y el mensaje nombra la variable y los valores permitidos',
    (_caso, valor) => {
      const texto = problema({ ...BASE, NODE_ENV: valor });

      expect(texto, `NODE_ENV=${JSON.stringify(valor)} debio rechazarse`).toBeDefined();
      expect(texto).toContain('NODE_ENV');
      expect(texto).toContain('development');
      expect(texto).toContain('test');
      expect(texto).toContain('production');
    },
  );

  it('criterio 78: lanza ErrorEntorno (no otro error) con un valor fuera de la lista', () => {
    expect(() => validarEntorno({ ...BASE, NODE_ENV: 'Production' })).toThrow(ErrorEntorno);
    expect(() => validarEntorno({ ...BASE, NODE_ENV: '' })).toThrow(ErrorEntorno);
  });

  it.each(['Production', 'PRODUCTION', 'valor-raro-xyz'])(
    'criterio 78: el mensaje no muestra el valor recibido (%s)',
    (valor) => {
      const texto = problema({ ...BASE, NODE_ENV: valor });

      expect(texto).toBeDefined();
      expect(texto).not.toContain(valor);
    },
  );

  it('criterio 78: se reportan junto con los demas problemas del entorno', () => {
    const texto = problema({ DATABASE_URL_APP: undefined, JWT_SECRETO: SECRETO_ROBUSTO, NODE_ENV: 'Production' });

    expect(texto).toContain('DATABASE_URL_APP');
    expect(texto).toContain('NODE_ENV');
  });
});

describe('criterio 79: JWT_SECRETO robusto con NODE_ENV=production', () => {
  const produccion = (secreto: string | undefined) => ({ ...BASE, JWT_SECRETO: secreto, NODE_ENV: 'production' });

  function esperarRechazo(secreto: string, razon: string): void {
    const texto = problema(produccion(secreto));

    expect(texto, razon).toBeDefined();
    expect(texto).toContain('JWT_SECRETO');
    expect(texto).not.toContain(secreto);
  }

  // Los secretos publicos del repositorio, leidos de sus archivos.
  const SECRETO_ENV_EJEMPLO = parseEnv(leer('.env.example'))['JWT_SECRETO'] ?? '';
  const SECRETO_PRUEBAS = /JWT_SECRETO_PRUEBAS\s*=\s*'([^']+)'/.exec(
    leer('backend/test/utilidades/aplicacion.ts'),
  )?.[1];
  const SECRETO_E2E = /JWT_SECRETO_E2E\s*=[^\n]*\?\?\s*'([^']+)'/.exec(leer('e2e/playwright.config.ts'))?.[1];

  describe('secretos publicos del repositorio', () => {
    it.each([
      ['.env.example', SECRETO_ENV_EJEMPLO],
      ['JWT_SECRETO_PRUEBAS de backend/test/utilidades/aplicacion.ts', SECRETO_PRUEBAS],
      ['el de respaldo de e2e/playwright.config.ts', SECRETO_E2E],
    ])('criterio 79: se rechaza el secreto de %s', (_archivo, secreto) => {
      expect(secreto, 'no se pudo leer el secreto del archivo').toBeTruthy();
      esperarRechazo(secreto ?? '', 'secreto publico del repositorio');
    });

    it.each([
      ['.env.example', SECRETO_ENV_EJEMPLO],
      ['JWT_SECRETO_PRUEBAS', SECRETO_PRUEBAS],
      ['el de respaldo de e2e', SECRETO_E2E],
    ])('criterio 79: fuera de produccion se acepta el secreto de %s (rige solo el criterio 5)', (_archivo, secreto) => {
      for (const NODE_ENV of ['development', 'test', undefined]) {
        expect(problema({ ...BASE, JWT_SECRETO: secreto, NODE_ENV })).toBeUndefined();
      }
    });
  });

  describe('espacios en blanco', () => {
    it.each([
      ['un espacio al comienzo', ` ${SECRETO_ROBUSTO}`],
      ['un espacio en el medio', `${SECRETO_ROBUSTO.slice(0, 20)} ${SECRETO_ROBUSTO.slice(20)}`],
      ['un espacio al final', `${SECRETO_ROBUSTO} `],
      ['un tabulador', `${SECRETO_ROBUSTO.slice(0, 20)}\t${SECRETO_ROBUSTO.slice(20)}`],
      ['un salto de linea al final', `${SECRETO_ROBUSTO}\n`],
      ['un espacio de no separacion (U+00A0)', `${SECRETO_ROBUSTO.slice(0, 20)}\u00a0${SECRETO_ROBUSTO.slice(20)}`],
      ['un espacio de ancho em (U+2003)', `${SECRETO_ROBUSTO.slice(0, 20)}\u2003${SECRETO_ROBUSTO.slice(20)}`],
    ])('criterio 79: se rechaza un secreto con %s', (_caso, secreto) => {
      esperarRechazo(secreto, 'contiene espacio en blanco');
    });
  });

  describe('longitud (puntos de codigo)', () => {
    it('criterio 79: 31 caracteres (con mas de 10 distintos) se rechazan y 32 se aceptan', () => {
      const distintos = 'abcdefghijklmnopqrstuvwxyz012345';

      expect(distintos).toHaveLength(32);
      esperarRechazo(distintos.slice(0, 31), '31 caracteres');
      expect(problema(produccion(distintos))).toBeUndefined();
    });

    it('criterio 79: los caracteres se cuentan por punto de codigo: 32 puntos de codigo (64 unidades UTF-16) se aceptan', () => {
      const astrales = Array.from({ length: 32 }, (_, i) => String.fromCodePoint(0x1f600 + i)).join('');

      expect([...astrales]).toHaveLength(32);
      expect(astrales).toHaveLength(64);
      expect(problema(produccion(astrales))).toBeUndefined();
    });

    it('criterio 79: 31 puntos de codigo (62 unidades UTF-16) se rechazan', () => {
      const astrales = Array.from({ length: 31 }, (_, i) => String.fromCodePoint(0x1f600 + i)).join('');

      expect(astrales).toHaveLength(62);
      esperarRechazo(astrales, '31 puntos de codigo');
    });
  });

  describe('caracteres distintos (puntos de codigo)', () => {
    it('criterio 79: 9 caracteres distintos en 40 se rechazan y 10 distintos se aceptan', () => {
      const nueve = 'abcdefghi'.repeat(5).slice(0, 40);
      const diez = 'abcdefghij'.repeat(4);

      expect(new Set(nueve).size).toBe(9);
      expect(new Set(diez).size).toBe(10);
      esperarRechazo(nueve, '9 caracteres distintos');
      expect(problema(produccion(diez))).toBeUndefined();
    });

    it('criterio 79: un secreto de un solo caracter repetido se rechaza', () => {
      esperarRechazo('a'.repeat(64), 'un caracter repetido');
    });

    it('criterio 79: los distintos se cuentan por punto de codigo y no por unidad UTF-16', () => {
      // 9 puntos de codigo distintos (5 de U+1F6xx y 4 de U+2000x), pero 11 unidades UTF-16 distintas.
      const nueve = [
        ...Array.from({ length: 5 }, (_, i) => String.fromCodePoint(0x1f600 + i)),
        ...Array.from({ length: 4 }, (_, i) => String.fromCodePoint(0x20000 + i)),
      ];
      const secreto = Array.from({ length: 40 }, (_, i) => nueve[i % nueve.length]).join('');

      expect(new Set([...secreto]).size).toBe(9);
      expect(new Set(secreto.split('')).size).toBeGreaterThanOrEqual(10);
      esperarRechazo(secreto, '9 puntos de codigo distintos');
    });
  });

  describe('secretos aceptados', () => {
    it('criterio 79: un secreto de 43 caracteres base64url aleatorios se acepta', () => {
      expect(SECRETO_ROBUSTO).toHaveLength(43);
      expect(problema(produccion(SECRETO_ROBUSTO))).toBeUndefined();
    });

    it('criterio 79: un secreto de 32 o mas caracteres, sin espacios, con 10 o mas distintos y fuera de la lista se acepta', () => {
      expect(problema(produccion('un-secreto-largo-sin-espacios-y-variado-2026'))).toBeUndefined();
    });
  });

  describe('fuera de produccion rige solo el criterio 5', () => {
    it.each(['development', 'test', undefined])(
      'criterio 79: con NODE_ENV=%s se acepta un secreto debil de 32 caracteres con un solo caracter distinto',
      (NODE_ENV) => {
        expect(problema({ ...BASE, JWT_SECRETO: 'a'.repeat(32), NODE_ENV })).toBeUndefined();
      },
    );

    it('criterio 79: con NODE_ENV=development se acepta un secreto con espacios en el medio', () => {
      const secreto = 'un secreto con espacios en el medio 2026 abcdef';

      expect(problema({ ...BASE, JWT_SECRETO: secreto, NODE_ENV: 'development' })).toBeUndefined();
    });

    it('criterio 79: el criterio 5 sigue rigiendo: menos de 32 caracteres se rechaza fuera de produccion', () => {
      const texto = problema({ ...BASE, JWT_SECRETO: 'corto-abcdefghijklmn', NODE_ENV: 'test' });

      expect(texto).toContain('JWT_SECRETO');
    });
  });
});
