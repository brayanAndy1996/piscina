import type { DetallesValidacion } from '@aquagestion/contratos';
import type { ZodError } from 'zod';

/**
 * Convierte un error de zod en los `detalles` de un 400 `SOLICITUD_INVALIDA`: un elemento por problema, con el campo
 * en notación de puntos (`datos.nombre`) y `""` cuando el problema es del cuerpo entero.
 */
export function detallesDeZod(error: ZodError): DetallesValidacion {
  return {
    errores: error.issues.map((problema) => ({
      campo: problema.path.map((parte) => String(parte)).join('.'),
      mensaje: problema.message,
    })),
  };
}
