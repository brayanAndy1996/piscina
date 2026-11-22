import { type MetodoPago, montoNoNegativoSchema, type ResultadoCierre, restarMontos } from '@aquagestion/contratos';
import { formatearSoles } from '../../lib/dinero';

/** Los montos de la caja se trabajan siempre como texto: nunca pasan por `number` (criterio 39 de 006). */

export const ETIQUETA_METODO: Readonly<Record<MetodoPago, string>> = {
  EFECTIVO: 'Efectivo',
  YAPE: 'Yape',
  TRANSFERENCIA: 'Transferencia',
};

export const ETIQUETA_RESULTADO: Readonly<Record<ResultadoCierre, string>> = {
  CUADRA: 'Cuadra',
  SOBRANTE: 'Sobrante',
  FALTANTE: 'Faltante',
};

/** El resultado de una diferencia ya calculada (`"-4.50"`, `"0.00"`, `"1.00"`), mirando solo el texto. */
export function resultadoDeDiferencia(diferencia: string): ResultadoCierre {
  if (!/[1-9]/.test(diferencia)) return 'CUADRA';
  return diferencia.startsWith('-') ? 'FALTANTE' : 'SOBRANTE';
}

/** "Cuadra", "Sobrante de S/ 1.00" o "Faltante de S/ 4.50": la palabra lleva el significado, no el signo. */
export function describirDiferencia(diferencia: string): string {
  const resultado = resultadoDeDiferencia(diferencia);
  if (resultado === 'CUADRA') return ETIQUETA_RESULTADO.CUADRA;
  return `${ETIQUETA_RESULTADO[resultado]} de ${formatearSoles(diferencia.replace(/^-/, ''))}`;
}

/**
 * La diferencia entre el efectivo contado y el esperado, en céntimos y sobre el texto (`restarMontos`), o `null` mientras lo escrito no
 * es un monto válido de la caja (hasta dos decimales, sin signo ni comas).
 */
export function diferenciaEnVivo(contado: string, esperadoEfectivo: string): string | null {
  const texto = contado.trim();
  if (!montoNoNegativoSchema.safeParse(texto).success) return null;
  return restarMontos(texto, esperadoEfectivo);
}
