// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 141 (ataque ronda 8, F1; AJUSTA la definicion de "esquemas revisados" de la seccion O y los criterios 130 y 137), parte de
// integracion de `npm run db:crear` (`scripts/crear-bases.mjs`, `problemasDePrivilegiosEnEsquemas`): la comprobacion del rol ya no descarta
// ENTERO un esquema que pertenece a una extension. Esquemas revisados son todos los de `pg_namespace` salvo `pg_catalog`,
// `information_schema`, `pg_toast` y los temporales; lo unico que se excluye es el objeto de extension (relacion con sus columnas,
// secuencia o funcion con su propia fila `deptype = 'e'`; un tipo compuesto cuenta si su tipo lo es). En un esquema de extension valen las
// reglas del criterio 130: un privilegio de tabla, de columna o de secuencia sobre una relacion propia es de mas, `EXECUTE` sobre una
// funcion propia de un esquema con `USAGE` tambien, y `USAGE` sobre el esquema se rechaza si contiene alguna relacion o funcion propia
// (aunque la app no tenga privilegios sobre ella) y se permite si esta vacio o solo tiene objetos de extension. `db:crear` termina con
// codigo 1 nombrando `reportes2.t`, el privilegio y la correccion (`REVOKE SELECT ON reportes2.t FROM aquagestion_app;`, `REVOKE USAGE ON
// SCHEMA reportes2 FROM aquagestion_app;` o `... FROM PUBLIC;`), sin modificar nada. Para un mismo estado de la base, la API y `db:crear`
// deciden lo mismo (los mismos casos de la API estan en `backend/test/integracion/aislamiento/privilegios-esquema-extension.test.ts`).
//
// Preparacion (en cada base temporal), como duenio no superusuario o superusuario: `CREATE EXTENSION pgcrypto SCHEMA public` (extension de
// confianza). Si no se puede instalar, los casos se omiten con aviso (corren en Docker y en la CI). Casos:
//   1. el ataque: `CREATE SCHEMA reportes2`, `ALTER EXTENSION pgcrypto ADD SCHEMA reportes2`, `CREATE TABLE reportes2.t (academia_id uuid,
//      dato text)` sin RLS con una fila de A y una de B, `GRANT USAGE ON SCHEMA reportes2` y `GRANT SELECT ON reportes2.t` a la app;
//   2. lo mismo con `USAGE` y `SELECT` concedidos a `PUBLIC`;
//   3. `USAGE` sobre `reportes2` con la tabla y sin ningun privilegio sobre ella;
//   4. control que pasa: `ext_r8` con una funcion `ext_r8.f()` y un tipo compuesto `ext_r8.par AS (a int)` agregados a la extension, y
//      `USAGE` para la app: codigo 0 y la salida no nombra `ext_r8` ni propone ningun `REVOKE`.
// Las bases son temporales: cada caso crea y borra las suyas. No se modifica el rol compartido `aquagestion_app` (solo se conceden
// privilegios sobre objetos de las bases temporales, que se borran).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USUARIO_APP } from '../../lib/entorno.mjs';
import {
  borrarBases,
  ejecutarScript,
  ejecutarSql,
  filtracionesDeLaClaveDelServidor,
  nombresTemporales,
  servidorDePruebas,
  urlDe,
} from './ayuda.mjs';

const servidor = servidorDePruebas();
const CLAVE_APP_QUE_NO_DEBE_SALIR = 'clave-app-que-no-debe-salir-ronda8';
const basesCreadas = [];

/** Codigos de PostgreSQL por los que una extension no se puede instalar aqui: sin permiso, no disponible, sin archivo, ya existe. */
const SIN_INSTALAR = ['42501', '0A000', '58P01', '42710'];
const EXTENSION = 'pgcrypto';

async function conectar() {
  const cliente = new pg.Client({
    host: servidor.host,
    port: servidor.puerto,
    user: servidor.usuario,
    password: servidor.clave,
    database: 'postgres',
  });
  await cliente.connect();
  return cliente;
}

async function consultar(sql, parametros = []) {
  const cliente = await conectar();
  try {
    return (await cliente.query(sql, parametros)).rows;
  } finally {
    await cliente.end();
  }
}

let existeElRolApp = false;

beforeAll(async () => {
  existeElRolApp =
    (await consultar('SELECT 1 AS ok FROM pg_catalog.pg_roles WHERE rolname = $1', [USUARIO_APP])).length > 0;
});

afterAll(async () => {
  await borrarBases(servidor, basesCreadas).catch(() => undefined);
});

/** Pareja de bases temporales, creadas aqui con el usuario de las pruebas como duenio. */
async function crearPareja() {
  const nombres = nombresTemporales();
  basesCreadas.push(nombres.desarrollo, nombres.pruebas);
  await consultar(`CREATE DATABASE "${nombres.desarrollo}"`);
  await consultar(`CREATE DATABASE "${nombres.pruebas}"`);
  return nombres;
}

