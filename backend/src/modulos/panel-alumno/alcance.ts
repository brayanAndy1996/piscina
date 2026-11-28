import { MATRIZ_PERMISOS } from '@aquagestion/contratos';
import { sinPermiso } from '../autenticacion/errores-de-acceso';
import type { SesionVerificada } from '../autenticacion/tipos';

/**
 * El alcance de las dos rutas del panel del alumno (spec 011, criterio 3; DT-2): `VER_CARNET` (el resumen) y `VER_REPORTES_ASISTENCIA` (la asistencia) con alcance
 * `PROPIO`, que hoy es solo del `ALUMNO`. El guard ya comprobó que el rol tiene la celda; aquí se exige que sea `PROPIO`: el `ADMIN` y la `SECRETARIA` (`TODO`) y el
 * `ENTRENADOR` (`SUS_CLASES`) reciben 403 `SIN_PERMISO`; ven al alumno por sus propias rutas. Va antes de cualquier lectura y del `mes`.
 */
export function exigirAlcancePropio(sesion: SesionVerificada, permiso: 'VER_CARNET' | 'VER_REPORTES_ASISTENCIA'): void {
  const fila = MATRIZ_PERMISOS[permiso];
  const celda = Object.hasOwn(fila, sesion.usuario.rol) ? fila[sesion.usuario.rol] : undefined;
  if (celda !== 'PROPIO') throw sinPermiso();
}
