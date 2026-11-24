/**
 * Montos en soles (D-03: los precios ya incluyen IGV). La API los entrega como texto (`"120.00"`) y la web los trabaja siempre como
 * texto: nunca se convierten a `number`, para que no pasen por coma flotante (criterio 10 de 004).
 */

const PATRON_MONTO = /^([0-9]+)(?:\.([0-9]{1,2}))?$/;

/** El monto con dos decimales (`"120"` es `"120.00"`, `"120.5"` es `"120.50"`), o `null` si el texto no es un monto. Solo texto. */
export function normalizarMonto(texto: string): string | null {
  const partes = PATRON_MONTO.exec(texto);
  if (!partes) return null;
  const entera = (partes[1] ?? '').replace(/^0+(?=[0-9])/, '');
  return `${entera}.${(partes[2] ?? '').padEnd(2, '0')}`;
}

/** Si dos textos son el mismo monto (`"120"` y `"120.00"`). Un texto que no es un monto solo es igual a sí mismo. */
export function sonMismoMonto(a: string, b: string): boolean {
  const normalA = normalizarMonto(a);
  const normalB = normalizarMonto(b);
  return normalA === null || normalB === null ? a === b : normalA === normalB;
}

/** `"120.00"` como `S/ 120.00`, con coma de millares (`S/ 1,200.00`). Vive en los contratos: la usan también el PDF del cierre y la API (PQ10 de 006). */
export { formatearSoles } from '@aquagestion/contratos';
