// Utilidades de las pruebas de integración de los scripts: bases temporales con nombres únicos en el servidor de
// DATABASE_URL_PRUEBAS. Nunca se tocan las bases reales: cada prueba crea y borra las suyas.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { analizarUrlPostgres, cargarEnv, USUARIO_APP } from '../../lib/entorno.mjs';

export const carpetaScripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Credenciales y servidor para las pruebas (de DATABASE_URL_PRUEBAS en el entorno o en el .env). */
export function servidorDePruebas() {
  cargarEnv();
  return analizarUrlPostgres(process.env.DATABASE_URL_PRUEBAS, 'DATABASE_URL_PRUEBAS');
}

/** Credencial de desarrollo inventada de `.env.example`, por si el entorno y el .env todavía no definen `DATABASE_URL_APP`. */
const URL_APP_POR_DEFECTO = 'postgresql://aquagestion_app:aquagestion_app@127.0.0.1:5432/aquagestion';

/**
 * `DATABASE_URL_APP` para los scripts (spec 001): la del entorno o el .env, o la de ejemplo. Las pruebas de los scripts
 * solo la usan para crear o comprobar el rol `aquagestion_app`; nunca inician sesión con ella.
 */
export function urlAppDePruebas() {
  cargarEnv();
  return process.env.DATABASE_URL_APP || URL_APP_POR_DEFECTO;
}

export function urlDe(servidor, base) {
  const usuario = encodeURIComponent(servidor.usuario);
  const clave = encodeURIComponent(servidor.clave);
  return `postgresql://${usuario}:${clave}@${servidor.host}:${servidor.puerto}/${base}`;
}

/** Nombres únicos para una pareja de bases temporales (desarrollo y pruebas). */
export function nombresTemporales() {
  const sufijo = crypto.randomBytes(5).toString('hex');
  return { desarrollo: `aqua_tmp_${sufijo}`, pruebas: `aqua_tmp_${sufijo}_pruebas` };
}

async function conectar(servidor, base = 'postgres') {
  const cliente = new pg.Client({
    host: servidor.host,
    port: servidor.puerto,
    user: servidor.usuario,
    password: servidor.clave,
    database: base,
  });
  await cliente.connect();
  return cliente;
}

export async function existeBase(servidor, nombre) {
  const cliente = await conectar(servidor);
  try {
    const { rowCount } = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]);
    return rowCount > 0;
  } finally {
    await cliente.end();
  }
}

export async function ejecutarSql(servidor, base, sql) {
  const cliente = await conectar(servidor, base);
  try {
    return await cliente.query(sql);
  } finally {
    await cliente.end();
  }
}

export async function tablasDePublic(servidor, base) {
  const { rows } = await ejecutarSql(
    servidor,
    base,
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  // Ordenadas en JavaScript: el orden del servidor depende de la configuración regional de PostgreSQL.
  return rows.map((fila) => fila.table_name).sort();
}

const INSUFFICIENT_PRIVILEGE = '42501';
const OBJECT_IN_USE = '55006';

const esperar = (milisegundos) => new Promise((resolver) => setTimeout(resolver, milisegundos));

/**
 * Borra una base temporal. `WITH (FORCE)` termina las demás sesiones de la base, y un usuario que no es superusuario
 * (la nube) no puede terminar las del autovacuum de PostgreSQL: el autovacuum se conecta a las bases recién creadas
 * (las que nunca ha procesado van primero) y, si coincide con el DROP, PostgreSQL responde "permission denied to
 * terminate process" (42501). Es una sesión pasajera, así que se reintenta: en cuanto termina, el DROP prospera.
 */
async function borrarBase(cliente, nombre) {
  const maximo = 40;
  for (let intento = 1; ; intento++) {
    try {
      await cliente.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
      return;
    } catch (error) {
      const pasajero = error && (error.code === INSUFFICIENT_PRIVILEGE || error.code === OBJECT_IN_USE);
      if (!pasajero || intento >= maximo) throw error;
      await esperar(250);
    }
  }
}

export async function borrarBases(servidor, nombres) {
  const cliente = await conectar(servidor);
  try {
    for (const nombre of nombres) await borrarBase(cliente, nombre);
  } finally {
    await cliente.end();
  }
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Busca en la salida de un script señales de que mostró una contraseña, sin confundirla con los identificadores
 * (rol, bases) cuyo nombre la contiene: la contraseña de desarrollo `aquagestion` es subcadena de `aquagestion_app`,
 * así que un `not.toContain(clave)` ingenuo fallaría con la configuración por defecto. Devuelve la lista de señales
 * encontradas (vacía si no hay filtración); se usa con `expect(filtracionesDeClave(...)).toEqual([])`.
 *
 * Señales que siempre se buscan (en claro y codificada como en una URL):
 *  - `:<clave>@`, la parte de una URL de conexión donde va la contraseña;
 *  - `PASSWORD '<clave>'` / `PASSWORD <clave>` y `password=<clave>` / `contraseña: <clave>`;
 * Además, si la clave no es ella misma un nombre de usuario o de base (`conocidos`), se busca como palabra aislada
 * (no precedida ni seguida de letras, dígitos o guion bajo, de modo que `aquagestion_app` no cuenta) y entre comillas.
 * Si la clave coincide con un nombre conocido solo rigen las señales con contexto, porque un `aquagestion` suelto es
 * indistinguible del nombre del usuario o de la base.
 */
export function filtracionesDeClave(salida, clave, conocidos = []) {
  if (!clave) return [];
  const hallazgos = [];
  const variantes = [...new Set([clave, encodeURIComponent(clave)])];
  for (const variante of variantes) {
    const c = escaparRegex(variante);
    const contextos = [
      ['`:<clave>@`', new RegExp(`:${c}@`)],
      ['PASSWORD con la clave', new RegExp(`PASSWORD\\s+'?${c}(?![\\w])`, 'i')],
      ['password=<clave>', new RegExp(`(?:password|contrase(?:ñ|n)a|clave)\\s*[=:]\\s*['"]?${c}(?![\\w])`, 'i')],
    ];
    for (const [nombre, patron] of contextos) if (patron.test(salida)) hallazgos.push(nombre);
    const esUnNombreConocido = conocidos.includes(clave);
    if (!esUnNombreConocido) {
      if (new RegExp(`(?<![\\w])${c}(?![\\w])`).test(salida)) hallazgos.push('la clave como palabra aislada');
      if (new RegExp(`['"]${c}['"]`).test(salida)) hallazgos.push('la clave entre comillas');
    }
  }
  return [...new Set(hallazgos)];
}

/** `filtracionesDeClave` para la contraseña del servidor de pruebas, con su usuario, su base y el rol de la app como nombres conocidos. */
export function filtracionesDeLaClaveDelServidor(salida, servidor) {
  return filtracionesDeClave(salida, servidor.clave, [servidor.usuario, servidor.base, USUARIO_APP]);
}

/** Ejecuta un script de la carpeta `scripts/` con Node, como lo haría `npm run`, con variables de entorno propias. */
export function ejecutarScript(argumentos, variables) {
  const resultado = spawnSync(
    process.execPath,
    [path.join(carpetaScripts, ...argumentos[0].split('/')), ...argumentos.slice(1)],
    {
      encoding: 'utf8',
      env: { ...process.env, ...variables },
      timeout: 120_000,
    },
  );
  return {
    estado: resultado.status,
    salida: `${resultado.stdout}${resultado.stderr}`,
  };
}
