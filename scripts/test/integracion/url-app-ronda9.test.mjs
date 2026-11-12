// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 148 (ataque ronda 9, O1; AMPLIA los criterios 6 y 8 y complementa el 81 y el 143), parte de integracion de `npm run db:crear`
// (`scripts/crear-bases.mjs`): `db:crear` tomaba de `DATABASE_URL_APP` solo el usuario y la contrasena, mientras que el servidor, el puerto y las
// bases que revisa salen de `DATABASE_URL` y `DATABASE_URL_PRUEBAS`; si la URL de la app apuntaba a otra base u otro servidor, aprobaba el rol en una
// base y la API usaba otra. Ahora, con las tres URL validas, `db:crear` termina con codigo 1, antes de abrir ninguna conexion y sin crear ni
// modificar nada (ni el rol ni las bases), si el servidor, el puerto o la base de `DATABASE_URL_APP` no coinciden con los de `DATABASE_URL`
// (el servidor sin distinguir mayusculas y sin resolver nombres: `localhost` y `127.0.0.1` son distintos; el puerto como numero, y la base
// exacta ya decodificada). El mensaje nombra `DATABASE_URL_APP`, `DATABASE_URL` y cada parte que difiere, pide corregir `DATABASE_URL_APP` y no
// contiene la URL ni la contrasena de ninguna de las dos. No se compara con `DATABASE_URL_PRUEBAS` ni el usuario, la contrasena o la cadena de
// consulta: la misma parte principal mas `?sslmode=disable` en `DATABASE_URL_APP` pasa (control).
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
const URL_APP = urlAppDePruebas();
const CLAVE_APP = analizarUrlPostgres(URL_APP, 'DATABASE_URL_APP').clave;
const basesPedidas = [];

afterAll(async () => {
  await borrarBases(servidor, basesPedidas).catch(() => undefined);
});

function parejaNueva() {
  const nombres = nombresTemporales();
  basesPedidas.push(nombres.desarrollo, nombres.pruebas);
  return nombres;
}

/** El otro nombre del mismo servidor: `localhost` si el de las pruebas es `127.0.0.1` y al reves. */
const OTRO_NOMBRE = servidor.host.toLowerCase() === 'localhost' ? '127.0.0.1' : 'localhost';
const OTRO_PUERTO = servidor.puerto === 5433 ? 5434 : 5433;

/** Las tres URL validas para una pareja de bases nuevas; la de la app coincide con `DATABASE_URL` salvo lo que cambie `cambiarApp`. */
function entornoDe(nombres, cambiarApp = (url) => url) {
  const desarrollo = urlDe(servidor, nombres.desarrollo);
  return {
    DATABASE_URL: desarrollo,
    DATABASE_URL_PRUEBAS: urlDe(servidor, nombres.pruebas),
    DATABASE_URL_APP: cambiarApp(urlAppAlineada(URL_APP, desarrollo)),
  };
}

async function existeElRol() {
  const { rows } = await ejecutarSql(
    servidor,
    'postgres',
    `SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${USUARIO_APP}'`,
  );
  return rows.length > 0;
}

/** Edita el nombre del servidor, el puerto o la base de una URL de PostgreSQL (el resto, incluida la cadena de consulta, queda igual). */
function conParte(url, { host, port, base }) {
  const resultado = new URL(url);
  if (host !== undefined) resultado.hostname = host;
  if (port !== undefined) resultado.port = String(port);
  if (base !== undefined) resultado.pathname = `/${base}`;
  return resultado.toString();
}

/**
 * Codigo 1; nombra las dos variables (DATABASE_URL por si sola, no solo dentro de DATABASE_URL_APP) y cada parte; no trae las URL ni las
 * contrasenas; y no creo ninguna de las bases ni el rol (si no existia).
 */
