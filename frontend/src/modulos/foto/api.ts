import { CABECERA_TOKEN_SOLICITUD } from '@aquagestion/contratos';
import { subirArchivo } from '../../api/cliente';

/**
 * `PUT /api/a/{nombreCorto}/solicitudes/foto` (criterio 34 de 005): la imagen como cuerpo binario, su tipo en `Content-Type` y el token de
 * la solicitud en `X-Token-Solicitud`. El token solo viaja en la cabecera: nunca en la dirección.
 */
export async function subirFoto(nombreCorto: string, token: string, archivo: File): Promise<void> {
  const ruta = `/api/a/${encodeURIComponent(nombreCorto)}/solicitudes/foto`;
  await subirArchivo(ruta, archivo, archivo.type, { [CABECERA_TOKEN_SOLICITUD]: token });
}

/** A quién se le pone la foto desde el panel: un alumno o la solicitud de un alumno (criterios 22 y 23 de 008). */
export type DestinoDeFoto = { tipo: 'alumno' | 'solicitud'; id: string };

/**
 * `PUT /api/alumnos/{id}/foto` o `PUT /api/solicitudes/{id}/foto` (008b): la imagen como cuerpo binario (`image/jpeg` o `image/png`), sin
 * más cabeceras. La academia sale de la sesión. Responde 204; 400 `IMAGEN_NO_VALIDA`, 413 `CARGA_EXCESIVA`, 404 y 409 son `ErrorDeApi`.
 */
export async function subirFotoDelPanel(destino: DestinoDeFoto, imagen: Blob): Promise<void> {
  const base = destino.tipo === 'alumno' ? 'alumnos' : 'solicitudes';
  await subirArchivo(`/api/${base}/${encodeURIComponent(destino.id)}/foto`, imagen, imagen.type);
}
