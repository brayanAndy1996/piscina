// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 130 (ataque ronda 6, F1 (a) y (c); amplia los criterios 102 y 123), parte de integracion de `npm run db:crear`
// (`scripts/crear-bases.mjs`): la comprobacion del rol (sobre la base de desarrollo y la de pruebas) calcula los privilegios efectivos de
// `aquagestion_app` (concedidos al rol, heredados o a `PUBLIC`) en todos los esquemas revisados, sin los objetos de extensiones, y rechaza
// cualquiera de mas: de tabla, columna o secuencia en un esquema que no es `public`; `EXECUTE` sobre una funcion de `public` que no esta
// en `FUNCIONES_APP` (tambien una funcion nueva con el `EXECUTE` por defecto de `PUBLIC`); y `USAGE` sobre un esquema con relaciones o
// funciones propias. `db:crear` termina con codigo 1 con un mensaje que nombra el esquema, el objeto y el privilegio y la correccion
// (`REVOKE SELECT ON reportes.auditoria_todas FROM aquagestion_app;` o `... FROM PUBLIC;`, `REVOKE EXECUTE ON FUNCTION
// <esquema>.<nombre>(<argumentos>) FROM PUBLIC;`, `REVOKE USAGE ON SCHEMA <esquema> FROM aquagestion_app;` o `... FROM PUBLIC;`), sin
// modificar nada. Casos 1 y 2 de la especificacion (el ataque con la app y con PUBLIC) y, ademas, la funcion nueva de `public`, el `USAGE`
// sobre un esquema con una tabla y los controles que pasan. Las bases son temporales: cada caso crea y borra las suyas. No se modifica el
// rol compartido `aquagestion_app` (solo se conceden privilegios sobre objetos de las bases temporales, que se borran).
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
const CLAVE_APP_QUE_NO_DEBE_SALIR = 'clave-app-que-no-debe-salir-ronda6';
const basesCreadas = [];

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

/** Pareja de bases temporales, creadas aqui con el usuario de las pruebas como dueno. */
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

/** Resultado esperado: codigo 1, sin la contrasena de la app ni la del servidor. */
function esperarRechazo(resultado) {
  expect(resultado.estado, resultado.salida).toBe(1);
  expect(resultado.salida).not.toContain(CLAVE_APP_QUE_NO_DEBE_SALIR);
  expect(
    filtracionesDeLaClaveDelServidor(resultado.salida, servidor),
    'la salida muestra la contrasena del servidor',
  ).toEqual([]);
}

function omitirSinRol(contexto) {
  if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
}

async function ejecutar(base, sentencias) {
  for (const sentencia of sentencias) await ejecutarSql(servidor, base, sentencia);
}

/** El ataque de la especificacion: un esquema `reportes` con una vista de `auditoria`, visible para `destinatario`. */
const elAtaque = (destinatario) => [
  'CREATE TABLE auditoria (id uuid, academia_id uuid)',
  'CREATE SCHEMA reportes',
  `GRANT USAGE ON SCHEMA reportes TO ${destinatario}`,
  'CREATE VIEW reportes.auditoria_todas AS SELECT * FROM public.auditoria',
  `GRANT SELECT ON reportes.auditoria_todas TO ${destinatario}`,
];

async function appPuedeLeer(base, objeto) {
  const { rows } = await ejecutarSql(
    servidor,
    base,
    `SELECT pg_catalog.has_table_privilege('${USUARIO_APP}', '${objeto}', 'SELECT') AS tiene`,
  );
  return rows[0].tiene;
}

