import { ErrorNegocio } from '../../comun/errores';

/**
 * El 404 de las rutas de alumnos y del carnet (spec 008a, criterio 5): el mismo para un id que no es UUID, que no existe, que es de otra
 * academia o que es de un `CLIENTE` (RN-05). Sin el id en el mensaje.
 */
export function alumnoNoEncontrado(): ErrorNegocio {
  return new ErrorNegocio(404, 'NO_ENCONTRADO', 'No se encontró el recurso solicitado.');
}