function ejecutarDbCrear(nombres) {
  return ejecutarScript(['crear-bases.mjs'], {
    DATABASE_URL: urlDe(servidor, nombres.desarrollo),
    DATABASE_URL_PRUEBAS: urlDe(servidor, nombres.pruebas),
    DATABASE_URL_APP: `postgresql://${USUARIO_APP}:${encodeURIComponent(CLAVE_APP_QUE_NO_DEBE_SALIR)}@${servidor.host}:${servidor.puerto}/aquagestion`,
  });
}

async function ejecutar(base, sentencias) {
  for (const sentencia of sentencias) await ejecutarSql(servidor, base, sentencia);
}

/** Codigo 1, sin la contrasena de la app ni la del servidor. */
function esperarRechazo(resultado) {
  expect(resultado.estado, resultado.salida).toBe(1);
  expect(resultado.salida).not.toContain(CLAVE_APP_QUE_NO_DEBE_SALIR);
  expect(
    filtracionesDeLaClaveDelServidor(resultado.salida, servidor),
    'la salida muestra la contrasena del servidor',
  ).toEqual([]);
}

let avisado = false;

/**
 * Instala la extension en `public` de la base. Devuelve `true`, o `false` (y avisa una vez) si el duenio no puede instalarla; entonces el
 * caso se omite.
 */
async function instalarExtension(base) {
  try {
    await ejecutarSql(servidor, base, `CREATE EXTENSION ${EXTENSION} SCHEMA public`);
    return true;
  } catch (error) {
    if (!(error && SIN_INSTALAR.includes(error.code))) throw error;
    if (!avisado) {
      avisado = true;
      console.warn(
        `[criterio 141] AVISO: el duenio no puede instalar ${EXTENSION} en una base temporal; los casos se omiten. Corren en Docker y en la CI.`,
      );
    }
    return false;
  }
}

/** Pareja de bases con el rol de la app y la extension instalada en la base indicada, o se omite el caso. */
async function prepararConExtension(contexto, donde = 'pruebas') {
  if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
  const nombres = await crearPareja();
  const base = nombres[donde];
  if (!(await instalarExtension(base))) contexto.skip(`el duenio no puede instalar ${EXTENSION}`);
  return { nombres, base };
}

/** El ataque de la especificacion (caso 1), con una fila de cada academia, visible para `destinatario`. */
const elAtaque = (destinatario) => [
  'CREATE SCHEMA reportes2',
  `ALTER EXTENSION ${EXTENSION} ADD SCHEMA reportes2`,
  'CREATE TABLE reportes2.t (academia_id uuid, dato text)',
  "INSERT INTO reportes2.t (academia_id, dato) VALUES (gen_random_uuid(), 'de A'), (gen_random_uuid(), 'de B')",
  `GRANT USAGE ON SCHEMA reportes2 TO ${destinatario}`,
  `GRANT SELECT ON reportes2.t TO ${destinatario}`,
];

/** El control del caso 4: `ext_r8` con una funcion y un tipo compuesto, los dos agregados a la extension. */
const elControl = [
  'CREATE SCHEMA ext_r8',
  `ALTER EXTENSION ${EXTENSION} ADD SCHEMA ext_r8`,
  "CREATE FUNCTION ext_r8.f() RETURNS int LANGUAGE sql AS 'SELECT 1'",
  'CREATE TYPE ext_r8.par AS (a int)',
  `ALTER EXTENSION ${EXTENSION} ADD FUNCTION ext_r8.f()`,
  `ALTER EXTENSION ${EXTENSION} ADD TYPE ext_r8.par`,
];

async function appPuedeLeer(base, objeto) {
  const { rows } = await ejecutarSql(
    servidor,
    base,
    `SELECT pg_catalog.has_table_privilege('${USUARIO_APP}', '${objeto}', 'SELECT') AS tiene`,
  );
  return rows[0].tiene;
}

