import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ErrorEntorno, JWT_SECRETO_DE_EJEMPLO, validarEntorno } from './entorno';

// Las variables nuevas de la historia 001 (DATABASE_URL_APP, JWT_SECRETO, DATABASE_POOL_MAX) se prueban en
// entorno-001.test.ts (prueba protegida). Aquí quedan PUERTO_API, NODE_ENV y lo que no cubre aquella.
const URL_APP = 'postgresql://aquagestion_app:clave-secreta@127.0.0.1:5432/aquagestion';
// Criterio 91: un secreto que producción aceptaría no se escribe en el repositorio; se genera al ejecutar.
const JWT = randomBytes(32).toString('base64url');
const BASE = { DATABASE_URL_APP: URL_APP, JWT_SECRETO: JWT };

function mensajes(env: Record<string, string | undefined>): readonly string[] {
  try {
    validarEntorno(env);
  } catch (error) {
    if (error instanceof ErrorEntorno) return error.problemas;
    throw error;
  }
  throw new Error('Se esperaba un ErrorEntorno');
}

describe('validarEntorno', () => {
  it('acepta un entorno válido y usa el puerto 3000 y 10 conexiones por defecto', () => {
    expect(validarEntorno(BASE)).toEqual({
      DATABASE_URL_APP: URL_APP,
      DATABASE_POOL_MAX: 10,
      JWT_SECRETO: JWT,
      PUERTO_API: 3000,
      NODE_ENV: undefined,
    });
  });

  it('lee PUERTO_API, NODE_ENV y DATABASE_POOL_MAX', () => {
    const entorno = validarEntorno({ ...BASE, PUERTO_API: '3100', NODE_ENV: 'production', DATABASE_POOL_MAX: ' 25 ' });
    expect(entorno.PUERTO_API).toBe(3100);
    expect(entorno.NODE_ENV).toBe('production');
    expect(entorno.DATABASE_POOL_MAX).toBe(25);
  });

  it.each(['1', '65535'])('acepta el puerto límite %s', (puerto) => {
    expect(validarEntorno({ ...BASE, PUERTO_API: puerto }).PUERTO_API).toBe(Number(puerto));
  });

  it.each(['0', '65536', '-1', '3000.5', 'abc', '3000abc', '1e3', '0x10'])(
    'rechaza PUERTO_API inválido (%s) y lo nombra',
    (valor) => {
      const problemas = mensajes({ ...BASE, PUERTO_API: valor });
      expect(problemas).toHaveLength(1);
      expect(problemas[0]).toContain('PUERTO_API');
    },
  );

  it('informa todos los problemas a la vez', () => {
    expect(mensajes({ PUERTO_API: 'abc' })).toHaveLength(3);
  });

  it('DATABASE_URL_APP que no es de PostgreSQL menciona PostgreSQL', () => {
    const problemas = mensajes({ ...BASE, DATABASE_URL_APP: 'mysql://u:p@localhost/b' });
    expect(problemas[0]).toContain('DATABASE_URL_APP');
    expect(problemas[0]).toContain('PostgreSQL');
  });

  it('nunca imprime el valor de ninguna variable', () => {
    const env = {
      DATABASE_URL_APP: 'mysql://usuario:clave-secreta@host-privado/base',
      JWT_SECRETO: 'corto-privado',
      DATABASE_POOL_MAX: 'pool-raro',
      PUERTO_API: 'puerto-raro',
    };
    try {
      validarEntorno(env);
      throw new Error('Se esperaba un error');
    } catch (error) {
      const texto = (error as Error).message;
      for (const valor of Object.values(env)) expect(texto).not.toContain(valor);
      expect(texto).not.toContain('clave-secreta');
      expect(texto).not.toContain('host-privado');
    }
  });
});

describe('JWT_SECRETO_DE_EJEMPLO', () => {
  it('coincide con el JWT_SECRETO de .env.example y tiene al menos 32 caracteres', () => {
    const archivo = path.resolve(__dirname, '..', '..', '..', '..', '.env.example');
    const ejemplo = parseEnv(fs.readFileSync(archivo, 'utf8'))['JWT_SECRETO'];
    expect(JWT_SECRETO_DE_EJEMPLO).toBe(ejemplo);
    expect(JWT_SECRETO_DE_EJEMPLO.length).toBeGreaterThanOrEqual(32);
  });
});
