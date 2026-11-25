import {
  esMenorDeEdad,
  type EstadoSolicitud,
  type FiltroEstadoSolicitudes,
  type SolicitudPanel,
  TOPE_DE_LA_LISTA,
} from '@aquagestion/contratos';
import { aTextoMonto } from '../../comun/dinero';
import { hoyEnLima } from '../../comun/fechas';
import { Decimal, type Fragmento, join, sql, type TransaccionAcademia, vacio } from '../../infraestructura/prisma';
import { totalACobrar } from '../pagos/dominio/total';
import { estadoVisible, estadoVisibleSql, unirUltimoPago } from './estado-visible';

/** Los estados visibles que muestra cada filtro de la lista (`TODAS` no filtra). */
const ESTADOS_DEL_FILTRO: Readonly<Record<Exclude<FiltroEstadoSolicitudes, 'TODAS'>, readonly EstadoSolicitud[]>> = {
  ACTIVAS: ['PENDIENTE_PAGO', 'EN_VERIFICACION', 'PAGO_RECHAZADO'],
  VENCIDAS: ['VENCIDA'],
  CANCELADAS: ['CANCELADA'],
  CONFIRMADAS: ['CONFIRMADA'],
};

interface FilaDeLaLista {
  id: string;
  codigo: string;
  estado_solicitud: EstadoSolicitud;
  estado_matricula: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  creada_en: Date;
  reserva_vence_en: Date | null;
  nombres: string;
  apellidos: string;
  dni: string;
  telefono: string;
  fecha_nacimiento: string;
  plan_id: string;
  plan_nombre: string;
  anio: number;
  mes: number;
  clases_totales: number;
  monto_calculado: string;
  monto_ajustado: string | null;
  motivo_ajuste: string | null;
  /** El último pago de la matrícula (`unirUltimoPago`): todo nulo si no tiene. */
  pago_id: string | null;
  pago_metodo: 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA' | null;
  pago_estado: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO' | null;
  pago_monto: string | null;
  pago_registrado_en: Date | null;
  pago_verificado_en: Date | null;
  pago_numero_operacion: string | null;
  pago_fecha_operacion: string | null;
  pago_motivo_rechazo: string | null;
  pago_numero_ticket: number | null;
  hay_pago_pendiente: boolean | null;
  /** JSON de las clases (`jsonb` como texto): `[{ id, nivel, diaSemana, horaInicio, horaFin }]`. */
  clases: string;
}

/**
 * Los elementos del panel de solicitudes (spec 005b, criterio 38; 007, criterio 29) con una sola consulta: la solicitud, el alumno, la matrícula
 * (`m.solicitud_id = s.id`), el plan, el último pago de la matrícula y las clases (por día y hora). Con `id`, solo esa solicitud; con
 * `filtro`, las de ese estado visible, de la más nueva a la más antigua y hasta el tope. Los datos de la persona son los que tiene hoy el
 * alumno (no hay historial); el plan, las clases, el mes y el total son los de la matrícula de la solicitud. El `monto` es el total a cobrar
 * (`totalACobrar`, calculado aquí con `Decimal` a partir de lo guardado en la matrícula) y `ajuste` lo muestra si hay uno. Sin bloqueos.
 */
