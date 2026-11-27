import type {
  ClaseDeMensualidad,
  NivelNatacion,
  RenovacionRegistrada,
  RespuestaRenovacion,
} from '@aquagestion/contratos';
import { aTextoMonto } from '../../comun/dinero';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import type { TransaccionAcademia } from '../../infraestructura/prisma';
import { leerPago } from '../pagos';
import { alumnoNoEncontrado } from './errores';

/**
 * Lecturas de la renovación (spec 010a). Todas con la `tx` de quien llama y siempre con `academia_id` (más la seguridad a nivel de fila): un id de
 * otra academia se comporta como uno que no existe. Las que dicen «sin bloquear» no toman ningún bloqueo de fila.
 */

export type EstadoDelAlumno = 'CLIENTE' | 'ALUMNO_ACTIVO' | 'ALUMNO_VENCIDO' | 'INACTIVO';

export interface AlumnoLeido {
  readonly id: string;
  readonly dni: string;
  readonly nombres: string;
  readonly apellidos: string;
  readonly nivel: NivelNatacion;
  readonly estado: EstadoDelAlumno;
}

interface FilaDelAlumno {
  id: string;
  dni: string;
  nombres: string;
  apellidos: string;
  nivel: NivelNatacion;
  estado: EstadoDelAlumno;
}

/**
 * El alumno, sin bloquear nada: 404 `NO_ENCONTRADO` si el id no es un UUID, no existe, es de otra academia o es un `CLIENTE` (RN-05). El DNI es el
 * dato que necesita el bloqueo consultivo (no cambia nunca) y no sale de aquí.
 */
export async function leerAlumno(tx: TransaccionAcademia, idPedido: string): Promise<AlumnoLeido> {
  if (!PATRON_UUID.test(idPedido)) throw alumnoNoEncontrado();
  const filas = await tx.cliente.$queryRaw<FilaDelAlumno[]>`
    SELECT id::text AS id, dni, nombres, apellidos, nivel::text AS nivel, estado::text AS estado
      FROM alumnos
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${idPedido.toLowerCase()}::uuid AND estado <> 'CLIENTE'::estado_alumno`;
  const fila = filas[0];
  if (!fila) throw alumnoNoEncontrado();
  return fila;
}

export interface MatriculaDelAlumno {
  readonly id: string;
  readonly anio: number;
  readonly mes: number;
  readonly estado: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  readonly reservaVenceEn: Date | null;
  readonly planId: string;
}

interface FilaDeMatricula {
  id: string;
  anio: number;
  mes: number;
  estado: MatriculaDelAlumno['estado'];
  reserva_vence_en: Date | null;
  plan_id: string;
}

/** Todas las matrículas del alumno, por id, sin bloquear. */
export async function leerMatriculasDelAlumno(
  tx: TransaccionAcademia,
  alumnoId: string,
): Promise<MatriculaDelAlumno[]> {
  const filas = await tx.cliente.$queryRaw<FilaDeMatricula[]>`
    SELECT id::text AS id, anio::int AS anio, mes::int AS mes, estado::text AS estado, reserva_vence_en, plan_id::text AS plan_id
      FROM matriculas
     WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumnoId}::uuid
     ORDER BY id`;
  return filas.map(aMatricula);
}

/** Las matrículas del alumno con `FOR UPDATE`, ordenadas por id (el orden de bloqueos de la 010a, criterio 13). */
export async function bloquearMatriculasDelAlumno(
  tx: TransaccionAcademia,
  alumnoId: string,
): Promise<MatriculaDelAlumno[]> {
  const filas = await tx.cliente.$queryRaw<FilaDeMatricula[]>`
    SELECT id::text AS id, anio::int AS anio, mes::int AS mes, estado::text AS estado, reserva_vence_en, plan_id::text AS plan_id
      FROM matriculas
     WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumnoId}::uuid
     ORDER BY id
       FOR UPDATE`;
  return filas.map(aMatricula);
}

function aMatricula(fila: FilaDeMatricula): MatriculaDelAlumno {
  return {
    id: fila.id,
    anio: fila.anio,
    mes: fila.mes,
    estado: fila.estado,
    reservaVenceEn: fila.reserva_vence_en,
    planId: fila.plan_id,
  };
}

/**
 * ¿La matrícula ya tiene al alumno registrado en su mes (pagada o en verificación)? Es la definición del índice único
 * `matriculas_alumno_mes_ocupa_cupo_key`: `VIGENTE` o `RESERVADA`. Una `CANCELADA` o `FINALIZADA` no cuenta (criterio 3).
 */
