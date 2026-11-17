import {
  type ActualizarConfiguracion,
  respuestaConfiguracionSchema,
  respuestaMiAcademiaSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirJson } from '../../api/cliente';

/** Llamadas de la configuración de la academia. La academia sale de la sesión: ninguna ruta la lleva (criterio 4). */

export async function obtenerConfiguracion() {
  return (await pedirJson('/api/configuracion', respuestaConfiguracionSchema)).datos.configuracion;
}

export async function actualizarConfiguracion(cambios: ActualizarConfiguracion) {
  return (await enviarJson('PATCH', '/api/configuracion', cambios, respuestaConfiguracionSchema, [200])).datos
    .configuracion;
}

export async function obtenerMiAcademia() {
  return (await pedirJson('/api/mi-academia', respuestaMiAcademiaSchema)).datos.academia;
}
