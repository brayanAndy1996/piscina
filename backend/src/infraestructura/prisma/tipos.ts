import type { Prisma } from '../../generated/prisma/client';
import type { Fragmento } from './sql-seguro';

/**
 * Lo que `trabajo` recibe como `tx.cliente` (spec 001, criterio 100, precisiones P-24 y P-26): un envoltorio armado por
 * `BaseDatos` que solo tiene `$queryRaw`, `$executeRaw` y los delegados de los modelos. No tiene `$transaction`, `$connect`,
 * `$on`, `$extends`, `$queryRawUnsafe` ni `$parent`: con ellos un módulo podría salirse de la transacción o ejecutar SQL
 * armado como texto.
 *
 * En tiempo de ejecución, todo lo que devuelve es una `Promise` nativa que ya corre dentro de la transacción (criterio 106), y
 * `$queryRaw`/`$executeRaw` aceptan solo una plantilla etiquetada o un único argumento que sea un fragmento del punto autorizado
 * (`sql`, `join`, `vacio`) o un `Sql` de Prisma (criterio 112). Los comandos (`cli/`) pasan la transacción completa de Prisma,
 * que es asignable a este tipo (los métodos se comparan de forma bivariante).
 */
export interface ClienteTransaccion extends Pick<Prisma.TransactionClient, Uncapitalize<Prisma.ModelName>> {
  $queryRaw<T = unknown>(consulta: TemplateStringsArray | Prisma.Sql | Fragmento, ...valores: unknown[]): Promise<T>;
  $executeRaw(consulta: TemplateStringsArray | Prisma.Sql | Fragmento, ...valores: unknown[]): Promise<number>;
}

/** Transacción con una academia fijada: todo lo que se lea o escriba pertenece a `academiaId` (RLS). */
export interface TransaccionAcademia {
  readonly academiaId: string;
  readonly cliente: ClienteTransaccion;
}

/** Transacción de la plataforma: solo ve y escribe las tablas de la plataforma, nunca datos de una academia. */
export interface TransaccionPlataforma {
  readonly cliente: ClienteTransaccion;
}

export interface OpcionesTransaccion {
  /** Nivel de aislamiento de la transacción (por defecto, el de PostgreSQL: `ReadCommitted`). */
  readonly aislamiento?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

/** Lo que `resolverAcademia` devuelve de una academia (activa o suspendida). */
export interface AcademiaResuelta {
  id: string;
  nombre: string;
  nombreCorto: string;
  estado: 'ACTIVA' | 'SUSPENDIDA';
}
