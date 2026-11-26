import type { NivelNatacion } from '@aquagestion/contratos';
import type { TransaccionAcademia } from '../../infraestructura/prisma';

/**
 * Lecturas del marcado de asistencia (spec 009a), sin Nest, con la `tx` de quien llama. Las dos que bloquean (`bloquearAlumno…` y
 * `bloquearMatriculaDelDia`) van en el orden del criterio 14: alumno `FOR SHARE` → matrícula `FOR UPDATE`. Nunca se bloquea `clases`.
 */

export interface FilaDelAlumno {
  id: string;
  nombres: string;
  apellidos: string;
  nivel: NivelNatacion;
  estado: 'ALUMNO_ACTIVO' | 'ALUMNO_VENCIDO' | 'INACTIVO';
  foto_clave: string | null;
}

export interface FilaDeMatricula {
  id: string;
  anio: number;
  mes: number;
  desde: string;
  hasta: string;
  clases_totales: number;
  clases_usadas: number;
  creado_en: Date;
}

export interface FilaDeClase {
  id: string;
  nivel: NivelNatacion;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
}

export interface FilaDeAsistencia {
  id: string;
  alumno_id: string;
  matricula_id: string;
  clase_id: string;
  fecha: string;
  llegada_en: Date;
  estado_llegada: 'PUNTUAL' | 'TARDE';
  metodo: 'QR' | 'MANUAL';
  registro_posterior: boolean;
}

/**
 * El alumno de un QR: se busca solo por `(academia de la sesión, qr_token)`, nunca un `CLIENTE` (RN-05), con `FOR SHARE`. Si la regeneración del
 * QR tiene la fila, la sentencia espera y vuelve a evaluar `qr_token` con la versión confirmada: un token regenerado no marca (criterio 4, DT-4).
 */
export async function bloquearAlumnoPorToken(tx: TransaccionAcademia, token: string): Promise<FilaDelAlumno | null> {
  const filas = await tx.cliente.$queryRaw<FilaDelAlumno[]>`
    SELECT id::text AS id, nombres, apellidos, nivel::text AS nivel, estado::text AS estado, foto_clave
      FROM alumnos
     WHERE academia_id = ${tx.academiaId}::uuid AND qr_token = ${token} AND estado <> 'CLIENTE'
       FOR SHARE`;
  return filas[0] ?? null;
}

/** El alumno de un id (la vía manual): de la academia de la sesión y nunca un `CLIENTE`, con `FOR SHARE`. */
export async function bloquearAlumnoPorId(tx: TransaccionAcademia, id: string): Promise<FilaDelAlumno | null> {
  const filas = await tx.cliente.$queryRaw<FilaDelAlumno[]>`
    SELECT id::text AS id, nombres, apellidos, nivel::text AS nivel, estado::text AS estado, foto_clave
      FROM alumnos
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid AND estado <> 'CLIENTE'
       FOR SHARE`;
  return filas[0] ?? null;
}

/**
 * La matrícula `VIGENTE` del alumno que cubre `hoy` (`anio`, `mes`, `fecha_inicio` ≤ hoy ≤ `fecha_fin`), con `FOR UPDATE`: es el punto de orden del
 * descuento y de «una por día» (DT-5). Hay como mucho una (índice `matriculas_alumno_mes_ocupa_cupo_key`).
 */
export async function bloquearMatriculaDelDia(
  tx: TransaccionAcademia,
  alumnoId: string,
  hoy: string,
): Promise<FilaDeMatricula | null> {
  const [anio = 0, mes = 0] = hoy.split('-').map(Number);
  const filas = await tx.cliente.$queryRaw<FilaDeMatricula[]>`
    SELECT id::text AS id, anio::int AS anio, mes::int AS mes,
           to_char(fecha_inicio, 'YYYY-MM-DD') AS desde, to_char(fecha_fin, 'YYYY-MM-DD') AS hasta,
           clases_totales::int AS clases_totales, clases_usadas::int AS clases_usadas, creado_en
      FROM matriculas
     WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumnoId}::uuid AND estado = 'VIGENTE'
       AND anio = ${anio}::int AND mes = ${mes}::int
       AND fecha_inicio <= ${hoy}::date AND fecha_fin >= ${hoy}::date
       FOR UPDATE`;
  return filas[0] ?? null;
}

/** `true` si la matrícula bloqueada cubre `hoy` (por si el día cambió mientras la lectura esperaba el bloqueo, DT-16). */
export function cubreElDia(matricula: FilaDeMatricula, hoy: string): boolean {
  const [anio = 0, mes = 0] = hoy.split('-').map(Number);
  return matricula.anio === anio && matricula.mes === mes && matricula.desde <= hoy && hoy <= matricula.hasta;
}

