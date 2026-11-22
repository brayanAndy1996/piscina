import type { TestProject } from 'vitest/node';
import { borrarAlmacenDePruebas, crearAlmacenDePruebas } from './almacen-de-pruebas';

/**
 * Crea el almacén temporal de las pruebas del backend antes de la ejecución y lo borra al terminar (spec 005, criterio 63). La ruta es la
 * `ALMACEN_DIRECTORIO` que `vitest.config.mts` fija en el `env` del proyecto; si no está o no es un directorio temporal de este tipo, no
 * hace nada (nunca borra otra cosa).
 */
export default function prepararAlmacenDePruebas(project: TestProject): () => void {
  const directorio = project.config.env?.['ALMACEN_DIRECTORIO'];
  if (typeof directorio !== 'string' || directorio === '') return () => undefined;
  crearAlmacenDePruebas(directorio);
  return () => borrarAlmacenDePruebas(directorio);
}
