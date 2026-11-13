import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import { PrismaClient } from '../generated/prisma/client';
import { opcionesDotenv } from '../infraestructura/entorno/opciones-dotenv';
import { parametrosDeConexionProhibidos } from '../infraestructura/entorno/url-postgres';
import { cerrarCursores, comprobarTransaccionViva, type ClienteTransaccion } from '../infraestructura/prisma';

/**
 * Utilidades de los comandos del proyecto (`npm run plataforma:superadmin`, `npm run db:semilla`). Los comandos usan
 * la conexión del dueño de las tablas (`DATABASE_URL`) y, igual que la API, fijan el contexto de plataforma en cada
 * transacción para pasar por la seguridad a nivel de fila (RLS) también cuando el dueño no es superusuario.
 */

/** Carga el `.env` de la raíz sin sobrescribir las variables ya definidas (las del entorno mandan). */
export function cargarEnvDeLaRaiz(): void {
  // Este archivo está en `backend/src/cli/`: la raíz del repositorio queda tres carpetas arriba.
  dotenv.config(opcionesDotenv(path.resolve(__dirname, '..', '..', '..', '.env')));
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

/** Turnos del ciclo de eventos que `enPlataforma` cede antes de comprobar la transacción (criterio 150). */
const TURNOS_DE_CESION = 3;

/**
 * Ejecuta `trabajo` en una transacción de plataforma. Igual que `BaseDatos`, la primera sentencia fija **los dos**
 * valores de contexto con `pg_catalog.set_config(…, true)` (locales a la transacción): `app.academia_id` vacío y
 * `app.plataforma` en `si`, el `search_path` en `pg_catalog, public, pg_temp` y `standard_conforming_strings` en `on` (criterios
 * 121 y 122; cada función calificada con `pg_catalog.`, porque PostgreSQL la resuelve antes de fijar el `search_path`), aunque la conexión traiga otros por la URL (`options`), por el rol o por la base (criterio 90), y la zona horaria
 * en `UTC` (criterio 98: el adaptador de Prisma envía las fechas sin desfase) y los parámetros de formato `DateStyle`,
 * `IntervalStyle`, `extra_float_digits` y `bytea_output` (criterio 107: el adaptador interpreta el texto que devuelve
 * PostgreSQL y ese texto depende de la sesión). Fija también `client_encoding` en `UTF8` (criterio 146: el adaptador envía y
 * lee siempre UTF-8) y `synchronous_commit` en `on`, `array_nulls` en `on` y `transform_null_equals` en `off` (criterio 147:
 * lo que se confirma y lo que se escribe no depende de la sesión). Fija además la marca aleatoria de la transacción en
 * `app.transaccion` (criterio 151). A continuación cierra todo cursor que haya sobrevivido en la conexión (`CLOSE ALL`, criterio
 * 101). Cuando `trabajo` termina bien comprueba que la transacción no quedó abortada ni fue reemplazada por un `ROLLBACK` o un
 * `COMMIT` escritos dentro (criterios 150 y 151) y, si no, rechaza con `ErrorTransaccionAbortada` sin confirmar nada. Toda transacción de academia que agregue un comando en el futuro
 * fija también los dos valores.
 *
 * Riesgo aceptado (spec 001, criterio 153, plan sección 23): `trabajo` recibe la transacción de Prisma sin el envoltorio de la
 * API, así que aquí no hay cola serial. Prisma agrupa en un lote las consultas que salen en el mismo turno y, si una falla con un
 * error que no es de la base, deja sin ejecutar las siguientes (sus promesas resuelven con `undefined`) y la transacción se
 * confirmaría sin ellas. Por eso, en comandos y en la semilla NO se lanzan consultas en paralelo dentro de `enPlataforma` (nada de
 * `Promise.all`, `Promise.allSettled` ni `map` con funciones `async` sobre `tx`): se encadenan con `await`.
 */
export function enPlataforma<T>(cliente: PrismaClient, trabajo: (tx: ClienteTransaccion) => Promise<T>): Promise<T> {
  return cliente.$transaction(async (tx) => {
    const marca = randomUUID();
    await tx.$queryRaw`SELECT pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true), pg_catalog.set_config('standard_conforming_strings', 'on', true), pg_catalog.set_config('app.academia_id', '', true), pg_catalog.set_config('app.plataforma', 'si', true), pg_catalog.set_config('TimeZone', 'UTC', true), pg_catalog.set_config('DateStyle', 'ISO, MDY', true), pg_catalog.set_config('IntervalStyle', 'postgres', true), pg_catalog.set_config('extra_float_digits', '1', true), pg_catalog.set_config('bytea_output', 'hex', true), pg_catalog.set_config('client_encoding', 'UTF8', true), pg_catalog.set_config('synchronous_commit', 'on', true), pg_catalog.set_config('array_nulls', 'on', true), pg_catalog.set_config('transform_null_equals', 'off', true), pg_catalog.set_config('app.transaccion', ${marca}, true)`;
    await cerrarCursores(tx);
    const resultado = await trabajo(tx);
    // Criterios 150 y 151: si `trabajo` atrapó un error de la base y siguió, la transacción quedó abortada y el `COMMIT` de Prisma
    // solo respondería `ROLLBACK`, sin error. Se cede el turno para que lleguen a la conexión las consultas que `trabajo` envió sin
    // `await`, y se comprueba que la transacción sigue viva y es la misma (la marca). Si `trabajo` lanza, no se llega aquí.
    for (let turno = 0; turno < TURNOS_DE_CESION; turno += 1) {
      await new Promise<void>((continuar) => {
        setImmediate(continuar);
      });
    }
    await comprobarTransaccionViva(tx, marca);
    return resultado;
  });
}

/**
 * Ejecuta `trabajo` en una transacción de una academia (spec 002: la semilla crea usuarios de ejemplo). Igual que `enPlataforma`
 * y que `BaseDatos`, la primera sentencia fija **los dos** valores de contexto con `pg_catalog.set_config(…, true)`: `app.academia_id`
 * en `academiaId` y `app.plataforma` vacío (la marca de plataforma no abre nada de una academia), y los mismos parámetros de sesión
 * (criterios 90, 98, 107, 121, 122, 146 y 147), la marca aleatoria de la transacción y el cierre de cursores. Al terminar comprueba
 * que la transacción sigue viva y es la misma (criterios 150 y 151). Como en `enPlataforma`, `trabajo` no lanza consultas en
 * paralelo: las encadena con `await`.
 */
export function enAcademia<T>(
  cliente: PrismaClient,
  academiaId: string,
  trabajo: (tx: ClienteTransaccion) => Promise<T>,
): Promise<T> {
  return cliente.$transaction(async (tx) => {
    const marca = randomUUID();
    await tx.$queryRaw`SELECT pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true), pg_catalog.set_config('standard_conforming_strings', 'on', true), pg_catalog.set_config('app.academia_id', ${academiaId}, true), pg_catalog.set_config('app.plataforma', '', true), pg_catalog.set_config('TimeZone', 'UTC', true), pg_catalog.set_config('DateStyle', 'ISO, MDY', true), pg_catalog.set_config('IntervalStyle', 'postgres', true), pg_catalog.set_config('extra_float_digits', '1', true), pg_catalog.set_config('bytea_output', 'hex', true), pg_catalog.set_config('client_encoding', 'UTF8', true), pg_catalog.set_config('synchronous_commit', 'on', true), pg_catalog.set_config('array_nulls', 'on', true), pg_catalog.set_config('transform_null_equals', 'off', true), pg_catalog.set_config('app.transaccion', ${marca}, true)`;
    await cerrarCursores(tx);
    const resultado = await trabajo(tx);
    for (let turno = 0; turno < TURNOS_DE_CESION; turno += 1) {
      await new Promise<void>((continuar) => {
        setImmediate(continuar);
      });
    }
    await comprobarTransaccionViva(tx, marca);
    return resultado;
  });
}
