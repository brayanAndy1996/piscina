import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import { PrismaClient } from '../generated/prisma/client';
import { parametrosDeConexionProhibidos } from '../infraestructura/entorno/url-postgres';
import { cerrarCursores, type ClienteTransaccion } from '../infraestructura/prisma';

/**
 * Utilidades de los comandos del proyecto (`npm run plataforma:superadmin`, `npm run db:semilla`). Los comandos usan
 * la conexión del dueño de las tablas (`DATABASE_URL`) y, igual que la API, fijan el contexto de plataforma en cada
 * transacción para pasar por la seguridad a nivel de fila (RLS) también cuando el dueño no es superusuario.
 */

/** Carga el `.env` de la raíz sin sobrescribir las variables ya definidas (las del entorno mandan). */
export function cargarEnvDeLaRaiz(): void {
  // Este archivo está en `backend/src/cli/`: la raíz del repositorio queda tres carpetas arriba.
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env'), quiet: true });
}

/** Valor de una variable, o `undefined` si falta o está vacía (o solo tiene espacios). */
export function leerVariable(env: Readonly<Record<string, string | undefined>>, nombre: string): string | undefined {
  const valor = env[nombre];
  return valor !== undefined && valor.trim() !== '' ? valor : undefined;
}

/**
 * Problema de una URL de conexión antes de abrirla (spec 001, criterio 143, P-34): `undefined` si está bien. Rechaza una URL
 * con `user`, `host`, `hostaddr`, `password`, `port`, `dbname` o `database` en la cadena de consulta, porque `pg` los toma por
 * encima de la parte principal; y, por falla cerrada, una URL que `new URL` no acepte. El mensaje nombra la variable y los
 * parámetros, nunca la URL, sus valores ni la contraseña.
 */
export function problemaDeUrlDeConexion(url: string, nombreVariable: string): string | undefined {
  let prohibidos: string[];
  try {
    prohibidos = parametrosDeConexionProhibidos(url);
  } catch {
    return `La variable ${nombreVariable} no es una URL válida.`;
  }
  if (prohibidos.length === 0) return undefined;
  return `La variable ${nombreVariable} no puede llevar ${prohibidos.length === 1 ? 'el parámetro' : 'los parámetros'} ${prohibidos.join(', ')} en la cadena de consulta: el usuario, el servidor y la base van en la parte principal de la URL.`;
}

/** Opciones de `crearClienteDelDueno`: `max` limita el pool de conexiones (por defecto, el de `pg`; spec 001, P-23). */
export interface OpcionesClienteDelDueno {
  readonly max?: number;
}

/**
 * Cliente de Prisma con la conexión del dueño. Se declara con dos firmas (con y sin `opciones`) para que quien la envuelve con
 * `Reflect.apply` y una aserción de tipo (la prueba del criterio 101) no tenga que lidiar con la inferencia de la genérica.
 */
export function crearClienteDelDueno(url: string, opciones: OpcionesClienteDelDueno): PrismaClient;
export function crearClienteDelDueno(url: string): PrismaClient;
export function crearClienteDelDueno(url: string, opciones: OpcionesClienteDelDueno = {}): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, ...(opciones.max === undefined ? {} : { max: opciones.max }) }),
  });
}

/**
 * Ejecuta `trabajo` en una transacción de plataforma. Igual que `BaseDatos`, la primera sentencia fija **los dos**
 * valores de contexto con `pg_catalog.set_config(…, true)` (locales a la transacción): `app.academia_id` vacío y
 * `app.plataforma` en `si`, el `search_path` en `pg_catalog, public, pg_temp` y `standard_conforming_strings` en `on` (criterios
 * 121 y 122; cada función calificada con `pg_catalog.`, porque PostgreSQL la resuelve antes de fijar el `search_path`), aunque la conexión traiga otros por la URL (`options`), por el rol o por la base (criterio 90), y la zona horaria
 * en `UTC` (criterio 98: el adaptador de Prisma envía las fechas sin desfase) y los parámetros de formato `DateStyle`,
 * `IntervalStyle`, `extra_float_digits` y `bytea_output` (criterio 107: el adaptador interpreta el texto que devuelve
 * PostgreSQL y ese texto depende de la sesión). Fija también `client_encoding` en `UTF8` (criterio 146: el adaptador envía y
 * lee siempre UTF-8) y `synchronous_commit` en `on`, `array_nulls` en `on` y `transform_null_equals` en `off` (criterio 147:
 * lo que se confirma y lo que se escribe no depende de la sesión). A continuación cierra todo cursor que haya
 * sobrevivido en la conexión (`CLOSE ALL`, criterio 101). Toda transacción de academia que agregue un comando en el futuro
 * fija también los dos valores.
 */
export function enPlataforma<T>(cliente: PrismaClient, trabajo: (tx: ClienteTransaccion) => Promise<T>): Promise<T> {
  return cliente.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true), pg_catalog.set_config('standard_conforming_strings', 'on', true), pg_catalog.set_config('app.academia_id', '', true), pg_catalog.set_config('app.plataforma', 'si', true), pg_catalog.set_config('TimeZone', 'UTC', true), pg_catalog.set_config('DateStyle', 'ISO, MDY', true), pg_catalog.set_config('IntervalStyle', 'postgres', true), pg_catalog.set_config('extra_float_digits', '1', true), pg_catalog.set_config('bytea_output', 'hex', true), pg_catalog.set_config('client_encoding', 'UTF8', true), pg_catalog.set_config('synchronous_commit', 'on', true), pg_catalog.set_config('array_nulls', 'on', true), pg_catalog.set_config('transform_null_equals', 'off', true)`;
    await cerrarCursores(tx);
    return trabajo(tx);
  });
}
