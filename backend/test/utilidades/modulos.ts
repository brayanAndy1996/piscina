// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { INestApplication, Type } from '@nestjs/common';
import { Writable } from 'node:stream';

/**
 * Carga de los módulos de producción de la historia 001 que se describen en el "Contrato" de `spec.md`.
 * Se cargan con importación dinámica y se tipan aquí con lo que dice el contrato: así, antes de implementarlos las
 * pruebas fallan con un mensaje claro ("falta el módulo ...") y no con errores de tipos que rompan el repositorio.
 */

const RAIZ_SRC = path.resolve(__dirname, '..', '..', 'src');

async function cargarModulo<T>(rutaDesdeSrc: string, exportaciones: readonly string[]): Promise<T> {
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
    if (typeof modulo[nombre] !== 'function') {
      throw new Error(`Falta la funcionalidad de la 001: "backend/src/${rutaDesdeSrc}" no exporta ${nombre}.`);
    }
  }
  return modulo as T;
}

/** Cliente de Prisma dentro de una transacción: en las pruebas solo se usa SQL directo. */
export interface ClientePrueba {
  $queryRawUnsafe<T = unknown>(sql: string, ...valores: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...valores: unknown[]): Promise<number>;
}
export interface TransaccionAcademiaPrueba {
  readonly academiaId: string;
  readonly cliente: ClientePrueba;
}
export interface TransaccionPlataformaPrueba {
  readonly cliente: ClientePrueba;
}
export interface OpcionesTransaccionPrueba {
  readonly aislamiento?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}
export interface AcademiaResueltaPrueba {
  id: string;
  nombre: string;
  nombreCorto: string;
  estado: 'ACTIVA' | 'SUSPENDIDA';
}
export interface BaseDatosPrueba {
  conAcademia<T>(
    academiaId: string,
    trabajo: (tx: TransaccionAcademiaPrueba) => Promise<T>,
    opciones?: OpcionesTransaccionPrueba,
  ): Promise<T>;
  comoPlataforma<T>(
    trabajo: (tx: TransaccionPlataformaPrueba) => Promise<T>,
    opciones?: OpcionesTransaccionPrueba,
  ): Promise<T>;
  resolverAcademia(nombreCorto: string): Promise<AcademiaResueltaPrueba | null>;
  comprobarConexion(): Promise<void>;
}
export interface ModuloPrisma {
  BaseDatos: Type<BaseDatosPrueba>;
  ErrorAcademiaNoEncontrada: Type<Error>;
  ErrorAcademiaSuspendida: Type<Error>;
  ErrorRolBaseDatosInseguro: Type<Error>;
}

/** `backend/src/infraestructura/prisma/index.ts` (criterios 3, 4 y 21 a 28). */
export function cargarPrisma(): Promise<ModuloPrisma> {
  return cargarModulo<ModuloPrisma>('infraestructura/prisma/index.ts', [
    'BaseDatos',
    'ErrorAcademiaNoEncontrada',
    'ErrorAcademiaSuspendida',
    'ErrorRolBaseDatosInseguro',
  ]);
}

export interface EntradaAuditoriaPrueba {
  actorTipo: 'USUARIO' | 'SUPERADMIN' | 'SISTEMA';
  actorId: string | null;
  accion: string;
  entidad: string;
  entidadId: string | null;
  datosAntes?: unknown;
  datosDespues?: unknown;
  motivo?: string | null;
  ip?: string | null;
}
export interface AuditoriaServicePrueba {
  registrarEnAcademia(tx: TransaccionAcademiaPrueba, entrada: EntradaAuditoriaPrueba): Promise<void>;
  registrarEnPlataforma(tx: TransaccionPlataformaPrueba, entrada: EntradaAuditoriaPrueba): Promise<void>;
}
export interface ModuloAuditoria {
  AuditoriaService: Type<AuditoriaServicePrueba>;
}

/** `backend/src/modulos/auditoria/index.ts` (criterios 29 a 31). */
export function cargarAuditoria(): Promise<ModuloAuditoria> {
  return cargarModulo<ModuloAuditoria>('modulos/auditoria/index.ts', ['AuditoriaService']);
}

/** `BaseDatos` de la aplicación de pruebas. */
export async function obtenerBaseDatos(app: INestApplication): Promise<BaseDatosPrueba> {
  const { BaseDatos } = await cargarPrisma();
  return app.get(BaseDatos, { strict: false });
}

/** `AuditoriaService` de la aplicación de pruebas. */
export async function obtenerAuditoria(app: INestApplication): Promise<AuditoriaServicePrueba> {
  const { AuditoriaService } = await cargarAuditoria();
  return app.get(AuditoriaService, { strict: false });
}

/** Un UUID v4 cualquiera, que no corresponde a ninguna academia creada por las pruebas. */
export function uuidInexistente(): string {
  const hex = randomBytes(16).toString('hex').split('');
  hex[12] = '4';
  hex[16] = '8';
  const t = hex.join('');
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20)}`;
}

/** Destino de registros en memoria (una línea JSON por entrada), para comprobar qué se escribió en el log. */
export function crearDestinoDeRegistro(): { destino: Writable; lineas: string[] } {
  const lineas: string[] = [];
  const destino = new Writable({
    write(trozo: Buffer, _codificacion, listo) {
      lineas.push(...trozo.toString('utf8').split('\n').filter(Boolean));
      listo();
    },
  });
  return { destino, lineas };
}

/** Espera (hasta 3 segundos) a que se cumpla una condición. */
export async function esperarHasta(condicion: () => boolean): Promise<void> {
  const limite = performance.now() + 3000;
  while (!condicion() && performance.now() < limite) await new Promise((resolver) => setTimeout(resolver, 10));
}
