import type { ArgumentsHost } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { FiltroErrores } from './filtro-errores';

/**
 * Responde un error desde un middleware de Express con el mismo formato que el resto de la API: reutiliza el filtro
 * global de Nest, que convierte la excepción en un `ErrorApi`.
 */
export function responderError(
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
