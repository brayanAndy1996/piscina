import {
  type BuscarUsuarioPorDni,
  type CrearUsuario,
  respuestaListaUsuariosSchema,
  respuestaUsuarioSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirJson } from '../../api/cliente';

/** Llamadas a `/api/usuarios`. La academia sale de la sesión: ninguna ruta la lleva (criterio 20). */

export async function listarPersonal() {
  return (await pedirJson('/api/usuarios', respuestaListaUsuariosSchema)).datos.usuarios;
}

export async function crearUsuario(datos: CrearUsuario) {
  return (await enviarJson('POST', '/api/usuarios', datos, respuestaUsuarioSchema, [201])).datos.usuario;
}

export async function desactivarUsuario(id: string) {
  const ruta = `/api/usuarios/${encodeURIComponent(id)}/desactivar`;
  return (await enviarJson('POST', ruta, {}, respuestaUsuarioSchema, [200])).datos.usuario;
}

export async function reactivarUsuario(id: string) {
  const ruta = `/api/usuarios/${encodeURIComponent(id)}/reactivar`;
  return (await enviarJson('POST', ruta, {}, respuestaUsuarioSchema, [200])).datos.usuario;
}

export async function restablecerClaveUsuario(id: string) {
  const ruta = `/api/usuarios/${encodeURIComponent(id)}/restablecer-clave`;
  return (await enviarJson('POST', ruta, {}, respuestaUsuarioSchema, [200])).datos.usuario;
}

/** El DNI viaja en el cuerpo y nunca en la dirección (PO-3, criterio 43: es un dato personal y la contraseña inicial). */
export async function buscarUsuarioPorDni(datos: BuscarUsuarioPorDni) {
  return (await enviarJson('POST', '/api/usuarios/buscar-por-dni', datos, respuestaUsuarioSchema, [200])).datos.usuario;
}
