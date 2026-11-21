import {
  type ActualizarClase,
  type CrearClase,
  respuestaClaseSchema,
  respuestaListaClasesSchema,
  respuestaOcupacionSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirJson } from '../../api/cliente';
import { listarPersonal } from '../usuarios/api';

/** Llamadas de las clases. La academia sale de la sesión: ninguna ruta la lleva (criterio 6 de 004). */

export async function listarClases() {
  return (await pedirJson('/api/clases', respuestaListaClasesSchema)).datos.clases;
}

/** `inscritos / aforo` de cada clase (criterio 40 de 005): `GET /api/clases/ocupacion`, solo para quien configura los horarios. */
export async function obtenerOcupacion() {
  return (await pedirJson('/api/clases/ocupacion', respuestaOcupacionSchema)).datos;
}

export async function crearClase(datos: CrearClase) {
  return (await enviarJson('POST', '/api/clases', datos, respuestaClaseSchema, [201])).datos.clase;
}

export async function actualizarClase({ id, cambios }: { id: string; cambios: ActualizarClase }) {
  const ruta = `/api/clases/${encodeURIComponent(id)}`;
  return (await enviarJson('PATCH', ruta, cambios, respuestaClaseSchema, [200])).datos.clase;
}

/** Un entrenador para elegirlo en el formulario: solo lo necesario, sin el DNI (DT-4 de 004). */
export interface EntrenadorElegible {
  id: string;
  nombres: string;
  apellidos: string;
  activo: boolean;
}

/** Los entrenadores de la academia, de `GET /api/usuarios` (el administrador ya tiene ese permiso; DT-4 de 004). */
export async function listarEntrenadores(): Promise<EntrenadorElegible[]> {
  const personal = await listarPersonal();
  return personal
    .filter((usuario) => usuario.rol === 'ENTRENADOR')
    .map((usuario) => ({
      id: usuario.id,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
      activo: usuario.estado === 'ACTIVO',
    }));
}
