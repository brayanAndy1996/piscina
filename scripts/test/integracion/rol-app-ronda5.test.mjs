// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterios 123 y 125 (ataque ronda 5), parte de integracion de `npm run db:crear` (`scripts/crear-bases.mjs`):
//  - 123: la comprobacion del rol (en `db:crear`, sobre la base de desarrollo y la de pruebas) rechaza el rol `aquagestion_app` si es
//    duenio de cualquier esquema de la base, si tiene CREATE sobre cualquier esquema (concedido al rol o a PUBLIC) o si existe en la
//    base un esquema con su nombre. `db:crear` termina con codigo 1 con un mensaje que nombra el esquema, la condicion y la correccion
//    (`REVOKE CREATE ON SCHEMA <esquema> FROM aquagestion_app;` o `... FROM PUBLIC;`, `ALTER SCHEMA <esquema> OWNER TO <dueno>;`, o
//    renombrar o eliminar el esquema `aquagestion_app`), sin modificar nada. USAGE sobre otros esquemas no se rechaza. Los casos que
//    crean un esquema propiedad del rol (`CREATE SCHEMA ... AUTHORIZATION aquagestion_app`) exigen superusuario y se omiten con
//    aviso en la nube.
//  - 125: un `GRANT SELECT` sobre una vista materializada (`mv_prueba`) o sobre una vista con `security_invoker = true`
//    (`v_prueba`) hace que `db:crear` termine con codigo 1 nombrando el objeto y el privilegio, sin modificar nada.
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
const CLAVE_APP_QUE_NO_DEBE_SALIR = 'clave-app-que-no-debe-salir-ronda5';
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
let esSuperusuario = false;

