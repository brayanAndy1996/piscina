import {
  type CotizarInscripcion,
  type EnviarInscripcion,
  respuestaCotizacionSchema,
  respuestaFormularioInscripcionSchema,
  respuestaInscripcionCreadaSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirJson } from '../../api/cliente';

/**
 * Llamadas de la inscripción pública (`/api/a/{nombreCorto}/inscripcion`, sin sesión). La academia sale solo del nombre corto de la
 * dirección: ninguna llamada lleva un id de academia (criterio 7 de 005).
 */

function base(nombreCorto: string): string {
  return `/api/a/${encodeURIComponent(nombreCorto)}/inscripcion`;
}

export async function obtenerFormulario(nombreCorto: string) {
  return (await pedirJson(base(nombreCorto), respuestaFormularioInscripcionSchema)).datos;
}

export async function cotizar(nombreCorto: string, datos: CotizarInscripcion) {
  return (await enviarJson('POST', `${base(nombreCorto)}/cotizacion`, datos, respuestaCotizacionSchema, [200])).datos
    .cotizacion;
}

export async function enviarInscripcion(nombreCorto: string, datos: EnviarInscripcion) {
  return (await enviarJson('POST', base(nombreCorto), datos, respuestaInscripcionCreadaSchema, [201])).datos.solicitud;
}
