import {
  type ActualizarPlan,
  type CrearPlan,
  respuestaListaPlanesSchema,
  respuestaPlanSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirJson } from '../../api/cliente';

/** Llamadas de los planes. La academia sale de la sesión: ninguna ruta la lleva (criterio 6 de 004). */

export async function listarPlanes() {
  return (await pedirJson('/api/planes', respuestaListaPlanesSchema)).datos.planes;
}

export async function crearPlan(datos: CrearPlan) {
  return (await enviarJson('POST', '/api/planes', datos, respuestaPlanSchema, [201])).datos.plan;
}

export async function actualizarPlan({ id, cambios }: { id: string; cambios: ActualizarPlan }) {
  const ruta = `/api/planes/${encodeURIComponent(id)}`;
  return (await enviarJson('PATCH', ruta, cambios, respuestaPlanSchema, [200])).datos.plan;
}
