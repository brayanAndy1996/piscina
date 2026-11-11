import { describe, expect, it } from 'vitest';
import { ErrorEntorno, validarEntorno } from './entorno';

const URL_VALIDA = 'postgresql://usuario:clave-secreta@127.0.0.1:5432/aquagestion';

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
  it('acepta un entorno válido y usa el puerto 3000 por defecto', () => {
    expect(validarEntorno({ DATABASE_URL: URL_VALIDA })).toEqual({
      DATABASE_URL: URL_VALIDA,
      PUERTO_API: 3000,
      NODE_ENV: undefined,
    });
  });

  it('acepta las URL postgres:// y postgresql://', () => {
    expect(validarEntorno({ DATABASE_URL: 'postgres://u:p@localhost/b' }).DATABASE_URL).toBe(
      'postgres://u:p@localhost/b',
    );
  });

  it('lee PUERTO_API y NODE_ENV', () => {
    const entorno = validarEntorno({ DATABASE_URL: URL_VALIDA, PUERTO_API: '3100', NODE_ENV: 'production' });
    expect(entorno.PUERTO_API).toBe(3100);
    expect(entorno.NODE_ENV).toBe('production');
  });

  it.each(['1', '65535'])('acepta el puerto límite %s', (puerto) => {
    expect(validarEntorno({ DATABASE_URL: URL_VALIDA, PUERTO_API: puerto }).PUERTO_API).toBe(Number(puerto));
  });

  it.each([undefined, '', '   '])('rechaza DATABASE_URL ausente o vacía (%j) y la nombra', (valor) => {
    const problemas = mensajes({ DATABASE_URL: valor });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain('DATABASE_URL');
  });

  it.each(['mysql://u:p@localhost/b', 'http://localhost', 'no es una url', '127.0.0.1:5432/base'])(
    'rechaza DATABASE_URL que no es de PostgreSQL (%s)',
    (valor) => {
      const problemas = mensajes({ DATABASE_URL: valor });
      expect(problemas[0]).toContain('DATABASE_URL');
      expect(problemas[0]).toContain('PostgreSQL');
    },
  );

  it.each(['0', '65536', '-1', '3000.5', 'abc', '3000abc', '1e3', '0x10'])(
    'rechaza PUERTO_API inválido (%s) y lo nombra',
    (valor) => {
      const problemas = mensajes({ DATABASE_URL: URL_VALIDA, PUERTO_API: valor });
      expect(problemas).toHaveLength(1);
      expect(problemas[0]).toContain('PUERTO_API');
    },
  );

  it('informa todos los problemas a la vez', () => {
    const problemas = mensajes({ PUERTO_API: 'abc' });
    expect(problemas).toHaveLength(2);
  });

  it('nunca imprime el valor de ninguna variable', () => {
    for (const env of [
      { DATABASE_URL: 'mysql://usuario:clave-secreta@host-privado/base', PUERTO_API: 'puerto-raro' },
      { DATABASE_URL: 'clave-secreta-suelta' },
    ]) {
      try {
        validarEntorno(env);
        throw new Error('Se esperaba un error');
      } catch (error) {
        const texto = (error as Error).message;
        for (const valor of Object.values(env)) expect(texto).not.toContain(valor);
        expect(texto).not.toContain('clave-secreta');
        expect(texto).not.toContain('host-privado');
      }
    }
  });
});
