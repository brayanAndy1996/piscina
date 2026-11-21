import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * El almacén de archivos de las pruebas del backend (spec 005, criterio 63; D-26): un directorio temporal fuera del repositorio, para que
 * ninguna prueba escriba en `backend/almacenamiento`, el almacén de quien desarrolla. `vitest.config.mts` fija `ALMACEN_DIRECTORIO` con
 * esta ruta para los procesos de prueba y el `globalSetup` (`global-setup-almacen.ts`) la crea y la borra al terminar. Los dos corren en el
 * proceso principal de Vitest, así que comparten el nombre por el número de ese proceso (sin variables de entorno que un proceso hijo pueda heredar).
 */
const PREFIJO = 'aqua-almacen-';

/** Solo se borra lo que es, sin duda, un directorio temporal de este tipo: dentro de `os.tmpdir()` y con el prefijo. */
export function esDirectorioTemporalDelAlmacen(directorio: string): boolean {
  const relativa = path.relative(os.tmpdir(), directorio);
  return (
    path.basename(directorio).startsWith(PREFIJO) &&
    relativa !== '' &&
    !relativa.startsWith('..') &&
    !path.isAbsolute(relativa)
  );
}

export function crearAlmacenDePruebas(directorio: string): void {
  if (!esDirectorioTemporalDelAlmacen(directorio)) return;
  fs.rmSync(directorio, { recursive: true, force: true });
  fs.mkdirSync(directorio, { recursive: true });
}

export function borrarAlmacenDePruebas(directorio: string): void {
  if (!esDirectorioTemporalDelAlmacen(directorio)) return;
  fs.rmSync(directorio, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
