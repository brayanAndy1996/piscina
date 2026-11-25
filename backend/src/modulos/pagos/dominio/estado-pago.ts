/**
 * Las transiciones de un pago al aprobarlo o rechazarlo (spec 007b, criterios 47 a 49), como funciones puras: lo que decide la transacción
 * después de bloquear el pago, sin base de datos. Un pago resuelto (`CONFIRMADO` o `RECHAZADO`) no cambia (el trigger `pagos_transiciones` lo
 * respalda); aprobar o rechazar otra vez el mismo resultado es idempotente (200), y el resultado contrario es un 409.
 */

export type EstadoDelPago = 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO';

/** Qué hace la aprobación: confirmar el pago pendiente, responder 200 con el confirmado, o 409 `PAGO_YA_RECHAZADO`. */
export type DecisionDeAprobacion = 'CONFIRMAR' | 'YA_CONFIRMADO' | 'RECHAZADO_ANTES';

/** Qué hace el rechazo: rechazar el pago pendiente, responder 200 con el rechazado, o 409 `PAGO_YA_CONFIRMADO`. */
export type DecisionDeRechazo = 'RECHAZAR' | 'YA_RECHAZADO' | 'CONFIRMADO_ANTES';

export function decidirAprobacion(estado: EstadoDelPago): DecisionDeAprobacion {
  if (estado === 'CONFIRMADO') return 'YA_CONFIRMADO';
  if (estado === 'RECHAZADO') return 'RECHAZADO_ANTES';
  return 'CONFIRMAR';
}

export function decidirRechazo(estado: EstadoDelPago): DecisionDeRechazo {
  if (estado === 'RECHAZADO') return 'YA_RECHAZADO';
  if (estado === 'CONFIRMADO') return 'CONFIRMADO_ANTES';
  return 'RECHAZAR';
}
