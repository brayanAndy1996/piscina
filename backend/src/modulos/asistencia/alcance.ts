import { MATRIZ_PERMISOS } from '@aquagestion/contratos';
import { sinPermiso } from '../autenticacion/errores-de-acceso';
import type { SesionVerificada } from '../autenticacion/tipos';

/**
 * El alcance de `VER_REPORTES_ASISTENCIA` en la consulta del mes (spec 009b, criterio 31; DT-13): esta ruta es del personal (`TODO`: administrador y secretaria).
 * El guard ya comprobó que el rol tiene la celda; aquí se exige que sea `TODO`: el `ENTRENADOR` (`SUS_CLASES`, vista de la 012) y el `ALUMNO` (`PROPIO`, vista de la
 * 011) reciben 403 `SIN_PERMISO`. Va antes de cualquier lectura: el id de la dirección no se mira siquiera.
 */
export function exigirAlcanceDelPersonal(sesion: SesionVerificada): void {
  const celda = Object.hasOwn(MATRIZ_PERMISOS.VER_REPORTES_ASISTENCIA, sesion.usuario.rol)
    ? MATRIZ_PERMISOS.VER_REPORTES_ASISTENCIA[sesion.usuario.rol]
    : undefined;
  if (celda !== 'TODO') throw sinPermiso();
}
