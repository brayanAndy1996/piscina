import type { EstadoSolicitud } from '@aquagestion/contratos';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { Decimal, type TransaccionAcademia } from '../../infraestructura/prisma';

/**
 * Las filas que toma todo cobro y toda verificación de un pago, en el orden de bloqueos de la regla «Orden de bloqueos con la caja» de la 006
 * y del criterio 19 de la 007 (spec 007, DT-16): después de `bloquearActorVigente` (que va primero, en quien llama), el bloqueo consultivo
 * del DNI (el mismo del envío de la 005 y de la creación de personal), `alumnos`, `solicitudes_inscripcion`, `matriculas` y `pagos`, todas con
 * `FOR UPDATE`. Las clases (`bloquearClasesParaCupo`) y, al final, la caja los toma quien llama, si mueve cupo o dinero. Sin Nest.
 */

export interface AlumnoBloqueado {
  readonly id: string;
  readonly dni: string;
  readonly nombres: string;
  readonly apellidos: string;
  readonly estado: 'CLIENTE' | 'ALUMNO_ACTIVO' | 'ALUMNO_VENCIDO' | 'INACTIVO';
  readonly usuarioId: string | null;
}

export interface SolicitudBloqueada {
  readonly id: string;
  readonly codigo: string;
  readonly estado: EstadoSolicitud;
}

export interface MatriculaBloqueada {
  readonly id: string;
  readonly estado: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  readonly reservaVenceEn: Date | null;
  readonly anio: number;
  readonly mes: number;
  readonly precioPlan: Decimal;
  readonly clasesPorMesPlan: number;
  readonly clasesTotales: number;
  readonly montoCalculado: Decimal;
  readonly montoAjustado: Decimal | null;
  readonly motivoAjuste: string | null;
}

export interface PagoBloqueado {
  readonly id: string;
  readonly estado: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO';
  readonly metodo: 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA';
  /** Texto con dos decimales. */
  readonly monto: string;
  readonly claveIdempotencia: string;
}

/** Lo que quedó bloqueado, para decidir sin volver a leer. `pagos` va del último al primero (`registrado_en` y, a igual instante, `id`). */
export interface FilasDelCobro {
  readonly alumno: AlumnoBloqueado;
  readonly solicitud: SolicitudBloqueada;
  readonly matricula: MatriculaBloqueada;
  readonly pagos: readonly PagoBloqueado[];
  /** Las clases de la matrícula, sin bloquear: quien mueve cupo las pasa a `bloquearClasesParaCupo` en una sola llamada. */
  readonly claseIds: readonly string[];
}

interface FilaDelAlumnoDeLaSolicitud {
  alumno_id: string;
  dni: string;
}

/**
 * El DNI del alumno de la solicitud, sin bloquear nada: el dato que necesita el bloqueo consultivo (y el cobro, para calcular el hash de la
 * contraseña inicial antes de abrir la transacción). Un DNI no cambia (la app no tiene `UPDATE` de `alumnos.dni`). `null` si la solicitud no
 * existe en la academia de `tx` o el id no es un UUID.
 */
export async function leerDniDeLaSolicitud(
  tx: TransaccionAcademia,
  solicitudId: string,
): Promise<{ alumnoId: string; dni: string; esCliente: boolean } | null> {
  if (!PATRON_UUID.test(solicitudId)) return null;
  const filas = await tx.cliente.$queryRaw<(FilaDelAlumnoDeLaSolicitud & { estado: string })[]>`
    SELECT a.id::text AS alumno_id, a.dni, a.estado::text AS estado
      FROM solicitudes_inscripcion s
      JOIN alumnos a ON a.academia_id = s.academia_id AND a.id = s.alumno_id
     WHERE s.academia_id = ${tx.academiaId}::uuid AND s.id = ${solicitudId.toLowerCase()}::uuid`;
  const fila = filas[0];
  return fila ? { alumnoId: fila.alumno_id, dni: fila.dni, esCliente: fila.estado === 'CLIENTE' } : null;
}

interface FilaDeLaMatricula {
  id: string;
  estado: MatriculaBloqueada['estado'];
  reserva_vence_en: Date | null;
  anio: number;
  mes: number;
  precio_plan: string;
  clases_por_mes_plan: number;
  clases_totales: number;
  monto_calculado: string;
  monto_ajustado: string | null;
  motivo_ajuste: string | null;
}

/**
 * Bloquea, en el orden de la regla, las filas de la solicitud `solicitudId` (que ya existe en la academia, con el alumno `alumnoId` y su `dni`
 * leídos con `leerDniDeLaSolicitud`). Devuelve `null` si algo no coincide (la solicitud o su matrícula no existen: quien llama responde 404).
 * No bloquea las clases ni la caja.
 */