export async function leerElementosDelPanel(
  tx: TransaccionAcademia,
  ahora: Date,
  pedido: { filtro: FiltroEstadoSolicitudes } | { id: string },
): Promise<SolicitudPanel[]> {
  let condicion: Fragmento = vacio;
  let tope: Fragmento = vacio;
  if ('id' in pedido) {
    condicion = sql`AND s.id = ${pedido.id}::uuid`;
  } else {
    if (pedido.filtro !== 'TODAS') {
      condicion = sql`AND ${estadoVisibleSql(ahora)} IN (${join([...ESTADOS_DEL_FILTRO[pedido.filtro]])})`;
    }
    tope = sql`LIMIT ${TOPE_DE_LA_LISTA}::int`;
  }
  const filas = await tx.cliente.$queryRaw<FilaDeLaLista[]>`
    SELECT s.id::text AS id, s.codigo, s.estado::text AS estado_solicitud, m.estado::text AS estado_matricula,
           s.creado_en AS creada_en, m.reserva_vence_en, a.nombres, a.apellidos, a.dni, a.telefono,
           a.fecha_nacimiento::text AS fecha_nacimiento, p.id::text AS plan_id, p.nombre AS plan_nombre,
           m.anio::int AS anio, m.mes::int AS mes, m.clases_totales::int AS clases_totales,
           m.monto_calculado::text AS monto_calculado, m.monto_ajustado::text AS monto_ajustado, m.motivo_ajuste,
           up.id::text AS pago_id, up.metodo::text AS pago_metodo, up.estado::text AS pago_estado, up.monto::text AS pago_monto,
           up.registrado_en AS pago_registrado_en, up.verificado_en AS pago_verificado_en,
           up.numero_operacion AS pago_numero_operacion, up.fecha_operacion::text AS pago_fecha_operacion,
           up.motivo_rechazo AS pago_motivo_rechazo, up.numero_ticket AS pago_numero_ticket, up.hay_pendiente AS hay_pago_pendiente,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id::text, 'nivel', c.nivel::text, 'diaSemana', c.dia_semana::int,
                                                         'horaInicio', to_char(c.hora_inicio, 'HH24:MI'),
                                                         'horaFin', to_char(c.hora_fin, 'HH24:MI'))
                                   ORDER BY c.dia_semana, c.hora_inicio, c.id), '[]'::jsonb)::text
              FROM matricula_clases mc
              JOIN clases c ON c.academia_id = mc.academia_id AND c.id = mc.clase_id
             WHERE mc.academia_id = s.academia_id AND mc.matricula_id = m.id) AS clases
      FROM solicitudes_inscripcion s
      JOIN alumnos a ON a.academia_id = s.academia_id AND a.id = s.alumno_id
      JOIN matriculas m ON m.academia_id = s.academia_id AND m.solicitud_id = s.id
      JOIN planes p ON p.academia_id = m.academia_id AND p.id = m.plan_id
      ${unirUltimoPago}
     WHERE s.academia_id = ${tx.academiaId}::uuid ${condicion}
     ORDER BY s.creado_en DESC, s.id DESC
     ${tope}`;
  const hoy = hoyEnLima(ahora);
  return filas.map((fila) => {
    const estado = estadoVisible(
      {
        estado_solicitud: fila.estado_solicitud,
        estado_matricula: fila.estado_matricula,
        reserva_vence_en: fila.reserva_vence_en,
        estado_ultimo_pago: fila.pago_estado,
        hay_pago_pendiente: fila.hay_pago_pendiente,
        anio: fila.anio,
        mes: fila.mes,
      },
      ahora,
    );
    const total = totalACobrar({
      montoAjustado: fila.monto_ajustado === null ? null : new Decimal(fila.monto_ajustado),
      montoCalculado: new Decimal(fila.monto_calculado),
    });
    return {
      id: fila.id,
      codigo: fila.codigo,
      estado,
      creadaEn: fila.creada_en.toISOString(),
      reservaVenceEn: estado === 'PENDIENTE_PAGO' && fila.reserva_vence_en ? fila.reserva_vence_en.toISOString() : null,
      nombres: fila.nombres,
      apellidos: fila.apellidos,
      dni: fila.dni,
      telefono: fila.telefono,
      menorDeEdad: esMenorDeEdad(fila.fecha_nacimiento, hoy),
      plan: { id: fila.plan_id, nombre: fila.plan_nombre },
      clases: JSON.parse(fila.clases) as SolicitudPanel['clases'],
      mes: `${fila.anio}-${String(fila.mes).padStart(2, '0')}`,
      clasesTotales: fila.clases_totales,
      monto: aTextoMonto(total),
      ajuste:
        fila.monto_ajustado === null
          ? null
          : { montoCalculado: aTextoMonto(fila.monto_calculado), motivo: fila.motivo_ajuste ?? '' },
      pago:
        fila.pago_id === null ||
        fila.pago_metodo === null ||
        fila.pago_estado === null ||
        fila.pago_monto === null ||
        fila.pago_registrado_en === null
          ? null
          : {
              id: fila.pago_id,
              metodo: fila.pago_metodo,
              estado: fila.pago_estado,
              monto: aTextoMonto(fila.pago_monto),
              registradoEn: fila.pago_registrado_en.toISOString(),
              verificadoEn: fila.pago_verificado_en ? fila.pago_verificado_en.toISOString() : null,
              numeroOperacion: fila.pago_numero_operacion,
              fechaOperacion: fila.pago_fecha_operacion,
              motivoRechazo: fila.pago_motivo_rechazo,
              numeroTicket: fila.pago_numero_ticket,
            },
    };
  });
}