beforeAll(async () => {
  const [fila] = await consultar('SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user');
  esSuperusuario = fila.rolsuper;
  existeElRolApp =
    (await consultar('SELECT 1 AS ok FROM pg_catalog.pg_roles WHERE rolname = $1', [USUARIO_APP])).length > 0;
  if (!esSuperusuario) {
    console.warn(
      '[criterio 123] AVISO: el usuario de las pruebas no es superusuario (nube); el caso CREATE SCHEMA ... AUTHORIZATION aquagestion_app se omite. Corre en Docker y en la CI.',
    );
  }
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
    // Criterio 148 (ataque ronda 9): la base de la URL de la app es la de DATABASE_URL del caso.
    DATABASE_URL_APP: `postgresql://${USUARIO_APP}:${encodeURIComponent(CLAVE_APP_QUE_NO_DEBE_SALIR)}@${servidor.host}:${servidor.puerto}/${nombres.desarrollo}`,
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

async function appPuedeCrearEn(base, esquema) {
  const [fila] = await ejecutarSql(
    servidor,
    base,
    `SELECT pg_catalog.has_schema_privilege('${USUARIO_APP}', '${esquema}', 'CREATE') AS tiene`,
  ).then((resultado) => resultado.rows);
  return fila.tiene;
}

async function existeElEsquema(base, esquema) {
  const { rowCount } = await ejecutarSql(
    servidor,
    base,
    `SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = '${esquema}'`,
  );
  return rowCount > 0;
}

function omitirSinRol(contexto) {
  if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
}

describe('criterio 123: db:crear rechaza esquemas propios, con CREATE o con el nombre del rol', () => {
  it('criterio 123 (control): con un esquema de mas pero solo con USAGE para la app, db:crear termina con codigo 0', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE SCHEMA trampa');
    await ejecutarSql(servidor, nombres.pruebas, `GRANT USAGE ON SCHEMA trampa TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });

  it('criterio 123: CREATE concedido a la app sobre un esquema termina con codigo 1 y propone REVOKE CREATE ON SCHEMA trampa FROM aquagestion_app;', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE SCHEMA trampa');
    await ejecutarSql(servidor, nombres.pruebas, `GRANT CREATE ON SCHEMA trampa TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('trampa');
    expect(resultado.salida).toContain('CREATE');
    expect(resultado.salida).toContain('REVOKE CREATE ON SCHEMA trampa FROM aquagestion_app;');
    expect(await appPuedeCrearEn(nombres.pruebas, 'trampa'), 'db:crear no debia modificar nada').toBe(true);
  });

  it('criterio 123: CREATE concedido a PUBLIC sobre un esquema termina con codigo 1 y propone REVOKE CREATE ON SCHEMA trampa FROM PUBLIC;', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE SCHEMA trampa');
    await ejecutarSql(servidor, nombres.pruebas, 'GRANT CREATE ON SCHEMA trampa TO PUBLIC');

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('trampa');
    expect(resultado.salida).toContain('REVOKE CREATE ON SCHEMA trampa FROM PUBLIC;');
    expect(await appPuedeCrearEn(nombres.pruebas, 'trampa'), 'db:crear no debia modificar nada').toBe(true);
  });

  it('criterio 123: el mismo CREATE en la base de desarrollo tambien se rechaza', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.desarrollo, 'CREATE SCHEMA extension_ajena');
    await ejecutarSql(servidor, nombres.desarrollo, `GRANT CREATE ON SCHEMA extension_ajena TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('extension_ajena');
    expect(resultado.salida).toContain('REVOKE CREATE ON SCHEMA extension_ajena FROM aquagestion_app;');
  });

  it('criterio 123: un esquema con el nombre del rol (aquagestion_app), sin conceder nada, termina con codigo 1 y propone renombrarlo o eliminarlo', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, `CREATE SCHEMA ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain(USUARIO_APP);
    expect(resultado.salida).toMatch(/renombr|elimin|rename|drop schema/i);
    expect(await existeElEsquema(nombres.pruebas, USUARIO_APP), 'db:crear no debia modificar nada').toBe(true);
  });

  it('criterio 123: un esquema propiedad del rol (CREATE SCHEMA otro AUTHORIZATION aquagestion_app) termina con codigo 1 y propone ALTER SCHEMA otro OWNER TO', async (contexto) => {
    omitirSinRol(contexto);
    if (!esSuperusuario)
      contexto.skip('exige superusuario (CREATE SCHEMA ... AUTHORIZATION): corre en Docker y en la CI');
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, `CREATE SCHEMA otro AUTHORIZATION ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('otro');
    expect(resultado.salida).toContain('ALTER SCHEMA otro OWNER TO');
  });
});

describe('criterio 125: db:crear rechaza privilegios sobre vistas y vistas materializadas', () => {
  it('criterio 125: SELECT sobre una vista materializada (mv_prueba) termina con codigo 1 nombrando el objeto y el privilegio', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE academias (id uuid, nombre text)');
    await ejecutarSql(
      servidor,
      nombres.pruebas,
      'CREATE MATERIALIZED VIEW mv_prueba AS SELECT id, nombre FROM academias',
    );
    await ejecutarSql(servidor, nombres.pruebas, `GRANT SELECT ON mv_prueba TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('mv_prueba');
    expect(resultado.salida).toContain('SELECT');
    const [fila] = await ejecutarSql(
      servidor,
      nombres.pruebas,
      `SELECT pg_catalog.has_table_privilege('${USUARIO_APP}', 'public.mv_prueba', 'SELECT') AS tiene`,
    ).then((r) => r.rows);
    expect(fila.tiene, 'db:crear no debia modificar nada').toBe(true);
  });

  it('criterio 125: SELECT sobre una vista con security_invoker = true (v_prueba) termina con codigo 1 nombrando el objeto y el privilegio', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE academias (id uuid, nombre text)');
    await ejecutarSql(
      servidor,
      nombres.pruebas,
      'CREATE VIEW v_prueba WITH (security_invoker = true) AS SELECT id FROM academias',
    );
    await ejecutarSql(servidor, nombres.pruebas, `GRANT SELECT ON v_prueba TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('v_prueba');
    expect(resultado.salida).toContain('SELECT');
  });

  it('criterio 125: el mismo privilegio en la base de desarrollo tambien se rechaza', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.desarrollo, 'CREATE TABLE academias (id uuid, nombre text)');
    await ejecutarSql(
      servidor,
      nombres.desarrollo,
      'CREATE MATERIALIZED VIEW mv_prueba AS SELECT id, nombre FROM academias',
    );
    await ejecutarSql(servidor, nombres.desarrollo, `GRANT SELECT ON mv_prueba TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('mv_prueba');
  });

  it('criterio 125 (control): una vista materializada sin privilegios para la app no se rechaza', async (contexto) => {
    omitirSinRol(contexto);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE academias (id uuid, nombre text)');
    await ejecutarSql(
      servidor,
      nombres.pruebas,
      'CREATE MATERIALIZED VIEW mv_prueba AS SELECT id, nombre FROM academias',
    );

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });
});