async function esperarFallaCerrada(nombres, resultado, { partes, urlApp, rolAntes }) {
  expect(resultado.estado, resultado.salida).toBe(1);
  expect(resultado.salida, 'la salida debe nombrar DATABASE_URL_APP').toContain('DATABASE_URL_APP');
  expect(resultado.salida, 'la salida debe nombrar DATABASE_URL por si sola').toMatch(/DATABASE_URL(?![A-Z_])/);
  for (const parte of partes) {
    expect(resultado.salida.toLowerCase(), `la salida debe nombrar la parte ${parte}`).toContain(parte);
  }
  expect(resultado.salida, 'la salida no puede traer la URL de la app').not.toContain(urlApp);
  expect(resultado.salida, 'la salida no puede traer la URL de la app codificada').not.toContain(
    encodeURIComponent(urlApp),
  );
  expect(resultado.salida, 'la salida no puede traer la URL de desarrollo').not.toContain(
    urlDe(servidor, nombres.desarrollo),
  );
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
  expect(await existeElRol(), 'db:crear no debia crear ni quitar el rol de la app').toBe(rolAntes);
}

describe('criterio 148: db:crear rechaza una DATABASE_URL_APP con otro servidor, puerto o base que DATABASE_URL', () => {
  it('criterio 148: otra base (/otra_base_r9) termina con codigo 1, nombra las dos variables y la base, y no crea nada', async () => {
    const nombres = parejaNueva();
    const rolAntes = await existeElRol();
    const entorno = entornoDe(nombres, (url) => conParte(url, { base: 'otra_base_r9' }));

    const resultado = ejecutarScript(['crear-bases.mjs'], entorno);

    await esperarFallaCerrada(nombres, resultado, { partes: ['base'], urlApp: entorno.DATABASE_URL_APP, rolAntes });
  });

  it('criterio 148: otro puerto termina con codigo 1, nombra las dos variables y el puerto, y no crea nada', async () => {
    const nombres = parejaNueva();
    const rolAntes = await existeElRol();
    const entorno = entornoDe(nombres, (url) => conParte(url, { port: OTRO_PUERTO }));

    const resultado = ejecutarScript(['crear-bases.mjs'], entorno);

    await esperarFallaCerrada(nombres, resultado, { partes: ['puerto'], urlApp: entorno.DATABASE_URL_APP, rolAntes });
  });

  it('criterio 148: localhost en lugar de 127.0.0.1 (o al reves) termina con codigo 1, nombra las dos variables y el servidor, y no crea nada', async () => {
    const nombres = parejaNueva();
    const rolAntes = await existeElRol();
    const entorno = entornoDe(nombres, (url) => conParte(url, { host: OTRO_NOMBRE }));

    const resultado = ejecutarScript(['crear-bases.mjs'], entorno);

    await esperarFallaCerrada(nombres, resultado, { partes: ['servidor'], urlApp: entorno.DATABASE_URL_APP, rolAntes });
  });

  it('criterio 148: otro servidor, otro puerto y otra base a la vez nombra las tres partes', async () => {
    const nombres = parejaNueva();
    const rolAntes = await existeElRol();
    const entorno = entornoDe(nombres, (url) =>
      conParte(url, { host: OTRO_NOMBRE, port: OTRO_PUERTO, base: 'otra_base_r9' }),
    );

    const resultado = ejecutarScript(['crear-bases.mjs'], entorno);

    await esperarFallaCerrada(nombres, resultado, {
      partes: ['servidor', 'puerto', 'base'],
      urlApp: entorno.DATABASE_URL_APP,
      rolAntes,
    });
  });

  it('criterio 148: el mensaje pide corregir DATABASE_URL_APP', async () => {
    const nombres = parejaNueva();
    const entorno = entornoDe(nombres, (url) => conParte(url, { base: 'otra_base_r9' }));

    const resultado = ejecutarScript(['crear-bases.mjs'], entorno);

    expect(resultado.estado, resultado.salida).toBe(1);
    expect(resultado.salida).toMatch(/corrig/i);
  });

  it('criterio 148: la comprobacion es anterior a la conexion: con DATABASE_URL en un puerto sin servidor, el error es la diferencia y no "No se pudo conectar"', () => {
    const nombres = parejaNueva();
    const desarrollo = `postgresql://aquagestion:${'clave-del-duenio-r9'}@127.0.0.1:1/${nombres.desarrollo}`;
    const entorno = {
      DATABASE_URL: desarrollo,
      DATABASE_URL_PRUEBAS: `postgresql://aquagestion:clave-del-duenio-r9@127.0.0.1:1/${nombres.pruebas}`,
      // El mismo servidor y puerto que DATABASE_URL, pero otra base.
      DATABASE_URL_APP: `postgresql://${USUARIO_APP}:${encodeURIComponent(CLAVE_APP)}@127.0.0.1:1/otra_base_r9`,
    };

    const resultado = ejecutarScript(['crear-bases.mjs'], entorno);

    expect(resultado.estado, resultado.salida).toBe(1);
    expect(resultado.salida).not.toContain('No se pudo conectar');
    expect(resultado.salida).toContain('DATABASE_URL_APP');
    expect(resultado.salida.toLowerCase()).toContain('base');
    expect(resultado.salida).not.toContain('clave-del-duenio-r9');
  });

  it('criterio 148: no se compara con DATABASE_URL_PRUEBAS: una URL de la app con la base de pruebas pero distinta de la de DATABASE_URL se rechaza igual', async () => {
    const nombres = parejaNueva();
    const rolAntes = await existeElRol();
    const entorno = entornoDe(nombres, (url) => conParte(url, { base: nombres.pruebas }));

    const resultado = ejecutarScript(['crear-bases.mjs'], entorno);

    await esperarFallaCerrada(nombres, resultado, { partes: ['base'], urlApp: entorno.DATABASE_URL_APP, rolAntes });
  });
});

