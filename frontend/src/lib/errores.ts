import { detallesValidacionSchema } from '@aquagestion/contratos';
import { ErrorDeApi, esErrorDeApi } from '../api/cliente';

export const MENSAJE_SIN_SERVIDOR = 'No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.';
export const MENSAJE_ERROR_GENERAL = 'Ocurrió un error inesperado. Inténtalo de nuevo.';

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
