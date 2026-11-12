import type { Prisma } from '../../generated/prisma/client';
import { codigoDeErrorDeBase } from './errores-base';
import { ErrorTransaccionAbortada } from './errores';

/**
 * Comprobación del final de toda transacción (spec 001, criterios 149 a 151, P-36). La primera sentencia de cada transacción
 * fija `app.transaccion` con una marca aleatoria (`set_config(..., true)`, local). Después de `trabajo`, esta función lee la
 * marca con el cliente crudo de la transacción:
 *
 * - si la consulta rechaza con `25P02` (transacción abortada: `trabajo` atrapó un error de la base y siguió), lanza
 *   `ErrorTransaccionAbortada`;
 * - si rechaza con otro error (conexión perdida, tiempo agotado), lo relanza tal cual;
 * - si la marca leída no es la esperada (un `ROLLBACK` o un `COMMIT` escritos en `trabajo` dejaron la sentencia fuera de la
 *   transacción), lanza `ErrorTransaccionAbortada`.
 *
 * Al lanzar dentro del callback de `$transaction`, Prisma revierte y la llamada rechaza con ese error.
 */
export async function comprobarTransaccionViva(tx: Prisma.TransactionClient, marca: string): Promise<void> {
  let filas: { marca: string | null }[];
  try {
    filas = await tx.$queryRaw<{ marca: string | null }[]>`
      SELECT pg_catalog.current_setting('app.transaccion', true) AS marca`;
  } catch (error) {
    if (codigoDeErrorDeBase(error) === '25P02') throw new ErrorTransaccionAbortada({ cause: error });
    throw error;
  }
  if (filas[0]?.marca !== marca) throw new ErrorTransaccionAbortada();
}
