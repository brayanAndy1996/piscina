/** La descarga se canceló (cerrar sesión, cambio de identidad o salir de la página): no hay archivo que entregar ni error que mostrar. */
export class DescargaCanceladaError extends Error {
  constructor() {
    super('La descarga se canceló.');
    this.name = 'DescargaCanceladaError';
  }
}

/** Las descargas que van en camino: cada una con su propio `AbortController` (criterio 54 de 006, DT-13). */
const descargasEnCurso = new Set<AbortController>();

/** Registra una descarga nueva. Quien la pide debe llamar a `terminar` al acabar, con éxito o sin él. */
export function iniciarDescarga(): { controlador: AbortController; terminar: () => void } {
  const controlador = new AbortController();
  descargasEnCurso.add(controlador);
  return { controlador, terminar: () => descargasEnCurso.delete(controlador) };
}

/** Cancela todas las descargas en curso, por ejemplo al pulsar "Cerrar sesión", sin esperar a que el servidor responda. */
export function cancelarDescargasEnCurso(): void {
  for (const controlador of descargasEnCurso) controlador.abort();
  descargasEnCurso.clear();
}
