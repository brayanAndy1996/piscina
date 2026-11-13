// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 143 (ataque ronda 8, O1; AMPLIA el criterio 5 y complementa los 6, 8, 81 y 90), precision P-34, parte de `scripts/lib/entorno.mjs`:
// `parametrosDeConexionProhibidos(url)` devuelve los nombres de `PARAMETROS_DE_CONEXION_PROHIBIDOS` (`user`, `host`, `hostaddr`, `password`,
// `port`, `dbname`, `database`) presentes en la cadena de consulta, en minusculas, sin repetir y en orden de aparicion, y lanza un
// `TypeError` si la entrada no es una URL. `analizarUrlPostgres` (y por ella `leerUrlApp`, `leerUrlsBases`, `db:crear` y el hook) rechaza
// una URL con alguno de esos nombres en la cadena de consulta, con un mensaje que nombra la variable y el parametro y nunca la URL, el
// valor del parametro ni la contrasena. `options` y `sslmode` siguen permitidos y una URL sin cadena de consulta no cambia. El archivo
// sigue importando solo modulos `node:*` (lo carga el hook antes de `npm ci`). La parte del backend esta en
// `backend/src/infraestructura/entorno/url-postgres.test.ts` (que tambien prueba que las dos listas son iguales).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as entorno from '../lib/entorno.mjs';

const { analizarUrlPostgres, leerUrlApp, leerUrlsBases } = entorno;

const LISTA = ['user', 'host', 'hostaddr', 'password', 'port', 'dbname', 'database'];
const CLAVE = 'clave-de-la-url-r8';
const VALOR = 'valor-reconocible-r8';
const BASE = `postgresql://aquagestion_app:${CLAVE}@127.0.0.1:5432/aquagestion`;
const BASE_PRUEBAS = `postgresql://aquagestion:${CLAVE}@127.0.0.1:5432/aquagestion_pruebas`;
const BASE_DESARROLLO = `postgresql://aquagestion:${CLAVE}@127.0.0.1:5432/aquagestion`;

function parametros(url) {
  if (typeof entorno.parametrosDeConexionProhibidos !== 'function') {
    throw new Error(
      'Falta la funcionalidad de la 001: scripts/lib/entorno.mjs no exporta parametrosDeConexionProhibidos.',
    );
  }
  return entorno.parametrosDeConexionProhibidos(url);
}

