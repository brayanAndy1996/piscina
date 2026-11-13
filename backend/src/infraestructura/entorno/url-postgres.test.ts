// spec: 001-academias-aislamiento (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 143 (ataque ronda 8, O1; amplia el criterio 5), precision P-34, parte unitaria del backend: `parametrosDeConexionProhibidos(url)` de
// `backend/src/infraestructura/entorno/url-postgres.ts` devuelve los nombres de la lista `PARAMETROS_DE_CONEXION_PROHIBIDOS` (`user`,
// `host`, `hostaddr`, `password`, `port`, `dbname`, `database`) presentes en la cadena de consulta de la URL, en minusculas, sin repetir y
// en orden de aparicion; `[]` si no hay. Lee la cadena con `new URL(url).searchParams` (nombres decodificados, sin distinguir mayusculas),
// no devuelve ni registra valores y lanza un `TypeError` si `url` no es una URL que `new URL` acepte. La lista es igual en
// `scripts/lib/entorno.mjs` (el mismo contenido, los mismos nombres). La parte de `validarEntorno` esta en `entorno-ronda8.test.ts`; la de
// los scripts, en `scripts/test/entorno-ronda8.test.mjs`.

interface UrlPostgres {
  readonly PARAMETROS_DE_CONEXION_PROHIBIDOS: readonly string[];
  readonly parametrosDeConexionProhibidos: (url: string) => string[];
}

const cargar = (): Promise<UrlPostgres> =>
  cargarFuncionalidad<UrlPostgres>('infraestructura/entorno/url-postgres.ts', [
    'PARAMETROS_DE_CONEXION_PROHIBIDOS',
    'parametrosDeConexionProhibidos',
  ]);

const LISTA = ['user', 'host', 'hostaddr', 'password', 'port', 'dbname', 'database'] as const;
const BASE = 'postgresql://aquagestion_app:clave-r8@127.0.0.1:5432/aquagestion';

describe('criterio 143 (P-34): PARAMETROS_DE_CONEXION_PROHIBIDOS', () => {
  it('criterio 143: la lista es user, host, hostaddr, password, port, dbname y database', async () => {
    const { PARAMETROS_DE_CONEXION_PROHIBIDOS } = await cargar();

    expect([...PARAMETROS_DE_CONEXION_PROHIBIDOS]).toEqual([...LISTA]);
  });

  it('criterio 143: la lista de url-postgres.ts es igual a la de scripts/lib/entorno.mjs (mismos nombres, mismo contenido)', async () => {
    const { PARAMETROS_DE_CONEXION_PROHIBIDOS } = await cargar();
    const ruta = path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'entorno.mjs');
    const scripts = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as {
      PARAMETROS_DE_CONEXION_PROHIBIDOS?: readonly string[];
    };

    expect(
      scripts.PARAMETROS_DE_CONEXION_PROHIBIDOS,
      'falta PARAMETROS_DE_CONEXION_PROHIBIDOS en scripts/lib/entorno.mjs',
    ).toBeDefined();
    expect([...(scripts.PARAMETROS_DE_CONEXION_PROHIBIDOS ?? [])]).toEqual([...PARAMETROS_DE_CONEXION_PROHIBIDOS]);
  });
});

