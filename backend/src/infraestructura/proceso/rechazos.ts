/**
 * Manejador de promesas rechazadas sin manejar (spec 001, criterio 157, P-40). En Node 22 una promesa rechazada que nadie maneja
 * termina el proceso; para una API que atiende a varias academias eso convierte un descuido (una cadena con `void`) en una caída
 * de todos. El manejador registra el rechazo y el proceso sigue atendiendo.
 *
 * Con un `Error` se registra `{ err }` (pino lo serializa con su mensaje y pila); con cualquier otro valor, solo su tipo: lo
 * rechazado puede ser un objeto con datos de una persona. No llama a `process.exit` ni cambia `process.exitCode`, y no tiene nada
 * que ver con `uncaughtException`: una excepción síncrona sin atrapar sigue terminando el proceso.
 */
export interface RegistroDeErrores {
  error(datos: object, mensaje: string): void;
}

export function crearManejadorDeRechazos(registro: RegistroDeErrores): (motivo: unknown) => void {
  return (motivo: unknown): void => {
    const datos = motivo instanceof Error ? { err: motivo } : { tipo: typeof motivo };
    registro.error(datos, 'Promesa rechazada sin manejar; el proceso sigue atendiendo.');
  };
}
