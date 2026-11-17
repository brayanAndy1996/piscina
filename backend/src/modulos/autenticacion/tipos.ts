import type { RolUsuario } from '@aquagestion/contratos';
import type { Request } from 'express';

/** El usuario de la sesión de academia de la petición. Lo entrega `@UsuarioActual()` a los servicios de las historias siguientes. */
export interface UsuarioAutenticado {
  readonly id: string;
  /** La academia sale siempre de la sesión: los servicios la pasan a `BaseDatos.conAcademia` y nunca leen otra (criterio 20). */
  readonly academiaId: string;
  readonly rol: RolUsuario;
  readonly nombres: string;
  readonly apellidos: string;
  readonly debeCambiarClave: boolean;
}

/** Lo que verifica una sesión válida: el usuario (leído de la base en esta petición) y su academia. */
export interface SesionVerificada {
  readonly usuario: UsuarioAutenticado;
  /** `version_token` actual del usuario; coincide con el `ver` del token. */
  readonly versionToken: number;
  readonly academia: { readonly nombreCorto: string; readonly nombre: string };
}

/** Petición de Express con la sesión de academia que dejó el middleware de las rutas de academia. */
export interface SolicitudDeAcademia extends Request {
  sesionAcademia?: SesionVerificada;
}

/** Valor del claim `tipo` de los tokens de academia: un token de otro tipo (por ejemplo, de plataforma) no sirve aquí. */
export const TIPO_TOKEN_ACADEMIA = 'academia';
