// Lectura del .env de la raíz y utilidades para las URL de PostgreSQL. Solo módulos de Node (más `pg` en quien lo use).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const raizProyecto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PATRON_NOMBRE = /^[a-z_][a-z0-9_]*$/;

/**
 * Carga el .env de la raíz en `env` sin sobrescribir las variables ya definidas (las de la CI mandan).
 * Si el archivo no existe, no hace nada.
 */
export function cargarEnv(env = process.env, raiz = raizProyecto) {
  const ruta = path.join(raiz, '.env');
  if (!fs.existsSync(ruta)) return;
  const valores = parseEnv(fs.readFileSync(ruta, 'utf8'));
  for (const [clave, valor] of Object.entries(valores)) {
    if (env[clave] === undefined) env[clave] = valor;
  }
}

/** Un nombre de usuario o de base es válido si cumple `^[a-z_][a-z0-9_]*$`. */
export function esNombreValido(nombre) {
  return PATRON_NOMBRE.test(nombre);
}

/** Descompone una URL de PostgreSQL. Lanza un error que nombra la variable, sin incluir el valor. */
export function analizarUrlPostgres(valor, nombreVariable) {
  if (!valor) throw new Error(`Falta la variable ${nombreVariable} en el .env.`);
  let url;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`La variable ${nombreVariable} no es una URL válida.`);
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`La variable ${nombreVariable} debe ser una URL de PostgreSQL (postgresql://).`);
  }
  const base = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!base) throw new Error(`La variable ${nombreVariable} debe indicar el nombre de la base de datos.`);
  return {
    host: url.hostname,
    puerto: url.port ? Number(url.port) : 5432,
    usuario: decodeURIComponent(url.username),
    clave: decodeURIComponent(url.password),
    base,
  };
}

/**
 * Obtiene las URL de desarrollo y de pruebas del entorno. La de pruebas debe ser distinta de la de desarrollo y su
 * base debe terminar en `_pruebas` (evita tocar por error la base de desarrollo).
 */
export function leerUrlsBases(env = process.env) {
  const desarrollo = analizarUrlPostgres(env.DATABASE_URL, 'DATABASE_URL');
  const pruebas = analizarUrlPostgres(env.DATABASE_URL_PRUEBAS, 'DATABASE_URL_PRUEBAS');
  if (env.DATABASE_URL === env.DATABASE_URL_PRUEBAS) {
    throw new Error('DATABASE_URL_PRUEBAS no puede ser igual a DATABASE_URL.');
  }
  if (!pruebas.base.endsWith('_pruebas')) {
    throw new Error('El nombre de la base de DATABASE_URL_PRUEBAS debe terminar en _pruebas.');
  }
  return { desarrollo, pruebas };
}

/** Nombre fijo del rol de PostgreSQL con el que se conecta la API (spec 001, "Roles de PostgreSQL"). */
export const USUARIO_APP = 'aquagestion_app';

/**
 * Descompone `DATABASE_URL_APP` (la conexión de la API). Lanza un error que nombra la variable, sin incluir el valor.
 * No exige que el usuario sea `aquagestion_app`: eso lo valida quien crea el rol.
 */
export function leerUrlApp(env = process.env) {
  return analizarUrlPostgres(env.DATABASE_URL_APP, 'DATABASE_URL_APP');
}

/**
 * URL de la app sobre otra base: el usuario y la contraseña de `urlApp`, y el host, el puerto, la base y los
 * parámetros de `urlBase`. Se usa para apuntar al rol `aquagestion_app` a la base de pruebas.
 */
export function urlAppSobre(urlBase, urlApp) {
  const resultado = new URL(urlBase);
  const app = new URL(urlApp);
  resultado.username = app.username;
  resultado.password = app.password;
  return resultado.toString();
}
