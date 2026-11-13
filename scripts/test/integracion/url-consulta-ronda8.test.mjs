// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 143 (ataque ronda 8, O1; AMPLIA el criterio 5 y complementa los 6, 8, 81 y 90), parte de integracion de `npm run db:crear`
// (`scripts/crear-bases.mjs`): el cliente `pg` toma `user`, `host`, `hostaddr`, `password`, `port`, `dbname` y `database` de la cadena de
// consulta por encima de la parte principal de la URL, mientras que `db:crear` lee la parte principal. Por eso, si `DATABASE_URL`,
// `DATABASE_URL_APP` o `DATABASE_URL_PRUEBAS` lleva alguno de esos nombres en la cadena de consulta (decodificado, sin distinguir
// mayusculas, con cualquier valor, tambien vacio, en cualquier posicion y aunque se repita), `db:crear` falla cerrado: termina con codigo 1
// antes de abrir ninguna conexion y sin modificar nada (no crea las bases ni el rol), nombra la variable y el parametro, y su salida no
// contiene la URL, el valor del parametro ni la contrasena. `options` y `sslmode` siguen permitidos. Los casos de la especificacion:
// `DATABASE_URL_APP` valida mas `?user=<usuario del duenio>`, y `DATABASE_URL_PRUEBAS` mas `?host=127.0.0.2`.
// Las bases son temporales y se piden con nombres unicos: si `db:crear` no se negara, las crearia, y el caso lo detecta y las borra.
import { afterAll, describe, expect, it } from 'vitest';
import { analizarUrlPostgres, USUARIO_APP } from '../../lib/entorno.mjs';
import {
  borrarBases,
  ejecutarScript,
  ejecutarSql,
  existeBase,
  filtracionesDeClave,
  filtracionesDeLaClaveDelServidor,
  nombresTemporales,
  servidorDePruebas,
  urlAppDePruebas,
  urlDe,
} from './ayuda.mjs';
import { urlAppAlineada } from './ayuda-ronda9.mjs';

const servidor = servidorDePruebas();
// La URL de la app es la configurada (entorno, `.env` o `.env.example`): asi, si `db:crear` no se negara, el rol que ya existe no se
// modifica (no cambia su contrasena) y esta prueba nunca crea un rol con una contrasena inventada.
const URL_APP = urlAppDePruebas();
const CLAVE_APP = analizarUrlPostgres(URL_APP, 'DATABASE_URL_APP').clave;
const VALOR = 'valor-reconocible-r8';
const LISTA = ['user', 'host', 'hostaddr', 'password', 'port', 'dbname', 'database'];
const basesPedidas = [];

afterAll(async () => {
  await borrarBases(servidor, basesPedidas).catch(() => undefined);
});

// Criterio 148 (ataque ronda 9): la URL de la app de cada caso lleva el mismo servidor, puerto y base que la DATABASE_URL del caso (con
// `nombres`); el usuario, la contrasena y la cadena de consulta no cambian. Sin `nombres`, la URL configurada tal cual.
const urlApp = (nombres) => (nombres ? urlAppAlineada(URL_APP, urlDe(servidor, nombres.desarrollo)) : URL_APP);

/** Las tres URL validas para una pareja de bases nuevas; `cambios` reemplaza alguna (con su cadena de consulta). */
function entornoDe(nombres, cambios = {}) {
  return {
    DATABASE_URL: urlDe(servidor, nombres.desarrollo),
    DATABASE_URL_PRUEBAS: urlDe(servidor, nombres.pruebas),
    DATABASE_URL_APP: urlApp(nombres),
    ...cambios,
  };
}

function parejaNueva() {
  const nombres = nombresTemporales();
  basesPedidas.push(nombres.desarrollo, nombres.pruebas);
  return nombres;
}

/**
 * Codigo 1; nombra la variable (sin confundirla con otra que la contiene: `DATABASE_URL` dentro de `DATABASE_URL_APP`) y el parametro; no
 * trae la URL, el valor ni las contrasenas; y no creo ninguna de las bases.
 */
async function esperarFallaCerrada(nombres, resultado, { variable, parametro, url, valor = VALOR }) {
  expect(resultado.estado, resultado.salida).toBe(1);
  expect(resultado.salida, 'la salida debe nombrar la variable').toMatch(new RegExp(`${variable}(?![A-Z_])`));
  expect(resultado.salida.toLowerCase(), `la salida debe nombrar el parametro ${parametro}`).toContain(parametro);
  expect(resultado.salida, 'la salida no puede traer la URL').not.toContain(url);
  expect(resultado.salida, 'la salida no puede traer la URL codificada').not.toContain(encodeURIComponent(url));
  if (valor) expect(resultado.salida, 'la salida no puede traer el valor del parametro').not.toContain(valor);
  expect(
    filtracionesDeClave(resultado.salida, CLAVE_APP, [USUARIO_APP, servidor.usuario, servidor.base]),
    'la salida muestra la contrasena de la app',
  ).toEqual([]);
  expect(
    filtracionesDeLaClaveDelServidor(resultado.salida, servidor),
    'la salida muestra la contrasena del servidor',
  ).toEqual([]);
  expect(await existeBase(servidor, nombres.desarrollo), 'db:crear no debia crear la base de desarrollo').toBe(false);
  expect(await existeBase(servidor, nombres.pruebas), 'db:crear no debia crear la base de pruebas').toBe(false);
}

