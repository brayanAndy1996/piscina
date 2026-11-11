import { detallesValidacionSchema } from '@aquagestion/contratos';
import { ErrorDeApi, esErrorDeApi } from '../../api/cliente';

export const MENSAJE_SIN_SERVIDOR = 'No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.';
export const MENSAJE_ERROR_GENERAL = 'Ocurrió un error inesperado. Inténtalo de nuevo.';

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

/** Error de red o del servidor sin un caso propio. */
export function mensajeGeneral(error: unknown): string {
  return error instanceof ErrorDeApi && error.estado < 500 ? error.message : MENSAJE_SIN_SERVIDOR;
}

/** Errores por campo de un 400 `SOLICITUD_INVALIDA` (`detalles.errores`), o una lista vacía. */
export function erroresPorCampo(error: unknown): { campo: string; mensaje: string }[] {
  if (!esErrorDeApi(error, 400)) return [];
  const detalles = detallesValidacionSchema.safeParse(error.detalles);
  return detalles.success ? detalles.data.errores : [];
}
