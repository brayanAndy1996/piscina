import {
  academiaPublicaSchema,
  type CambiarClave,
  type IniciarSesionAcademia,
  respuestaSesionAcademiaSchema,
} from '@aquagestion/contratos';
import { enviarJson, enviarSinRespuesta, pedirJson } from '../../api/cliente';

/**
 * Llamadas de la sesión de academia (`/api/sesion` y `/api/a/{nombreCorto}`). La cookie `aq_sesion` es httpOnly: viaja sola y
 * la web no la ve ni guarda nada de ella.
 */

export async function obtenerAcademiaPublica(nombreCorto: string) {
  return (await pedirJson(`/api/a/${encodeURIComponent(nombreCorto)}`, academiaPublicaSchema)).datos;
}

export async function iniciarSesion(nombreCorto: string, datos: IniciarSesionAcademia) {
  const ruta = `/api/a/${encodeURIComponent(nombreCorto)}/sesion`;
  return (await enviarJson('POST', ruta, datos, respuestaSesionAcademiaSchema, [200])).datos;
}

export async function obtenerSesion() {
  return (await pedirJson('/api/sesion', respuestaSesionAcademiaSchema)).datos;
}

export async function cerrarSesion(): Promise<void> {
  await enviarSinRespuesta('DELETE', '/api/sesion');
}

export async function cambiarClave(datos: CambiarClave) {
  return (await enviarJson('POST', '/api/sesion/clave', datos, respuestaSesionAcademiaSchema, [200])).datos;
}
