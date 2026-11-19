import { Decimal } from '../../infraestructura/prisma';

/**
 * Montos en soles (D-03): siempre `Decimal` en el código y `numeric` en la base, nunca `number` con coma flotante. En el JSON viajan
 * como texto con dos decimales (`"120.00"`, decisión D3 de 004).
 */

/** El `Decimal` de un monto escrito como texto (`"120"`, `"120.5"`). El texto ya pasó por `montoSchema`. */
export function aDecimal(texto: string): Decimal {
  return new Decimal(texto);
}

/** El texto con exactamente dos decimales de un monto (`"120.00"`), sin pasar por `number`. */
export function aTextoMonto(monto: Decimal | string): string {
  return new Decimal(monto).toFixed(2);
}

/** `true` si los dos montos valen lo mismo (`"120"`, `"120.0"` y `"120.00"` son el mismo). */
export function montosIguales(a: Decimal | string, b: Decimal | string): boolean {
  return new Decimal(a).equals(new Decimal(b));
}