export function registraElMes(matricula: Pick<MatriculaDelAlumno, 'estado'>): boolean {
  return matricula.estado === 'VIGENTE' || matricula.estado === 'RESERVADA';
}

/**
 * Las clases de la mensualidad de un mes en las que el alumno es titular de prioridad (D-06, DT-3, DR-12, criterio 45): las de su matrícula `VIGENTE` (pago
 * confirmado) de `mes`; una `RESERVADA` en verificación no da prioridad. Sin bloquear. Quien llama decide si el alumno ya tiene la matrícula del mes siguiente (entonces no es titular).
 */
export async function clasesDeLaTitularidad(
  tx: TransaccionAcademia,
  alumnoId: string,
  mes: { anio: number; mes: number },
): Promise<string[]> {
  const filas = await tx.cliente.$queryRaw<{ clase_id: string }[]>`
    SELECT mc.clase_id::text AS clase_id
      FROM matriculas m
      JOIN matricula_clases mc ON mc.academia_id = m.academia_id AND mc.matricula_id = m.id
     WHERE m.academia_id = ${tx.academiaId}::uuid AND m.alumno_id = ${alumnoId}::uuid
       AND m.anio = ${mes.anio}::smallint AND m.mes = ${mes.mes}::smallint
       AND m.estado = 'VIGENTE'::estado_matricula
     ORDER BY mc.clase_id`;
  return filas.map((fila) => fila.clase_id);
}

export interface PagoDeLaClave {
  readonly id: string;
  readonly alumnoId: string;
  readonly matriculaId: string;
  readonly metodo: 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA';
  readonly concepto: string;
  readonly estado: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO';
  readonly monto: string;
  readonly numeroOperacionNormalizado: string | null;
  readonly fechaOperacion: string | null;
  /** La matrícula del pago no tiene solicitud: es una renovación. */
  readonly esDeRenovacion: boolean;
  readonly mes: string;
  readonly planId: string;
  /** Las clases de la matrícula, ordenadas. */
  readonly claseIds: readonly string[];
}

interface FilaDelPagoDeLaClave {
  id: string;
  alumno_id: string;
  matricula_id: string;
  metodo: PagoDeLaClave['metodo'];
  concepto: string;
  estado: PagoDeLaClave['estado'];
  monto: string;
  numero_operacion_normalizado: string | null;
  fecha_operacion: string | null;
  solicitud_id: string | null;
  anio: number;
  mes: number;
  plan_id: string;
  clase_ids: string[];
}

/** El pago de la academia con esa clave de idempotencia, de cualquier alumno, método y estado (la clave es única por academia), sin bloquear. */
export async function leerPagoDeLaClave(
  tx: TransaccionAcademia,
  claveIdempotencia: string,
): Promise<PagoDeLaClave | null> {
  const filas = await tx.cliente.$queryRaw<FilaDelPagoDeLaClave[]>`
    SELECT p.id::text AS id, p.alumno_id::text AS alumno_id, p.matricula_id::text AS matricula_id, p.metodo::text AS metodo,
           p.concepto::text AS concepto, p.estado::text AS estado, p.monto::text AS monto, p.numero_operacion_normalizado,
           p.fecha_operacion::text AS fecha_operacion, m.solicitud_id::text AS solicitud_id, m.anio::int AS anio, m.mes::int AS mes,
           m.plan_id::text AS plan_id,
           coalesce((SELECT array_agg(mc.clase_id::text ORDER BY mc.clase_id)
                       FROM matricula_clases mc
                      WHERE mc.academia_id = m.academia_id AND mc.matricula_id = m.id), '{}'::text[]) AS clase_ids
      FROM pagos p
      JOIN matriculas m ON m.academia_id = p.academia_id AND m.id = p.matricula_id
     WHERE p.academia_id = ${tx.academiaId}::uuid AND p.clave_idempotencia = ${claveIdempotencia.toLowerCase()}::uuid`;
  const fila = filas[0];
  if (!fila) return null;
  return {
    id: fila.id,
    alumnoId: fila.alumno_id,
    matriculaId: fila.matricula_id,
    metodo: fila.metodo,
    concepto: fila.concepto,
    estado: fila.estado,
    monto: fila.monto,
    numeroOperacionNormalizado: fila.numero_operacion_normalizado,
    fechaOperacion: fila.fecha_operacion,
    esDeRenovacion: fila.solicitud_id === null,
    mes: `${fila.anio}-${String(fila.mes).padStart(2, '0')}`,
    planId: fila.plan_id,
    claseIds: fila.clase_ids,
  };
}