const VARIABLES = [
  { variable: 'DATABASE_URL', base: (nombres) => urlDe(servidor, nombres.desarrollo) },
  { variable: 'DATABASE_URL_PRUEBAS', base: (nombres) => urlDe(servidor, nombres.pruebas) },
  { variable: 'DATABASE_URL_APP', base: (nombres) => urlApp(nombres) },
];

describe('criterio 143: los casos de la especificacion en db:crear', () => {
  it('criterio 143: DATABASE_URL_APP valida mas ?user=<usuario del duenio> termina con codigo 1, nombra la variable y el parametro y no trae la contrasena ni la URL', async () => {
    const nombres = parejaNueva();
    const url = `${urlApp(nombres)}?user=${encodeURIComponent(servidor.usuario)}`;

    const resultado = ejecutarScript(['crear-bases.mjs'], entornoDe(nombres, { DATABASE_URL_APP: url }));

    await esperarFallaCerrada(nombres, resultado, {
      variable: 'DATABASE_URL_APP',
      parametro: 'user',
      url,
      valor: '',
    });
  });

  it('criterio 143: DATABASE_URL_PRUEBAS mas ?host=127.0.0.2 termina con codigo 1, nombra la variable y el parametro y no trae la contrasena ni la URL', async () => {
    const nombres = parejaNueva();
    const url = `${urlDe(servidor, nombres.pruebas)}?host=127.0.0.2`;

    const resultado = ejecutarScript(['crear-bases.mjs'], entornoDe(nombres, { DATABASE_URL_PRUEBAS: url }));

    await esperarFallaCerrada(nombres, resultado, {
      variable: 'DATABASE_URL_PRUEBAS',
      parametro: 'host',
      url,
      valor: '127.0.0.2',
    });
  });
});

describe.each(VARIABLES)('criterio 143: db:crear con parametros de conexion en $variable', ({ variable, base }) => {
  it.each(LISTA)(
    `criterio 143: ?%s=<valor> en ${variable} termina con codigo 1 nombrando la variable y el parametro`,
    async (nombre) => {
      const nombres = parejaNueva();
      const url = `${base(nombres)}?${nombre}=${VALOR}`;

      const resultado = ejecutarScript(['crear-bases.mjs'], entornoDe(nombres, { [variable]: url }));

      await esperarFallaCerrada(nombres, resultado, { variable, parametro: nombre, url });
    },
  );

  it.each([
    ['en mayusculas', `USER=${VALOR}`, 'user', VALOR],
    ['codificado (%75ser)', `%75ser=${VALOR}`, 'user', VALOR],
    ['con valor vacio', 'database=', 'database', ''],
    ['en segunda posicion', `sslmode=disable&dbname=${VALOR}`, 'dbname', VALOR],
    ['repetido', `host=${VALOR}&Host=otro-${VALOR}`, 'host', VALOR],
  ])(`criterio 143: en ${variable}, %s tambien termina con codigo 1`, async (_caso, consulta, parametro, valor) => {
    const nombres = parejaNueva();
    const url = `${base(nombres)}?${consulta}`;

    const resultado = ejecutarScript(['crear-bases.mjs'], entornoDe(nombres, { [variable]: url }));

    await esperarFallaCerrada(nombres, resultado, { variable, parametro, url, valor });
  });
});

describe('criterio 143: options y sslmode siguen permitidos en db:crear', () => {
  it('criterio 143 (control): DATABASE_URL_PRUEBAS con ?sslmode=disable&options=-c TimeZone=UTC no se rechaza por la cadena de consulta', async (contexto) => {
    // db:crear necesita que el rol de la app ya exista (lo crea el entorno: Docker, la CI o el hook de la nube).
    const roles = await ejecutarSql(
      servidor,
      'postgres',
      `SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${USUARIO_APP}'`,
    );
    if (roles.rows.length === 0) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = parejaNueva();
    const url = `${urlDe(servidor, nombres.pruebas)}?sslmode=disable&options=${encodeURIComponent('-c TimeZone=UTC')}`;

    const resultado = ejecutarScript(['crear-bases.mjs'], entornoDe(nombres, { DATABASE_URL_PRUEBAS: url }));

    expect(resultado.estado, resultado.salida).toBe(0);
    expect(filtracionesDeClave(resultado.salida, CLAVE_APP, [USUARIO_APP, servidor.usuario, servidor.base])).toEqual(
      [],
    );
  });
});
