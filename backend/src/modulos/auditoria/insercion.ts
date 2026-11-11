import type { ClienteTransaccion } from '../../infraestructura/prisma';

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
 * Inserta una fila en `auditoria_plataforma` con el cliente de una transacción de la plataforma. Es una función sin
 * Nest para que la reutilicen los comandos (`npm run plataforma:superadmin`) y la semilla con el mismo formato que la
 * API.
 */
export async function insertarEnAuditoriaPlataforma(
  cliente: ClienteTransaccion,
  fechaHora: Date,
  entrada: EntradaAuditoria,
): Promise<void> {
  await cliente.$executeRaw`
    INSERT INTO auditoria_plataforma
      (id, fecha_hora, actor_tipo, actor_id, accion, entidad, entidad_id,
       datos_antes, datos_despues, motivo, ip)
    VALUES
      (gen_random_uuid(), ${fechaHora}::timestamptz,
       ${entrada.actorTipo}::tipo_actor, ${entrada.actorId}::uuid, ${entrada.accion}, ${entrada.entidad},
       ${entrada.entidadId}, ${comoJson(entrada.datosAntes)}::jsonb, ${comoJson(entrada.datosDespues)}::jsonb,
       ${entrada.motivo ?? null}, ${entrada.ip ?? null}::inet)`;
}

/** Inserta una fila en `auditoria` con el cliente de una transacción de la academia `academiaId`. */
export async function insertarEnAuditoriaDeAcademia(
  cliente: ClienteTransaccion,
  academiaId: string,
  fechaHora: Date,
  entrada: EntradaAuditoria,
): Promise<void> {
  await cliente.$executeRaw`
    INSERT INTO auditoria
      (id, academia_id, fecha_hora, actor_tipo, actor_id, accion, entidad, entidad_id,
       datos_antes, datos_despues, motivo, ip)
    VALUES
      (gen_random_uuid(), ${academiaId}::uuid, ${fechaHora}::timestamptz,
       ${entrada.actorTipo}::tipo_actor, ${entrada.actorId}::uuid, ${entrada.accion}, ${entrada.entidad},
       ${entrada.entidadId}, ${comoJson(entrada.datosAntes)}::jsonb, ${comoJson(entrada.datosDespues)}::jsonb,
       ${entrada.motivo ?? null}, ${entrada.ip ?? null}::inet)`;
}
