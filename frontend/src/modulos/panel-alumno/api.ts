import { asistenciaDelMesSchema, miPanelSchema } from '@aquagestion/contratos';
import { pedirJson } from '../../api/cliente';

/** Llamadas del panel del alumno (spec 011). No llevan ningún id: el alumno sale de la sesión (criterio 2). Las respuestas se validan con los contratos. */

export async function obtenerMiPanel() {
  return (await pedirJson('/api/mi-panel', miPanelSchema)).datos;
}

/** La asistencia de un mes `AAAA-MM`: el mismo cuerpo que ve recepción en la ficha del alumno (criterio 12). */
export async function obtenerMiAsistencia(mes: string) {
  return (await pedirJson(`/api/mi-panel/asistencias?mes=${encodeURIComponent(mes)}`, asistenciaDelMesSchema)).datos;
}
