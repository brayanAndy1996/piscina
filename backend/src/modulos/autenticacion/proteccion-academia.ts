import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { ErrorNegocio } from '../../comun/errores';
import { FiltroErrores } from '../../comun/filtros/filtro-errores';
import { responderError } from '../../comun/filtros/responder-error';
import { permitirErrorDeCuerpoDiferido } from '../../comun/http/error-de-cuerpo-diferido';
import { esCierreDeSesion, esRutaDeAcademia, esRutaPermitidaConCambioPendiente } from './dominio/rutas-de-academia';
import { SesionAcademiaService } from './sesion-academia.service';
import type { SolicitudDeAcademia } from './tipos';

/**
 * Middleware de las rutas de academia (spec 002, criterios 14 a 21): todo `/api/*` salvo `/api/salud`, `/api/plataforma/…` y
 * `/api/a/…`. Se instala en `configurarApp` antes del lector del cuerpo, así vale también para las rutas que no existen o que
 * llevan barra final, y una petición sin sesión se rechaza antes de leer su cuerpo. Orden de las comprobaciones:
 *
 * 1. `Cache-Control: no-store` en toda respuesta, también las de error.
 * 2. `DELETE /api/sesion` sigue sin sesión (cerrar la sesión no la exige; su manejador siempre responde 204).
 * 3. Sesión válida (401 `NO_AUTENTICADO`) y academia activa (403 `ACADEMIA_SUSPENDIDA`): `SesionAcademiaService.autenticar`.
 * 4. Con el cambio de contraseña pendiente, solo `GET /api/sesion` y `POST /api/sesion/clave` (403 `CAMBIO_DE_CLAVE_OBLIGATORIO`).
 *
 * Deja la sesión en la petición para `PermisosGuard` y los decoradores (el permiso, 403 `SIN_PERMISO`, es del guard). Las
 * peticiones autenticadas difieren los errores del cuerpo hasta después del permiso.
 */
export function instalarProteccionDeAcademia(app: NestExpressApplication, prefijoApi: string): void {
  const sesiones = app.get(SesionAcademiaService, { strict: false });
  const filtro = app.get(FiltroErrores, { strict: false });

  app.use(`/${prefijoApi}`, (solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    if (!esRutaDeAcademia(solicitud.path)) {
      siguiente();
      return;
    }
    respuesta.setHeader('Cache-Control', 'no-store');
    if (esCierreDeSesion(solicitud.method, solicitud.path)) {
      siguiente();
      return;
    }
    sesiones.autenticar(solicitud).then(
      (sesion) => {
        if (sesion.usuario.debeCambiarClave && !esRutaPermitidaConCambioPendiente(solicitud.method, solicitud.path)) {
          const error = new ErrorNegocio(
            403,
            'CAMBIO_DE_CLAVE_OBLIGATORIO',
            'Debes cambiar tu contraseña antes de continuar.',
          );
          sesiones.registrarRechazo(solicitud, error, sesion);
          responderError(filtro, error, solicitud, respuesta, siguiente);
          return;
        }
        (solicitud as SolicitudDeAcademia).sesionAcademia = sesion;
        permitirErrorDeCuerpoDiferido(solicitud);
        siguiente();
      },
      (error: unknown) => {
        sesiones.registrarRechazo(solicitud, error);
        responderError(filtro, error, solicitud, respuesta, siguiente);
      },
    );
  });
}
