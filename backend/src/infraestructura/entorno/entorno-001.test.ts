// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ErrorEntorno, validarEntorno } from './entorno';

const URL_APP = 'postgresql://aquagestion_app:clave-app-secreta@127.0.0.1:5432/aquagestion';
// Criterio 91: un secreto que producción aceptaría no se escribe en el repositorio; se genera al ejecutar.
const JWT_VALIDO = randomBytes(32).toString('base64url');
const BASE = { DATABASE_URL_APP: URL_APP, JWT_SECRETO: JWT_VALIDO };

/** Entorno validado visto como un registro: el contrato de `Entorno` agrega las variables nuevas con su mismo nombre. */
function validar(env: Record<string, string | undefined>): Record<string, unknown> {
  return validarEntorno(env) as unknown as Record<string, unknown>;
}

function mensaje(env: Record<string, string | undefined>): string {
  try {
    validarEntorno(env);
  } catch (error) {
    if (error instanceof ErrorEntorno) return error.message;
    throw error;
  }
  throw new Error('Se esperaba un ErrorEntorno');
}

function jwtDeEjemplo(): string | undefined {
  const archivo = path.resolve(__dirname, '..', '..', '..', '..', '.env.example');
  return parseEnv(fs.readFileSync(archivo, 'utf8'))['JWT_SECRETO'];
}

// Criterio 5: validación del entorno de la API.
describe('criterio 5: validarEntorno con DATABASE_URL_APP, JWT_SECRETO y DATABASE_POOL_MAX', () => {
  it('criterio 5: acepta un entorno válido sin DATABASE_URL', () => {
    const entorno = validar(BASE);

    expect(entorno['DATABASE_URL_APP']).toBe(URL_APP);
    expect(entorno['JWT_SECRETO']).toBe(JWT_VALIDO);
  });

  it('criterio 5: la API ya no lee DATABASE_URL: no la exige y no la devuelve', () => {
    const sinUrl = validar(BASE);
    const conUrl = validar({ ...BASE, DATABASE_URL: 'postgresql://dueno:otra-clave@127.0.0.1:5432/aquagestion' });

    expect(sinUrl).not.toHaveProperty('DATABASE_URL');
    expect(conUrl).not.toHaveProperty('DATABASE_URL');
  });

  it('criterio 5: DATABASE_URL_APP acepta postgresql:// y postgres://', () => {
    expect(validar({ ...BASE, DATABASE_URL_APP: 'postgres://u:p@localhost/b' })['DATABASE_URL_APP']).toBe(
      'postgres://u:p@localhost/b',
    );
  });

  it.each([
    ['falta', undefined],
    ['está vacía', ''],
    ['solo tiene espacios', '   '],
    ['no es una URL', 'esto-no-es-una-url-clave-secreta'],
    ['no es de PostgreSQL', 'mysql://usuario:clave-secreta@127.0.0.1:3306/base'],
  ])(
    'criterio 5: DATABASE_URL_APP %s: la API no arranca y el mensaje nombra la variable sin su valor',
    (_caso, valor) => {
      const texto = mensaje({ ...BASE, DATABASE_URL_APP: valor });

      expect(texto).toContain('DATABASE_URL_APP');
      if (valor?.trim()) expect(texto).not.toContain('clave-secreta');
    },
  );

  it.each([
    ['falta', undefined],
    ['está vacío', ''],
    ['tiene 31 caracteres', 'a'.repeat(31)],
    ['es corto', 'corto-secreto-privado'],
  ])('criterio 5: JWT_SECRETO %s: la API no arranca y el mensaje nombra la variable sin su valor', (_caso, valor) => {
    const texto = mensaje({ ...BASE, JWT_SECRETO: valor });

    expect(texto).toContain('JWT_SECRETO');
    if (valor) expect(texto).not.toContain(valor);
  });

  it('criterio 5: JWT_SECRETO de exactamente 32 caracteres es válido', () => {
    expect(validar({ ...BASE, JWT_SECRETO: 'a'.repeat(32) })['JWT_SECRETO']).toBe('a'.repeat(32));
  });

  it.each(['0', '101', '-1', '1.5', 'diez', '1e1', '0x10'])(
    'criterio 5: DATABASE_POOL_MAX = %j no es un entero entre 1 y 100: la API no arranca y el mensaje nombra la variable',
    (valor) => {
      const texto = mensaje({ ...BASE, DATABASE_POOL_MAX: valor });

      expect(texto).toContain('DATABASE_POOL_MAX');
    },
  );

  it.each(['1', '10', '100'])('criterio 5: DATABASE_POOL_MAX = %s es válido', (valor) => {
    expect(validar({ ...BASE, DATABASE_POOL_MAX: valor })['DATABASE_POOL_MAX']).toBe(Number(valor));
  });

  it('criterio 5: DATABASE_POOL_MAX es opcional y por defecto vale 10', () => {
    expect(validar(BASE)['DATABASE_POOL_MAX']).toBe(10);
  });

  it('criterio 5: con NODE_ENV=production rechaza el JWT_SECRETO de .env.example, nombrando la variable sin su valor', () => {
    const ejemplo = jwtDeEjemplo();
    expect(ejemplo, '.env.example debe definir JWT_SECRETO (criterio 62)').toBeDefined();
    expect((ejemplo ?? '').length).toBeGreaterThanOrEqual(32);

    const texto = mensaje({ ...BASE, JWT_SECRETO: ejemplo, NODE_ENV: 'production' });

    expect(texto).toContain('JWT_SECRETO');
    expect(texto).not.toContain(ejemplo ?? '');
  });

  it('criterio 5: fuera de producción acepta el JWT_SECRETO de .env.example', () => {
    const ejemplo = jwtDeEjemplo();
    expect(ejemplo, '.env.example debe definir JWT_SECRETO (criterio 62)').toBeDefined();

    expect(validar({ ...BASE, JWT_SECRETO: ejemplo, NODE_ENV: 'development' })['JWT_SECRETO']).toBe(ejemplo);
    expect(validar({ ...BASE, JWT_SECRETO: ejemplo })['JWT_SECRETO']).toBe(ejemplo);
  });

  it('criterio 5: con NODE_ENV=production acepta un JWT_SECRETO distinto del de ejemplo', () => {
    expect(validar({ ...BASE, NODE_ENV: 'production' })['JWT_SECRETO']).toBe(JWT_VALIDO);
  });

  it('criterio 5: reúne todos los problemas en un solo error', () => {
    const texto = mensaje({ DATABASE_URL_APP: undefined, JWT_SECRETO: 'corto', DATABASE_POOL_MAX: '0' });

    expect(texto).toContain('DATABASE_URL_APP');
    expect(texto).toContain('JWT_SECRETO');
    expect(texto).toContain('DATABASE_POOL_MAX');
  });

  it('criterio 5: conserva PUERTO_API y NODE_ENV', () => {
    const entorno = validar({ ...BASE, PUERTO_API: '3100', NODE_ENV: 'production' });

    expect(entorno['PUERTO_API']).toBe(3100);
    expect(entorno['NODE_ENV']).toBe('production');
  });
});
