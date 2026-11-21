import type { Cotizacion } from '@aquagestion/contratos';
import { Decimal } from '../../../infraestructura/prisma';
import { hoyEnLima } from '../../../comun/fechas';
import { aTextoMonto } from '../../../comun/dinero';
import { type ClaseElegida, clasesRestantes, diasDelMes, montoProporcional } from '../../matriculas/dominio/cobro';

/**
 * La cotización de una inscripción (spec 005, criterios 9 y 11; HU-34, RN-25, D-03): pura y calculada con "ahora" en America/Lima. Es lo
 * que ve el cliente y lo que se guarda en la matrícula: el envío la vuelve a calcular y compara (criterio 19).
 */

export interface PlanParaCotizar {
  /** Texto con dos decimales (`"120.00"`), tal como sale de `numeric(10,2)`. */
  precio: string;
  clasesPorMes: number;
}

/** La cotización con los números de la matrícula. El precio se copia del plan (HU-19) y el total se redondea hacia arriba una sola vez. */
export function cotizarInscripcion(plan: PlanParaCotizar, clases: readonly ClaseElegida[], ahora: Date): Cotizacion {
  const hoy = hoyEnLima(ahora);
  const [anio = '0', mes = '0'] = hoy.split('-');
  const restantes = clasesRestantes(clases, ahora);
  // Con el tope del plan (HU-34): quien entra el día 1 de un mes con más clases que el plan paga el precio entero.
  const totales = Math.min(restantes, plan.clasesPorMes);
  const monto = totales > 0 ? montoProporcional(new Decimal(plan.precio), plan.clasesPorMes, totales) : new Decimal(0);
  return {
    mes: `${anio}-${mes}`,
    fechaInicio: hoy,
    fechaFin: `${anio}-${mes}-${String(diasDelMes(Number(anio), Number(mes))).padStart(2, '0')}`,
    clasesRestantes: restantes,
    clasesTotales: totales,
    clasesPorMes: plan.clasesPorMes,
    precioPlan: aTextoMonto(plan.precio),
    monto: aTextoMonto(monto),
    esProporcional: restantes < plan.clasesPorMes,
  };
}
