import type { ZodError } from 'zod';

/** El primer mensaje de cada campo de un error del esquema compartido (`{ campo: mensaje }`). Un error sin campo va con la clave `''`. */
export function mensajesPorCampo(error: ZodError): Record<string, string> {
  const mensajes: Record<string, string> = {};
  for (const problema of error.issues) {
    const campo = String(problema.path[0] ?? '');
    mensajes[campo] ??= problema.message;
  }
  return mensajes;
}