describe('criterio 141: db:crear rechaza privilegios de mas en un esquema que pertenece a una extension', () => {
  it('criterio 141 (caso 1): el ataque en la base de pruebas termina con codigo 1, nombra reportes2.t y SELECT y propone los REVOKE, sin modificar nada', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, elAtaque(USUARIO_APP));

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('reportes2.t');
    expect(resultado.salida).toContain('SELECT');
    expect(resultado.salida).toContain('REVOKE SELECT ON reportes2.t FROM aquagestion_app;');
    expect(resultado.salida).toContain('REVOKE USAGE ON SCHEMA reportes2 FROM aquagestion_app;');
    expect(await appPuedeLeer(base, 'reportes2.t'), 'db:crear no debia modificar nada').toBe(true);
  });

  it('criterio 141 (caso 1): el mismo ataque en la base de desarrollo tambien se rechaza', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto, 'desarrollo');
    await ejecutar(base, elAtaque(USUARIO_APP));

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('reportes2.t');
    expect(resultado.salida).toContain('REVOKE SELECT ON reportes2.t FROM aquagestion_app;');
  });

  it('criterio 141 (caso 2): lo mismo con USAGE y SELECT concedidos a PUBLIC propone REVOKE ... FROM PUBLIC;', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, elAtaque('PUBLIC'));

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('reportes2.t');
    expect(resultado.salida).toContain('SELECT');
    expect(resultado.salida).toContain('REVOKE SELECT ON reportes2.t FROM PUBLIC;');
    expect(resultado.salida).toContain('REVOKE USAGE ON SCHEMA reportes2 FROM PUBLIC;');
    expect(resultado.salida).not.toContain('REVOKE SELECT ON reportes2.t FROM aquagestion_app;');
    expect(await appPuedeLeer(base, 'reportes2.t'), 'db:crear no debia modificar nada').toBe(true);
  });

  it('criterio 141 (caso 3): USAGE sobre reportes2 con la tabla y sin ningun privilegio sobre ella termina con codigo 1 y propone REVOKE USAGE ON SCHEMA', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, [
      'CREATE SCHEMA reportes2',
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA reportes2`,
      'CREATE TABLE reportes2.t (academia_id uuid, dato text)',
      `GRANT USAGE ON SCHEMA reportes2 TO ${USUARIO_APP}`,
    ]);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('reportes2');
    expect(resultado.salida).toContain('USAGE');
    expect(resultado.salida).toContain('REVOKE USAGE ON SCHEMA reportes2 FROM aquagestion_app;');
  });

  it('criterio 141 (caso 4, control): ext_r8 con una funcion y un tipo compuesto de la extension y USAGE para la app termina con codigo 0 sin nombrar ext_r8 ni proponer REVOKE', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, [...elControl, `GRANT USAGE ON SCHEMA ext_r8 TO ${USUARIO_APP}`]);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
    expect(resultado.salida, 'la salida nombra el esquema de extension').not.toContain('ext_r8');
    expect(resultado.salida, 'la salida propone un REVOKE').not.toMatch(/REVOKE/);
  });

  it('criterio 141 (caso 4, control): lo mismo en la base de desarrollo y con USAGE concedido a PUBLIC termina con codigo 0', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto, 'desarrollo');
    await ejecutar(base, [...elControl, 'GRANT USAGE ON SCHEMA ext_r8 TO PUBLIC']);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
    expect(resultado.salida).not.toContain('ext_r8');
    expect(resultado.salida).not.toMatch(/REVOKE/);
  });

  it('criterio 141: reportes2 vacio, agregado a la extension y con USAGE para la app, termina con codigo 0', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, [
      'CREATE SCHEMA reportes2',
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA reportes2`,
      `GRANT USAGE ON SCHEMA reportes2 TO ${USUARIO_APP}`,
    ]);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
    expect(resultado.salida).not.toMatch(/REVOKE/);
  });

  it('criterio 141: una tabla agregada a la extension dentro de reportes2, con SELECT para la app, es objeto de extension y no se informa', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, [
      'CREATE SCHEMA reportes2',
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA reportes2`,
      'CREATE TABLE reportes2.t_ext (academia_id uuid, dato text)',
      `ALTER EXTENSION ${EXTENSION} ADD TABLE reportes2.t_ext`,
      `GRANT USAGE ON SCHEMA reportes2 TO ${USUARIO_APP}`,
      `GRANT SELECT ON reportes2.t_ext TO ${USUARIO_APP}`,
    ]);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
    expect(resultado.salida).not.toContain('t_ext');
    expect(resultado.salida).not.toMatch(/REVOKE/);
  });

  it('criterio 141: un SELECT de columna sobre la tabla propia de reportes2 termina con codigo 1 nombrando la columna', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, [
      'CREATE SCHEMA reportes2',
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA reportes2`,
      'CREATE TABLE reportes2.t (academia_id uuid, dato text)',
      `GRANT SELECT (dato) ON reportes2.t TO ${USUARIO_APP}`,
    ]);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('reportes2');
    expect(resultado.salida).toContain('dato');
    expect(resultado.salida).toContain('SELECT');
  });

  it('criterio 141: una funcion propia de reportes2 (con el EXECUTE por defecto) y USAGE para la app termina con codigo 1 y propone REVOKE EXECUTE ... FROM PUBLIC;', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, [
      'CREATE SCHEMA reportes2',
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA reportes2`,
      "CREATE FUNCTION reportes2.funcion_propia_r8() RETURNS int LANGUAGE sql AS 'SELECT 1'",
      `GRANT USAGE ON SCHEMA reportes2 TO ${USUARIO_APP}`,
    ]);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('funcion_propia_r8');
    expect(resultado.salida).toContain('EXECUTE');
    expect(resultado.salida).toContain('REVOKE EXECUTE ON FUNCTION reportes2.funcion_propia_r8() FROM PUBLIC;');
  });

  it('criterio 141 (control): un esquema de extension con una tabla propia sin USAGE ni privilegios para la app ni para PUBLIC termina con codigo 0', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, [
      'CREATE SCHEMA reportes2',
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA reportes2`,
      'CREATE TABLE reportes2.t (academia_id uuid, dato text)',
    ]);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });

  it('criterio 141 (control): despues de quitar el esquema del ataque de la extension y borrarlo, db:crear termina con codigo 0', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, [
      ...elAtaque(USUARIO_APP),
      `ALTER EXTENSION ${EXTENSION} DROP SCHEMA reportes2`,
      'DROP SCHEMA reportes2 CASCADE',
    ]);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });
});
