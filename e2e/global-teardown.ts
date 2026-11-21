import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PREFIJO_ALMACEN_E2E = 'aqua-e2e-almacen-';

/**
 * Borra el almacén temporal de la API de las E2E (spec 005, criterio 63). Solo borra lo que es, sin duda, un directorio temporal de este tipo:
 * dentro de `os.tmpdir()` y con el prefijo del almacén de las E2E.
 */
export default function borrarAlmacenDeLasE2e(): void {
  const directorio = process.env['AQUA_ALMACEN_E2E'];
  if (!directorio) return;
  const relativa = path.relative(os.tmpdir(), directorio);
  const esTemporal =
    path.basename(directorio).startsWith(PREFIJO_ALMACEN_E2E) &&
    relativa !== '' &&
    !relativa.startsWith('..') &&
    !path.isAbsolute(relativa);
  if (!esTemporal) return;
  fs.rmSync(directorio, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
