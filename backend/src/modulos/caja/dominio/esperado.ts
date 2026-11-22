import type { MetodoPago, ResultadoCierre } from '@aquagestion/contratos';
import { Decimal } from '../../../infraestructura/prisma';

/**
 * El esperado de la caja y la diferencia del cierre (spec 006, criterio 27; HU-27, sección 4.3, D-03, D-04). Funciones puras y sin base de
 * datos: todo con `Decimal`, nunca `number`, así que `0.10 + 0.20` da exactamente `0.30` y mil ingresos de `0.01`, exactamente `10.00`.
 */

/** Un movimiento de la caja, solo con lo que cuenta para el resumen. */
export interface MovimientoParaResumen {
  readonly tipo: 'INGRESO' | 'EGRESO';
  readonly metodo: MetodoPago;
  readonly monto: Decimal;
}

export interface MontosPorMetodo {
  readonly efectivo: Decimal;
  readonly yape: Decimal;
  readonly transferencia: Decimal;
}

export interface ResumenDeMontos {
  readonly ingresos: MontosPorMetodo;
  readonly egresos: { readonly efectivo: Decimal };
  readonly esperado: MontosPorMetodo;
}

const CERO = new Decimal(0);

/**
 * Esperado en efectivo = monto inicial + ingresos en efectivo - egresos; esperado en Yape = ingresos por Yape; esperado en transferencia =
 * ingresos por transferencia (el Yape y la transferencia se registran en la caja, pero no suman al efectivo físico; sección 4.3, D-04).
 * Todo egreso sale del efectivo (DR-3). No cambia los movimientos que recibe ni depende de su orden.
 */
export function calcularResumen(entrada: {
  readonly montoInicial: Decimal;
  readonly movimientos: readonly MovimientoParaResumen[];
}): ResumenDeMontos {
  let efectivo = CERO;
  let yape = CERO;
  let transferencia = CERO;
  let egresos = CERO;
  for (const movimiento of entrada.movimientos) {
    if (movimiento.tipo === 'EGRESO') {
      egresos = egresos.plus(movimiento.monto);
    } else if (movimiento.metodo === 'EFECTIVO') {
      efectivo = efectivo.plus(movimiento.monto);
    } else if (movimiento.metodo === 'YAPE') {
      yape = yape.plus(movimiento.monto);
    } else {
      transferencia = transferencia.plus(movimiento.monto);
    }
  }
  return {
    ingresos: { efectivo, yape, transferencia },
    egresos: { efectivo: egresos },
    esperado: { efectivo: entrada.montoInicial.plus(efectivo).minus(egresos), yape, transferencia },
  };
}

/** `declarado - esperado en efectivo`, y `CUADRA` si es 0, `SOBRANTE` si es mayor y `FALTANTE` si es menor (`0` y `0.00` son lo mismo). */
export function calcularDiferencia(
  declarado: Decimal,
  esperadoEfectivo: Decimal,
): { diferencia: Decimal; resultado: ResultadoCierre } {
  const diferencia = declarado.minus(esperadoEfectivo);
  const resultado: ResultadoCierre = diferencia.isZero() ? 'CUADRA' : diferencia.gt(CERO) ? 'SOBRANTE' : 'FALTANTE';
  return { diferencia, resultado };
}
