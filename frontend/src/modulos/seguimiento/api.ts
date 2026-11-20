import { type ConsultarSolicitud, respuestaConsultaSolicitudSchema } from '@aquagestion/contratos';
import { enviarJson } from '../../api/cliente';

/**
 * Consulta del seguimiento (`POST /api/a/{nombreCorto}/solicitudes/consulta`, criterios 29 y 30 de 005). El token y el DNI van en el
 * cuerpo y nunca en la dirección de la API: una dirección queda en los registros del servidor y en el historial.
 */
export async function consultarSolicitud(nombreCorto: string, consulta: ConsultarSolicitud) {
  const ruta = `/api/a/${encodeURIComponent(nombreCorto)}/solicitudes/consulta`;
  return (await enviarJson('POST', ruta, consulta, respuestaConsultaSolicitudSchema, [200])).datos;
}
