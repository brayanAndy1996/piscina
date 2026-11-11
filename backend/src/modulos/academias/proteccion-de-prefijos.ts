import type { ArgumentsHost } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { FiltroErrores } from '../../comun/filtros/filtro-errores';
import { ErrorAcademiaNoEncontrada } from '../../infraestructura/prisma';
import { SesionPlataformaService } from './sesion-plataforma.service';

const CABECERA_SIN_CACHE = 'no-store';

/** Rutas bajo `/api/plataforma` que no piden sesión: solo `POST` y `DELETE` sobre `/sesion` (con o sin barra final). */
const RUTA_DE_SESION = /^\/sesion\/?$/i;

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

/** Responde con el mismo formato de error que el resto de la API (el filtro global de Nest). */
function responderError(
  filtro: FiltroErrores,
  error: unknown,
  solicitud: Request,
  respuesta: Response,
  siguiente: NextFunction,
): void {
  const contexto = {
    switchToHttp: () => ({ getRequest: () => solicitud, getResponse: () => respuesta, getNext: () => siguiente }),
  } as unknown as ArgumentsHost;
  filtro.catch(error, contexto);
}

/**
 * Middlewares de los prefijos con datos sensibles o por academia (P-7 y P-8 de la spec 001). Se instalan antes de que
 * Nest registre sus rutas y su lector del cuerpo (`configurarApp`), así que valen para todo el prefijo, incluidas las
 * rutas que no existen o que llevan barra final, y una petición sin sesión se rechaza antes de leer su cuerpo.
 *
 * - `/api/plataforma`: `Cache-Control: no-store` en toda respuesta (también las de error) y sesión de superadmin
 *   válida en toda ruta salvo `POST` y `DELETE /api/plataforma/sesion`; sin ella, 401 `NO_AUTENTICADO`.
 * - `/api/a`: `Cache-Control: no-store` en toda respuesta.
 */
export function instalarProteccionDePrefijos(app: NestExpressApplication, prefijoApi: string): void {
  const sesion = app.get(SesionPlataformaService, { strict: false });
  const filtro = app.get(FiltroErrores, { strict: false });

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
