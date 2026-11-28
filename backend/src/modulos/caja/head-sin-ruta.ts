import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { FiltroErrores } from '../../comun/filtros/filtro-errores';
import { responderError } from '../../comun/filtros/responder-error';
import { noEncontrado } from './errores';

/**
 * Las direcciones bajo `/api` sin `HEAD`: la caja (006), los pagos (007b, DT-9 de 006), los alumnos y el carnet (008a, criterio 18; también la
 * renovación de la 010a, que cuelga de `/alumnos`), la asistencia (009a, criterio 18) y las mensualidades y las matrículas (010: el listado y el
 * cambio de horario de la 010b y la 010c) y el panel del alumno (011, criterio 16).
 */
export const PREFIJOS_SIN_HEAD: readonly string[] = [
  '/cajas',
  '/pagos',
  '/alumnos',
  '/mi-carnet',
  '/mi-panel',
  '/asistencias',
  '/mensualidades',
  '/matriculas',
];

/**
 * Cada prefijo y lo que cuelga de él, con o sin barra final, sin distinguir mayúsculas (como el enrutador). Los caracteres especiales de las
 * expresiones regulares del prefijo se escapan.
 */
function patronDeLosPrefijos(prefijos: readonly string[]): RegExp {
  const alternativas = prefijos.map((prefijo) => prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`^(?:${alternativas})(?:/.*)?$`, 'i');
}

/**
 * `HEAD` no existe en las rutas de la caja ni en las de los pagos (spec 006b, criterio 50; amplía el criterio 23 y PQ15; DT-9; 007b, criterio
 * 46: `/api/pagos`, con el comprobante y la bandeja). Express atiende un `HEAD` con el
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
export function instalarHeadSinRutasDeCaja(
  app: NestExpressApplication,
  prefijoApi: string,
  prefijos: readonly string[] = PREFIJOS_SIN_HEAD,
): void {
  const filtro = app.get(FiltroErrores, { strict: false });
  const rutaSinHead = patronDeLosPrefijos(prefijos);

  app.use(`/${prefijoApi}`, (solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    if (solicitud.method === 'HEAD' && rutaSinHead.test(solicitud.path)) {
      responderError(filtro, noEncontrado(), solicitud, respuesta, siguiente);
      return;
    }
    siguiente();
  });
}