describe('criterio 130: db:crear rechaza privilegios de mas fuera de public', () => {
  it('criterio 130 (caso 1): reportes.auditoria_todas con USAGE y SELECT para la app termina con codigo 1 y propone los REVOKE', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutar(nombres.pruebas, elAtaque(USUARIO_APP));

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('reportes');
    expect(resultado.salida).toContain('auditoria_todas');
    expect(resultado.salida).toContain('SELECT');
    expect(resultado.salida).toContain('REVOKE SELECT ON reportes.auditoria_todas FROM aquagestion_app;');
    expect(resultado.salida).toContain('REVOKE USAGE ON SCHEMA reportes FROM aquagestion_app;');
    expect(await appPuedeLeer(nombres.pruebas, 'reportes.auditoria_todas'), 'db:crear no debia modificar nada').toBe(
      true,
    );
  });

  it('criterio 130 (caso 2): lo mismo con USAGE y SELECT concedidos a PUBLIC propone REVOKE ... FROM PUBLIC;', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutar(nombres.pruebas, elAtaque('PUBLIC'));

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('reportes');
    expect(resultado.salida).toContain('auditoria_todas');
    expect(resultado.salida).toContain('REVOKE SELECT ON reportes.auditoria_todas FROM PUBLIC;');
    expect(resultado.salida).toContain('REVOKE USAGE ON SCHEMA reportes FROM PUBLIC;');
    expect(resultado.salida).not.toContain('REVOKE SELECT ON reportes.auditoria_todas FROM aquagestion_app;');
    expect(await appPuedeLeer(nombres.pruebas, 'reportes.auditoria_todas'), 'db:crear no debia modificar nada').toBe(
      true,
    );
  });

  it('criterio 130: el mismo ataque en la base de desarrollo tambien se rechaza', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutar(nombres.desarrollo, elAtaque(USUARIO_APP));

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('reportes');
    expect(resultado.salida).toContain('auditoria_todas');
    expect(resultado.salida).toContain('REVOKE SELECT ON reportes.auditoria_todas FROM aquagestion_app;');
  });

  it('criterio 130: una tabla de otro esquema con GRANT SELECT (id) y sin USAGE termina con codigo 1 nombrando la columna', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutar(nombres.pruebas, [
      'CREATE SCHEMA reportes',
      'CREATE TABLE reportes.t (id int)',
      `GRANT SELECT (id) ON reportes.t TO ${USUARIO_APP}`,
    ]);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('reportes');
    expect(resultado.salida).toContain('id');
    expect(resultado.salida).toContain('SELECT');
  });

  it('criterio 130: una funcion nueva de public con el EXECUTE por defecto termina con codigo 1 y propone REVOKE EXECUTE ... FROM PUBLIC;', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutar(nombres.pruebas, ["CREATE FUNCTION public.funcion_extra() RETURNS int LANGUAGE sql AS 'SELECT 1'"]);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('funcion_extra');
    expect(resultado.salida).toContain('EXECUTE');
    expect(resultado.salida).toContain('REVOKE EXECUTE ON FUNCTION public.funcion_extra() FROM PUBLIC;');
  });

  it('criterio 130: USAGE sobre un esquema con una tabla sin privilegios para la app termina con codigo 1 y propone REVOKE USAGE ON SCHEMA', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutar(nombres.pruebas, [
      'CREATE SCHEMA reportes',
      'CREATE TABLE reportes.t (id int)',
      `GRANT USAGE ON SCHEMA reportes TO ${USUARIO_APP}`,
    ]);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('reportes');
    expect(resultado.salida).toContain('USAGE');
    expect(resultado.salida).toContain('REVOKE USAGE ON SCHEMA reportes FROM aquagestion_app;');
  });
});

describe('criterio 130: controles de db:crear que pasan', () => {
  it('criterio 130 (control): la funcion nueva de public despues de REVOKE EXECUTE ... FROM PUBLIC termina con codigo 0', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutar(nombres.pruebas, [
      "CREATE FUNCTION public.funcion_extra() RETURNS int LANGUAGE sql AS 'SELECT 1'",
      'REVOKE EXECUTE ON FUNCTION public.funcion_extra() FROM PUBLIC',
    ]);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });

  it('criterio 130 (control): reportes con una funcion y sin USAGE para la app ni para PUBLIC termina con codigo 0', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutar(nombres.pruebas, [
      'CREATE SCHEMA reportes',
      "CREATE FUNCTION reportes.f() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    ]);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });

  it('criterio 130 (control): USAGE sobre un esquema vacio termina con codigo 0 (criterio 123)', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutar(nombres.pruebas, ['CREATE SCHEMA reportes', `GRANT USAGE ON SCHEMA reportes TO ${USUARIO_APP}`]);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });

  it('criterio 130 (control): USAGE sobre un esquema que solo tiene objetos de una extension (pgcrypto) termina con codigo 0', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    try {
      await ejecutar(nombres.pruebas, ['CREATE SCHEMA ext_prueba', 'CREATE EXTENSION pgcrypto SCHEMA ext_prueba']);
    } catch (error) {
      if (error && (error.code === '42501' || error.code === '0A000')) {
        console.warn(
          '[criterio 130] AVISO: el usuario de las pruebas no puede instalar pgcrypto; el control de la extension se omite.',
        );
        contexto.skip('no se puede instalar pgcrypto');
      }
      throw error;
    }
    await ejecutar(nombres.pruebas, [`GRANT USAGE ON SCHEMA ext_prueba TO ${USUARIO_APP}`]);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });
});
