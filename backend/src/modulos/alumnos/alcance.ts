import { MATRIZ_PERMISOS } from '@aquagestion/contratos';
import { sinPermiso } from '../autenticacion/errores-de-acceso';
import type { SesionVerificada } from '../autenticacion/tipos';

/**
 * El alcance de `VER_CARNET` según la ruta (spec 008a, criterios 4 y 6; DT-4): `/api/alumnos/…` es del personal (`TODO`: administrador y
 * secretaria) y `/api/mi-carnet…` es del alumno (`PROPIO`). El guard ya comprobó que el rol tiene la celda; aquí se exige que sea la de la
 * ruta: el `ALUMNO` no entra por las rutas del personal ni el personal por la del alumno (403 `SIN_PERMISO`). Va antes de cualquier lectura,
 * de modo que el id de la dirección no se mira siquiera.
 */
export function exigirAlcanceDelCarnet(sesion: SesionVerificada, alcance: 'TODO' | 'PROPIO'): void {
  const celda = Object.hasOwn(MATRIZ_PERMISOS.VER_CARNET, sesion.usuario.rol)
    ? MATRIZ_PERMISOS.VER_CARNET[sesion.usuario.rol]
    : undefined;
  if (celda !== alcance) throw sinPermiso();
}
