import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import { PrismaClient } from '../generated/prisma/client';
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
 * valores de contexto con `set_config(…, true)` (locales a la transacción): `app.academia_id` vacío y `app.plataforma`
 * en `si`, aunque la conexión traiga otros por la URL (`options`), por el rol o por la base (criterio 90), y la zona horaria
 * en `UTC` (criterio 98: el adaptador de Prisma envía las fechas sin desfase) y los parámetros de formato `DateStyle`,
 * `IntervalStyle`, `extra_float_digits` y `bytea_output` (criterio 107: el adaptador interpreta el texto que devuelve
 * PostgreSQL y ese texto depende de la sesión). A continuación cierra todo cursor que haya
 * sobrevivido en la conexión (`CLOSE ALL`, criterio 101). Toda transacción de academia que agregue un comando en el futuro
 * fija también los dos valores.
 */
export function enPlataforma<T>(cliente: PrismaClient, trabajo: (tx: ClienteTransaccion) => Promise<T>): Promise<T> {
  return cliente.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.academia_id', '', true), set_config('app.plataforma', 'si', true), set_config('TimeZone', 'UTC', true), set_config('DateStyle', 'ISO, MDY', true), set_config('IntervalStyle', 'postgres', true), set_config('extra_float_digits', '1', true), set_config('bytea_output', 'hex', true)`;
    await cerrarCursores(tx);
    return trabajo(tx);
  });
}