describe('criterio 143 (P-34): parametrosDeConexionProhibidos devuelve los nombres prohibidos de la cadena de consulta', () => {
  it.for(LISTA)('criterio 143: ?%s=valor devuelve ese nombre', async (nombre) => {
    const { parametrosDeConexionProhibidos } = await cargar();

    expect(parametrosDeConexionProhibidos(`${BASE}?${nombre}=valor`)).toEqual([nombre]);
  });

  it.for(LISTA)('criterio 143: el nombre %s en mayusculas, y mezclado, se devuelve en minusculas', async (nombre) => {
    const { parametrosDeConexionProhibidos } = await cargar();
    const mezclado = [...nombre].map((letra, i) => (i % 2 === 0 ? letra.toUpperCase() : letra)).join('');

    expect(parametrosDeConexionProhibidos(`${BASE}?${nombre.toUpperCase()}=valor`)).toEqual([nombre]);
    expect(parametrosDeConexionProhibidos(`${BASE}?${mezclado}=valor`)).toEqual([nombre]);
  });

  it.for([
    ['%75ser', 'user'],
    ['%55SER', 'user'],
    ['d%61tabase', 'database'],
    ['%64bname', 'dbname'],
    ['%50assword', 'password'],
    ['h%6Fst', 'host'],
    ['%68ostaddr', 'hostaddr'],
    ['p%6frt', 'port'],
    ['%75%73%65%72', 'user'],
  ] as const)('criterio 143: el nombre codificado %s se decodifica y devuelve %s', async ([codificado, esperado]) => {
    const { parametrosDeConexionProhibidos } = await cargar();

    expect(parametrosDeConexionProhibidos(`${BASE}?${codificado}=valor`)).toEqual([esperado]);
  });

  it('criterio 143: con valor vacio (?user= y ?user) tambien se devuelve', async () => {
    const { parametrosDeConexionProhibidos } = await cargar();

    expect(parametrosDeConexionProhibidos(`${BASE}?user=`)).toEqual(['user']);
    expect(parametrosDeConexionProhibidos(`${BASE}?user`)).toEqual(['user']);
    expect(parametrosDeConexionProhibidos(`${BASE}?host=&port=`)).toEqual(['host', 'port']);
  });

  it('criterio 143: en cualquier posicion (segunda, ultima, entre otros parametros)', async () => {
    const { parametrosDeConexionProhibidos } = await cargar();

    expect(parametrosDeConexionProhibidos(`${BASE}?sslmode=disable&user=x`)).toEqual(['user']);
    expect(parametrosDeConexionProhibidos(`${BASE}?sslmode=disable&application_name=a&dbname=x`)).toEqual(['dbname']);
    expect(parametrosDeConexionProhibidos(`${BASE}?application_name=a&host=h&sslmode=require`)).toEqual(['host']);
  });

  it('criterio 143: repetido, se devuelve una sola vez (aunque cambien las mayusculas o la codificacion)', async () => {
    const { parametrosDeConexionProhibidos } = await cargar();

    expect(parametrosDeConexionProhibidos(`${BASE}?user=a&user=b`)).toEqual(['user']);
    expect(parametrosDeConexionProhibidos(`${BASE}?user=a&USER=b&%75ser=c`)).toEqual(['user']);
  });

  it('criterio 143: varios distintos se devuelven en orden de aparicion', async () => {
    const { parametrosDeConexionProhibidos } = await cargar();

    expect(parametrosDeConexionProhibidos(`${BASE}?port=1&host=h&user=u&host=h2&Database=d`)).toEqual([
      'port',
      'host',
      'user',
      'database',
    ]);
    expect(parametrosDeConexionProhibidos(`${BASE}?${[...LISTA].reverse().join('=x&')}=x`)).toEqual(
      [...LISTA].reverse(),
    );
  });

  it('criterio 143: devuelve solo nombres, nunca valores, la contrasena ni la URL', async () => {
    const { parametrosDeConexionProhibidos } = await cargar();
    const url = `${BASE}?user=valor-reconocible-r8&password=otra-clave-r8`;

    const resultado = parametrosDeConexionProhibidos(url);

    expect(resultado).toEqual(['user', 'password']);
    const texto = JSON.stringify(resultado);
    for (const secreto of ['valor-reconocible-r8', 'otra-clave-r8', 'clave-r8', '127.0.0.1']) {
      expect(texto).not.toContain(secreto);
    }
  });

  it.for([
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
  ] as const)('criterio 143: pasa y devuelve []: %s', async ([, url]) => {
    const { parametrosDeConexionProhibidos } = await cargar();

    expect(parametrosDeConexionProhibidos(url)).toEqual([]);
  });

  it.for(['', 'no es una url', '/solo/ruta?user=x', '://sin-protocolo?user=x'])(
    'criterio 143: si la entrada no es una URL que new URL acepte (%j), lanza un TypeError (falla cerrada)',
    async (entrada) => {
      const { parametrosDeConexionProhibidos } = await cargar();

      expect(() => parametrosDeConexionProhibidos(entrada)).toThrow(TypeError);
    },
  );
});
