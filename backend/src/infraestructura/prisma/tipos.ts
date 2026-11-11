import type { Prisma } from '../../generated/prisma/client';

/** Cliente de Prisma dentro de una transacción. Solo se obtiene a través de `BaseDatos`. */
export type ClienteTransaccion = Prisma.TransactionClient;

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
