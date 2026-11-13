import path from 'node:path';
import dotenv from 'dotenv';
import { opcionesDotenv } from './opciones-dotenv';

/**
 * Carga el .env de la raíz del repositorio (un solo .env para todo el proyecto). Las variables ya definidas, como
 * las de la integración continua, no se sobrescriben. Desde `src/` o `dist/` la raíz queda cuatro carpetas arriba.
 */
export function cargarEnvRaiz(): void {
  dotenv.config(opcionesDotenv(path.resolve(__dirname, '..', '..', '..', '..', '.env')));
}
