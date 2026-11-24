import { Decimal } from '../../../infraestructura/prisma';
import { baseProporcional, calcularTotal } from '../../matriculas';

/** Lo guardado en la matrícula que decide lo que se cobra (nunca se lee del plan, HU-19). */
export interface DatosDelTotal {
  readonly precioPlan: Decimal;
  readonly clasesPorMesPlan: number;
  readonly clasesTotales: number;
  /** El ajuste del administrador (RN-25), o `null` si no hay. */
  readonly montoAjustado: Decimal | null;
  /**
   * El monto que se calculó al inscribirse y quedó guardado (`monto_calculado`). Sin ajuste, el total es ese monto: por construcción es el
   * mismo cálculo (`montoProporcional` con `precio_plan`, `clases_por_mes_plan` y `clases_totales`), y así el total de una matrícula sin ajuste
   * es siempre «igual al de antes» (spec 007, «Impacto» en la 005, y definición del total).
   */
  readonly montoCalculado?: Decimal;
}

/**
 * El total a cobrar de una matrícula (spec 007, criterio 10; D-03, RN-25, HU-34): `calcularTotal` con la base proporcional de lo guardado en la
 * matrícula (`precio_plan`, `clases_por_mes_plan` y `clases_totales`) y su ajuste, si lo hay. Un entero de soles, redondeado hacia arriba una
 * sola vez, al final. Sin `number`: todo es `Decimal` y fracciones de `bigint`. Pura.
 */
export function totalACobrar(matricula: DatosDelTotal): Decimal {
  // Sin ajuste, el monto guardado al inscribirse (el mismo cálculo): `baseProporcional(monto, 1, 1)` es ese monto como fracción exacta.
  const base =
    matricula.montoAjustado === null && matricula.montoCalculado !== undefined
      ? baseProporcional(matricula.montoCalculado, 1, 1)
      : baseProporcional(matricula.precioPlan, matricula.clasesPorMesPlan, matricula.clasesTotales);
  return calcularTotal(matricula.montoAjustado === null ? { base } : { base, montoAjustado: matricula.montoAjustado });
}
