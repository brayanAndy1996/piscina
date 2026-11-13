// spec: 001-academias-aislamiento (pruebas protegidas)
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

/**
 * Credencial de desarrollo inventada que tendrá `DATABASE_URL_APP` en `.env.example` (no es una credencial real): se
 * usa si el entorno y el `.env` local todavía no la definen.
 */
export const URL_APP_POR_DEFECTO = 'postgresql://aquagestion_app:aquagestion_app@127.0.0.1:5432/aquagestion';

/**
 * URL de la app sobre la base de pruebas: usuario y contraseña de `urlApp`; host, puerto, base y parámetros de
 * `urlBase` (spec 001, "Roles de PostgreSQL y variables de entorno").
 */
export function urlAppSobre(urlBase: string, urlApp: string): string {
  const resultado = new URL(urlBase);
  const app = new URL(urlApp);
  resultado.username = app.username;
  resultado.password = app.password;
  return resultado.toString();
}

/** `DATABASE_URL_APP` del entorno del proceso o del `.env` de la raíz; si ninguno la define, la de `.env.example`. */
export function leerUrlAppConfigurada(raiz: string, entorno: Readonly<Record<string, string | undefined>>): string {
  const delEntorno = entorno['DATABASE_URL_APP']?.trim();
  if (delEntorno) return delEntorno;
  const ruta = path.join(raiz, '.env');
  if (fs.existsSync(ruta)) {
    // Con `dotenv.parse`, el mismo analizador que usa el backend: BOM, variable repetida y comillas se leen igual (spec 001, criterio 172).
    const delArchivo = dotenv.parse(fs.readFileSync(ruta, 'utf8'))['DATABASE_URL_APP']?.trim();
    if (delArchivo) return delArchivo;
  }
  return URL_APP_POR_DEFECTO;
}

function exigirVariable(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`${nombre} no está definida: el globalSetup de las pruebas de integración debe fijarla.`);
  }
  return valor;
}

/** URL del dueño de las tablas sobre la base de pruebas (`DATABASE_URL_PRUEBAS`). */
export function urlPropietarioPruebas(): string {
  return exigirVariable('DATABASE_URL_PRUEBAS');
}

/** URL del rol `aquagestion_app` sobre la base de pruebas (la fija el `globalSetup`). */
export function urlAppPruebas(): string {
  return exigirVariable('DATABASE_URL_APP');
}

export type RolPruebas = 'propietario' | 'app';

/**
 * Contexto de la transacción, fijado con `set_config(..., true)`. `academiaId` se fija tal cual (puede ser un texto
 * inválido); `plataforma: true` fija `si` y un texto fija ese texto; `false` o ausente no fija nada.
 */
export interface Contexto {
  academiaId?: string;
  plataforma?: boolean | string;
}

function urlDe(rol: RolPruebas): string {
  return rol === 'app' ? urlAppPruebas() : urlPropietarioPruebas();
}

async function fijarContexto(cliente: pg.ClientBase, contexto: Contexto | undefined): Promise<void> {
  if (contexto?.academiaId !== undefined) {
    await cliente.query("SELECT set_config('app.academia_id', $1, true)", [contexto.academiaId]);
  }
  const plataforma = contexto?.plataforma;
  if (plataforma !== undefined && plataforma !== false) {
    await cliente.query("SELECT set_config('app.plataforma', $1, true)", [plataforma === true ? 'si' : plataforma]);
  }
}

/**
 * Abre una conexión nueva con el rol indicado, la entrega a `trabajo` y la cierra. No abre ninguna transacción: quien
 * la necesite ejecuta `BEGIN` y `COMMIT` o `ROLLBACK` por su cuenta.
 */
export async function conClienteComo<T>(rol: RolPruebas, trabajo: (cliente: pg.ClientBase) => Promise<T>): Promise<T> {
  const cliente = new pg.Client({ connectionString: urlDe(rol) });
  await cliente.connect();
  try {
    return await trabajo(cliente);
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

/**
 * Abre una transacción con el rol indicado, fija el contexto si se indica, ejecuta `sql` y confirma. Si PostgreSQL
 * responde con error, revierte y rechaza con el error de `pg` (con su `code`).
 */
export async function ejecutarComo(
  rol: RolPruebas,
  sql: string,
  parametros: unknown[] = [],
  contexto?: Contexto,
): Promise<pg.QueryResult> {
  return conClienteComo(rol, async (cliente) => {
    await cliente.query('BEGIN');
    try {
      await fijarContexto(cliente, contexto);
      const resultado = await cliente.query(sql, parametros);
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Ejecuta `trabajo` dentro de una transacción con el contexto indicado y la revierte siempre: sirve para probar
 * escrituras que deben funcionar sin dejar datos. Lo que `trabajo` lance se propaga.
 */
export async function conTransaccionRevertida<T>(
  rol: RolPruebas,
  contexto: Contexto | undefined,
  trabajo: (cliente: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return conClienteComo(rol, async (cliente) => {
    await cliente.query('BEGIN');
    try {
      await fijarContexto(cliente, contexto);
      return await trabajo(cliente);
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined);
    }
  });
}

/** Nombres de las tablas de `public`, sin `_prisma_migrations`. */
export async function tablasDelNegocio(): Promise<string[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
  );
  return rows.map((fila: { tablename: string }) => fila.tablename);
}

/** `TRUNCATE` de todas las tablas de `public` salvo `_prisma_migrations`. No falla si todavía no hay tablas. */
export async function limpiarBase(): Promise<void> {
  const tablas = await tablasDelNegocio();
  if (tablas.length === 0) return;
  const lista = tablas.map((tabla) => `"public"."${tabla}"`).join(', ');
  await ejecutarComo('propietario', `TRUNCATE ${lista} CASCADE`);
}
