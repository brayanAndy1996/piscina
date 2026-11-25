import {
  type BuscarAlumnos,
  type RegenerarQr,
  carnetSchema,
  resultadoBusquedaAlumnosSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirArchivo, pedirJson } from '../../api/cliente';

/** Llamadas del carnet. La academia sale de la sesión: ninguna ruta la lleva (criterios 4 a 6 de 008). Las respuestas se validan con los esquemas compartidos. */

/** El carnet de la propia persona (alumno, criterio 6). No lleva ningún id. */
export async function obtenerMiCarnet() {
  return (await pedirJson('/api/mi-carnet', carnetSchema)).datos;
}

/** El carnet de un alumno de la academia, para el personal (criterio 4). */
export async function obtenerCarnet(alumnoId: string) {
  return (await pedirJson(`/api/alumnos/${encodeURIComponent(alumnoId)}/carnet`, carnetSchema)).datos;
}

/** El PDF del carnet: el de la propia persona sin id, o el de un alumno del personal (criterio 11). */
export async function obtenerPdfDelCarnet(alumnoId: string | null, senal?: AbortSignal): Promise<Blob> {
  const ruta = alumnoId === null ? '/api/mi-carnet/pdf' : `/api/alumnos/${encodeURIComponent(alumnoId)}/carnet/pdf`;
  return pedirArchivo(ruta, 'application/pdf', senal);
}

/** Genera un QR nuevo (criterio 13): 200 con el carnet actualizado; 200 también si es un reintento con la misma clave (criterio 14). */
export async function regenerarQr({ alumnoId, datos }: { alumnoId: string; datos: RegenerarQr }) {
  const ruta = `/api/alumnos/${encodeURIComponent(alumnoId)}/carnet/qr`;
  return (await enviarJson('POST', ruta, datos, carnetSchema, [200])).datos;
}

/** Busca alumnos por DNI o nombre (criterio 16). El texto va en el cuerpo: nunca en la dirección. */
export async function buscarAlumnos(datos: BuscarAlumnos) {
  return (await enviarJson('POST', '/api/alumnos/buscar', datos, resultadoBusquedaAlumnosSchema, [200])).datos;
}
