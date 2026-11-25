import { esErrorDeApi } from '../../api/cliente';
import { mensajeGeneral } from '../../lib/errores';
import { FOTO_MEGABYTES_MAXIMOS } from './validacion';

export const MENSAJE_CAMARA = 'No se pudo usar la cámara. Revisa el permiso del navegador o elige un archivo.';

/** Lo que se dice ante cada error de la foto del panel (criterios 22, 23 y 28 de 008), en español y sin códigos. */
export function mensajeDeFotoDelPanel(error: unknown): string {
  if (esErrorDeApi(error, 400, 'IMAGEN_NO_VALIDA')) {
    return 'La imagen no es válida. Elige otra foto JPG o PNG, o toma una nueva.';
  }
  if (esErrorDeApi(error, 413)) return `La foto pesa más de ${FOTO_MEGABYTES_MAXIMOS} MB. Elige una más liviana.`;
  if (esErrorDeApi(error, 409)) return 'Esta solicitud ya no admite foto: venció o se canceló. Actualizamos la lista.';
  if (esErrorDeApi(error, 404))
    return 'El alumno o la solicitud ya no existe o no es de tu academia. Actualizamos la lista.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para cambiar fotos.';
  return mensajeGeneral(error);
}

/** Una subida a la que no tiene sentido volver a intentar: el alumno o la solicitud ya no existe, o la solicitud ya no admite foto. */
export function esFotoSinSalida(error: unknown): boolean {
  return esErrorDeApi(error, 404) || esErrorDeApi(error, 409);
}
