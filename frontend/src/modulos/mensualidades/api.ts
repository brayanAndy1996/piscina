import {
  CABECERA_DATOS_RENOVACION,
  type CotizarRenovacion,
  type DatosRenovacionComprobante,
  ofertaRenovacionSchema,
  type RenovarEnEfectivo,
  respuestaCotizacionRenovacionSchema,
  respuestaRenovacionSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirJson, subirArchivoConRespuesta } from '../../api/cliente';
import { jsonParaCabecera } from '../../lib/cabecera-json';

/** Llamadas de la renovación (spec 010a). La academia sale de la sesión: ninguna ruta la lleva (criterio 18). */

const base = (alumnoId: string) => `/api/alumnos/${encodeURIComponent(alumnoId)}/renovacion`;

/** La oferta (criterio 2). Sin `mes`, la API elige el siguiente si la ventana está abierta y se permite; si no, el mes en curso. */
export async function obtenerOferta(alumnoId: string, mes?: string) {
  const ruta = mes === undefined ? base(alumnoId) : `${base(alumnoId)}?mes=${encodeURIComponent(mes)}`;
  return (await pedirJson(ruta, ofertaRenovacionSchema)).datos;
}

/** La cotización (criterio 5): no bloquea ni escribe. El monto lo calcula la API, nunca la web. */
export async function cotizarRenovacion(alumnoId: string, datos: CotizarRenovacion) {
  const respuesta = await enviarJson(
    'POST',
    `${base(alumnoId)}/cotizacion`,
    datos,
    respuestaCotizacionRenovacionSchema,
    [200],
  );
  return respuesta.datos.cotizacion;
}

/** 201 con la renovación cobrada; 200 con `repetida: true` si repite la clave (criterio 12). */
export async function renovarEnEfectivo(alumnoId: string, datos: RenovarEnEfectivo) {
  return (await enviarJson('POST', `${base(alumnoId)}/efectivo`, datos, respuestaRenovacionSchema, [200, 201])).datos;
}

/**
 * `PUT …/renovacion/comprobante` (criterio 7): la imagen como cuerpo binario y los datos en `X-Renovacion-Datos`, JSON ASCII. 201 con la
 * renovación en verificación; 200 con `repetida: true` si repite la clave.
 */
export async function subirComprobanteDeRenovacion(alumnoId: string, datos: DatosRenovacionComprobante, archivo: File) {
  const encabezados = { [CABECERA_DATOS_RENOVACION]: jsonParaCabecera(datos) };
  const respuesta = await subirArchivoConRespuesta(
    `${base(alumnoId)}/comprobante`,
    archivo,
    archivo.type,
    encabezados,
    respuestaRenovacionSchema,
  );
  return respuesta.datos;
}
