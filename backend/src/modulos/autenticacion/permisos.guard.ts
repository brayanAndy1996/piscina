import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { puede, type Permiso as PermisoMatriz } from '@aquagestion/contratos';
import { ErrorNegocio } from '../../comun/errores';
import { lanzarErrorDeCuerpoGuardado } from '../../comun/http/error-de-cuerpo-diferido';
import { CLAVE_PERMISO, CLAVE_SOLO_SESION } from './permiso.decorator';
import type { SolicitudDeAcademia } from './tipos';

function sinPermiso(): ErrorNegocio {
  return new ErrorNegocio(403, 'SIN_PERMISO', 'No tienes permiso para realizar esta acción.');
}

/**
 * Guard global de permisos (RNF-03, criterios 27 y 28). El middleware de las rutas de academia ya comprobó la sesión, la academia
 * activa y el cambio obligatorio y dejó la sesión en la petición; aquí se decide el permiso:
 *
 * - `@Permiso(p)`: el rol de la sesión debe tener la celda `p` de `MATRIZ_PERMISOS`; si no, 403 `SIN_PERMISO`.
 * - `@SoloSesion()`: basta la sesión.
 * - Sin ninguna de las dos, en una ruta con sesión de academia: 403 `SIN_PERMISO` a todos los roles (falla cerrada). Las rutas que
 *   no son de academia (`/api/salud`, `/api/a/…`, `/api/plataforma/…` y `DELETE /api/sesion`) no pasan por el middleware, no tienen
 *   sesión de academia y este guard las deja pasar: tienen su propia protección.
 *
 * Lo declarado en el manejador manda sobre lo de la clase. Una ruta que declara un permiso y llega sin sesión de academia (porque
 * el middleware no se instaló) responde 401: nunca se abre por omisión.
 *
 * Después de comprobar el permiso lanza el error del cuerpo que el lector dejó guardado, si hay (JSON roto, tamaño excesivo…): así
 * quien no tiene permiso recibe 403 y no 400.
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const solicitud = contexto.switchToHttp().getRequest<SolicitudDeAcademia>();
    const sesion = solicitud.sesionAcademia;
    const destinos = [contexto.getHandler(), contexto.getClass()];

    let permiso: PermisoMatriz | undefined;
    let basta = false;
    for (const destino of destinos) {
      permiso = this.reflector.get<PermisoMatriz | undefined>(CLAVE_PERMISO, destino);
      basta = this.reflector.get<boolean | undefined>(CLAVE_SOLO_SESION, destino) === true;
      if (permiso !== undefined || basta) break;
    }

    const declarada = permiso !== undefined || basta;
    if (!declarada) {
      if (sesion) throw sinPermiso();
      return true;
    }
    if (!sesion) {
      throw new ErrorNegocio(401, 'NO_AUTENTICADO', 'Debes iniciar sesión para continuar.');
    }
    if (permiso !== undefined && !puede(sesion.usuario.rol, permiso)) throw sinPermiso();
    lanzarErrorDeCuerpoGuardado(solicitud);
    return true;
  }
}
