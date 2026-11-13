import { SetMetadata } from '@nestjs/common';
import { PERMISOS, type Permiso as PermisoMatriz } from '@aquagestion/contratos';

/** Claves de la metadata que lee `PermisosGuard`. */
export const CLAVE_PERMISO = 'aquagestion:permiso';
export const CLAVE_SOLO_SESION = 'aquagestion:solo-sesion';

/**
 * Declara el permiso de la matriz (`MATRIZ_PERMISOS`) que exige un manejador o un controlador: `@Permiso('GESTIONAR_USUARIOS')`.
 * Si el rol del usuario no tiene la celda, la petición responde 403 `SIN_PERMISO` sin ejecutar nada. El guard solo decide si el
 * rol pasa; el alcance de la celda (`SUS_ALUMNOS`, `PROPIO`…) lo aplica el servicio de cada historia.
 */
export function Permiso(permiso: PermisoMatriz): MethodDecorator & ClassDecorator {
  // Falla al arrancar, no en la primera petición: un permiso mal escrito dejaría la ruta cerrada para todos.
  if (!(PERMISOS as readonly string[]).includes(permiso)) {
    throw new Error(`El permiso ${String(permiso)} no existe en MATRIZ_PERMISOS.`);
  }
  return SetMetadata(CLAVE_PERMISO, permiso);
}

/**
 * Declara que a la ruta le basta una sesión válida, sin permiso de la matriz (por ejemplo, ver o cambiar la propia contraseña).
 * Una ruta de academia sin `@Permiso` ni `@SoloSesion` responde 403 `SIN_PERMISO` a todos los roles (falla cerrada).
 */
export function SoloSesion(): MethodDecorator & ClassDecorator {
  return SetMetadata(CLAVE_SOLO_SESION, true);
}
