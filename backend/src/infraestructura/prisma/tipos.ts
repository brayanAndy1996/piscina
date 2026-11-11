import type { Prisma } from '../../generated/prisma/client';

/**
 * Lo que `trabajo` recibe como `tx.cliente` (spec 001, criterio 100, precisión P-24): un envoltorio armado por `BaseDatos` que
 * solo tiene `$queryRaw`, `$executeRaw` y los delegados de los modelos. No tiene `$transaction`, `$connect`, `$on`,
 * `$extends`, `$queryRawUnsafe` ni `$parent`: con ellos un módulo podría salirse de la transacción o ejecutar SQL armado como
 * texto. Los comandos (`cli/`) pasan la transacción completa de Prisma, que es asignable a este tipo.
 */
export type ClienteTransaccion = Pick<
  Prisma.TransactionClient,
  '$queryRaw' | '$executeRaw' | Uncapitalize<Prisma.ModelName>
>;

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
