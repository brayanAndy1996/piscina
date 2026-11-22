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

// ---------------------------------------------------------------------------------------------------------------------
// Caja (spec 006, criterios 11, 27 y 39; PP3)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Monto de entrada que acepta el cero (spec 006, criterio 11; DR-6): de `"0"` a `"99999.99"`, con hasta dos decimales. Es el monto inicial
 * de la caja y el efectivo contado al cerrarla. Como `montoSchema`, pero sin la regla de "mayor que 0". Rechaza `"-0"`, un número JSON, la
 * notación científica, la coma, los espacios y los ceros a la izquierda; el texto no pasa por `Number`.
 */
export const montoNoNegativoSchema = z
  .string('El monto debe ser un texto, por ejemplo "120.00".')
  .regex(PATRON_MONTO, 'El monto debe tener hasta dos decimales y como máximo 99999.99, por ejemplo "120.00".');

/** Una parte entera sin ceros a la izquierda (`0` o de 1 a 10 dígitos): la capacidad de `numeric(12,2)` de los cierres de caja. */
const PARTE_ENTERA_DE_LECTURA = '(?:0|[1-9][0-9]{0,9})';

/** Monto sin signo de una respuesta: exactamente dos decimales y hasta `9999999999.99` (PP3). */
const PATRON_MONTO_DE_LECTURA = new RegExp(`^${PARTE_ENTERA_DE_LECTURA}\\.[0-9]{2}$`);

/** Monto con signo de una respuesta: como el anterior, con un `-` opcional. */
const PATRON_MONTO_CON_SIGNO = new RegExp(`^-?${PARTE_ENTERA_DE_LECTURA}\\.[0-9]{2}$`);

/**
 * Monto sin signo con el que la API responde (`resumen`, monto inicial, ingresos, egresos, esperado y declarado de un cierre): exactamente dos
 * decimales y, como mucho, `9999999999.99`, la capacidad de las columnas `numeric(12,2)`. No usa el tope de `montoNoNegativoSchema`
 * (`99999.99`), que es de entrada: lo que la API calcula (la suma de los cobros del día) puede pasar de ahí (PP3).
 */
export const montoDeLecturaSchema = z
  .string('El monto debe ser un texto con dos decimales.')
  .regex(PATRON_MONTO_DE_LECTURA, 'El monto debe tener exactamente dos decimales, por ejemplo "120.00".');

/**
 * Monto con signo con el que la API responde (la diferencia de un cierre): `-?` y exactamente dos decimales, hasta `9999999999.99` en valor
 * absoluto. Rechaza `"-0.00"`: una diferencia nula se escribe `"0.00"`.
 */
export const montoConSignoSchema = z
  .string('El monto debe ser un texto con dos decimales.')
  .regex(PATRON_MONTO_CON_SIGNO, 'El monto debe tener exactamente dos decimales, por ejemplo "-4.50".')
  .refine((texto) => texto !== '-0.00', { message: 'El monto cero se escribe "0.00".' });

/** Un monto sin signo para restar: los de `montoNoNegativoSchema` y los de lectura (hasta diez dígitos enteros y dos decimales). */
const PATRON_MONTO_A_RESTAR = new RegExp(`^${PARTE_ENTERA_DE_LECTURA}(?:\\.[0-9]{1,2})?$`);

/** Los céntimos enteros de un monto de texto ya comprobado, sin pasar por `Number`. */
function centimosDe(texto: string): bigint {
  const [enteros = '0', decimales = ''] = texto.split('.');
  return BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, '0') || '0');
}

/**
 * `a - b` de dos montos de texto, siempre con dos decimales y con `-` delante si es negativo, y nunca `"-0.00"` (dos montos iguales dan
 * `"0.00"`). Trabaja en céntimos enteros (`bigint`) sobre el texto, sin `Number` ni `parseFloat`: `"126.50"` menos `"126.49"` da `"0.01"` y al
 * revés `"-0.01"`. La web la usa para mostrar la diferencia mientras se escribe el efectivo contado. Con un texto que no es un monto lanza
 * `RangeError`: nunca devuelve un resultado inventado.
 */
export function restarMontos(a: string, b: string): string {
  for (const monto of [a, b]) {
    if (typeof monto !== 'string' || !PATRON_MONTO_A_RESTAR.test(monto)) {
      throw new RangeError('Un monto de la resta no tiene el formato de un monto en soles.');
    }
  }
  const diferencia = centimosDe(a) - centimosDe(b);
  const negativa = diferencia < 0n;
  const absoluta = negativa ? -diferencia : diferencia;
  const enteros = (absoluta / 100n).toString();
  const decimales = (absoluta % 100n).toString().padStart(2, '0');
  return `${negativa ? '-' : ''}${enteros}.${decimales}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Texto de un monto (spec 006b, PQ10)
// ---------------------------------------------------------------------------------------------------------------------

const PATRON_MONTO_A_MOSTRAR = /^([0-9]+)(?:\.([0-9]{1,2}))?$/;

/**
 * `"120.00"` como `S/ 120.00`, con coma de millares (`S/ 1,200.00`) y siempre con dos decimales (`"88"` es `S/ 88.00`). La usan la web y el
 * PDF del cierre de caja (PQ10). Trabaja sobre el texto, sin `Number` ni `parseFloat`: un monto grande no pierde precisión. Un texto que no
 * es un monto (negativo, con coma decimal, con espacios) se muestra tal cual, después de `S/ `.
 */
export function formatearSoles(monto: string): string {
  const partes = PATRON_MONTO_A_MOSTRAR.exec(monto);
  if (!partes) return `S/ ${monto}`;
  const entera = (partes[1] ?? '').replace(/^0+(?=[0-9])/, '');
  const decimales = (partes[2] ?? '').padEnd(2, '0');
  return `S/ ${entera.replace(/\B(?=(?:[0-9]{3})+(?![0-9]))/g, ',')}.${decimales}`;
}
