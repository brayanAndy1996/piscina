import {
  CODIGOS_RECHAZO_ASISTENCIA,
  type CodigoRechazoAsistencia,
  type RechazoAsistencia,
  type RegistrarAsistenciaManual,
  type RegistrarAsistenciaQr,
  type ResultadoAsistencia,
  rechazoAsistenciaSchema,
  resultadoAsistenciaSchema,
} from '@aquagestion/contratos';
import { ErrorDeApi, enviarJson } from '../../api/cliente';

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
