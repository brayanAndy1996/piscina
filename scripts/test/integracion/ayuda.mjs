// Utilidades de las pruebas de integración de los scripts: bases temporales con nombres únicos en el servidor de
// DATABASE_URL_PRUEBAS. Nunca se tocan las bases reales: cada prueba crea y borra las suyas.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { analizarUrlPostgres, cargarEnv } from '../../lib/entorno.mjs';

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
