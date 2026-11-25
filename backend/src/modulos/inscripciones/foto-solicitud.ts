import type { EstadoSolicitud } from '@aquagestion/contratos';
import type { TransaccionAcademia } from '../../infraestructura/prisma';
import { estadoVisible, unirUltimoPago } from './estado-visible';

/** La solicitud con su matrícula y su alumno, lo que decide si admite una foto (005b, criterio 34; 008b, criterio 23). */
export interface FilaDeLaSolicitud {
  solicitud_id: string;
  alumno_id: string;
  estado_solicitud: EstadoSolicitud;
  estado_matricula: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  reserva_vence_en: Date | null;
  estado_alumno: string;
  /** El último pago de la matrícula, si lo hay, y el mes de la matrícula (007: `EN_VERIFICACION` y `PAGO_RECHAZADO` siguen editables). */
  estado_ultimo_pago: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO' | null;
  hay_pago_pendiente: boolean | null;
  anio: number;
  mes: number;
}

/**
 * ¿Admite la foto la ruta pública? Solo con la vista completa de la solicitud vigente del cliente (PB5; 007, criterio 31): fila `PENDIENTE_PAGO`,
 * alumno `CLIENTE` y estado visible `PENDIENTE_PAGO`, `EN_VERIFICACION` o `PAGO_RECHAZADO`. Con `CONFIRMADA` el alumno ya no está en `CLIENTE`:
 * la foto de un alumno es de la 008. En el instante exacto del vencimiento (con el tope del fin de mes, criterio 54) ya es `VENCIDA`.
 */
export function esEditable(fila: FilaDeLaSolicitud, ahora: Date): boolean {
  if (fila.estado_solicitud !== 'PENDIENTE_PAGO' || fila.estado_alumno !== 'CLIENTE') return false;
  const estado = estadoVisible(fila, ahora);
  return estado === 'PENDIENTE_PAGO' || estado === 'EN_VERIFICACION' || estado === 'PAGO_RECHAZADO';
}

/**
 * ¿Admite la foto la ruta del panel? Lo mismo que la pública (`esEditable`) o la solicitud `CONFIRMADA` de un alumno que ya no es `CLIENTE`
 * (008b, criterio 23). Una solicitud `VENCIDA` o `CANCELADA`, o la fila anterior de un cliente que volvió, no.
 */
export function esEditableDesdeElPanel(fila: FilaDeLaSolicitud, ahora: Date): boolean {
  if (esEditable(fila, ahora)) return true;
  return fila.estado_solicitud === 'CONFIRMADA' && fila.estado_alumno !== 'CLIENTE';
}

/**
 * La solicitud de un id con su última matrícula y su alumno, sin bloquear nada (comprobación previa de la foto del panel). A diferencia de la
 * pública, no exige matrícula: la fila anterior `VENCIDA` de un cliente que volvió no tiene ninguna y debe responder 409, no 404 (criterio 23). Sin
 * matrícula, el estado de la matrícula se toma como `CANCELADA`: una solicitud sin matrícula nunca está activa.
 */
export async function leerSolicitudParaLaFoto(
  tx: TransaccionAcademia,
  solicitudId: string,
): Promise<FilaDeLaSolicitud | undefined> {
  const filas = await tx.cliente.$queryRaw<FilaDeLaSolicitud[]>`
    SELECT s.id::text AS solicitud_id, s.alumno_id::text AS alumno_id, s.estado::text AS estado_solicitud,
           COALESCE(m.estado::text, 'CANCELADA') AS estado_matricula, m.reserva_vence_en, a.estado::text AS estado_alumno,
           up.estado::text AS estado_ultimo_pago, up.hay_pendiente AS hay_pago_pendiente,
           COALESCE(m.anio, 0)::int AS anio, COALESCE(m.mes, 0)::int AS mes
      FROM solicitudes_inscripcion s
      JOIN alumnos a ON a.academia_id = s.academia_id AND a.id = s.alumno_id
      LEFT JOIN LATERAL (
        SELECT m2.* FROM matriculas m2
         WHERE m2.academia_id = s.academia_id AND m2.solicitud_id = s.id
         ORDER BY m2.creado_en DESC
         LIMIT 1
      ) m ON true
      ${unirUltimoPago}
     WHERE s.academia_id = ${tx.academiaId}::uuid AND s.id = ${solicitudId}::uuid`;
  return filas[0];
}

/**
 * La parte común de la transacción de escritura de la foto de una solicitud: `alumnos` `FOR UPDATE` y después `solicitudes_inscripcion` `FOR
 * UPDATE` (el orden de «Orden de bloqueos»: el envío con el mismo DNI toma el alumno antes que sus solicitudes) y la lectura de su matrícula.
 * Devuelve la fila de la solicitud ya con los bloqueos y la clave anterior, o `null` si alguna de las tres filas ya no está; el 404 que
 * corresponde y la comprobación de si todavía se admite la hacen quien llama.
 */
export async function bloquearYLeerLaSolicitud(
  tx: TransaccionAcademia,
  solicitudId: string,
  alumnoId: string,
): Promise<{ fila: FilaDeLaSolicitud; fotoClaveAnterior: string | null } | null> {
  const alumnos = await tx.cliente.$queryRaw<{ estado: string; foto_clave: string | null }[]>`
    SELECT estado::text AS estado, foto_clave FROM alumnos
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumnoId}::uuid
       FOR UPDATE`;
  const solicitudes = await tx.cliente.$queryRaw<{ estado: FilaDeLaSolicitud['estado_solicitud'] }[]>`
    SELECT estado::text AS estado FROM solicitudes_inscripcion
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${solicitudId}::uuid
       FOR UPDATE`;
  const matriculas = await tx.cliente.$queryRaw<
    {
      estado: FilaDeLaSolicitud['estado_matricula'];
      reserva_vence_en: Date | null;
      estado_ultimo_pago: FilaDeLaSolicitud['estado_ultimo_pago'];
      hay_pago_pendiente: boolean | null;
      anio: number;
      mes: number;
    }[]
  >`
    SELECT m.estado::text AS estado, m.reserva_vence_en, up.estado::text AS estado_ultimo_pago,
           up.hay_pendiente AS hay_pago_pendiente, m.anio::int AS anio, m.mes::int AS mes
      FROM matriculas m
      ${unirUltimoPago}
     WHERE m.academia_id = ${tx.academiaId}::uuid AND m.solicitud_id = ${solicitudId}::uuid
     ORDER BY m.creado_en DESC
     LIMIT 1`;
  const alumno = alumnos[0];
  const solicitud = solicitudes[0];
  const matricula = matriculas[0];
  if (!alumno || !solicitud || !matricula) return null;
  return {
    fotoClaveAnterior: alumno.foto_clave,
    fila: {
      solicitud_id: solicitudId,
      alumno_id: alumnoId,
      estado_solicitud: solicitud.estado,
      estado_matricula: matricula.estado,
      reserva_vence_en: matricula.reserva_vence_en,
      estado_alumno: alumno.estado,
      estado_ultimo_pago: matricula.estado_ultimo_pago,
      hay_pago_pendiente: matricula.hay_pago_pendiente,
      anio: matricula.anio,
      mes: matricula.mes,
    },
  };
}
