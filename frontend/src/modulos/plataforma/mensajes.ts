import { esErrorDeApi } from '../../api/cliente';
import { mensajeGeneral } from '../../lib/errores';

/** Mensaje del ingreso según la respuesta de la API (textos de la especificación, criterio 68). */
export function mensajeDeIngreso(error: unknown): string {
  if (esErrorDeApi(error, 401)) return 'Correo o contraseña incorrectos.';
  if (esErrorDeApi(error, 423)) {
    return 'La cuenta está bloqueada por varios intentos fallidos. Intenta de nuevo en 15 minutos.';
  }
  if (esErrorDeApi(error, 429)) return 'Hiciste demasiados intentos. Espera un minuto.';
  if (esErrorDeApi(error, 400)) return 'Revisa el correo y la contraseña.';
  return mensajeGeneral(error);
}

/** Mensaje de las acciones sobre academias (suspender y reactivar). */
export function mensajeDeAccion(error: unknown): string {
  if (esErrorDeApi(error, 409, 'ACADEMIA_YA_SUSPENDIDA')) return 'La academia ya estaba suspendida.';
  if (esErrorDeApi(error, 409, 'ACADEMIA_YA_ACTIVA')) return 'La academia ya estaba activa.';
  if (esErrorDeApi(error, 404)) return 'La academia no existe.';
  if (esErrorDeApi(error, 400)) return 'Revisa los datos e inténtalo de nuevo.';
  return mensajeGeneral(error);
}

/** Mensaje de las acciones sobre los administradores de una academia (listar, crear y restablecer). */
export function mensajeDeAdministradores(error: unknown): string {
  if (esErrorDeApi(error, 403, 'ACADEMIA_SUSPENDIDA')) {
    return 'La academia está suspendida. Reactívala para gestionar a sus administradores.';
  }
  if (esErrorDeApi(error, 404, 'ACADEMIA_NO_ENCONTRADA')) return 'La academia no existe.';
  if (esErrorDeApi(error, 404)) return 'El administrador ya no existe.';
  return mensajeGeneral(error);
}
