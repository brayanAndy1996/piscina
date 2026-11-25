import { esErrorDeApi } from '../../api/cliente';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario } from '../../lib/fechas';
import { detallesDeError } from '../solicitudes/mensajes';

/** Lo que se dice ante cada error de la verificación de pagos (criterios 46 a 49 de 007b). Textos en español y sin códigos. */

/** Los 409 que dicen que la caja no está lista: la aprobación se puede reintentar cuando quien verifica la abra. */
export function esErrorDeCajaAlAprobar(error: unknown): boolean {
  return esErrorDeApi(error, 409, 'SIN_CAJA_ABIERTA') || esErrorDeApi(error, 409, 'CAJA_DE_OTRO_DIA');
}

export function mensajeDeAprobacion(error: unknown): string {
  if (esErrorDeApi(error, 409, 'SIN_CAJA_ABIERTA')) return 'Abre la caja antes de aprobar el pago.';
  if (esErrorDeApi(error, 409, 'CAJA_DE_OTRO_DIA')) {
    const { fecha } = detallesDeError(error);
    return fecha
      ? `La caja abierta es del ${formatearFechaCalendario(fecha)}. Ciérrala y abre la de hoy antes de aprobar el pago.`
      : 'La caja abierta es de otro día. Ciérrala y abre la de hoy antes de aprobar el pago.';
  }
  if (esErrorDeApi(error, 409, 'PAGO_YA_RECHAZADO')) {
    return 'Este comprobante ya se había rechazado, así que no se puede aprobar. Actualizamos la lista.';
  }
  if (esErrorDeApi(error, 409, 'DNI_DEL_PERSONAL')) {
    return 'Ya existe un usuario de la academia con el DNI de esta persona. Consulta con el administrador antes de aprobar.';
  }
  if (esErrorDeApi(error, 404)) return 'Este pago ya no existe o no es de tu academia. Actualizamos la lista.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para verificar pagos.';
  return mensajeGeneral(error);
}

/** Una aprobación a la que no tiene sentido volver a pedir desde el mismo diálogo: el pago ya no se puede aprobar o no existe. */
export function esAprobacionSinSalida(error: unknown): boolean {
  return (
    esErrorDeApi(error, 404) ||
    esErrorDeApi(error, 403) ||
    ['PAGO_YA_RECHAZADO', 'DNI_DEL_PERSONAL'].some((codigo) => esErrorDeApi(error, 409, codigo))
  );
}

export function mensajeDeRechazo(error: unknown): string {
  if (esErrorDeApi(error, 409, 'PAGO_YA_CONFIRMADO')) {
    return 'Este pago ya se había confirmado, así que no se puede rechazar. Actualizamos la lista.';
  }
  if (esErrorDeApi(error, 404)) return 'Este pago ya no existe o no es de tu academia. Actualizamos la lista.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para verificar pagos.';
  return mensajeGeneral(error);
}

/** Un rechazo al que no tiene sentido volver a pedir: el pago ya se confirmó o no existe. */
export function esRechazoSinSalida(error: unknown): boolean {
  return esErrorDeApi(error, 409, 'PAGO_YA_CONFIRMADO') || esErrorDeApi(error, 404) || esErrorDeApi(error, 403);
}

/** Lo que se dice cuando la imagen del comprobante no llegó. */
export function mensajeDeImagen(error: unknown): string {
  if (esErrorDeApi(error, 404)) return 'No encontramos la imagen de este comprobante. Actualiza la lista.';
  return `No pudimos cargar la imagen del comprobante. ${mensajeGeneral(error)}`;
}