export async function bloquearFilasDelCobro(
  tx: TransaccionAcademia,
  entrada: { solicitudId: string; alumnoId: string; dni: string },
): Promise<FilasDelCobro | null> {
  const { alumnoId, dni } = entrada;
  const solicitudId = entrada.solicitudId.toLowerCase();
  // 1. El bloqueo consultivo del DNI: el mismo del envío de la 005 y de la creación de personal (DT-16).
  await tx.cliente.$executeRaw`
    SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`inscripcion-dni:${tx.academiaId}:${dni}`}::text, 0))`;
  // 2. El alumno. Se comprueba que su DNI sea el leído (nunca cambia, pero lo que se bloquea es lo que se decidió).
  const alumnos = await tx.cliente.$queryRaw<
    {
      id: string;
      dni: string;
      nombres: string;
      apellidos: string;
      estado: AlumnoBloqueado['estado'];
      usuario_id: string | null;
    }[]
  >`
    SELECT id::text AS id, dni, nombres, apellidos, estado::text AS estado, usuario_id::text AS usuario_id
      FROM alumnos
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumnoId}::uuid
       FOR UPDATE`;
  const alumno = alumnos[0];
  if (!alumno || alumno.dni !== dni) return null;
  // 3. La solicitud.
  const solicitudes = await tx.cliente.$queryRaw<{ id: string; codigo: string; estado: EstadoSolicitud }[]>`
    SELECT id::text AS id, codigo, estado::text AS estado FROM solicitudes_inscripcion
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${solicitudId}::uuid AND alumno_id = ${alumnoId}::uuid
       FOR UPDATE`;
  const solicitud = solicitudes[0];
  if (!solicitud) return null;
  // 4. Su matrícula.
  const matriculas = await tx.cliente.$queryRaw<FilaDeLaMatricula[]>`
    SELECT id::text AS id, estado::text AS estado, reserva_vence_en, anio::int AS anio, mes::int AS mes, precio_plan::text AS precio_plan,
           clases_por_mes_plan::int AS clases_por_mes_plan, clases_totales::int AS clases_totales,
           monto_calculado::text AS monto_calculado, monto_ajustado::text AS monto_ajustado, motivo_ajuste
      FROM matriculas
     WHERE academia_id = ${tx.academiaId}::uuid AND solicitud_id = ${solicitudId}::uuid
     ORDER BY id
       FOR UPDATE`;
  const matricula = matriculas[0];
  if (!matricula) return null;
  // 5. Sus pagos.
  const pagos = await tx.cliente.$queryRaw<
    {
      id: string;
      estado: PagoBloqueado['estado'];
      metodo: PagoBloqueado['metodo'];
      monto: string;
      clave_idempotencia: string;
    }[]
  >`
    SELECT id::text AS id, estado::text AS estado, metodo::text AS metodo, monto::text AS monto,
           clave_idempotencia::text AS clave_idempotencia
      FROM pagos
     WHERE academia_id = ${tx.academiaId}::uuid AND matricula_id = ${matricula.id}::uuid
     ORDER BY registrado_en DESC, id DESC
       FOR UPDATE`;
  const clases = await tx.cliente.$queryRaw<{ clase_id: string }[]>`
    SELECT clase_id::text AS clase_id FROM matricula_clases
     WHERE academia_id = ${tx.academiaId}::uuid AND matricula_id = ${matricula.id}::uuid
     ORDER BY clase_id`;
  return {
    alumno: {
      id: alumno.id,
      dni: alumno.dni,
      nombres: alumno.nombres,
      apellidos: alumno.apellidos,
      estado: alumno.estado,
      usuarioId: alumno.usuario_id,
    },
    solicitud,
    matricula: {
      id: matricula.id,
      estado: matricula.estado,
      reservaVenceEn: matricula.reserva_vence_en,
      anio: matricula.anio,
      mes: matricula.mes,
      precioPlan: new Decimal(matricula.precio_plan),
      clasesPorMesPlan: matricula.clases_por_mes_plan,
      clasesTotales: matricula.clases_totales,
      montoCalculado: new Decimal(matricula.monto_calculado),
      montoAjustado: matricula.monto_ajustado === null ? null : new Decimal(matricula.monto_ajustado),
      motivoAjuste: matricula.motivo_ajuste,
    },
    pagos: pagos.map((pago) => ({
      id: pago.id,
      estado: pago.estado,
      metodo: pago.metodo,
      monto: pago.monto,
      claveIdempotencia: pago.clave_idempotencia,
    })),
    claseIds: clases.map((fila) => fila.clase_id),
  };
}
