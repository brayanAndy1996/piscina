// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 137 (ataque ronda 7, F1; AJUSTA el alcance del criterio 102 y precisa el 130), parte de integracion de `npm run db:crear`
// (`scripts/crear-bases.mjs`): ninguna comprobacion de privilegios de la app (criterios 102, 125 y 130), ni en la API ni en `db:crear`,
// cuenta un objeto de extension (fila de `pg_depend` con `deptype = 'e'` hacia `pg_extension`) en ningun esquema, INCLUIDO `public`: ni
// la relacion ni sus columnas. `db:crear` no nombra esos objetos como problema ni propone `REVOKE` sobre ellos; un privilegio de mas sobre
// un objeto que no es de extension se sigue rechazando, en `public` y en los demas esquemas, aunque haya extensiones instaladas. Para un
// mismo estado de la base, la API rechaza por privilegios si y solo si `db:crear` informa al menos un privilegio de mas (los mismos casos
// de la API estan en `backend/test/integracion/aislamiento/privilegios-extensiones.test.ts`).
//
// Preparacion (en cada base temporal): como superusuario, `CREATE EXTENSION pg_stat_statements SCHEMA public` (Docker y CI; concede
// `SELECT` a `PUBLIC` sobre sus vistas); si no se puede, una extension de confianza (`pgcrypto`) en `public`. En los dos casos, una vista
// propia `public.vista_de_extension AS SELECT 1 AS x` con `GRANT SELECT ... TO PUBLIC`, agregada a la extension con
// `ALTER EXTENSION ... ADD VIEW`. Si no se puede instalar ninguna, los casos se omiten con aviso. Entonces:
//   1. con la extension instalada, `db:crear` (sobre la base de pruebas y sobre la de desarrollo) termina con codigo 0 y no nombra ningun
//      objeto de la extension ni propone un `REVOKE` sobre el;
//   2. control, con la extension todavia instalada: `CREATE VIEW public.vista_extra AS SELECT 1 AS x` y `GRANT SELECT ON public.vista_extra
//      TO PUBLIC`: `db:crear` termina con codigo 1 nombrando `vista_extra` y `REVOKE SELECT ON vista_extra FROM PUBLIC;` (la forma de la
//      correccion del criterio 102);
//   3. control: `GRANT TRUNCATE ON auditoria TO aquagestion_app` con la extension instalada: termina con codigo 1.
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
const CLAVE_APP_QUE_NO_DEBE_SALIR = 'clave-app-que-no-debe-salir-ronda7';
const basesCreadas = [];

/** Codigos de PostgreSQL por los que una extension no se puede instalar aqui: sin permiso, no disponible, sin archivo, ya existe. */
const SIN_INSTALAR = ['42501', '0A000', '58P01', '42710'];
const CANDIDATAS = ['pg_stat_statements', 'pgcrypto'];

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
    // Criterio 148 (ataque ronda 9): la base de la URL de la app es la de DATABASE_URL del caso.
    DATABASE_URL_APP: `postgresql://${USUARIO_APP}:${encodeURIComponent(CLAVE_APP_QUE_NO_DEBE_SALIR)}@${servidor.host}:${servidor.puerto}/${nombres.desarrollo}`,
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
 * Instala una extension en `public` de la base con la vista propia (`SELECT` para `PUBLIC`) agregada a ella. Devuelve su nombre, o
 * `undefined` (y avisa una vez) si no se puede instalar ninguna.
 */
async function instalarExtension(base) {
  for (const nombre of CANDIDATAS) {
    try {
      await ejecutarSql(servidor, base, `CREATE EXTENSION ${nombre} SCHEMA public`);
    } catch (error) {
      if (error && SIN_INSTALAR.includes(error.code)) continue;
      throw error;
    }
    await ejecutar(base, [
      'CREATE VIEW public.vista_de_extension AS SELECT 1 AS x',
      'GRANT SELECT ON public.vista_de_extension TO PUBLIC',
      `ALTER EXTENSION ${nombre} ADD VIEW public.vista_de_extension`,
    ]);
    return nombre;
  }
  if (!avisado) {
    avisado = true;
    console.warn(
      '[criterio 137] AVISO: no se puede instalar ninguna extension en public (pg_stat_statements exige superusuario; pgcrypto no esta disponible o ya esta instalada); los casos se omiten. Corren en Docker y en la CI.',
    );
  }
  return undefined;
}

