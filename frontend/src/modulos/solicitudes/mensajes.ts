import { esErrorDeApi } from '../../api/cliente';
import { mensajeGeneral } from '../../lib/errores';

/** Lo que se dice ante una cancelación que no se pudo hacer (criterio 46 de 005). */
export function mensajeDeCancelacion(error: unknown): string {
  if (esErrorDeApi(error, 409, 'SOLICITUD_NO_CANCELABLE')) {
    return 'Esta solicitud ya no se puede cancelar: ya no está esperando el pago. Actualizamos la lista.';
  }
  if (esErrorDeApi(error, 404)) return 'La solicitud ya no existe o no es de tu academia. Actualizamos la lista.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para cancelar solicitudes.';
  return mensajeGeneral(error);
}

/** Una cancelación a la que no tiene sentido volver a pedir: la solicitud ya no se puede cancelar o no existe. */
export function esCancelacionSinSalida(error: unknown): boolean {
  return esErrorDeApi(error, 409, 'SOLICITUD_NO_CANCELABLE') || esErrorDeApi(error, 404);
}
