import { Inject, Injectable } from '@nestjs/common';
import type { TransaccionAcademia, TransaccionPlataforma } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';

/** Lo que se registra de una acción crítica: quién, cuándo (lo pone el servicio) y qué (RN-22, RNF-06). */
export interface EntradaAuditoria {
  actorTipo: 'USUARIO' | 'SUPERADMIN' | 'SISTEMA';
  /** Id de quien actuó; nulo con actor `SISTEMA`. */
  actorId: string | null;
  /** MAYÚSCULAS_CON_GUIONES_BAJOS, por ejemplo `ACADEMIA_SUSPENDIDA`. */
  accion: string;
  /** En singular, por ejemplo `academia`. */
  entidad: string;
  entidadId: string | null;
  /** JSON con los nombres de campo de la API. Nunca objetos completos con datos sensibles (por ejemplo `clave_hash`). */
  datosAntes?: unknown;
  datosDespues?: unknown;
  motivo?: string | null;
  /** IP del cliente tal como la ve Express (`req.ip`). */
  ip?: string | null;
}

function comoJson(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  const texto = JSON.stringify(valor);
  if (texto === undefined) throw new Error('El dato de auditoría no se puede representar como JSON.');
  return texto;
}

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
    await tx.cliente.$executeRaw`
      INSERT INTO auditoria
        (id, academia_id, fecha_hora, actor_tipo, actor_id, accion, entidad, entidad_id,
         datos_antes, datos_despues, motivo, ip)
      VALUES
        (gen_random_uuid(), ${tx.academiaId}::uuid, ${this.reloj.ahora()}::timestamptz,
         ${entrada.actorTipo}::tipo_actor, ${entrada.actorId}::uuid, ${entrada.accion}, ${entrada.entidad},
         ${entrada.entidadId}, ${comoJson(entrada.datosAntes)}::jsonb, ${comoJson(entrada.datosDespues)}::jsonb,
         ${entrada.motivo ?? null}, ${entrada.ip ?? null}::inet)`;
  }

  /** Registra en `auditoria_plataforma`, la bitácora de las acciones que no pertenecen a una academia. */
  async registrarEnPlataforma(tx: TransaccionPlataforma, entrada: EntradaAuditoria): Promise<void> {
    await tx.cliente.$executeRaw`
      INSERT INTO auditoria_plataforma
        (id, fecha_hora, actor_tipo, actor_id, accion, entidad, entidad_id,
         datos_antes, datos_despues, motivo, ip)
      VALUES
        (gen_random_uuid(), ${this.reloj.ahora()}::timestamptz,
         ${entrada.actorTipo}::tipo_actor, ${entrada.actorId}::uuid, ${entrada.accion}, ${entrada.entidad},
         ${entrada.entidadId}, ${comoJson(entrada.datosAntes)}::jsonb, ${comoJson(entrada.datosDespues)}::jsonb,
         ${entrada.motivo ?? null}, ${entrada.ip ?? null}::inet)`;
  }
}
