import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import { PrismaClient } from '../generated/prisma/client';
import type { ClienteTransaccion } from '../infraestructura/prisma';

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

export function crearClienteDelDueno(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** Ejecuta `trabajo` en una transacción con `app.plataforma = 'si'` (local a la transacción). */
export function enPlataforma<T>(cliente: PrismaClient, trabajo: (tx: ClienteTransaccion) => Promise<T>): Promise<T> {
  return cliente.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.plataforma', 'si', true)`;
    return trabajo(tx);
  });
}
