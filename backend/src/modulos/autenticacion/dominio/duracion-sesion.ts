import type { RolUsuario } from '@aquagestion/contratos';

/** Duración de la sesión del personal: 12 horas, una jornada de 08:00 a 20:00 (DR-8 de la spec 002). */
export const DURACION_SESION_PERSONAL_SEGUNDOS = 43_200;

/** Duración de la sesión del alumno: 30 días, para mostrar su carnet desde el celular sin entrar cada día (DR-8). */
export const DURACION_SESION_ALUMNO_SEGUNDOS = 2_592_000;

/** Segundos que dura la sesión de un usuario, según su rol. Función pura. */
export function duracionSesionSegundos(rol: RolUsuario): number {
  return rol === 'ALUMNO' ? DURACION_SESION_ALUMNO_SEGUNDOS : DURACION_SESION_PERSONAL_SEGUNDOS;
}
