import type { Prisma } from '../../generated/prisma/client';

/**
 * Cierra todo cursor abierto en la conexión (`CLOSE ALL`; spec 001, criterio 101). Un cursor `WITH HOLD` sobrevive a la
 * transacción que lo declaró y el siguiente `conAcademia` de la misma conexión del pool podría leer, con él, filas de otra
 * academia. Cada transacción de `BaseDatos` y de `enPlataforma` (comandos) lo ejecuta justo después de fijar el contexto.
 *
 * Vive aquí porque el lint prohíbe `CLOSE` en el código fuera de `infraestructura/prisma/` (criterio 94), también en `cli/`.
 * Es una sentencia aparte: `CLOSE` no se puede combinar con un `SELECT` en el protocolo extendido.
 */
export async function cerrarCursores(tx: Pick<Prisma.TransactionClient, '$executeRaw'>): Promise<void> {
  await tx.$executeRaw`CLOSE ALL`;
}
