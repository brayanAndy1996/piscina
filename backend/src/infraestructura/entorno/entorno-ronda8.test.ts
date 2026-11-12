// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ErrorEntorno, validarEntorno } from './entorno';

// Criterio 143 (ataque ronda 8, O1; AMPLIA el criterio 5), parte unitaria de `validarEntorno`: el cliente `pg` (con `pg-connection-string`,
// el que usa la API por `@prisma/adapter-pg`) toma `user`, `host`, `hostaddr`, `password`, `port`, `dbname` y `database` de la cadena de
// consulta por encima de la parte principal de la URL. Por eso una `DATABASE_URL_APP` con cualquiera de esos nombres en la cadena de
// consulta (decodificado como lo hace `URLSearchParams` y sin distinguir mayusculas, con cualquier valor, tambien vacio, en cualquier
// posicion y aunque se repita) es invalida: `validarEntorno` lanza `ErrorEntorno` y la API no arranca. El mensaje nombra la variable y el
// parametro, y nunca la URL, el valor del parametro ni la contrasena. `options` y `sslmode` siguen permitidos, y una URL sin cadena de
// consulta no cambia. Las funciones que deciden estan en `url-postgres.test.ts` (P-34).

const CLAVE_DE_LA_URL = `clave-${randomBytes(6).toString('hex')}`;
const URL_APP = `postgresql://aquagestion_app:${CLAVE_DE_LA_URL}@127.0.0.1:5432/aquagestion`;
const VALOR_RECONOCIBLE = `valor-reconocible-${randomBytes(6).toString('hex')}`;
const SECRETO = randomBytes(32).toString('base64url');
const entornoCon = (urlApp: string): Record<string, string> => ({ DATABASE_URL_APP: urlApp, JWT_SECRETO: SECRETO });

const NOMBRES = ['user', 'host', 'hostaddr', 'password', 'port', 'dbname', 'database'] as const;

/** El `ErrorEntorno` de `validarEntorno(env)` o `undefined` si el entorno es valido. */
function errorDe(env: Record<string, string | undefined>): ErrorEntorno | undefined {
  try {
    validarEntorno(env);
    return undefined;
  } catch (error) {
    if (error instanceof ErrorEntorno) return error;
    throw error;
  }
}

/** Todo el texto del error: el mensaje y cada problema. */
const textoDe = (error: ErrorEntorno): string => `${error.message}\n${error.problemas.join('\n')}`;

function esperarRechazo(urlApp: string, parametro: string, valor = VALOR_RECONOCIBLE): void {
  const error = errorDe(entornoCon(urlApp));

  expect(error, `validarEntorno debia lanzar ErrorEntorno para ${parametro}`).toBeInstanceOf(ErrorEntorno);
  const texto = textoDe(error as ErrorEntorno);
  expect(texto, 'el mensaje debe nombrar la variable').toContain('DATABASE_URL_APP');
  expect(texto.toLowerCase(), `el mensaje debe nombrar el parametro ${parametro}`).toContain(parametro);
  expect(texto, 'el mensaje no puede traer la URL').not.toContain(urlApp);
  expect(texto, 'el mensaje no puede traer la contrasena').not.toContain(CLAVE_DE_LA_URL);
  if (valor) expect(texto, 'el mensaje no puede traer el valor del parametro').not.toContain(valor);
}

