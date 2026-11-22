import { ErrorNegocio } from '../../comun/errores';

/**
 * Los dos 403 de acceso de las rutas de academia (spec 002, criterios 17 y 27), en un solo lugar para que el middleware de las rutas, el guard de
 * permisos y la nueva verificación de la sesión (`SesionAcademiaService.volverAVerificar`, spec 006b criterio 53) respondan exactamente lo mismo.
 */

/** 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`: la persona debe cambiar su contraseña antes de seguir. */
export function cambioDeClaveObligatorio(): ErrorNegocio {
  return new ErrorNegocio(403, 'CAMBIO_DE_CLAVE_OBLIGATORIO', 'Debes cambiar tu contraseña antes de continuar.');
}

/** 403 `SIN_PERMISO`: el rol de la sesión no tiene el permiso que pide la ruta. */
export function sinPermiso(): ErrorNegocio {
  return new ErrorNegocio(403, 'SIN_PERMISO', 'No tienes permiso para realizar esta acción.');
}