/** La asistencia con esta clave de idempotencia en la academia, o `null`. */
export async function leerAsistenciaPorClave(tx: TransaccionAcademia, clave: string): Promise<FilaDeAsistencia | null> {
  const filas = await tx.cliente.$queryRaw<FilaDeAsistencia[]>`
    SELECT id::text AS id, alumno_id::text AS alumno_id, matricula_id::text AS matricula_id, clase_id::text AS clase_id,
           to_char(fecha, 'YYYY-MM-DD') AS fecha, llegada_en, estado_llegada::text AS estado_llegada, metodo::text AS metodo,
           registro_posterior
      FROM asistencias
     WHERE academia_id = ${tx.academiaId}::uuid AND clave_idempotencia = ${clave}::uuid`;
  return filas[0] ?? null;
}

/** La asistencia de hoy del alumno (la que cuenta para «una por día»: no `PARTICULAR`), o `null`. */
export async function leerAsistenciaDeHoy(
  tx: TransaccionAcademia,
  alumnoId: string,
  hoy: string,
): Promise<FilaDeAsistencia | null> {
  const filas = await tx.cliente.$queryRaw<FilaDeAsistencia[]>`
    SELECT id::text AS id, alumno_id::text AS alumno_id, matricula_id::text AS matricula_id, clase_id::text AS clase_id,
           to_char(fecha, 'YYYY-MM-DD') AS fecha, llegada_en, estado_llegada::text AS estado_llegada, metodo::text AS metodo,
           registro_posterior
      FROM asistencias
     WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumnoId}::uuid AND fecha = ${hoy}::date AND tipo <> 'PARTICULAR'
     ORDER BY llegada_en, id
     LIMIT 1`;
  return filas[0] ?? null;
}

/** Sin matrícula del día: el alumno tiene una matrícula `RESERVADA` del mes con un pago `PENDIENTE_VERIFICACION` (una renovación por Yape, DR-3). */
export async function hayPagoEnVerificacion(tx: TransaccionAcademia, alumnoId: string, hoy: string): Promise<boolean> {
  const [anio = 0, mes = 0] = hoy.split('-').map(Number);
  const filas = await tx.cliente.$queryRaw<{ existe: number }[]>`
    SELECT 1 AS existe
      FROM matriculas m
      JOIN pagos p ON p.academia_id = m.academia_id AND p.matricula_id = m.id
     WHERE m.academia_id = ${tx.academiaId}::uuid AND m.alumno_id = ${alumnoId}::uuid AND m.estado = 'RESERVADA'
       AND m.anio = ${anio}::int AND m.mes = ${mes}::int AND p.estado = 'PENDIENTE_VERIFICACION'
     LIMIT 1`;
  return filas.length > 0;
}

/** Las clases activas de la matrícula que caen en `diaIso` (por la regla DR-4 de 005, como mucho una), de la más temprana a la más tarde. */
export async function leerClasesDelDia(
  tx: TransaccionAcademia,
  matriculaId: string,
  diaIso: number,
): Promise<FilaDeClase[]> {
  return tx.cliente.$queryRaw<FilaDeClase[]>`
    SELECT c.id::text AS id, c.nivel::text AS nivel, c.dia_semana::int AS dia_semana,
           to_char(c.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(c.hora_fin, 'HH24:MI') AS hora_fin
      FROM matricula_clases mc
      JOIN clases c ON c.academia_id = mc.academia_id AND c.id = mc.clase_id
     WHERE mc.academia_id = ${tx.academiaId}::uuid AND mc.matricula_id = ${matriculaId}::uuid
       AND c.activo AND c.dia_semana = ${diaIso}::int
     ORDER BY c.hora_inicio, c.id`;
}

/** Una clase por id (para repetir la respuesta de una asistencia ya registrada). */
export async function leerClase(tx: TransaccionAcademia, claseId: string): Promise<FilaDeClase | null> {
  const filas = await tx.cliente.$queryRaw<FilaDeClase[]>`
    SELECT id::text AS id, nivel::text AS nivel, dia_semana::int AS dia_semana,
           to_char(hora_inicio, 'HH24:MI') AS hora_inicio, to_char(hora_fin, 'HH24:MI') AS hora_fin
      FROM clases WHERE academia_id = ${tx.academiaId}::uuid AND id = ${claseId}::uuid`;
  return filas[0] ?? null;
}

/** Las clases de una matrícula, tal como están guardadas ahora. */
export async function leerClasesDeLaMatricula(
  tx: TransaccionAcademia,
  matriculaId: string,
): Promise<{ clases_totales: number; clases_usadas: number } | null> {
  const filas = await tx.cliente.$queryRaw<{ clases_totales: number; clases_usadas: number }[]>`
    SELECT clases_totales::int AS clases_totales, clases_usadas::int AS clases_usadas
      FROM matriculas WHERE academia_id = ${tx.academiaId}::uuid AND id = ${matriculaId}::uuid`;
  return filas[0] ?? null;
}
