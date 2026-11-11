// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterios 102, 103 y 104 (ataque ronda 3), parte de integracion de `npm run db:crear` (`scripts/crear-bases.mjs`):
//  - 102: la comprobacion del rol calcula los privilegios efectivos de `aquagestion_app` (concedidos al rol o a `PUBLIC`) sobre cada
//    tabla, vista, secuencia, etc. del esquema `public` de la base de desarrollo y la de pruebas, a nivel de tabla y de columna, y
//    los compara con la lista permitida del criterio 2. Cualquier privilegio de mas hace que `db:crear` termine con codigo 1 con
//    un mensaje que nombra la tabla, el privilegio y la correccion (`REVOKE TRUNCATE ON auditoria FROM aquagestion_app;`, o
//    `FROM PUBLIC` si viene de ahi), sin modificar nada. Un privilegio que falta no lo rechaza. Las bases son temporales: cada
//    caso crea y borra las suyas, con una tabla `auditoria` (o `academias`) vacia que lleva el nombre de la tabla real.
//  - 103: el caso de `db:crear` (valores por defecto propios del rol `aquagestion_app` en una base) esta en
//    `scripts/test/integracion-aislada/rol-app-config.test.mjs`: modifica el rol compartido y corre solo, despues de las demas.
//  - 104: si la contrasena de `DATABASE_URL_APP` tiene caracteres fuera de ASCII imprimible (U+0020 a U+007E), `db:crear` termina
//    con codigo 1 nombrando la variable, sin mostrar la contrasena. Donde se pueden crear roles (Docker y CI) la sentencia que fija
//    la contrasena en `asegurarRolApp` lleva el verificador SCRAM-SHA-256 y no la contrasena, y el rol creado inicia sesion con
//    ella. En la nube se omiten con aviso (los verifica el tester tras el hook).
import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asegurarRolApp } from '../../crear-bases.mjs';
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
const CLAVE_APP_QUE_NO_DEBE_SALIR = 'clave-app-que-no-debe-salir-ronda3';
const CLAVE_ROL = 'clave-temporal-de-prueba-ronda3-$$-\\-x';
const basesCreadas = [];
const rolesCreados = [];