describe('criterio 143 (P-34): PARAMETROS_DE_CONEXION_PROHIBIDOS y parametrosDeConexionProhibidos en scripts/lib/entorno.mjs', () => {
  it('criterio 143: la lista es user, host, hostaddr, password, port, dbname y database', () => {
    expect(entorno.PARAMETROS_DE_CONEXION_PROHIBIDOS, 'falta PARAMETROS_DE_CONEXION_PROHIBIDOS').toBeDefined();
    expect([...entorno.PARAMETROS_DE_CONEXION_PROHIBIDOS]).toEqual(LISTA);
  });

  it('criterio 143: el archivo sigue importando solo modulos node:* (lo carga el hook antes de npm ci)', () => {
    const ruta = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'entorno.mjs');
    const texto = fs.readFileSync(ruta, 'utf8');
    const origenes = [...texto.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gms)].map((m) => m[1]);
    const dinamicos = [...texto.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

    expect(origenes.length).toBeGreaterThan(0);
    for (const origen of [...origenes, ...dinamicos]) expect(origen, `import de ${origen}`).toMatch(/^node:/);
  });

  it.each(LISTA)('criterio 143: ?%s=valor devuelve ese nombre', (nombre) => {
    expect(parametros(`${BASE}?${nombre}=valor`)).toEqual([nombre]);
  });

  it.each(LISTA)('criterio 143: el nombre %s en mayusculas, y mezclado, se devuelve en minusculas', (nombre) => {
    const mezclado = [...nombre].map((letra, i) => (i % 2 === 0 ? letra.toUpperCase() : letra)).join('');

    expect(parametros(`${BASE}?${nombre.toUpperCase()}=valor`)).toEqual([nombre]);
    expect(parametros(`${BASE}?${mezclado}=valor`)).toEqual([nombre]);
  });

  it.each([
    ['%75ser', 'user'],
    ['%55SER', 'user'],
    ['d%61tabase', 'database'],
    ['%64bname', 'dbname'],
    ['%50assword', 'password'],
    ['h%6Fst', 'host'],
    ['%68ostaddr', 'hostaddr'],
    ['p%6frt', 'port'],
    ['%75%73%65%72', 'user'],
  ])('criterio 143: el nombre codificado %s se decodifica y devuelve %s', (codificado, esperado) => {
    expect(parametros(`${BASE}?${codificado}=valor`)).toEqual([esperado]);
  });

  it('criterio 143: con valor vacio (?user= y ?user) tambien se devuelve', () => {
    expect(parametros(`${BASE}?user=`)).toEqual(['user']);
    expect(parametros(`${BASE}?user`)).toEqual(['user']);
    expect(parametros(`${BASE}?host=&port=`)).toEqual(['host', 'port']);
  });

  it('criterio 143: en cualquier posicion (segunda, ultima, entre otros parametros)', () => {
    expect(parametros(`${BASE}?sslmode=disable&user=x`)).toEqual(['user']);
    expect(parametros(`${BASE}?sslmode=disable&application_name=a&dbname=x`)).toEqual(['dbname']);
    expect(parametros(`${BASE}?application_name=a&host=h&sslmode=require`)).toEqual(['host']);
  });

  it('criterio 143: repetido, se devuelve una sola vez (aunque cambien las mayusculas o la codificacion)', () => {
    expect(parametros(`${BASE}?user=a&user=b`)).toEqual(['user']);
    expect(parametros(`${BASE}?user=a&USER=b&%75ser=c`)).toEqual(['user']);
  });

  it('criterio 143: varios distintos se devuelven en orden de aparicion', () => {
    expect(parametros(`${BASE}?port=1&host=h&user=u&host=h2&Database=d`)).toEqual(['port', 'host', 'user', 'database']);
    expect(parametros(`${BASE}?${[...LISTA].reverse().join('=x&')}=x`)).toEqual([...LISTA].reverse());
  });

  it('criterio 143: devuelve solo nombres, nunca valores, la contrasena ni la URL', () => {
    const resultado = parametros(`${BASE}?user=${VALOR}&password=otra-clave-r8`);

    expect(resultado).toEqual(['user', 'password']);
    const texto = JSON.stringify(resultado);
    for (const secreto of [VALOR, 'otra-clave-r8', CLAVE, '127.0.0.1']) expect(texto).not.toContain(secreto);
  });

  it.each([
    ['sin cadena de consulta', BASE],
    ['con "?" y sin parametros', `${BASE}?`],
    ['options codificado', `${BASE}?options=-c%20TimeZone%3DUTC`],
    ['sslmode=disable', `${BASE}?sslmode=disable`],
    ['sslmode y options', `${BASE}?sslmode=require&options=-c%20search_path%3Dx`],
    ['application_name', `${BASE}?application_name=x`],
    ['un nombre prohibido dentro del valor de options', `${BASE}?options=-c%20user%3Dx`],
    ['un nombre prohibido dentro del valor de otro parametro (& codificado)', `${BASE}?application_name=a%26user%3Db`],
    ['un nombre que solo contiene el prohibido (usuario, hostname, portal)', `${BASE}?usuario=a&hostname=b&portal=c`],
    ['el nombre prohibido en el fragmento y no en la consulta', `${BASE}#?user=x`],
    ['el nombre prohibido en la ruta', 'postgresql://u:p@h/user?sslmode=disable'],
  ])('criterio 143: pasa y devuelve []: %s', (_caso, url) => {
    expect(parametros(url)).toEqual([]);
  });

  it.each(['', 'no es una url', '/solo/ruta?user=x', '://sin-protocolo?user=x'])(
    'criterio 143: si la entrada no es una URL que new URL acepte (%j), lanza un TypeError (falla cerrada)',
    (entrada) => {
      expect(() => parametros(entrada)).toThrow(TypeError);
    },
  );
});

