import type { EstadoSolicitud } from '@aquagestion/contratos';
import { anioYMesEnLima } from '../../comun/fechas';
import { type Fragmento, sql } from '../../infraestructura/prisma';

/** Lo que decide el estado visible de una solicitud: su fila, su matrícula, el vencimiento de la reserva y, desde la 007, sus pagos. */
export interface DatosDelEstado {
  estado_solicitud: EstadoSolicitud;
  estado_matricula: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  reserva_vence_en: Date | null;
  /** El estado del pago que cuenta de la matrícula (el abierto y, si no hay, el último rechazado: `unirUltimoPago`), o `null` si no tiene. */
  estado_ultimo_pago?: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO' | null;
  /** Si la matrícula tiene un pago `PENDIENTE_VERIFICACION` (a lo sumo uno, el índice `pagos_un_abierto_por_matricula`). */
  hay_pago_pendiente?: boolean | null;
  /** El año y el mes de la matrícula: con ellos se decide si un pago rechazado todavía se puede reintentar (007b). */
  anio?: number;
  mes?: number;
}

/**
 * El estado visible de una solicitud (spec 005, PB2, ampliado por la 007): una sola regla para el seguimiento, la foto, la lista, la
 * cancelación y el cobro. En este orden:
 * 1. la fila `VENCIDA`, `CANCELADA` o `CONFIRMADA` es lo que dice;
 * 2. con un pago `PENDIENTE_VERIFICACION` en la matrícula, `EN_VERIFICACION`;
 * 3. con la matrícula `CANCELADA` y su último pago `RECHAZADO`: `PAGO_RECHAZADO` mientras el mes de «hoy» (Lima) no sea posterior al de la
 *    matrícula (la de M+1 también, 010d, DT-9) y `VENCIDA` después;
 * 4. con la matrícula `CANCELADA`, `CANCELADA`;
 * 5. con la matrícula `RESERVADA` y la reserva vencida (`reserva_vence_en <= ahora`, también en el instante exacto), `VENCIDA`, aunque la
 *    fila aún no lo diga (se calcula al leer, sin tarea programada);
 * 6. si no, `PENDIENTE_PAGO`.
 * La fila `VENCIDA` la escribe el criterio 21 b de 005 en las solicitudes anteriores de un cliente que vuelve.
 */
export function estadoVisible(datos: DatosDelEstado, ahora: Date): EstadoSolicitud {
  if (datos.estado_solicitud !== 'PENDIENTE_PAGO') return datos.estado_solicitud;
  if (datos.hay_pago_pendiente === true) return 'EN_VERIFICACION';
  if (datos.estado_matricula === 'CANCELADA') {
    if (datos.estado_ultimo_pago === 'RECHAZADO') {
      const hoy = anioYMesEnLima(ahora);
      // El mes de hoy no es posterior al de la matrícula (010d, DT-9): año y mes juntos, así un rechazo de M+1 sigue vivo en M.
      const reintentable =
        datos.anio !== undefined && datos.mes !== undefined && datos.anio * 12 + datos.mes >= hoy.anio * 12 + hoy.mes;
      return reintentable ? 'PAGO_RECHAZADO' : 'VENCIDA';
    }
    return 'CANCELADA';
  }
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
 * El pago de la matrícula `m` del que depende lo que se muestra, como un `LEFT JOIN LATERAL` con el alias `up`, más si hay un pago pendiente
 * (`hay_pendiente`). Sin pagos, las columnas de `up` son nulas. Se une después de `matriculas m`.
 *
 * Es el pago abierto (`PENDIENTE_VERIFICACION` o `CONFIRMADO`, a lo sumo uno por matrícula: el índice `pagos_un_abierto_por_matricula`) y, si
 * no hay, el último rechazado (`registrado_en` más reciente y, a igual instante, el de mayor `id`). Un abierto va antes que un rechazado aunque
 * el `registrado_en` del rechazado sea posterior (los relojes de varias instancias de la API pueden diferir): así la vista `CONFIRMADA` muestra
 * el método, el monto y el ticket del cobro, y `EN_VERIFICACION`, los datos del comprobante en revisión (spec 007b, «Notas»).
 */
export const unirUltimoPago: Fragmento = sql`
  LEFT JOIN LATERAL (
    SELECT p.id, p.metodo, p.estado, p.monto, p.registrado_en, p.verificado_en, p.numero_operacion, p.fecha_operacion,
           p.motivo_rechazo, p.numero_ticket,
           EXISTS (SELECT 1 FROM pagos q WHERE q.academia_id = p.academia_id AND q.matricula_id = p.matricula_id
                      AND q.estado = 'PENDIENTE_VERIFICACION'::estado_pago) AS hay_pendiente
      FROM pagos p
     WHERE p.academia_id = m.academia_id AND p.matricula_id = m.id
     ORDER BY (p.estado = 'RECHAZADO'::estado_pago), p.registrado_en DESC, p.id DESC
     LIMIT 1
  ) up ON true`;

/**
 * La misma regla de `estadoVisible` como expresión de SQL, para filtrar la lista del panel (criterio 38 de 005 y 29 de 007) sin traer todas
 * las filas. Usa los alias `s` (`solicitudes_inscripcion`), `m` (`matriculas`) y `up` (`unirUltimoPago`); `ahora` viaja como parámetro (nunca
 * `now()`) y el mes de hoy en Lima se calcula en TypeScript.
 */
export function estadoVisibleSql(ahora: Date): Fragmento {
  const hoy = anioYMesEnLima(ahora);
  return sql`(CASE
      WHEN s.estado <> 'PENDIENTE_PAGO'::estado_solicitud THEN s.estado::text
      WHEN coalesce(up.hay_pendiente, false) THEN 'EN_VERIFICACION'
      WHEN m.estado = 'CANCELADA'::estado_matricula AND up.estado = 'RECHAZADO'::estado_pago THEN
        (CASE WHEN (m.anio::int * 12 + m.mes::int) >= ${hoy.anio * 12 + hoy.mes}::int THEN 'PAGO_RECHAZADO' ELSE 'VENCIDA' END)
      WHEN m.estado = 'CANCELADA'::estado_matricula THEN 'CANCELADA'
      WHEN m.estado = 'RESERVADA'::estado_matricula AND m.reserva_vence_en IS NOT NULL
           AND m.reserva_vence_en <= ${ahora}::timestamptz THEN 'VENCIDA'
      ELSE 'PENDIENTE_PAGO' END)`;
}
