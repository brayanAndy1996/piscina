import { Inject, Injectable } from '@nestjs/common';
import type { TransaccionAcademia, TransaccionPlataforma } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { type EntradaAuditoria, insertarEnAuditoriaDeAcademia, insertarEnAuditoriaPlataforma } from './insercion';

/**
 * Bitácora de las acciones críticas. Inserta con el cliente de la transacción de quien llama, así que el registro vive
 * y muere con la operación (si la transacción se revierte, el registro tampoco queda; si el registro falla, falla la
 * operación completa).
 *
 * Los dos tipos de transacción son distintos a propósito: TypeScript impide auditar en la tabla equivocada. La entrada
 * no tiene campo de academia: se audita siempre en la de la transacción, y la RLS lo comprueba en la base.
 */
@Injectable()
export class AuditoriaService {
  constructor(@Inject(RELOJ) private readonly reloj: Reloj) {}

  /** Registra en `auditoria`, con `academia_id` igual a `tx.academiaId`. */
  async registrarEnAcademia(tx: TransaccionAcademia, entrada: EntradaAuditoria): Promise<void> {
    await insertarEnAuditoriaDeAcademia(tx.cliente, tx.academiaId, this.reloj.ahora(), entrada);
  }

  /** Registra en `auditoria_plataforma`, la bitácora de las acciones que no pertenecen a una academia. */
  async registrarEnPlataforma(tx: TransaccionPlataforma, entrada: EntradaAuditoria): Promise<void> {
    await insertarEnAuditoriaPlataforma(tx.cliente, this.reloj.ahora(), entrada);
  }
}