async function conectar(opciones = {}) {
  const cliente = new pg.Client({
    host: servidor.host,
    port: servidor.puerto,
    user: servidor.usuario,
    password: servidor.clave,
    database: 'postgres',
    ...opciones,
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
let puedeCrearRoles = false;

beforeAll(async () => {
  const [fila] = await consultar(
    'SELECT rolsuper, rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user',
  );
  esSuperusuario = fila.rolsuper;
  puedeCrearRoles = fila.rolsuper || fila.rolcreaterole;
  existeElRolApp =
    (await consultar('SELECT 1 AS ok FROM pg_catalog.pg_roles WHERE rolname = $1', [USUARIO_APP])).length > 0;
});

afterAll(async () => {
  await borrarBases(servidor, basesCreadas).catch(() => undefined);
  for (const rol of rolesCreados) {
    await consultar(`DROP OWNED BY "${rol}"`).catch(() => undefined);
    await consultar(`DROP ROLE IF EXISTS "${rol}"`).catch(() => undefined);
  }
});

/** Pareja de bases temporales, creadas aqui con el usuario de las pruebas como dueno. */
async function crearPareja() {
  const nombres = nombresTemporales();
  basesCreadas.push(nombres.desarrollo, nombres.pruebas);
  await consultar(`CREATE DATABASE "${nombres.desarrollo}"`);
  await consultar(`CREATE DATABASE "${nombres.pruebas}"`);
  return nombres;
}

function ejecutarDbCrear(nombres, urlApp) {
  return ejecutarScript(['crear-bases.mjs'], {
    DATABASE_URL: urlDe(servidor, nombres.desarrollo),
    DATABASE_URL_PRUEBAS: urlDe(servidor, nombres.pruebas),
    DATABASE_URL_APP:
      urlApp ??
      `postgresql://${USUARIO_APP}:${encodeURIComponent(CLAVE_APP_QUE_NO_DEBE_SALIR)}@${servidor.host}:${servidor.puerto}/aquagestion`,
  });
}

async function privilegioDeLaApp(base, tabla, privilegio) {
  const [fila] = await ejecutarSql(
    servidor,
    base,
    `SELECT pg_catalog.has_table_privilege('${USUARIO_APP}', 'public.${tabla}', '${privilegio}') AS tiene`,
  ).then((resultado) => resultado.rows);
  return fila.tiene;
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterio 102
// ---------------------------------------------------------------------------------------------------------------------

describe('criterio 102: db:crear rechaza privilegios de tabla de mas', () => {
  /** Resultado esperado: codigo 1, con la tabla, el privilegio y la correccion, sin la contrasena y sin cambiar los privilegios. */
  function esperarRechazo(resultado, { tabla, privilegio, correccion }) {
    expect(resultado.estado, resultado.salida).toBe(1);
    expect(resultado.salida).toContain(tabla);
    expect(resultado.salida).toContain(privilegio);
    if (correccion) expect(resultado.salida).toContain(correccion);
    expect(resultado.salida).not.toContain(CLAVE_APP_QUE_NO_DEBE_SALIR);
    expect(
      filtracionesDeLaClaveDelServidor(resultado.salida, servidor),
      'la salida muestra la contrasena del servidor',
    ).toEqual([]);
  }

  it('criterio 102 (control): con las tablas sin concesiones de mas, db:crear termina con codigo 0', async (contexto) => {
    if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE auditoria (id int)');
    await ejecutarSql(servidor, nombres.pruebas, `GRANT SELECT, INSERT ON auditoria TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });

  it('criterio 102: TRUNCATE sobre auditoria termina con codigo 1 y propone REVOKE TRUNCATE ON auditoria FROM aquagestion_app;', async (contexto) => {
    if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE auditoria (id int)');
    await ejecutarSql(servidor, nombres.pruebas, `GRANT TRUNCATE ON auditoria TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado, {
      tabla: 'auditoria',
      privilegio: 'TRUNCATE',
      correccion: 'REVOKE TRUNCATE ON auditoria FROM aquagestion_app;',
    });
    expect(await privilegioDeLaApp(nombres.pruebas, 'auditoria', 'TRUNCATE'), 'db:crear no debia modificar nada').toBe(
      true,
    );
  });

  it('criterio 102: el mismo privilegio en la base de desarrollo tambien se rechaza', async (contexto) => {
    if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.desarrollo, 'CREATE TABLE configuraciones (id int)');
    await ejecutarSql(servidor, nombres.desarrollo, `GRANT DELETE ON configuraciones TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado, {
      tabla: 'configuraciones',
      privilegio: 'DELETE',
      correccion: 'REVOKE DELETE ON configuraciones FROM aquagestion_app;',
    });
  });

  it('criterio 102: TRUNCATE concedido a PUBLIC termina con codigo 1 y propone REVOKE ... FROM PUBLIC;', async (contexto) => {
    if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE auditoria (id int)');
    await ejecutarSql(servidor, nombres.pruebas, 'GRANT TRUNCATE ON auditoria TO PUBLIC');

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado, {
      tabla: 'auditoria',
      privilegio: 'TRUNCATE',
      correccion: 'REVOKE TRUNCATE ON auditoria FROM PUBLIC;',
    });
    expect(await privilegioDeLaApp(nombres.pruebas, 'auditoria', 'TRUNCATE'), 'db:crear no debia modificar nada').toBe(
      true,
    );
  });

  it('criterio 102: UPDATE de una columna que no esta permitida (academias.nombre_corto) termina con codigo 1 nombrando la columna', async (contexto) => {
    if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE academias (id uuid, nombre_corto text, estado text)');
    await ejecutarSql(servidor, nombres.pruebas, `GRANT UPDATE (estado) ON academias TO ${USUARIO_APP}`);
    await ejecutarSql(servidor, nombres.pruebas, `GRANT UPDATE (nombre_corto) ON academias TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado, { tabla: 'academias', privilegio: 'UPDATE' });
    expect(resultado.salida).toContain('nombre_corto');
  });

  it('criterio 102: UPDATE de las columnas permitidas de academias (estado) no se rechaza (control)', async (contexto) => {
    if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE academias (id uuid, nombre_corto text, estado text)');
    await ejecutarSql(servidor, nombres.pruebas, `GRANT SELECT, INSERT ON academias TO ${USUARIO_APP}`);
    await ejecutarSql(servidor, nombres.pruebas, `GRANT UPDATE (estado) ON academias TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });

  it('criterio 102: SELECT sobre _prisma_migrations termina con codigo 1', async (contexto) => {
    if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE _prisma_migrations (id int)');
    await ejecutarSql(servidor, nombres.pruebas, `GRANT SELECT ON _prisma_migrations TO ${USUARIO_APP}`);

    const resultado = ejecutarDbCrear(nombres);

    esperarRechazo(resultado, { tabla: '_prisma_migrations', privilegio: 'SELECT' });
  });

  it('criterio 102: un privilegio que falta no lo rechaza db:crear (la tabla sin ninguna concesion)', async (contexto) => {
    if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = await crearPareja();
    await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE configuraciones (id int)');

    const resultado = ejecutarDbCrear(nombres);

    expect(resultado.estado, resultado.salida).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criterio 104
// ---------------------------------------------------------------------------------------------------------------------

describe('criterio 104: la contrasena de los roles nunca viaja en claro', () => {
  it('criterio 104: una contrasena de DATABASE_URL_APP fuera de ASCII imprimible termina con codigo 1, nombra la variable y no la muestra', async () => {
    const nombres = await crearPareja();
    const clave = 'contraseña-secreta-ronda3';
    const urlApp = `postgresql://${USUARIO_APP}:${encodeURIComponent(clave)}@${servidor.host}:${servidor.puerto}/aquagestion`;

    const resultado = ejecutarDbCrear(nombres, urlApp);

    expect(resultado.estado, resultado.salida).toBe(1);
    expect(resultado.salida).toContain('DATABASE_URL_APP');
    expect(resultado.salida).not.toContain(clave);
    expect(resultado.salida).not.toContain(encodeURIComponent(clave));
    expect(
      filtracionesDeLaClaveDelServidor(resultado.salida, servidor),
      'la salida muestra la contrasena del servidor',
    ).toEqual([]);
  });

  it('criterio 104: una contrasena con un emoji tambien se rechaza sin mostrarla', async () => {
    const nombres = await crearPareja();
    const clave = 'clave-con-emoji-😀-ronda3';
    const urlApp = `postgresql://${USUARIO_APP}:${encodeURIComponent(clave)}@${servidor.host}:${servidor.puerto}/aquagestion`;

    const resultado = ejecutarDbCrear(nombres, urlApp);

    expect(resultado.estado, resultado.salida).toBe(1);
    expect(resultado.salida).toContain('DATABASE_URL_APP');
    expect(resultado.salida).not.toContain(clave);
  });

  describe('donde se pueden crear roles (Docker y la integracion continua)', () => {
    function nombreDeRol() {
      const nombre = `aqua_r3_${crypto.randomBytes(4).toString('hex')}`;
      rolesCreados.push(nombre);
      return nombre;
    }

    /** Un cliente que delega en uno real pero guarda el texto de cada sentencia que se le envia por `query`. */
    function espiar(real) {
      const sentencias = [];
      const espia = new Proxy(real, {
        get(objetivo, propiedad) {
          if (propiedad === 'query') {
            return (...argumentos) => {
              const primero = argumentos[0];
              sentencias.push(typeof primero === 'string' ? primero : String(primero?.text ?? ''));
              return objetivo.query(...argumentos);
            };
          }
          const valor = Reflect.get(objetivo, propiedad);
          return typeof valor === 'function' ? valor.bind(objetivo) : valor;
        },
      });
      return { sentencias, espia };
    }

    it('criterio 104: asegurarRolApp fija la contrasena con un verificador SCRAM-SHA-256 y no envia la contrasena', async (contexto) => {
      if (!puedeCrearRoles) {
        console.warn(
          '[criterio 104] AVISO: el usuario de la base no puede crear roles; se omite (lo verifica el tester tras el hook).',
        );
        contexto.skip('el usuario de la base no puede crear roles');
      }
      const usuario = nombreDeRol();
      const real = await conectar();
      const { sentencias, espia } = espiar(real);
      try {
        const resultado = await asegurarRolApp(espia, { usuario, clave: CLAVE_ROL });

        expect(resultado).toEqual({ creado: true });
        const todas = sentencias.join('\n');
        expect(todas).toContain('SCRAM-SHA-256$4096:');
        expect(todas).not.toContain(CLAVE_ROL);
        expect(todas).not.toContain(CLAVE_ROL.replaceAll("'", "''"));
        expect(todas).not.toContain(encodeURIComponent(CLAVE_ROL));
      } finally {
        await real.end();
      }
    });

    it('criterio 104: el rol creado con el verificador inicia sesion con la contrasena, y su rolpassword es SCRAM-SHA-256', async (contexto) => {
      if (!puedeCrearRoles) contexto.skip('el usuario de la base no puede crear roles');
      const usuario = nombreDeRol();
      const real = await conectar();
      try {
        await asegurarRolApp(real, { usuario, clave: CLAVE_ROL });
      } finally {
        await real.end();
      }

      const sesion = await conectar({ user: usuario, password: CLAVE_ROL, database: 'postgres' }).catch(
        (error) => error,
      );

      expect(sesion, 'el rol no pudo iniciar sesion con su contrasena').toBeInstanceOf(pg.Client);
      await sesion.end();
      if (esSuperusuario) {
        const [fila] = await consultar('SELECT rolpassword FROM pg_catalog.pg_authid WHERE rolname = $1', [usuario]);
        expect(fila.rolpassword.startsWith('SCRAM-SHA-256$')).toBe(true);
        expect(fila.rolpassword).not.toContain(CLAVE_ROL);
      }
    });
  });
});
