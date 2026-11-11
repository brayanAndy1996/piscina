// spec: 001-academias-aislamiento (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '../../src/generated/prisma/client';
import { ejecutarComo } from './base-datos';
import { obtenerBaseDatos } from './modulos';

/**
 * Ayudas de las pruebas protegidas de la ronda 3 del ataque (criterios 98 a 105).
 *
 * Desde el criterio 100, dentro de `trabajo` el cliente es un envoltorio que solo tiene `$queryRaw`, `$executeRaw` y los
 * delegados de los modelos: las pruebas nuevas usan solo esas dos funciones (como etiqueta de plantilla o con `Prisma.sql` /
 * `Prisma.raw`), que funcionan igual antes y despues del envoltorio.
 */

export { Prisma };

const RAIZ_SRC = path.resolve(__dirname, '..', '..', 'src');

/**
 * Carga un modulo de produccion de la 001 que todavia puede no existir y comprueba sus exportaciones. Si falta, la prueba
 * falla con un mensaje claro ("falta la funcionalidad") y no con un error de tipos que rompa el repositorio.
 */
export async function cargarFuncionalidad<T>(rutaDesdeSrc: string, exportaciones: readonly string[]): Promise<T> {
  const ruta = path.join(RAIZ_SRC, rutaDesdeSrc);
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`Falta la funcionalidad de la 001: no se pudo cargar "backend/src/${rutaDesdeSrc}" (${motivo}).`, {
      cause: error,
    });
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 001: "backend/src/${rutaDesdeSrc}" no exporta ${nombre}.`);
    }
  }
  return modulo as T;
}

/** Cliente dentro de una transaccion de `BaseDatos`: lo unico que tiene en comun el cliente de antes y el envoltorio. */
export interface ClienteRonda3 {
  $queryRaw<T = unknown>(consulta: TemplateStringsArray | Prisma.Sql, ...valores: unknown[]): Promise<T>;
  $executeRaw(consulta: TemplateStringsArray | Prisma.Sql, ...valores: unknown[]): Promise<number>;
}
export interface TransaccionAcademiaRonda3 {
  readonly academiaId: string;
  readonly cliente: ClienteRonda3;
}
export interface TransaccionPlataformaRonda3 {
  readonly cliente: ClienteRonda3;
}
export interface BaseDatosRonda3 {
  conAcademia<T>(academiaId: string, trabajo: (tx: TransaccionAcademiaRonda3) => Promise<T>): Promise<T>;
  comoPlataforma<T>(trabajo: (tx: TransaccionPlataformaRonda3) => Promise<T>): Promise<T>;
  resolverAcademia(nombreCorto: string): Promise<{ id: string; nombre: string; nombreCorto: string } | null>;
  comprobarConexion(): Promise<void>;
}

/** `BaseDatos` de la aplicacion de pruebas, con el tipo de cliente de la ronda 3 (solo `$queryRaw` y `$executeRaw`). */
export async function obtenerBaseDatosRonda3(app: INestApplication): Promise<BaseDatosRonda3> {
  return (await obtenerBaseDatos(app)) as unknown as BaseDatosRonda3;
}

/** `url` con `?options=<opciones>` (codificado), por ejemplo `-c TimeZone=Pacific/Kiritimati`. */
export function urlConOpciones(url: string, opciones: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(opciones)}`;
}

/** Texto del error y de sus partes (Prisma deja el codigo de PostgreSQL en el mensaje y en `meta`). */
export function textoDelError(error: unknown): string {
  if (error === undefined || error === null) return '';
  if (!(error instanceof Error)) return typeof error === 'string' ? error : JSON.stringify(error);
  const extra = error as { code?: unknown; meta?: unknown };
  const codigo = typeof extra.code === 'string' ? extra.code : '';
  return [error.name, error.message, codigo, JSON.stringify(extra.meta ?? null), textoDelError(error.cause)].join(' ');
}

/** Ejecuta `trabajo` y devuelve el error que lanza (o `undefined` si termina bien). */
export async function intentar(trabajo: () => Promise<unknown>): Promise<unknown> {
  try {
    await trabajo();
    return undefined;
  } catch (error) {
    return error;
  }
}

export function citar(identificador: string): string {
  return `"${identificador.replaceAll('"', '""')}"`;
}

export async function nombreDeLaBase(): Promise<string> {
  const { rows } = await ejecutarComo('propietario', 'SELECT current_database() AS base');
  return (rows[0] as { base: string }).base;
}

/** Espera (hasta `ms` milisegundos) a que se cumpla una condicion. */
export async function esperarCondicion(condicion: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const limite = performance.now() + ms;
  while (!(await condicion()) && performance.now() < limite) await new Promise((resolver) => setTimeout(resolver, 20));
}
