import {
  type AsistenciaDelMes,
  CODIGOS_RECHAZO_ASISTENCIA,
  type CodigoRechazoAsistencia,
  type RechazoAsistencia,
  type RegistrarAsistenciaManual,
  type RegistrarAsistenciaPosterior,
  type RegistrarAsistenciaQr,
  type ResultadoAsistencia,
  asistenciaDelMesSchema,
  rechazoAsistenciaSchema,
  resultadoAsistenciaSchema,
} from '@aquagestion/contratos';
import { ErrorDeApi, enviarJson, pedirJson } from '../../api/cliente';

/** Llamadas de la asistencia (spec 009a, criterios 2, 5, 7 y 15). La academia sale de la sesión: ninguna ruta la lleva. */

/** El intento de marcar: lo que se leyó o se eligió y su clave de idempotencia, que un reintento conserva (criterio 13). */
export type IntentoDeMarcado =
  | { via: 'QR'; contenido: string; claveIdempotencia: string }
  | { via: 'MANUAL'; alumnoId: string; claveIdempotencia: string };

/** Lo que responde el marcado: la asistencia registrada (201 o 200 repetida) o un rechazo de negocio (409 con su color). */
export type SalidaDeMarcado =
  | { tipo: 'REGISTRADA'; resultado: ResultadoAsistencia }
  | { tipo: 'RECHAZADA'; codigo: CodigoRechazoAsistencia; rechazo: RechazoAsistencia };

function esCodigoDeRechazo(codigo: string): codigo is CodigoRechazoAsistencia {
  return Object.hasOwn(CODIGOS_RECHAZO_ASISTENCIA, codigo);
}

/** Un 409 con uno de los códigos del criterio 7 y los `detalles` de `rechazoAsistenciaSchema`; cualquier otro error se relanza tal cual. */
function comoRechazo(error: unknown): SalidaDeMarcado | null {
  if (!(error instanceof ErrorDeApi) || error.estado !== 409 || !esCodigoDeRechazo(error.codigo)) return null;
  const detalles = rechazoAsistenciaSchema.safeParse(error.detalles);
  return detalles.success ? { tipo: 'RECHAZADA', codigo: error.codigo, rechazo: detalles.data } : null;
}

async function marcar(
  ruta: string,
  cuerpo: RegistrarAsistenciaQr | RegistrarAsistenciaManual,
): Promise<SalidaDeMarcado> {
  try {
    const { datos } = await enviarJson('POST', ruta, cuerpo, resultadoAsistenciaSchema, [200, 201]);
    return { tipo: 'REGISTRADA', resultado: datos };
  } catch (error) {
    const rechazo = comoRechazo(error);
    if (rechazo) return rechazo;
    throw error;
  }
}

/** `POST /api/asistencias/qr`: el contenido va en el cuerpo, nunca en la dirección (criterio 17). */
export function marcarPorQr(datos: RegistrarAsistenciaQr): Promise<SalidaDeMarcado> {
  return marcar('/api/asistencias/qr', datos);
}

/** `POST /api/asistencias/manual`: el alumno elegido en la búsqueda. */
export function marcarManual(datos: RegistrarAsistenciaManual): Promise<SalidaDeMarcado> {
  return marcar('/api/asistencias/manual', datos);
}

/** `GET /api/alumnos/{id}/asistencias?mes=AAAA-MM` (009b, criterio 31): las asistencias y faltas de un alumno en un mes, para el personal. */
export async function obtenerAsistenciaDelMes(alumnoId: string, mes: string): Promise<AsistenciaDelMes> {
  const ruta = `/api/alumnos/${encodeURIComponent(alumnoId)}/asistencias?mes=${encodeURIComponent(mes)}`;
  return (await pedirJson(ruta, asistenciaDelMesSchema)).datos;
}

/**
 * `POST /api/asistencias/posterior` (009b, criterio 28): la asistencia de una clase ya terminada del mes en curso. 201, o 200 con `repetida: true` si
 * repite la clave. Un rechazo (409 con su código) se lanza como `ErrorDeApi`: el diálogo lo muestra con los textos de `mensajes.ts`.
 */
export async function registrarAsistenciaPosterior(datos: RegistrarAsistenciaPosterior): Promise<ResultadoAsistencia> {
  return (await enviarJson('POST', '/api/asistencias/posterior', datos, resultadoAsistenciaSchema, [200, 201])).datos;
}