/** Pareja de bases con el rol de la app y la extension instalada en la base indicada, o se omite el caso. */
async function prepararConExtension(contexto, base = 'pruebas') {
  if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
  const nombres = await crearPareja();
  const extension = await instalarExtension(nombres[base]);
  if (extension === undefined) contexto.skip('no se puede instalar ninguna extension en public');
  return { nombres, extension, base: nombres[base] };
}

/** Lo que la salida no debe nombrar: ningun objeto de la extension ni un `REVOKE` sobre el. */
function esperarSinObjetosDeExtension(salida, extension) {
  expect(salida, 'la salida nombra la vista de la extension').not.toContain('vista_de_extension');
  expect(salida, 'la salida nombra la extension').not.toContain(extension);
  expect(salida, 'la salida propone un REVOKE').not.toMatch(/REVOKE/);
  if (extension === 'pg_stat_statements') {
    expect(salida, 'la salida nombra una vista de pg_stat_statements').not.toContain('pg_stat_statements');
  }
}

describe('criterio 137: db:crear ante una extension instalada en public', () => {
  it('criterio 137 (caso 1): con la extension instalada en la base de pruebas, db:crear termina con codigo 0 y no nombra ningun objeto de la extension ni propone REVOKE', async (contexto) => {
    const { nombres, extension } = await prepararConExtension(contexto, 'pruebas');

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
    esperarSinObjetosDeExtension(resultado.salida, extension);
  });

  it('criterio 137 (caso 1): con la extension instalada en la base de desarrollo, db:crear termina con codigo 0 y no nombra ningun objeto de la extension ni propone REVOKE', async (contexto) => {
    const { nombres, extension } = await prepararConExtension(contexto, 'desarrollo');

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
    esperarSinObjetosDeExtension(resultado.salida, extension);
  });

  it.for([
    [
      'SELECT sobre la vista de la extension, concedido a la app',
      `GRANT SELECT ON public.vista_de_extension TO ${USUARIO_APP}`,
    ],
    [
      'SELECT (x) sobre la vista de la extension, concedido a la app (privilegio de columna)',
      `GRANT SELECT (x) ON public.vista_de_extension TO ${USUARIO_APP}`,
    ],
    [
      'todos los privilegios sobre la vista de la extension, concedidos a la app',
      `GRANT ALL ON public.vista_de_extension TO ${USUARIO_APP}`,
    ],
  ])(
    'criterio 137: %s no se informa (un objeto de extension no cuenta, ni la relacion ni sus columnas): db:crear termina con codigo 0',
    async ([, concesion], contexto) => {
      const { nombres, extension, base } = await prepararConExtension(contexto);
      await ejecutarSql(servidor, base, concesion);

      const resultado = ejecutarDbCrear(nombres);

      expect(resultado.estado, resultado.salida).toBe(0);
      esperarSinObjetosDeExtension(resultado.salida, extension);
    },
  );

  it('criterio 137 (control, caso 2): con la extension instalada, vista_extra con SELECT para PUBLIC termina con codigo 1 y propone REVOKE SELECT ON vista_extra FROM PUBLIC;', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, [
      'CREATE VIEW public.vista_extra AS SELECT 1 AS x',
      'GRANT SELECT ON public.vista_extra TO PUBLIC',
    ]);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('vista_extra');
    expect(resultado.salida).toContain('SELECT');
    expect(resultado.salida).toContain('REVOKE SELECT ON vista_extra FROM PUBLIC;');
  });

  it('criterio 137: con la extension instalada, vista_extra con SELECT para la app termina con codigo 1 y propone REVOKE SELECT ON vista_extra FROM aquagestion_app;', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, [
      'CREATE VIEW public.vista_extra AS SELECT 1 AS x',
      `GRANT SELECT ON public.vista_extra TO ${USUARIO_APP}`,
    ]);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('REVOKE SELECT ON vista_extra FROM aquagestion_app;');
  });

  it('criterio 137 (control, caso 3): con la extension instalada, GRANT TRUNCATE ON auditoria TO aquagestion_app termina con codigo 1 y propone REVOKE TRUNCATE ON auditoria FROM aquagestion_app;', async (contexto) => {
    const { nombres, base } = await prepararConExtension(contexto);
    await ejecutar(base, ['CREATE TABLE auditoria (id int)', `GRANT TRUNCATE ON auditoria TO ${USUARIO_APP}`]);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado);
    expect(resultado.salida).toContain('auditoria');
    expect(resultado.salida).toContain('TRUNCATE');
    expect(resultado.salida).toContain('REVOKE TRUNCATE ON auditoria FROM aquagestion_app;');
  });
});
