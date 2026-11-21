import type { EstadoSolicitud } from '@aquagestion/contratos';
import { type Fragmento, sql } from '../../infraestructura/prisma';

/** Lo que decide el estado visible de una solicitud: su fila, su matrícula y el vencimiento de la reserva. */
export interface DatosDelEstado {
  estado_solicitud: EstadoSolicitud;
  estado_matricula: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  reserva_vence_en: Date | null;
}

/**
 * El estado visible de una solicitud (spec 005, PB2): una sola regla para el seguimiento, la foto, la lista y la cancelación.
 * La fila `VENCIDA` o `CANCELADA` es lo que dice; una fila `PENDIENTE_PAGO` con la matrícula `CANCELADA` se ve `CANCELADA`; con la
 * matrícula `RESERVADA` y la reserva vencida (`reserva_vence_en <= ahora`, también en el instante exacto) se ve `VENCIDA`, aunque la
 * fila aún no lo diga (se calcula al leer, sin tarea programada); si no, `PENDIENTE_PAGO`. La fila `VENCIDA` la escribe el criterio 21 b
 * en las solicitudes anteriores de un cliente que vuelve.
 */
export function estadoVisible(datos: DatosDelEstado, ahora: Date): EstadoSolicitud {
  if (datos.estado_solicitud !== 'PENDIENTE_PAGO') return datos.estado_solicitud;
  if (datos.estado_matricula === 'CANCELADA') return 'CANCELADA';
  if (
    datos.estado_matricula === 'RESERVADA' &&
    datos.reserva_vence_en !== null &&
    datos.reserva_vence_en.getTime() <= ahora.getTime()
  ) {
    return 'VENCIDA';
  }
  return 'PENDIENTE_PAGO';
}

/**
 * La misma regla de `estadoVisible` como expresión de SQL, para filtrar la lista del panel (criterio 38) sin traer todas las filas. Usa
 * los alias `s` (`solicitudes_inscripcion`) y `m` (`matriculas`); `ahora` viaja como parámetro (nunca `now()`).
 */
export function estadoVisibleSql(ahora: Date): Fragmento {
  return sql`(CASE
      WHEN s.estado <> 'PENDIENTE_PAGO'::estado_solicitud THEN s.estado::text
      WHEN m.estado = 'CANCELADA'::estado_matricula THEN 'CANCELADA'
      WHEN m.estado = 'RESERVADA'::estado_matricula AND m.reserva_vence_en IS NOT NULL
           AND m.reserva_vence_en <= ${ahora}::timestamptz THEN 'VENCIDA'
      ELSE 'PENDIENTE_PAGO' END)`;
}
