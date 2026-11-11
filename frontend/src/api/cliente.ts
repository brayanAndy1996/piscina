import type { ZodType } from 'zod';

/** El servidor no respondió, o respondió algo que no cumple lo esperado. */
export class ErrorDeRespuesta extends Error {}

export interface RespuestaJson<T> {
  /** Código HTTP de la respuesta. */
  estado: number;
  /** Cuerpo validado con el esquema. */
  datos: T;
}

/**
 * Pide `ruta` (debe empezar por `/api`) y valida el cuerpo JSON con `esquema` (contratos compartidos).
 * Lanza `ErrorDeRespuesta` si la red falla, si el código no está en `estadosAceptados` o si el cuerpo no cumple el
 * esquema. Un código aceptado distinto de 200 (por ejemplo, el 503 de salud) se devuelve en `estado`.
 */
export async function pedirJson<T>(
  ruta: string,
  esquema: ZodType<T>,
  estadosAceptados: readonly number[] = [200],
): Promise<RespuestaJson<T>> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ErrorDeRespuesta('No se pudo contactar al servidor.');
  }
  if (!estadosAceptados.includes(respuesta.status)) {
    throw new ErrorDeRespuesta(`Respuesta inesperada del servidor (${respuesta.status}).`);
  }
  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    throw new ErrorDeRespuesta('La respuesta del servidor no es JSON.');
  }
  const resultado = esquema.safeParse(cuerpo);
  if (!resultado.success) throw new ErrorDeRespuesta('La respuesta del servidor no tiene el formato esperado.');
  return { estado: respuesta.status, datos: resultado.data };
}
