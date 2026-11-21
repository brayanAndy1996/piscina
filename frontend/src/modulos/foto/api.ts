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
