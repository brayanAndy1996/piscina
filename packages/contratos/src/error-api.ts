import { z } from 'zod';

/**
 * Formato de error de toda la API.
 * `codigo` va en MAYÚSCULAS con guiones bajos (por ejemplo `NO_ENCONTRADO`) y `mensaje` en español, para mostrarlo
 * al usuario. El contenido de `detalles` lo define la primera historia con validación de entradas.
 */
export const errorApiSchema = z.object({
  codigo: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  mensaje: z.string().min(1),
  detalles: z.unknown().optional(),
});

export type ErrorApi = z.infer<typeof errorApiSchema>;
