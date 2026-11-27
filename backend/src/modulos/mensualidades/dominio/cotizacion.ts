import type { Cotizacion } from '@aquagestion/contratos';
import { cotizarInscripcion, type PlanParaCotizar } from '../../inscripciones/dominio/cotizacion';
import type { ClaseElegida } from '../../matriculas/dominio/cobro';
import { inicioDelMesEnLima, mesDeTexto, mesEnCurso } from './ventana';

/**
 * La cotización de una renovación (spec 010a, criterios 5 y 21; RN-25, HU-34, D-03, DR-3, DT-6): la misma cuenta de la inscripción de la 005
 * (`clasesTotales = min(clasesRestantes, clasesPorMes)`, el monto proporcional redondeado hacia arriba al sol entero una sola vez y
 * `esProporcional = clasesRestantes < clasesPorMes`), pero con el «desde» del mes pedido: «ahora» para el mes en curso (la clase de hoy cuenta
 * si todavía no empezó) y las 00:00 de Lima del día 1 para cualquier otro (el mes siguiente se cotiza completo desde el día 1). Pura, con
 * `Decimal` y sin `number` con coma flotante.
 */
export function cotizarRenovacion(
  plan: PlanParaCotizar,
  clases: readonly ClaseElegida[],
  mes: string,
  ahora: Date,
): Cotizacion {
  const desde = mes === mesEnCurso(ahora) ? ahora : inicioDelMesEnLima(mesDeTexto(mes));
  return cotizarInscripcion(plan, clases, desde);
}
