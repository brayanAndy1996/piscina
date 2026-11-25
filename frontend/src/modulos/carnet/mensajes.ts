import { esErrorDeApi } from '../../api/cliente';
import { mensajeGeneral } from '../../lib/errores';

/** Lo que se dice ante cada error del carnet (criterios 4 a 6, 11 y 13 a 16 de 008). Textos en español y sin códigos. */

export function mensajeDeCarnet(error: unknown): string {
  if (esErrorDeApi(error, 404)) return 'No encontramos este carnet. Puede que el alumno ya no esté en tu academia.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para ver este carnet.';
  return mensajeGeneral(error);
}

export function mensajeDeDescarga(error: unknown): string {
  return `No pudimos descargar el PDF. ${mensajeDeCarnet(error)}`;
}

export function mensajeDeRegeneracion(error: unknown): string {
  if (esErrorDeApi(error, 404)) return 'Este alumno ya no existe o no es de tu academia.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para regenerar el QR.';
  return mensajeGeneral(error);
}

/** Una regeneración a la que no tiene sentido volver a pedir desde el mismo diálogo: el alumno ya no existe o no hay permiso. */
export function esRegeneracionSinSalida(error: unknown): boolean {
  return esErrorDeApi(error, 404) || esErrorDeApi(error, 403);
}

export function mensajeDeBusqueda(error: unknown): string {
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para buscar alumnos.';
  return mensajeGeneral(error);
}
