// Crea la base de desarrollo y la de pruebas si no existen, y el rol aquagestion_app (el que usa la API) si falta.
// No borra nada y no cambia la contraseña ni los atributos de un rol que ya existe. En las bases que crea o encuentra
// revoca TEMPORARY a PUBLIC y a aquagestion_app (criterio 82) y comprueba que el rol no tenga ninguna condición
// insegura (criterios 80, 81, 102 y 103: atributos, membresías, dueño, CREATE, privilegios de más sobre las tablas y valores
// por defecto propios); si la tiene, termina con código 1 y dice cómo corregirla. La contraseña del rol se envía como
// verificador SCRAM-SHA-256 y nunca en claro (criterio 104).
// Uso: npm run db:crear
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { cargarEnv, esNombreValido, leerUrlApp, leerUrlsBases, USUARIO_APP } from './lib/entorno.mjs';
import {
  correccionDePrivilegio,
  privilegiosNoPermitidos,
  problemasDeConfiguracionApp,
  problemasDelRolApp,
  verificadorScram,
} from './lib/rol-app.mjs';

const DUPLICATE_DATABASE = '42P04';
const DUPLICATE_OBJECT = '42710';

/** Reemplaza cada aparición de la contraseña en un texto por "***". */
function ocultarClave(texto, clave) {
  if (!clave) return texto;
  return String(texto).replaceAll(clave, '***');
}

/**
 * Valida la contraseña de `DATABASE_URL_APP` (criterio 104): solo ASCII imprimible (U+0020 a U+007E), porque PostgreSQL la
 * normaliza con SASLprep y el verificador calculado aquí podría no coincidir. El error nombra la variable y no la contraseña.
 */
function validarClaveApp(clave) {
  try {
    verificadorScram(clave);
  } catch {
    throw new Error(
      'La contraseña de DATABASE_URL_APP tiene caracteres fuera de ASCII imprimible (U+0020 a U+007E): usa solo letras ' +
        'sin tilde, dígitos y signos ASCII (PostgreSQL la normalizaría con SASLprep y el verificador no coincidiría).',
    );
  }
}

/**
 * Sentencia que crea el rol de la app sin privilegios. La contraseña nunca viaja en claro: se envía como verificador
 * SCRAM-SHA-256 calculado aquí con `node:crypto` (criterio 104), que no contiene comillas ni barras invertidas.
 */
export function sentenciaCrearRolApp(usuario, clave) {
  validarClaveApp(clave);
  return (
    `CREATE ROLE "${usuario}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ` +
    `PASSWORD '${verificadorScram(clave)}'`
  );
}

/**
 * Se asegura de que exista el rol de la API (spec 001, criterio 6). `cliente` es una conexión de `pg` ya abierta con
 * el usuario de `DATABASE_URL`. Devuelve `{ creado }`.
 * - Si el rol existe con atributos seguros, no cambia nada (tampoco su contraseña).
 * - Si existe con SUPERUSER, BYPASSRLS, REPLICATION, CREATEROLE o CREATEDB, o es miembro de algún rol, o falta y el
 *   usuario no puede crear roles, lanza un error que dice qué hacer (y no modifica el rol).
 * Los mensajes no incluyen la contraseña.
 */
