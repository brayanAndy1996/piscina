import {
  type CrearAcademia,
  type CrearAdministrador,
  type IniciarSesionPlataforma,
  type ReactivarAcademia,
  respuestaAcademiaSchema,
  respuestaAdministradorSchema,
  respuestaListaAdministradoresSchema,
  respuestaListaAcademiasSchema,
  respuestaSesionPlataformaSchema,
  type SuspenderAcademia,
} from '@aquagestion/contratos';
import { enviarJson, enviarSinRespuesta, pedirJson } from '../../api/cliente';

/** Llamadas a `/api/plataforma/*`. La cookie de sesión viaja sola (mismo dominio); la web no guarda nada de ella. */

export async function iniciarSesion(datos: IniciarSesionPlataforma) {
  return (await enviarJson('POST', '/api/plataforma/sesion', datos, respuestaSesionPlataformaSchema)).datos;
}

export async function obtenerSesion() {
  return (await pedirJson('/api/plataforma/sesion', respuestaSesionPlataformaSchema)).datos;
}

export async function cerrarSesion(): Promise<void> {
  await enviarSinRespuesta('DELETE', '/api/plataforma/sesion');
}

export async function listarAcademias() {
  return (await pedirJson('/api/plataforma/academias', respuestaListaAcademiasSchema)).datos.academias;
}

export async function crearAcademia(datos: CrearAcademia) {
  return (await enviarJson('POST', '/api/plataforma/academias', datos, respuestaAcademiaSchema, [201])).datos.academia;
}

export async function suspenderAcademia(id: string, datos: SuspenderAcademia) {
  const ruta = `/api/plataforma/academias/${encodeURIComponent(id)}/suspender`;
  return (await enviarJson('POST', ruta, datos, respuestaAcademiaSchema, [200])).datos.academia;
}

export async function reactivarAcademia(id: string, datos: ReactivarAcademia) {
  const ruta = `/api/plataforma/academias/${encodeURIComponent(id)}/reactivar`;
  return (await enviarJson('POST', ruta, datos, respuestaAcademiaSchema, [200])).datos.academia;
}

/** Administradores de una academia (DR-1 y DR-5, D-29): lo único de sus datos internos que ve el Superadmin. */
export async function listarAdministradores(academiaId: string) {
  const ruta = `/api/plataforma/academias/${encodeURIComponent(academiaId)}/administradores`;
  return (await pedirJson(ruta, respuestaListaAdministradoresSchema)).datos.administradores;
}

export async function crearAdministrador(academiaId: string, datos: CrearAdministrador) {
  const ruta = `/api/plataforma/academias/${encodeURIComponent(academiaId)}/administradores`;
  return (await enviarJson('POST', ruta, datos, respuestaAdministradorSchema, [201])).datos.administrador;
}

export async function restablecerClaveAdministrador(academiaId: string, usuarioId: string) {
  const ruta = `/api/plataforma/academias/${encodeURIComponent(academiaId)}/administradores/${encodeURIComponent(usuarioId)}/restablecer-clave`;
  return (await enviarJson('POST', ruta, {}, respuestaAdministradorSchema, [200])).datos.administrador;
}
