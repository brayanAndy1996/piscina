import type { RolUsuario } from '@aquagestion/contratos';

/** Quien restablece una contraseña: un usuario con su rol, o el Superadmin (solo para los administradores, D-29). */
export type ActorDeRestablecimiento =
  | { readonly tipo: 'USUARIO'; readonly id: string; readonly rol: RolUsuario }
  | { readonly tipo: 'SUPERADMIN'; readonly id: string };

/** A quien se le restablece la contraseña. */
export interface ObjetivoDeRestablecimiento {
  readonly id: string;
  readonly rol: RolUsuario;
}

/**
 * - `PERMITIDO`: el actor puede restablecer a ese usuario.
 * - `FUERA_DE_ALCANCE`: el usuario existe pero el actor no puede tocarlo; se responde 404, igual que si no existiera, para no
 *   revelar quién es quién (criterio 36).
 * - `SOBRE_SI_MISMO`: el administrador no se restablece a sí mismo (409 `OPERACION_SOBRE_SI_MISMO`).
 */
export type ResultadoAlcance = 'PERMITIDO' | 'FUERA_DE_ALCANCE' | 'SOBRE_SI_MISMO';

/**
 * Quién restablece a quién (DR-4 de la spec 002, criterio 36). Función pura:
 *
 * - `ADMIN`: a cualquier usuario de su academia, salvo a sí mismo.
 * - `SECRETARIA`: solo a alumnos (sobre otro rol o sobre sí misma, fuera de alcance).
 * - `ENTRENADOR` y `ALUMNO`: a nadie.
 * - `SUPERADMIN`: solo a administradores (criterio 40).
 *
 * El estado del objetivo no cuenta: restablecer a un usuario inactivo funciona y lo deja inactivo (PO-5).
 */
export function evaluarAlcanceDeRestablecimiento(
  actor: ActorDeRestablecimiento,
  objetivo: ObjetivoDeRestablecimiento,
): ResultadoAlcance {
  if (actor.tipo === 'SUPERADMIN') return objetivo.rol === 'ADMIN' ? 'PERMITIDO' : 'FUERA_DE_ALCANCE';
  if (actor.rol === 'ADMIN') return actor.id === objetivo.id ? 'SOBRE_SI_MISMO' : 'PERMITIDO';
  if (actor.rol === 'SECRETARIA') return objetivo.rol === 'ALUMNO' ? 'PERMITIDO' : 'FUERA_DE_ALCANCE';
  return 'FUERA_DE_ALCANCE';
}

/** Los roles del personal: los únicos que se desactivan y reactivan desde la gestión de usuarios (DR-6). */
export const ROLES_DEL_PERSONAL: readonly RolUsuario[] = ['ADMIN', 'SECRETARIA', 'ENTRENADOR'];
