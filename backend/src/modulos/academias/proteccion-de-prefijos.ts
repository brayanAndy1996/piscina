import { HttpException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import { FiltroErrores } from '../../comun/filtros/filtro-errores';
import { responderError } from '../../comun/filtros/responder-error';
import { ErrorAcademiaNoEncontrada } from '../../infraestructura/prisma';
import { LIMITE_INICIO_SESION } from './limite-inicio-sesion';
import { SesionPlataformaService } from './sesion-plataforma.service';

const CABECERA_SIN_CACHE = 'no-store';

/** Rutas bajo `/api/plataforma` que no piden sesión: solo `POST` y `DELETE` sobre `/sesion` (con o sin barra final). */
const RUTA_DE_SESION = /^\/sesion\/?$/i;

/** `POST /api/plataforma/sesion`, con o sin barra final y sin distinguir mayúsculas (como el router de Express). */
function esInicioDeSesion(solicitud: Request): boolean {
  return solicitud.method === 'POST' && RUTA_DE_SESION.test(solicitud.path);
}

function esRutaPublicaDeSesion(solicitud: Request): boolean {
  return (solicitud.method === 'POST' || solicitud.method === 'DELETE') && RUTA_DE_SESION.test(solicitud.path);
}

function esDireccionDecodificable(ruta: string): boolean {
  try {
    decodeURIComponent(ruta);
    return true;
  } catch {
    return false;
  }
}

/**
 * Middlewares de los prefijos con datos sensibles o por academia (P-7 y P-8 de la spec 001). Se instalan antes de que
 * Nest registre sus rutas y su lector del cuerpo (`configurarApp`), así que valen para todo el prefijo, incluidas las
 * rutas que no existen o que llevan barra final, y una petición sin sesión se rechaza antes de leer su cuerpo.
 *
 * - `/api/plataforma`: `Cache-Control: no-store` en toda respuesta (también las de error); límite por IP del inicio de
 *   sesión, que cuenta **antes** de leer el cuerpo (criterio 75: también el JSON roto, el 413 y los tipos que no son
 *   JSON); y sesión de superadmin válida en toda ruta salvo `POST` y `DELETE /api/plataforma/sesion`; sin ella, 401
 *   `NO_AUTENTICADO`.
 * - `/api/a`: `Cache-Control: no-store` en toda respuesta.
 */
export function instalarProteccionDePrefijos(app: NestExpressApplication, prefijoApi: string): void {
  const sesion = app.get(SesionPlataformaService, { strict: false });
  const filtro = app.get(FiltroErrores, { strict: false });
  const almacenLimite = app.get<ThrottlerStorage>(ThrottlerStorage, { strict: false });

  app.use(`/${prefijoApi}/a`, (solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    respuesta.setHeader('Cache-Control', CABECERA_SIN_CACHE);
    // Una dirección con un `%` mal formado (`/a/%FF`) no puede ser un nombre corto: se responde igual que un nombre
    // inexistente, y no con el 400 genérico de Express.
    if (!esDireccionDecodificable(solicitud.path)) {
      responderError(filtro, new ErrorAcademiaNoEncontrada(), solicitud, respuesta, siguiente);
      return;
    }
    siguiente();
  });

  app.use(`/${prefijoApi}/plataforma`, (solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    respuesta.setHeader('Cache-Control', CABECERA_SIN_CACHE);
    if (esInicioDeSesion(solicitud)) {
      // Cada petición cuenta, sea cual sea su resultado; la que pasa del límite no llega a leer el cuerpo.
      const { ttl, limit } = LIMITE_INICIO_SESION;
      almacenLimite.increment(`inicio-sesion:${solicitud.ip ?? ''}`, ttl, limit, ttl, LIMITE_INICIO_SESION.name).then(
        (registro) => {
          if (registro.isBlocked)
            responderError(filtro, new HttpException('Too Many Requests', 429), solicitud, respuesta, siguiente);
          else siguiente();
        },
        (error: unknown) => responderError(filtro, error, solicitud, respuesta, siguiente),
      );
      return;
    }
    if (esRutaPublicaDeSesion(solicitud)) {
      siguiente();
      return;
    }
    sesion.autenticar(solicitud).then(
      () => siguiente(),
      (error: unknown) => responderError(filtro, error, solicitud, respuesta, siguiente),
    );
  });
}
