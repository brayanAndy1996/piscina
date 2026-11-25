import { Decimal } from '../../../infraestructura/prisma';
import { baseProporcional, calcularTotal } from '../../matriculas';

/** Lo guardado en la matrícula que decide lo que se cobra (nunca se lee del plan, HU-19). */
export interface DatosDelTotal {
  /** El ajuste del administrador (RN-25), o `null` si no hay. */
  readonly montoAjustado: Decimal | null;
  /**
   * El monto que se calculó al inscribirse y quedó guardado (`monto_calculado`). Sin ajuste, el total es ese monto: es el cálculo proporcional
   * de la 005 sobre lo que valía el plan en ese momento, y así el total de una matrícula sin ajuste es siempre «igual al de antes» (spec 007,
   * «Impacto» en la 005, y definición del total). Es obligatorio: no hay otro camino para obtener la base.
   */
  readonly montoCalculado: Decimal;
}

/**
 * El total a cobrar de una matrícula (spec 007, criterio 10; D-03, RN-25, HU-34): `calcularTotal` con el monto guardado en la matrícula como base y
 * su ajuste, si lo hay (el ajuste lo reemplaza). Un entero de soles, redondeado hacia arriba una sola vez, al final. Sin `number`: todo es
 * `Decimal` y fracciones de `bigint`. Pura.
 */
export function totalACobrar(matricula: DatosDelTotal): Decimal {
  // `baseProporcional(monto, 1, 1)` es ese monto como fracción exacta.
  const base = baseProporcional(matricula.montoCalculado, 1, 1);
  return calcularTotal(matricula.montoAjustado === null ? { base } : { base, montoAjustado: matricula.montoAjustado });
}