/** Las clases de una matrícula, por día y hora, sin bloquear (lo que muestran la oferta y la respuesta del registro). */
export async function leerClasesDeLaMatricula(
  tx: TransaccionAcademia,
  matriculaId: string,
): Promise<ClaseDeMensualidad[]> {
  const filas = await tx.cliente.$queryRaw<{ id: string; dia_semana: number; hora_inicio: string; hora_fin: string }[]>`
    SELECT c.id::text AS id, c.dia_semana::int AS dia_semana, to_char(c.hora_inicio, 'HH24:MI') AS hora_inicio,
           to_char(c.hora_fin, 'HH24:MI') AS hora_fin
      FROM matricula_clases mc
      JOIN clases c ON c.academia_id = mc.academia_id AND c.id = mc.clase_id
     WHERE mc.academia_id = ${tx.academiaId}::uuid AND mc.matricula_id = ${matriculaId}::uuid
     ORDER BY c.dia_semana, c.hora_inicio, c.id`;
  return filas.map((fila) => ({
    id: fila.id,
    diaSemana: fila.dia_semana as ClaseDeMensualidad['diaSemana'],
    horaInicio: fila.hora_inicio as ClaseDeMensualidad['horaInicio'],
    horaFin: fila.hora_fin,
  }));
}

interface FilaDeLaRenovacion {
  matricula_id: string;
  anio: number;
  mes: number;
  plan_id: string;
  plan_nombre: string;
  fecha_inicio: string;
  fecha_fin: string;
  clases_totales: number;
  estado_pago: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO';
  monto: string;
}

/**
 * La respuesta del registro (criterio 11), armada solo con lo guardado: la matrícula, sus clases, el pago y la auditoría `RENOVACION_REGISTRADA`
 * (de ahí salen los ids con prioridad, que ya no se pueden recalcular una vez que el alumno tiene la matrícula del mes siguiente). Sirve para el 201
 * y para el 200 repetido: los dos cuerpos son iguales salvo `repetida`.
 */
