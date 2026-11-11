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
  return rows.map((fila) => fila.table_name);
}

export async function borrarBases(servidor, nombres) {
  const cliente = await conectar(servidor);
  try {
    for (const nombre of nombres) await cliente.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
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
