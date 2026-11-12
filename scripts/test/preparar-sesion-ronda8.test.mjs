// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 143 (ataque ronda 8, O1; complementa el criterio 5 y el hook de la nube, spec 000): el paso del hook de sesion que lee las URL
// (`leerConexion` para `DATABASE_URL` y `DATABASE_URL_PRUEBAS`, y `leerUrlApp` de `scripts/lib/entorno.mjs`, que el hook carga con
// `cargarUtilidadesEntorno()`, para `DATABASE_URL_APP`) falla y lo informa cuando alguna de las tres variables lleva `user`, `host`,
// `hostaddr`, `password`, `port`, `dbname` o `database` en la cadena de consulta (decodificado, sin distinguir mayusculas, con cualquier
// valor, en cualquier posicion y aunque se repita). Como el paso falla antes de crear nada, el hook no crea roles con esos valores. El
// mensaje nombra la variable y el parametro y no trae la URL, el valor ni la contrasena. `options` y `sslmode` siguen permitidos.
import { beforeAll, describe, expect, it } from 'vitest';
import { cargarUtilidadesEntorno, leerConexion } from '../../.claude/hooks/preparar-sesion.mjs';

const LISTA = ['user', 'host', 'hostaddr', 'password', 'port', 'dbname', 'database'];
const CLAVE = 'clave-del-hook-r8';
const VALOR = 'valor-reconocible-r8';
const APP = `postgresql://aquagestion_app:${CLAVE}@127.0.0.1:5432/aquagestion`;
const DESARROLLO = `postgresql://aquagestion:${CLAVE}@127.0.0.1:5432/aquagestion`;
const PRUEBAS = `postgresql://aquagestion:${CLAVE}@127.0.0.1:5432/aquagestion_pruebas`;

let utilidades;

beforeAll(async () => {
  // Como hace el hook en la nube: las utilidades de entorno se cargan con import() dinamico antes de leer las URL.
  utilidades = await cargarUtilidadesEntorno();
});

function mensajeDe(f) {
  try {
    f();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('El paso que lee las URL debia fallar y no fallo.');
}

function esperarMensaje(mensaje, variable, parametro, url, valor = VALOR) {
  expect(mensaje, 'el paso debe nombrar la variable').toMatch(new RegExp(`${variable}(?![A-Z_])`));
  expect(mensaje.toLowerCase(), `el paso debe nombrar el parametro ${parametro}`).toContain(parametro);
  expect(mensaje, 'el mensaje no puede traer la URL').not.toContain(url);
  expect(mensaje, 'el mensaje no puede traer la contrasena').not.toContain(CLAVE);
  if (valor) expect(mensaje, 'el mensaje no puede traer el valor del parametro').not.toContain(valor);
}

const PASOS = [
  {
    variable: 'DATABASE_URL',
    base: DESARROLLO,
    leer: (url) => leerConexion({ DATABASE_URL: url, DATABASE_URL_PRUEBAS: PRUEBAS }),
  },
  {
    variable: 'DATABASE_URL_PRUEBAS',
    base: PRUEBAS,
    leer: (url) => leerConexion({ DATABASE_URL: DESARROLLO, DATABASE_URL_PRUEBAS: url }),
  },
  {
    variable: 'DATABASE_URL_APP',
    base: APP,
    leer: (url) => utilidades.leerUrlApp({ DATABASE_URL_APP: url }),
  },
];

describe.each(PASOS)('criterio 143: el hook de sesion lee $variable', ({ variable, base, leer }) => {
  it.each(LISTA)(
    `criterio 143: con ?%s=<valor> el paso falla nombrando ${variable} y el parametro, sin el valor`,
    (nombre) => {
      const url = `${base}?${nombre}=${VALOR}`;

      esperarMensaje(
        mensajeDe(() => leer(url)),
        variable,
        nombre,
        url,
      );
    },
  );

  it.each([
    ['en mayusculas', `USER=${VALOR}`, 'user', VALOR],
    ['codificado (%75ser)', `%75ser=${VALOR}`, 'user', VALOR],
    ['con valor vacio', 'host=', 'host', ''],
    ['en segunda posicion', `sslmode=disable&dbname=${VALOR}`, 'dbname', VALOR],
    ['repetido', `port=${VALOR}&Port=otro-${VALOR}`, 'port', VALOR],
  ])('criterio 143: %s tambien falla', (_caso, consulta, parametro, valor) => {
    const url = `${base}?${consulta}`;

    esperarMensaje(
      mensajeDe(() => leer(url)),
      variable,
      parametro,
      url,
      valor,
    );
  });

  it.each(['', '?options=-c%20TimeZone%3DUTC', '?sslmode=disable', '?sslmode=require&options=-c%20search_path%3Dx'])(
    'criterio 143: la cadena de consulta %j sigue permitida',
    (consulta) => {
      expect(() => leer(`${base}${consulta}`)).not.toThrow();
    },
  );
});
