import { z } from 'zod';

/**
 * Formato de error de toda la API.
 * `codigo` va en MAYÚSCULAS con guiones bajos (por ejemplo `NO_ENCONTRADO`) y `mensaje` en español, para mostrarlo
 * al usuario. `detalles` es opcional; el de las solicitudes inválidas (400 `SOLICITUD_INVALIDA`) cumple
 * `detallesValidacionSchema`.
 */
export const errorApiSchema = z.object({
  codigo: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  mensaje: z.string().min(1),
  detalles: z.unknown().optional(),
});

export type ErrorApi = z.infer<typeof errorApiSchema>;

/**
 * `detalles` de un 400 `SOLICITUD_INVALIDA`: un elemento por campo con problema. `campo` usa puntos para las rutas
 * anidadas (`datos.nombre`) y es `""` cuando el problema es del cuerpo entero.
 */
export const detallesValidacionSchema = z.object({
  errores: z.array(z.object({ campo: z.string(), mensaje: z.string() })),
});

export type DetallesValidacion = z.infer<typeof detallesValidacionSchema>;
