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

/**
 * Monto máximo de un monto cotizado (spec 005, criterio 50). Un plan vale como mucho `MONTO_MAXIMO`; redondeado hacia arriba al sol
 * entero (D-03) el monto de un mes completo llega a 100000.00. Ningún otro cálculo lo supera, porque `clasesTotales <= clasesPorMes`.
 */
export const MONTO_COTIZADO_MAXIMO = '100000.00';

/** Como `PATRON_MONTO`, pero con hasta seis dígitos enteros: el tope exacto se comprueba aparte, sobre el texto. */
const PATRON_MONTO_COTIZADO = /^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,2})?$/;

/**
 * El monto que el cliente vio al cotizar (`montoMostrado`): las mismas reglas de forma que `montoSchema`, mayor que 0 y como mucho
 * `"100000.00"`. Acepta `"100000"`, `"100000.0"` y `"100000.00"`; rechaza `"100000.01"`, `"100001"` y `"1000000"`. Sin `Number`: el
 * tope se comprueba sobre el texto. `montoSchema` no cambia (el precio de un plan sigue con tope 99999.99).
 */
export const montoCotizadoSchema = z
  .string('El monto debe ser un texto, por ejemplo "120.00".')
  .regex(
    PATRON_MONTO_COTIZADO,
    'El monto debe tener hasta dos decimales y como máximo 100000.00, por ejemplo "120.00".',
  )
  .refine((texto) => /[1-9]/.test(texto), { message: 'El monto debe ser mayor que 0.' })
  .refine((texto) => !esMayorQueElMaximoCotizado(texto), {
    message: 'El monto debe ser como máximo 100000.00.',
  });

/** Con seis dígitos enteros solo vale `100000` con los decimales en cero (comparación sobre el texto). */
function esMayorQueElMaximoCotizado(texto: string): boolean {
  const [entero = '', decimales = ''] = texto.split('.');
  if (entero.length < 6) return false;
  return entero !== '100000' || /[1-9]/.test(decimales);
}
