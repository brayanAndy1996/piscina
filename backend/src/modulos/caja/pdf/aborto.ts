/**
 * El error de una descarga o de una generación abandonadas (spec 006b, criterio 51): un error cuyo `name` es `'AbortError'`, el mismo que usan
 * `fetch` y `AbortSignal.timeout`. Lo comparten la cola (`ColaPdfCierre.turno`) y el generador (`generarPdfCierre`).
 */
export function errorDeAborto(mensaje = 'La descarga del PDF fue abandonada por el cliente.'): Error {
  return new DOMException(mensaje, 'AbortError');
}

/** `true` si `error` es un error de aborto (`name === 'AbortError'`). */
export function esErrorDeAborto(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
