// Crea la base de desarrollo y la de pruebas si no existen. No toca las existentes y no borra nada.
// Uso: npm run db:crear
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { cargarEnv, esNombreValido, leerUrlsBases } from './lib/entorno.mjs';

const DUPLICATE_DATABASE = '42P04';

/**
 * Crea las bases que faltan. Se conecta a la base `postgres` del mismo servidor con las credenciales de DATABASE_URL.
 * Devuelve `{ creadas, existentes }` con los nombres de las bases.
 */
export async function crearBases(env = process.env) {
  const { desarrollo, pruebas } = leerUrlsBases(env);
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
  try {
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
  return { creadas, existentes };
}

async function principal() {
  cargarEnv();
  try {
    const { creadas, existentes } = await crearBases();
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
