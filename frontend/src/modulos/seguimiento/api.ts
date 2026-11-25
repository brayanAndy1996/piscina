import {
  CABECERA_DATOS_PAGO,
  CABECERA_TOKEN_SOLICITUD,
  type ConsultarSolicitud,
  type DatosComprobante,
  respuestaConsultaSolicitudSchema,
} from '@aquagestion/contratos';
import { enviarJson, subirArchivoConRespuesta } from '../../api/cliente';

/**
 * Consulta del seguimiento (`POST /api/a/{nombreCorto}/solicitudes/consulta`, criterios 29 y 30 de 005). El token y el DNI van en el
 * cuerpo y nunca en la dirección de la API: una dirección queda en los registros del servidor y en el historial.
 */
export async function consultarSolicitud(nombreCorto: string, consulta: ConsultarSolicitud) {
  const ruta = `/api/a/${encodeURIComponent(nombreCorto)}/solicitudes/consulta`;
  return (await enviarJson('POST', ruta, consulta, respuestaConsultaSolicitudSchema, [200])).datos;
}

/**
 * Los datos del comprobante como JSON ASCII (criterio 36 de 007b): una cabecera solo admite caracteres de un byte, y un número de
 * operación puede traer dígitos de ancho completo, que la API normaliza. Cada carácter fuera de ASCII imprimible va como `\uXXXX`.
 */
export function datosDePagoParaCabecera(datos: DatosComprobante): string {
  return JSON.stringify(datos).replace(
    /[^\x20-\x7e]/g,
    (caracter) => `\\u${caracter.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** La respuesta del comprobante: la vista de la solicitud (`EN_VERIFICACION`), sin los datos de la academia. */
const respuestaComprobanteSchema = respuestaConsultaSolicitudSchema.pick({ solicitud: true });

/**
 * `PUT /api/a/{nombreCorto}/solicitudes/comprobante` (criterios 36 a 42 de 007b): la imagen como cuerpo binario, el token en
 * `X-Token-Solicitud` y los datos del pago en `X-Pago-Datos`. 201 con el pago nuevo; 200 con la misma vista si es el reintento de la misma
 * clave. El token solo viaja en la cabecera, nunca en la dirección.
 */
export async function subirComprobante(nombreCorto: string, token: string, datos: DatosComprobante, archivo: File) {
  const ruta = `/api/a/${encodeURIComponent(nombreCorto)}/solicitudes/comprobante`;
  const encabezados = { [CABECERA_TOKEN_SOLICITUD]: token, [CABECERA_DATOS_PAGO]: datosDePagoParaCabecera(datos) };
  return (await subirArchivoConRespuesta(ruta, archivo, archivo.type, encabezados, respuestaComprobanteSchema)).datos
    .solicitud;
}