export async function leerRespuestaDelPago(
  tx: TransaccionAcademia,
  pagoId: string,
  repetida: boolean,
): Promise<RespuestaRenovacion> {
  const filas = await tx.cliente.$queryRaw<FilaDeLaRenovacion[]>`
    SELECT m.id::text AS matricula_id, m.anio::int AS anio, m.mes::int AS mes, m.plan_id::text AS plan_id, pl.nombre AS plan_nombre,
           m.fecha_inicio::text AS fecha_inicio, m.fecha_fin::text AS fecha_fin, m.clases_totales::int AS clases_totales,
           p.estado::text AS estado_pago, p.monto::text AS monto
      FROM pagos p
      JOIN matriculas m ON m.academia_id = p.academia_id AND m.id = p.matricula_id
      JOIN planes pl ON pl.academia_id = m.academia_id AND pl.id = m.plan_id
     WHERE p.academia_id = ${tx.academiaId}::uuid AND p.id = ${pagoId}::uuid`;
  const fila = filas[0];
  const pago = await leerPago(tx, pagoId);
  if (!fila || !pago) throw new Error('La renovación no dejó su matrícula o su pago.');
  const clases = await leerClasesDeLaMatricula(tx, fila.matricula_id);
  const auditadas = await tx.cliente.$queryRaw<{ con_prioridad: unknown }[]>`
    SELECT datos_despues -> 'conPrioridad' AS con_prioridad
      FROM auditoria
     WHERE academia_id = ${tx.academiaId}::uuid AND accion = 'RENOVACION_REGISTRADA' AND entidad = 'matricula'
       AND entidad_id = ${fila.matricula_id}
     ORDER BY fecha_hora DESC, id DESC
     LIMIT 1`;
  const guardada = auditadas[0]?.con_prioridad;
  const conPrioridad = Array.isArray(guardada)
    ? guardada.filter((id): id is string => typeof id === 'string').sort()
    : [];
  const renovacion: RenovacionRegistrada = {
    matriculaId: fila.matricula_id,
    mes: `${fila.anio}-${String(fila.mes).padStart(2, '0')}`,
    estado: fila.estado_pago === 'CONFIRMADO' ? 'VIGENTE' : 'EN_VERIFICACION',
    plan: { id: fila.plan_id, nombre: fila.plan_nombre },
    clases,
    fechaInicio: fila.fecha_inicio,
    fechaFin: fila.fecha_fin,
    clasesTotales: fila.clases_totales,
    total: aTextoMonto(fila.monto),
    conPrioridad,
  };
  return { renovacion, pago, repetida };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 010c · Cambio de horario
// ---------------------------------------------------------------------------------------------------------------------------------

export interface MatriculaParaElCambio {
  readonly id: string;
  readonly alumnoId: string;
  readonly anio: number;
  readonly mes: number;
  readonly estado: MatriculaDelAlumno['estado'];
  readonly reservaVenceEn: Date | null;
  readonly planId: string;
  readonly clasesTotales: number;
  readonly clasesUsadas: number;
}

interface FilaParaElCambio {
  id: string;
  alumno_id: string;
  anio: number;
  mes: number;
  estado: MatriculaDelAlumno['estado'];
  reserva_vence_en: Date | null;
  plan_id: string;
  clases_totales: number;
  clases_usadas: number;
}

function aMatriculaParaElCambio(fila: FilaParaElCambio): MatriculaParaElCambio {
  return {
    id: fila.id,
    alumnoId: fila.alumno_id,
    anio: fila.anio,
    mes: fila.mes,
    estado: fila.estado,
    reservaVenceEn: fila.reserva_vence_en,
    planId: fila.plan_id,
    clasesTotales: fila.clases_totales,
    clasesUsadas: fila.clases_usadas,
  };
}

/**
 * El alumno dueño de una matrícula, sin bloquear nada (el primer paso del cambio de horario, para poder bloquear el alumno antes que la matrícula): 404
 * `NO_ENCONTRADO` si el id no es un UUID, no existe, es de otra academia o es de un `CLIENTE` (RN-05). El alumno de una matrícula no cambia nunca.
 */
export async function leerAlumnoDeLaMatricula(tx: TransaccionAcademia, matriculaIdPedido: string): Promise<string> {
  if (!PATRON_UUID.test(matriculaIdPedido)) throw alumnoNoEncontrado();
  const filas = await tx.cliente.$queryRaw<{ alumno_id: string }[]>`
    SELECT m.alumno_id::text AS alumno_id
      FROM matriculas m
      JOIN alumnos a ON a.academia_id = m.academia_id AND a.id = m.alumno_id
     WHERE m.academia_id = ${tx.academiaId}::uuid AND m.id = ${matriculaIdPedido.toLowerCase()}::uuid
       AND a.estado <> 'CLIENTE'::estado_alumno`;
  const fila = filas[0];
  if (!fila) throw alumnoNoEncontrado();
  return fila.alumno_id;
}

/** La matrícula del alumno con `FOR UPDATE` (después del alumno): 404 si dejó de existir. */
export async function bloquearMatriculaParaElCambio(
  tx: TransaccionAcademia,
  matriculaId: string,
  alumnoId: string,
): Promise<MatriculaParaElCambio> {
  const filas = await tx.cliente.$queryRaw<FilaParaElCambio[]>`
    SELECT id::text AS id, alumno_id::text AS alumno_id, anio::int AS anio, mes::int AS mes, estado::text AS estado, reserva_vence_en,
           plan_id::text AS plan_id, clases_totales::int AS clases_totales, clases_usadas::int AS clases_usadas
      FROM matriculas
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${matriculaId}::uuid AND alumno_id = ${alumnoId}::uuid
       FOR UPDATE`;
  const fila = filas[0];
  if (!fila) throw alumnoNoEncontrado();
  return aMatriculaParaElCambio(fila);
}

/** Los ids de las clases de la matrícula, ordenados, sin bloquear (quien llama ya tiene la matrícula con `FOR UPDATE`). */
export async function leerClaseIdsDeLaMatricula(tx: TransaccionAcademia, matriculaId: string): Promise<string[]> {
  const filas = await tx.cliente.$queryRaw<{ clase_id: string }[]>`
    SELECT clase_id::text AS clase_id
      FROM matricula_clases
     WHERE academia_id = ${tx.academiaId}::uuid AND matricula_id = ${matriculaId}::uuid
     ORDER BY clase_id`;
  return filas.map((fila) => fila.clase_id);
}
