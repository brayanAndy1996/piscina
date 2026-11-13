import type { Request } from 'express';
import type { SuperadminSesion } from '@aquagestion/contratos';

/** El superadmin autenticado de la petición: lo deja el guard y lo lee `@SuperadminActual()`. */
export type SuperadminAutenticado = SuperadminSesion;

/** Petición de Express con el superadmin que dejó el guard de sesión. */
export interface SolicitudDePlataforma extends Request {
  superadminPlataforma?: SuperadminAutenticado;
}

/** Duración de la sesión de la plataforma: 8 horas (DR-3). */
export const DURACION_SESION_PLATAFORMA_SEGUNDOS = 28_800;

/** Valor del claim `tipo` de los tokens de la plataforma: un token de otro tipo no sirve aquí. */
export const TIPO_TOKEN_PLATAFORMA = 'plataforma';
