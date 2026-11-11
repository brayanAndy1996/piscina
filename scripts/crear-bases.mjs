// Crea la base de desarrollo y la de pruebas si no existen, y el rol aquagestion_app (el que usa la API) si falta.
// No toca las bases existentes, no borra nada y no cambia la contraseña de un rol que ya existe.
// Uso: npm run db:crear
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { cargarEnv, esNombreValido, leerUrlApp, leerUrlsBases, USUARIO_APP } from './lib/entorno.mjs';

const DUPLICATE_DATABASE = '42P04';
const DUPLICATE_OBJECT = '42710';

/** Reemplaza cada aparición de la contraseña en un texto por "***". */
function ocultarClave(texto, clave) {
  if (!clave) return texto;
  return String(texto).replaceAll(clave, '***');
}

/**
 * Sentencia que crea el rol de la app sin privilegios. La contraseña va entre comillas simples con las comillas
 * duplicadas; hay que ejecutarla con `standard_conforming_strings = on` para que la barra invertida no sea especial.
 */
function sentenciaCrearRolApp(usuario, clave) {
  const literal = `'${clave.replaceAll("'", "''")}'`;
  return (
    `CREATE ROLE "${usuario}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ` +
    `PASSWORD ${literal}`
  );
}

/**
 * Se asegura de que exista el rol de la API (spec 001, criterio 6). `cliente` es una conexión de `pg` ya abierta con
 * el usuario de `DATABASE_URL`. Devuelve `{ creado }`.
 * - Si el rol existe con atributos seguros, no cambia nada (tampoco su contraseña).
 * - Si existe con SUPERUSER o BYPASSRLS, o falta y el usuario no puede crear roles, lanza un error que dice qué hacer.
 * Los mensajes no incluyen la contraseña.
 */
export async function asegurarRolApp(cliente, { usuario, clave }) {
  if (!esNombreValido(usuario)) {
    throw new Error('El usuario de DATABASE_URL_APP debe tener solo minúsculas, dígitos y guiones bajos.');
  }
  if (!clave) throw new Error('La URL de DATABASE_URL_APP debe incluir la contraseña del rol.');
  if (clave.includes('\0')) throw new Error('La contraseña de DATABASE_URL_APP no puede contener caracteres nulos.');

  const { rows } = await cliente.query('SELECT rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = $1', [
    usuario,
  ]);
  if (rows.length > 0) {
    if (rows[0].rolsuper || rows[0].rolbypassrls) {
      throw new Error(
        `El rol ${usuario} existe pero es superusuario o tiene BYPASSRLS, y entonces la seguridad por academia no ` +
          `protege nada. Corrígelo con un superusuario: ALTER ROLE ${usuario} NOSUPERUSER NOBYPASSRLS;`,
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

/**
 * Crea las bases que faltan. Se conecta a la base `postgres` del mismo servidor con las credenciales de DATABASE_URL.
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
