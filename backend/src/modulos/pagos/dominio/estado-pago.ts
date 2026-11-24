import type { EstadoPago } from '@aquagestion/contratos';

/**
 * Las transiciones permitidas de un pago (spec 007, criterio 6; HU-09): un pago pendiente se resuelve una vez, a `CONFIRMADO` o a
 * `RECHAZADO`, y uno resuelto no cambia nunca. La base lo garantiza también con el trigger `pagos_transiciones`. Pura.
 */
export function transicionPermitida(desde: EstadoPago, hacia: EstadoPago): boolean {
  return desde === 'PENDIENTE_VERIFICACION' && (hacia === 'CONFIRMADO' || hacia === 'RECHAZADO');
}

/** Un pago resuelto (confirmado o rechazado) no vuelve a cambiar. */
export function estaResuelto(estado: EstadoPago): boolean {
  return estado === 'CONFIRMADO' || estado === 'RECHAZADO';
}

/** Un pago abierto (pendiente o confirmado) ocupa la matrícula y su número de operación (índices únicos parciales del criterio 4). */
export function estaAbierto(estado: EstadoPago): boolean {
  return estado === 'PENDIENTE_VERIFICACION' || estado === 'CONFIRMADO';
}
