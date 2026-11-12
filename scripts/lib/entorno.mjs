// Lectura del .env de la raíz y utilidades para las URL de PostgreSQL. Solo módulos de Node (más `pg` en quien lo use).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const raizProyecto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PATRON_NOMBRE = /^[a-z_][a-z0-9_]*$/;
const BOM = '\uFEFF';

/**
 * Quita un U+FEFF solo si es el primer carácter del texto; ninguno más (spec 001, criterio 169, P-43). Un `.env` guardado
 * con BOM (PowerShell 5.1) lo trae al principio, y `dotenv` (el que usa el backend) lo descarta.
 */
export function quitarBom(texto) {
  return texto.startsWith(BOM) ? texto.slice(1) : texto;
}

/**
 * `parseEnv(quitarBom(texto))`: la lectura que usan todos los scripts de un `.env` o de `.env.example`, de modo que la
 * primera clave no lleve el BOM pegado (spec 001, criterio 169, P-43).
 */
export function analizarEnv(texto) {
  return parseEnv(quitarBom(texto));
}

// Líneas separadas por \n, \r, U+2028 o U+2029; en cada una, tras quitar los espacios del principio (los de `\s` de
// JavaScript, que incluyen U+FEFF y U+00A0) y un `export` opcional, una clave y luego `=` o `:`.
const SEPARADOR_DE_LINEAS = /\r\n|[\n\r\u2028\u2029]/;
const LINEA_CON_CLAVE = /^\s*(?:export\s+)?([\w.-]+)\s*[=:]/;

/**
 * Claves que alguna línea del texto podría definir para `dotenv`: una regla más amplia que la de `dotenv` (en la duda, sí;
 * por ejemplo, también cuenta una línea dentro de un valor entre comillas de varias líneas). Nunca lanza (spec 001,
 * criterio 170, P-43).
 */
export function clavesPosiblesEnv(texto) {
  const claves = new Set();
  for (const linea of String(texto).split(SEPARADOR_DE_LINEAS)) {
    const coincidencia = LINEA_CON_CLAVE.exec(linea);
    if (coincidencia) claves.add(coincidencia[1]);
  }
  return claves;
}

/**
 * Carga el .env de la raíz en `env` sin sobrescribir las variables ya definidas (las de la CI mandan).
 * Si el archivo no existe, no hace nada.
 */
export function cargarEnv(env = process.env, raiz = raizProyecto) {
  const ruta = path.join(raiz, '.env');
  if (!fs.existsSync(ruta)) return;
  const valores = analizarEnv(fs.readFileSync(ruta, 'utf8'));
  for (const [clave, valor] of Object.entries(valores)) {
    if (env[clave] === undefined) env[clave] = valor;
  }
}

/** Un nombre de usuario o de base es válido si cumple `^[a-z_][a-z0-9_]*$`. */
export function esNombreValido(nombre) {
  return PATRON_NOMBRE.test(nombre);
}

/**
 * Parámetros de conexión que el cliente `pg` toma de la cadena de consulta por encima de la parte principal de la URL
 * (spec 001, criterio 143, P-34). Igual que `PARAMETROS_DE_CONEXION_PROHIBIDOS` de
 * `backend/src/infraestructura/entorno/url-postgres.ts`.
 */
export const PARAMETROS_DE_CONEXION_PROHIBIDOS = ['user', 'host', 'hostaddr', 'password', 'port', 'dbname', 'database'];

/**
 * Nombres de `PARAMETROS_DE_CONEXION_PROHIBIDOS` presentes en la cadena de consulta de `url`: en minúsculas, sin
 * repetir y en orden de aparición; `[]` si no hay. No devuelve valores. Lanza `TypeError` si `url` no es una URL que
 * `new URL` acepte.
 */
export function parametrosDeConexionProhibidos(url) {
  const encontrados = [];
  for (const nombre of new URL(url).searchParams.keys()) {
    const minusculas = nombre.toLowerCase();
    if (PARAMETROS_DE_CONEXION_PROHIBIDOS.includes(minusculas) && !encontrados.includes(minusculas)) {
      encontrados.push(minusculas);
    }
  }
  return encontrados;
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
  const prohibidos = parametrosDeConexionProhibidos(valor);
  if (prohibidos.length > 0) {
    throw new Error(
      `La variable ${nombreVariable} no puede llevar ${prohibidos.length === 1 ? 'el parámetro' : 'los parámetros'} ${prohibidos.join(', ')} en la cadena de consulta: el usuario, el servidor y la base van en la parte principal de la URL.`,
    );
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
 * Partes en que la conexión de la app (`DATABASE_URL_APP`) difiere de la de desarrollo (`DATABASE_URL`), en el orden
 * `servidor`, `puerto`, `base`, sin repetir (spec 001, criterio 148, P-35). `app` y `desarrollo` son los objetos que devuelve
 * `analizarUrlPostgres`. El servidor se compara sin distinguir mayúsculas y sin resolver nombres, el puerto como número y la
 * base exacta; no se miran el usuario, la contraseña ni la cadena de consulta. Devuelve `[]` si coinciden.
 */
export function diferenciasConDesarrollo(app, desarrollo) {
  const partes = [];
  if (String(app.host).toLowerCase() !== String(desarrollo.host).toLowerCase()) partes.push('servidor');
  if (Number(app.puerto) !== Number(desarrollo.puerto)) partes.push('puerto');
  if (app.base !== desarrollo.base) partes.push('base');
  return partes;
}

/**
 * Mensaje del criterio 148: nombra las dos variables y las partes que difieren, pide corregir `DATABASE_URL_APP` y no incluye la
 * URL ni la contraseña de ninguna.
 */
export function mensajeDeDiferenciasConDesarrollo(partes) {
  return (
    `DATABASE_URL_APP debe apuntar al mismo servidor, puerto y base que DATABASE_URL (difieren: ${partes.join(', ')}). ` +
    'Corrige DATABASE_URL_APP en el .env: la API usaría otra base que la que revisa db:crear.'
  );
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