describe('criterio 143: validarEntorno rechaza una DATABASE_URL_APP con parametros de conexion en la cadena de consulta', () => {
  it.for(NOMBRES)(
    'criterio 143: ?%s=<valor reconocible> lanza ErrorEntorno que nombra la variable y el parametro',
    (nombre) => {
      esperarRechazo(`${URL_APP}?${nombre}=${VALOR_RECONOCIBLE}`, nombre);
    },
  );

  it('criterio 143: el ejemplo de la especificacion, ?user=postgres, lanza ErrorEntorno que nombra DATABASE_URL_APP y user', () => {
    const urlApp = `${URL_APP}?user=postgres`;
    const error = errorDe(entornoCon(urlApp));

    expect(error).toBeInstanceOf(ErrorEntorno);
    const texto = textoDe(error as ErrorEntorno);
    expect(texto).toContain('DATABASE_URL_APP');
    expect(texto).toContain('user');
    expect(texto).not.toContain(urlApp);
    expect(texto).not.toContain(CLAVE_DE_LA_URL);
    expect(texto, 'el valor del parametro no se muestra').not.toContain('user=postgres');
  });

  it('criterio 143: el ejemplo de la especificacion, ?password=<valor reconocible>, lanza ErrorEntorno sin el valor ni la URL', () => {
    esperarRechazo(`${URL_APP}?password=${VALOR_RECONOCIBLE}`, 'password');
  });

  it.for(NOMBRES)('criterio 143: %s en mayusculas y mezclado tambien se rechaza', (nombre) => {
    esperarRechazo(`${URL_APP}?${nombre.toUpperCase()}=${VALOR_RECONOCIBLE}`, nombre);
    esperarRechazo(`${URL_APP}?${nombre[0]?.toUpperCase()}${nombre.slice(1)}=${VALOR_RECONOCIBLE}`, nombre);
  });

  it.for([
    ['%75ser', 'user'],
    ['d%61tabase', 'database'],
    ['%64bname', 'dbname'],
    ['%50ASSWORD', 'password'],
    ['h%6fst', 'host'],
  ] as const)('criterio 143: el nombre codificado %s se decodifica y se rechaza como %s', ([codificado, nombre]) => {
    esperarRechazo(`${URL_APP}?${codificado}=${VALOR_RECONOCIBLE}`, nombre);
  });

  it('criterio 143: con valor vacio (?user=) se rechaza', () => {
    esperarRechazo(`${URL_APP}?user=`, 'user', '');
    esperarRechazo(`${URL_APP}?host`, 'host', '');
  });

  it('criterio 143: en segunda posicion (?sslmode=disable&user=x) y despues de options se rechaza', () => {
    esperarRechazo(`${URL_APP}?sslmode=disable&user=${VALOR_RECONOCIBLE}`, 'user');
    esperarRechazo(`${URL_APP}?options=-c%20TimeZone%3DUTC&sslmode=disable&port=${VALOR_RECONOCIBLE}`, 'port');
  });

  it('criterio 143: repetido (?user=a&user=b) se rechaza', () => {
    esperarRechazo(`${URL_APP}?user=${VALOR_RECONOCIBLE}&user=otro-${VALOR_RECONOCIBLE}`, 'user');
  });

  it('criterio 143: varios parametros distintos: el mensaje nombra cada uno', () => {
    const error = errorDe(entornoCon(`${URL_APP}?user=a&host=b&dbname=c`));

    expect(error).toBeInstanceOf(ErrorEntorno);
    const texto = textoDe(error as ErrorEntorno);
    for (const nombre of ['user', 'host', 'dbname']) expect(texto).toContain(nombre);
  });

  it('criterio 143: un parametro prohibido rechaza aunque el resto del entorno sea valido, tambien con postgres:// en lugar de postgresql://', () => {
    const urlApp = `postgres://aquagestion_app:${CLAVE_DE_LA_URL}@127.0.0.1:5432/aquagestion?user=${VALOR_RECONOCIBLE}`;

    expect(errorDe(entornoCon(urlApp))).toBeInstanceOf(ErrorEntorno);
  });
});

describe('criterio 143: validarEntorno sigue aceptando las URL sin parametros de conexion en la cadena de consulta', () => {
  it.for([
    ['sin cadena de consulta', URL_APP],
    ['options', `${URL_APP}?options=-c%20TimeZone%3DUTC`],
    ['sslmode', `${URL_APP}?sslmode=disable`],
    ['sslmode y options', `${URL_APP}?sslmode=require&options=-c%20search_path%3Dx`],
    ['application_name', `${URL_APP}?application_name=x`],
    ['un nombre prohibido solo dentro del valor de options', `${URL_APP}?options=-c%20user%3Dx`],
  ] as const)('criterio 143: %s es valida y la URL se conserva tal cual', ([, urlApp]) => {
    const entorno = validarEntorno(entornoCon(urlApp));

    expect(entorno.DATABASE_URL_APP).toBe(urlApp);
  });
});
