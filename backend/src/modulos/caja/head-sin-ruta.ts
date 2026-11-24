import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { FiltroErrores } from '../../comun/filtros/filtro-errores';
import { responderError } from '../../comun/filtros/responder-error';
import { noEncontrado } from './errores';

/** Toda dirección de la caja bajo `/api`: `/cajas` y lo que cuelga de ella, con o sin barra final, sin distinguir mayúsculas (como el enrutador). */
const RUTA_DE_CAJA = /^\/cajas(?:\/.*)?$/i;

/**
 * `HEAD` no existe en las rutas de la caja (spec 006b, criterio 50; amplía el criterio 23 y PQ15; DT-9). Express atiende un `HEAD` con el
 * manejador del `GET` de la misma dirección: sin esto, `HEAD /api/cajas/{id}/cierres/{numero}/pdf` generaría el PDF y las otras tres lecturas
 * de la caja (`/api/cajas`, `/api/cajas/actual` y `/api/cajas/{id}`) se ejecutarían sin sus cabeceras de descarga ni su cuerpo.
 *
 * Es un middleware de Express y no `@Head()` en el controlador porque debe responder igual que `PATCH` sobre esas direcciones (404
 * `NO_ENCONTRADO`) para cualquier rol: con `@Head()` pasaría por el guard de permisos y el `ENTRENADOR` recibiría 403. Se instala en
 * `configurarApp` después de `instalarProteccionDeAcademia` (sin sesión, con el cambio de contraseña pendiente o con la academia suspendida
 * responde lo mismo que `PATCH`, porque esa protección ya respondió) y antes de que Nest registre sus rutas. Responde con el filtro de errores:
 * el mismo JSON y las mismas cabeceras (`no-store`) del 404 de siempre, sin cuerpo (un `HEAD` nunca lo tiene) y sin tocar el servicio, la base,
 * el generador del PDF ni la auditoría.
 */
export function instalarHeadSinRutasDeCaja(app: NestExpressApplication, prefijoApi: string): void {
  const filtro = app.get(FiltroErrores, { strict: false });

  app.use(`/${prefijoApi}`, (solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    if (solicitud.method === 'HEAD' && RUTA_DE_CAJA.test(solicitud.path)) {
      responderError(filtro, noEncontrado(), solicitud, respuesta, siguiente);
      return;
    }
    siguiente();
  });
}