/** Mensaje del error que lanza `f` (falla si no lanza). */
function mensajeDe(f) {
  try {
    f();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Debia lanzar un error y no lanzo ninguno.');
}

/** Lo que debe cumplir el mensaje de un rechazo: nombra la variable y el parametro, y no trae la URL, el valor ni la contrasena. */
function esperarMensaje(mensaje, { variable, parametro, url, valor = VALOR }) {
  expect(mensaje, 'el mensaje debe nombrar la variable').toMatch(new RegExp(`${variable}(?![A-Z_])`));
  expect(mensaje.toLowerCase(), `el mensaje debe nombrar el parametro ${parametro}`).toContain(parametro);
  expect(mensaje, 'el mensaje no puede traer la URL').not.toContain(url);
  expect(mensaje, 'el mensaje no puede traer la contrasena').not.toContain(CLAVE);
  if (valor) expect(mensaje, 'el mensaje no puede traer el valor del parametro').not.toContain(valor);
}

// Cada variable con su URL de base y la funcion que la lee.
const VARIABLES = [
  {
    variable: 'DATABASE_URL_APP',
    base: BASE,
    leer: (url) => leerUrlApp({ DATABASE_URL_APP: url }),
  },
  {
    variable: 'DATABASE_URL',
    base: BASE_DESARROLLO,
    leer: (url) => leerUrlsBases({ DATABASE_URL: url, DATABASE_URL_PRUEBAS: BASE_PRUEBAS }),
  },
  {
    variable: 'DATABASE_URL_PRUEBAS',
    base: BASE_PRUEBAS,
    leer: (url) => leerUrlsBases({ DATABASE_URL: BASE_DESARROLLO, DATABASE_URL_PRUEBAS: url }),
  },
];

describe.each(VARIABLES)(
  'criterio 143: $variable con parametros de conexion en la cadena de consulta',
  ({ variable, base, leer }) => {
    it.each(LISTA)(
      `criterio 143: analizarUrlPostgres rechaza ?%s=<valor> nombrando ${variable} y el parametro`,
      (nombre) => {
        const url = `${base}?${nombre}=${VALOR}`;

        esperarMensaje(
          mensajeDe(() => analizarUrlPostgres(url, variable)),
          { variable, parametro: nombre, url },
        );
      },
    );

    it.each(LISTA)(
      'criterio 143: la lectura de la variable (leerUrlApp o leerUrlsBases) rechaza ?%s=<valor>',
      (nombre) => {
        const url = `${base}?${nombre}=${VALOR}`;

        esperarMensaje(
          mensajeDe(() => leer(url)),
          { variable, parametro: nombre, url },
        );
      },
    );

    it.each([
      ['en mayusculas', `USER=${VALOR}`, 'user'],
      ['mezclado', `HostAddr=${VALOR}`, 'hostaddr'],
      ['codificado (%75ser)', `%75ser=${VALOR}`, 'user'],
      ['codificado (d%61tabase)', `d%61tabase=${VALOR}`, 'database'],
      ['con valor vacio', 'dbname=', 'dbname'],
      ['sin signo igual', 'port', 'port'],
      ['en segunda posicion', `sslmode=disable&password=${VALOR}`, 'password'],
      ['repetido', `host=${VALOR}&host=otro-${VALOR}`, 'host'],
      ['despues de options', `options=-c%20TimeZone%3DUTC&user=${VALOR}`, 'user'],
    ])('criterio 143: %s se rechaza', (_caso, consulta, parametro) => {
      const url = `${base}?${consulta}`;

      esperarMensaje(
        mensajeDe(() => leer(url)),
        { variable, parametro, url, valor: consulta.endsWith('=') || consulta === 'port' ? '' : VALOR },
      );
    });

    it.each([
      '?options=-c%20TimeZone%3DUTC',
      '?sslmode=disable',
      '?sslmode=require&options=-c%20search_path%3Dx',
      '?application_name=x',
      '',
    ])('criterio 143: la cadena de consulta %j sigue permitida', (consulta) => {
      expect(() => leer(`${base}${consulta}`)).not.toThrow();
    });
  },
);

describe('criterio 143: analizarUrlPostgres sin parametros de conexion no cambia', () => {
  it('descompone la URL como antes, con y sin options y sslmode', () => {
    const esperado = { host: '127.0.0.1', puerto: 5432, usuario: 'aquagestion_app', clave: CLAVE, base: 'aquagestion' };

    expect(analizarUrlPostgres(BASE, 'X')).toEqual(esperado);
    expect(analizarUrlPostgres(`${BASE}?sslmode=disable&options=-c%20TimeZone%3DUTC`, 'X')).toEqual(esperado);
  });

  it('las demas validaciones siguen igual: falta, formato y protocolo', () => {
    expect(() => analizarUrlPostgres(undefined, 'X')).toThrow(/Falta la variable X/);
    expect(() => analizarUrlPostgres('no es url', 'X')).toThrow(/no es una URL válida/);
    expect(() => analizarUrlPostgres('mysql://u:p@h/b?user=x', 'X')).toThrow(/URL de PostgreSQL/);
  });
});
