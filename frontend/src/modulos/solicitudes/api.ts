import {
  type CancelarSolicitud,
  type FiltroEstadoSolicitudes,
  respuestaListaSolicitudesSchema,
  respuestaSolicitudPanelSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirJson } from '../../api/cliente';

/** Llamadas del panel de solicitudes. La academia sale de la sesión: ninguna ruta la lleva (criterios 38 y 39 de 005). */

export async function listarSolicitudes(estado: FiltroEstadoSolicitudes) {
  const ruta = `/api/solicitudes?estado=${encodeURIComponent(estado)}`;
  return (await pedirJson(ruta, respuestaListaSolicitudesSchema)).datos.solicitudes;
}

export async function cancelarSolicitud({ id, datos }: { id: string; datos: CancelarSolicitud }) {
  const ruta = `/api/solicitudes/${encodeURIComponent(id)}/cancelar`;
  return (await enviarJson('POST', ruta, datos, respuestaSolicitudPanelSchema, [200])).datos.solicitud;
}
