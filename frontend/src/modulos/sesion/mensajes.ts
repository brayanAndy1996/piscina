import { esErrorDeApi } from '../../api/cliente';
import { mensajeGeneral } from '../../lib/errores';
import { MENSAJE_ACADEMIA_SUSPENDIDA } from './hooks';

const AYUDA_BLOQUEO = 'Si no puedes esperar, pide en recepción que restablezcan tu contraseña.';

/**
 * Mensaje del 423 `CUENTA_BLOQUEADA` de una academia (criterio 19): el de la API, que dice cuántos minutos faltan (el bloqueo lo
 * configura cada academia, así que la web no repite ningún número fijo), más cómo pedir ayuda.
 */
export function mensajeDeBloqueo(error: unknown): string {
  const dicho = esErrorDeApi(error, 423) ? error.message.trim() : '';
  const base = dicho === '' ? 'La cuenta está bloqueada por varios intentos fallidos.' : dicho;
  return `${/[.!?]$/.test(base) ? base : `${base}.`} ${AYUDA_BLOQUEO}`;
}

/** Mensaje del ingreso de una academia según la respuesta de la API (criterio 46; textos orientativos). */
export function mensajeDeIngresoAcademia(error: unknown): string {
  if (esErrorDeApi(error, 401)) return 'DNI o contraseña incorrectos.';
  if (esErrorDeApi(error, 423)) return mensajeDeBloqueo(error);
  if (esErrorDeApi(error, 429)) return 'Hiciste demasiados intentos. Espera un minuto.';
  if (esErrorDeApi(error, 403, 'USUARIO_INACTIVO')) {
    return 'Tu cuenta está desactivada. Consulta en recepción.';
  }
  if (esErrorDeApi(error, 403, 'ACADEMIA_SUSPENDIDA')) return MENSAJE_ACADEMIA_SUSPENDIDA;
  if (esErrorDeApi(error, 404, 'ACADEMIA_NO_ENCONTRADA')) return 'No encontramos esa academia. Revisa el enlace.';
  if (esErrorDeApi(error, 400)) return 'Revisa el DNI (8 dígitos) y la contraseña.';
  return mensajeGeneral(error);
}