describe('criterio 148: lo que no se compara', () => {
  it('criterio 148 (control): la misma parte principal que DATABASE_URL mas ?sslmode=disable en DATABASE_URL_APP pasa', async (contexto) => {
    // db:crear necesita que el rol de la app ya exista (lo crea el entorno: Docker, la CI o el hook de la nube) o poder crearlo.
    if (!(await existeElRol())) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = parejaNueva();
    const entorno = entornoDe(nombres, (url) => `${url}?sslmode=disable`);

    const resultado = ejecutarScript(['crear-bases.mjs'], entorno);

    expect(resultado.estado, resultado.salida).toBe(0);
    expect(resultado.salida).toContain(`Base creada: ${nombres.desarrollo}`);
    expect(resultado.salida).toContain(`Base creada: ${nombres.pruebas}`);
    expect(
      filtracionesDeClave(resultado.salida, CLAVE_APP, [USUARIO_APP, servidor.usuario, servidor.base]),
      'la salida muestra la contrasena de la app',
    ).toEqual([]);
  });

  it('criterio 148 (control): sin puerto en DATABASE_URL_APP frente a :5432 en DATABASE_URL (o al reves) coincide y pasa', async (contexto) => {
    if (servidor.puerto !== 5432) contexto.skip('el servidor de pruebas no usa el puerto por defecto');
    if (!(await existeElRol())) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = parejaNueva();
    // DATABASE_URL con el puerto explicito y la URL de la app sin puerto (el 5432 por defecto).
    const entorno = entornoDe(nombres, (url) => {
      const resultado = new URL(url);
      resultado.port = '';
      return resultado.toString();
    });
    expect(new URL(entorno.DATABASE_URL_APP).port, 'premisa: la URL de la app no lleva puerto').toBe('');
    expect(new URL(entorno.DATABASE_URL).port, 'premisa: DATABASE_URL lleva puerto').toBe('5432');

    const resultado = ejecutarScript(['crear-bases.mjs'], entorno);

    expect(resultado.estado, resultado.salida).toBe(0);
  });

  it('criterio 148 (control): una base codificada en DATABASE_URL_APP que decodifica igual que la de DATABASE_URL coincide y pasa', async (contexto) => {
    if (!(await existeElRol())) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = parejaNueva();
    // `aqua_tmp_x` -> `aqua%5Ftmp_x`: la misma base escrita con el guion bajo codificado.
    const entorno = entornoDe(nombres, (url) => {
      const resultado = new URL(url);
      resultado.pathname = `/${nombres.desarrollo.replace('_', '%5F')}`;
      return resultado.toString();
    });
    expect(entorno.DATABASE_URL_APP, 'premisa: la base va codificada').toContain('%5F');

    const resultado = ejecutarScript(['crear-bases.mjs'], entorno);

    expect(resultado.estado, resultado.salida).toBe(0);
  });
});
