import { z } from 'zod';

/**
 * Montos en soles (spec 004, criterio 10; D-03: los precios ya incluyen IGV). Viajan como **texto** en el JSON y nunca como número:
 * el lector de JSON convertiría `120.5` en coma flotante. La API los lee como `Decimal` y la base los guarda en `numeric(10,2)`.
 * Lo reutilizan los planes y las historias de cobro, caja y pagos.
 */

/** Monto máximo que acepta la API (provisional aprobado en DR-1 de 004). */
export const MONTO_MAXIMO = '99999.99';

/** Hasta cinco dígitos enteros (sin ceros a la izquierda) y hasta dos decimales. Solo dígitos ASCII, sin espacios ni signos. */
const PATRON_MONTO = /^(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,2})?$/;

/**
 * Monto mayor que 0 y como mucho `"99999.99"`, con hasta dos decimales: `"120"`, `"120.5"`, `"0.01"` y `"99999.99"` valen; un número
 * JSON, `"0"`, `"0.00"`, `"-1"`, `"120.505"`, `"1e2"`, `"120,50"`, `" 120"`, `"100000"` y `""` no. Sin recorte: un espacio es error.
 * La comparación con cero se hace sobre el texto (hay algún dígito distinto de cero), sin pasar por `Number`.
 */
export const montoSchema = z
  .string('El monto debe ser un texto, por ejemplo "120.00".')
  .regex(PATRON_MONTO, 'El monto debe tener hasta dos decimales y como máximo 99999.99, por ejemplo "120.00".')
  .refine((texto) => /[1-9]/.test(texto), { message: 'El monto debe ser mayor que 0.' });
