import { esErrorDeApi } from '../../api/cliente';
import { mensajeGeneral } from '../../lib/errores';
import { MENSAJE_ACADEMIA_SUSPENDIDA } from './hooks';

/** Mensaje del ingreso de una academia según la respuesta de la API (criterio 46; textos orientativos). */
export function mensajeDeIngresoAcademia(error: unknown): string {
  if (esErrorDeApi(error, 401)) return 'DNI o contraseña incorrectos.';
  if (esErrorDeApi(error, 423)) {
    return 'La cuenta está bloqueada por varios intentos fallidos. Intenta de nuevo en 15 minutos o pide en recepción que la restablezcan.';
  }
  if (esErrorDeApi(error, 429)) return 'Hiciste demasiados intentos. Espera un minuto.';
  if (esErrorDeApi(error, 403, 'USUARIO_INACTIVO')) {
    return 'Tu cuenta está desactivada. Consulta en recepción.';
  }
  if (esErrorDeApi(error, 403, 'ACADEMIA_SUSPENDIDA')) return MENSAJE_ACADEMIA_SUSPENDIDA;
  if (esErrorDeApi(error, 404, 'ACADEMIA_NO_ENCONTRADA')) return 'No encontramos esa academia. Revisa el enlace.';
  if (esErrorDeApi(error, 400)) return 'Revisa el DNI (8 dígitos) y la contraseña.';
  return mensajeGeneral(error);
}
