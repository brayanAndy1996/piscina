import { esErrorDeApi } from '../../api/cliente';
import { mensajeGeneral } from '../../lib/errores';

/** Mensaje de desactivar, reactivar y restablecer una cuenta según la respuesta de la API. */
export function mensajeDeAccionUsuario(error: unknown): string {
  if (esErrorDeApi(error, 409, 'OPERACION_SOBRE_SI_MISMO')) return 'No puedes hacer esto con tu propia cuenta.';
  if (esErrorDeApi(error, 409, 'USUARIO_YA_INACTIVO')) return 'La cuenta ya estaba desactivada.';
  if (esErrorDeApi(error, 409, 'USUARIO_YA_ACTIVO')) return 'La cuenta ya estaba activa.';
  if (esErrorDeApi(error, 404)) return 'La cuenta ya no existe o no tienes permiso sobre ella.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para hacer esto.';
  return mensajeGeneral(error);
}

export const MENSAJE_DNI_EN_USO = 'Ya existe una cuenta con ese DNI en esta academia.';