export async function asegurarRolApp(cliente, { usuario, clave }) {
  if (!esNombreValido(usuario)) {
    throw new Error('El usuario de DATABASE_URL_APP debe tener solo minúsculas, dígitos y guiones bajos.');
  }
  if (!clave) throw new Error('La URL de DATABASE_URL_APP debe incluir la contraseña del rol.');
  if (clave.includes('\0')) throw new Error('La contraseña de DATABASE_URL_APP no puede contener caracteres nulos.');
  validarClaveApp(clave);

  const { rows } = await cliente.query(
    `SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolreplication, r.rolcreaterole, r.rolcreatedb,
            EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS es_miembro,
            ARRAY(SELECT o.rolname::text FROM pg_catalog.pg_auth_members m
                    JOIN pg_catalog.pg_roles o ON o.oid = m.roleid WHERE m.member = r.oid ORDER BY 1) AS roles
       FROM pg_catalog.pg_roles r WHERE r.rolname = $1`,
    [usuario],
  );
  if (rows.length > 0) {
    const fila = rows[0];
    const problemas = problemasDelRolApp(fila);
    if (problemas.length > 0) {
      const adicional =
        fila.rolsuper || fila.rolbypassrls
          ? [`Para quitar ambos a la vez: ALTER ROLE ${usuario} NOSUPERUSER NOBYPASSRLS;`]
          : [];
      throw new Error(
        `El rol ${usuario} ya existe pero no es seguro, y entonces la seguridad por academia no protege nada ` +
          `(spec 001, criterios 80 y 81). No se modificó nada.\n${[...problemas, ...adicional].map((p) => `- ${p}`).join('\n')}`,
      );
    }
    return { creado: false };
  }

  const { rows: permisos } = await cliente.query(
    'SELECT rolsuper, rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user',
  );
  if (!permisos[0] || !(permisos[0].rolsuper || permisos[0].rolcreaterole)) {
    throw new Error(
      `Falta el rol ${usuario} y el usuario de DATABASE_URL no puede crear roles. Créalo con un superusuario ` +
        `(CREATE ROLE ${usuario} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ` +
        `PASSWORD '<la de DATABASE_URL_APP>';) o, en la nube, ejecuta: node .claude/hooks/preparar-sesion.mjs`,
    );
  }

  try {
    await cliente.query('SET standard_conforming_strings = on');
    await cliente.query(sentenciaCrearRolApp(usuario, clave));
  } catch (error) {
    // Otra ejecución lo creó entre la consulta y la creación: se trata como si ya existiera.
    if (error && error.code === DUPLICATE_OBJECT) return { creado: false };
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo crear el rol ${usuario}: ${ocultarClave(motivo, clave)}`, { cause: error });
  }
  return { creado: true };
}

const citar = (identificador) => `"${identificador.replaceAll('"', '""')}"`;

/**
 * Revoca TEMPORARY a PUBLIC y al rol de la API sobre la base `base` (criterio 82). Idempotente; no quita CONNECT.
 * `cliente` es la conexión a `postgres` con el usuario de DATABASE_URL. Si ese usuario no es el dueño de la base ni
 * superusuario, PostgreSQL no revocaría nada (solo avisa), así que se comprueba antes y se lanza un error que lo explica.
 */
export async function revocarTemporales(cliente, { base, usuarioApp }) {
  const { rows } = await cliente.query(
    `SELECT pg_catalog.pg_has_role(current_user, d.datdba, 'USAGE') AS puede
       FROM pg_catalog.pg_database d WHERE d.datname = $1`,
    [base],
  );
  if (!rows[0]?.puede) {
    throw new Error(
      `El usuario de DATABASE_URL no es el propietario (dueño) de la base ${base} ni superusuario, y no puede revocar ` +
        `TEMPORARY. Con el dueño o un superusuario ejecuta: REVOKE TEMPORARY ON DATABASE ${citar(base)} FROM PUBLIC; ` +
        `REVOKE TEMPORARY ON DATABASE ${citar(base)} FROM ${usuarioApp};`,
    );
  }
  await cliente.query(`REVOKE TEMPORARY ON DATABASE ${citar(base)} FROM PUBLIC`);
  await cliente.query(`REVOKE TEMPORARY ON DATABASE ${citar(base)} FROM ${citar(usuarioApp)}`);
}

/**
 * Condiciones inseguras de `usuarioApp` que dependen de la base `base` (criterio 81): dueño de la base, CREATE o TEMPORARY
 * sobre la base, CREATE sobre `public` y propiedad de objetos de `public`. Se evalúan después de la revocación del
 * criterio 82. `clientePostgres` está conectado a `postgres`; `abrirCliente(base)` abre una conexión a esa base.
 * Devuelve la lista de problemas (vacía si no hay ninguno).
 */
export async function problemasDeLaBase(clientePostgres, abrirCliente, { base, usuarioApp }) {
  const problemas = [];
  const { rows } = await clientePostgres.query(
    `SELECT d.datdba = r.oid AS es_duena,
            pg_catalog.has_database_privilege(r.oid, d.oid, 'CREATE') AS crea,
            pg_catalog.has_database_privilege(r.oid, d.oid, 'TEMPORARY') AS temporales
       FROM pg_catalog.pg_database d, pg_catalog.pg_roles r WHERE d.datname = $1 AND r.rolname = $2`,
    [base, usuarioApp],
  );
  const fila = rows[0];
  if (!fila) return problemas;
  if (fila.es_duena) {
    problemas.push(
      `El rol de la API es el dueño (propietario) de la base ${base}. Corrígelo con un superusuario: ` +
        `ALTER DATABASE ${citar(base)} OWNER TO <el usuario de DATABASE_URL>;`,
    );
  }
  if (fila.crea) {
    problemas.push(
      `El rol de la API tiene CREATE sobre la base ${base}. Corrígelo: ` +
        `REVOKE CREATE ON DATABASE ${citar(base)} FROM <rol de la API>;`,
    );
  }
  if (fila.temporales) {
    problemas.push(
      `El rol de la API sigue con TEMPORARY sobre la base ${base} (concedido a un rol del que es miembro). ` +
        `Corrígelo revocando ese privilegio.`,
    );
  }
  const clienteBase = await abrirCliente(base);
  try {
    const { rows: esquema } = await clienteBase.query(
      `SELECT pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE') AS crea_en_public,
              (EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relowner = r.oid)
               OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                           WHERE n.nspname = 'public' AND p.proowner = r.oid)
               OR EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                           WHERE n.nspname = 'public' AND t.typowner = r.oid)
               OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = 'public' AND n.nspowner = r.oid))
               AS es_duena_de_objetos
         FROM pg_catalog.pg_roles r WHERE r.rolname = $1`,
      [usuarioApp],
    );
    if (esquema[0]?.crea_en_public) {
      problemas.push(
        `El rol de la API tiene CREATE sobre el esquema public de la base ${base}. Corrígelo: ` +
          `REVOKE CREATE ON SCHEMA public FROM <rol de la API>; (y de PUBLIC si lo hereda)`,
      );
    }
    if (esquema[0]?.es_duena_de_objetos) {
      problemas.push(
        `El rol de la API es dueño (propietario) de objetos del esquema public de la base ${base} (tablas, ` +
          `funciones, tipos o del propio esquema). Corrígelo: REASSIGN OWNED BY <rol de la API> TO <el usuario de ` +
          `DATABASE_URL>; ejecutado en esa base.`,
      );
    }
    problemas.push(...(await problemasDePrivilegios(clienteBase, { base, usuarioApp })));
  } finally {
    await clienteBase.end();
  }
  return problemas;
}

/**
 * Privilegios efectivos de `usuarioApp` (concedidos al rol o a PUBLIC) sobre las tablas, vistas, secuencias, etc. del esquema
 * `public` de la base a la que está conectado `clienteBase`, a nivel de tabla y de columna (criterio 102), comparados con la
 * lista permitida (`PRIVILEGIOS_APP`). Un problema por cada privilegio de más, con su corrección (`REVOKE … FROM <rol>;` o
 * `FROM PUBLIC;` si lo concede PUBLIC). No modifica nada. Un privilegio que falta no es un problema.
 */
export async function problemasDePrivilegios(clienteBase, { base, usuarioApp }) {
  const { rows } = await clienteBase.query(
    `SELECT c.relname::text AS tabla, NULL::text AS columna, p.privilegio::text AS privilegio, false AS secuencia,
            pg_catalog.has_table_privilege('public', c.oid, p.privilegio) AS via_public
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilegio)
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND pg_catalog.has_table_privilege($1::name, c.oid, p.privilegio)
     UNION ALL
     SELECT c.relname::text, NULL::text, p.privilegio::text, true,
            pg_catalog.has_sequence_privilege('public', c.oid, p.privilegio)
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p(privilegio)
      WHERE n.nspname = 'public' AND c.relkind = 'S'
        AND pg_catalog.has_sequence_privilege($1::name, c.oid, p.privilegio)
     UNION ALL
     SELECT c.relname::text, a.attname::text, p.privilegio::text, false,
            pg_catalog.has_column_privilege('public', c.oid, a.attnum, p.privilegio)
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(privilegio)
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, p.privilegio)`,
    [usuarioApp],
  );
  const deMas = privilegiosNoPermitidos(rows);
  // Si el privilegio es de la tabla entera, el de cada columna es el mismo: se informa solo el de la tabla.
  const deTabla = new Set(
    deMas.filter((fila) => fila.columna === null).map((fila) => `${fila.tabla}|${fila.privilegio}`),
  );
  return deMas
    .filter((fila) => fila.columna === null || !deTabla.has(`${fila.tabla}|${fila.privilegio}`))
    .map((fila) => {
      const objeto = fila.columna === null ? fila.tabla : `${fila.tabla}.${fila.columna}`;
      const correccion = correccionDePrivilegio(fila, {
        rol: usuarioApp,
        viaPublic: fila.via_public,
        secuencia: fila.secuencia,
      });
      return (
        `El rol de la API tiene el privilegio ${fila.privilegio} de más sobre ${objeto} en la base ${base}` +
        `${fila.via_public ? ' (concedido a PUBLIC)' : ''}. Corrígelo con el dueño o un superusuario: ${correccion}`
      );
    });
}

/**
 * Valores por defecto propios del rol en cualquier base (criterio 103): `pg_roles.rolconfig` (`ALTER ROLE … SET`) o filas de
 * `pg_db_role_setting` con el rol y una base (`ALTER ROLE … IN DATABASE … SET`). Los de la base para todos los roles no cuentan.
 * `clientePostgres` está conectado a `postgres`. Devuelve la lista de problemas (vacía si no hay ninguno).
 */
export async function problemasDeConfiguracionDelRol(clientePostgres, usuarioApp) {
  const { rows } = await clientePostgres.query(
    `SELECT r.rolconfig,
            ARRAY(SELECT d.datname::text FROM pg_catalog.pg_db_role_setting s
                    JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
                   WHERE s.setrole = r.oid ORDER BY 1) AS bases
       FROM pg_catalog.pg_roles r WHERE r.rolname = $1`,
    [usuarioApp],
  );
  const fila = rows[0];
  if (!fila) return [];
  return problemasDeConfiguracionApp({ rolconfig: fila.rolconfig, bases: fila.bases, rolname: usuarioApp });
}

/**
 * Crea las bases que faltan y deja el rol de la API sin TEMPORARY. Se conecta a la base `postgres` del mismo servidor con las credenciales de DATABASE_URL.
 * Devuelve `{ creadas, existentes, rolCreado }`: los nombres de las bases y si se creó el rol de la API.
 */
export async function crearBases(env = process.env) {
  const { desarrollo, pruebas } = leerUrlsBases(env);
  const app = leerUrlApp(env);
  if (app.usuario !== USUARIO_APP) {
    throw new Error(`El usuario de DATABASE_URL_APP debe ser ${USUARIO_APP}.`);
  }
  if (app.usuario === desarrollo.usuario) {
    throw new Error(
      'DATABASE_URL_APP debe usar un usuario distinto del de DATABASE_URL: la API no es el dueño de las tablas.',
    );
  }
  const nombres = [...new Set([desarrollo.base, pruebas.base])];
  for (const nombre of nombres) {
    if (!esNombreValido(nombre)) {
      throw new Error(`El nombre de base "${nombre}" no es válido: usa solo minúsculas, dígitos y guiones bajos.`);
    }
  }

  const cliente = new pg.Client({
    host: desarrollo.host,
    port: desarrollo.puerto,
    user: desarrollo.usuario,
    password: desarrollo.clave,
    database: 'postgres',
    connectionTimeoutMillis: 5000,
  });
  try {
    await cliente.connect();
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo conectar a PostgreSQL en ${desarrollo.host}:${desarrollo.puerto} (${motivo}).`, {
      cause: error,
    });
  }

  const abrirCliente = async (base) => {
    const conexion = new pg.Client({
      host: desarrollo.host,
      port: desarrollo.puerto,
      user: desarrollo.usuario,
      password: desarrollo.clave,
      database: base,
      connectionTimeoutMillis: 5000,
    });
    await conexion.connect();
    return conexion;
  };

  const creadas = [];
  const existentes = [];
  let rol;
  try {
    rol = await asegurarRolApp(cliente, { usuario: app.usuario, clave: app.clave });
    for (const nombre of nombres) {
      const { rowCount } = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]);
      if (rowCount) {
        existentes.push(nombre);
        continue;
      }
      try {
        await cliente.query(`CREATE DATABASE "${nombre}"`);
        creadas.push(nombre);
      } catch (error) {
        if (error && error.code === DUPLICATE_DATABASE) existentes.push(nombre);
        else throw error;
      }
    }
    // Criterios 81 y 82: primero se revoca TEMPORARY y después se evalúan las condiciones de cada base.
    for (const nombre of nombres) {
      await revocarTemporales(cliente, { base: nombre, usuarioApp: app.usuario });
    }
    const problemas = [...(await problemasDeConfiguracionDelRol(cliente, app.usuario))];
    for (const nombre of nombres) {
      problemas.push(...(await problemasDeLaBase(cliente, abrirCliente, { base: nombre, usuarioApp: app.usuario })));
    }
    if (problemas.length > 0) {
      throw new Error(
        `El rol de la API no es seguro en las bases de desarrollo o de pruebas (spec 001, criterios 80 a 83, 102 y 103). ` +
          `No se modificó el rol.\n${problemas.map((p) => `- ${p}`).join('\n')}`,
      );
    }
  } finally {
    await cliente.end();
  }
  return { creadas, existentes, rolCreado: rol.creado };
}

async function principal() {
  cargarEnv();
  try {
    const { creadas, existentes, rolCreado } = await crearBases();
    console.log(rolCreado ? `Rol creado: ${USUARIO_APP}` : `El rol ya existía: ${USUARIO_APP}`);
    for (const nombre of creadas) console.log(`Base creada: ${nombre}`);
    for (const nombre of existentes) console.log(`La base ya existía: ${nombre}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await principal();
}
