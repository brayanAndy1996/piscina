import { HttpException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Error del cuerpo de una petición ya autenticada de una academia, guardado para lanzarlo después de comprobar el permiso
 * (spec 002, contrato: sesión → academia activa → cambio obligatorio → permiso → validación del cuerpo). El lector del cuerpo
 * corre antes que los guards de Nest: sin esto, un cuerpo roto de quien no tiene permiso recibiría 400 y no 403.
 *
 * Solo se difieren las peticiones que el middleware de las rutas de academia marcó con `permitirErrorDeCuerpoDiferido`. El
 * primer error gana. Se guarda en la petición con símbolos propios: ningún otro código lo ve por casualidad.
 */
const DIFERIBLE = Symbol('aquagestion.cuerpo-diferible');
const ERROR_GUARDADO = Symbol('aquagestion.error-de-cuerpo');

type ConMarcas = Request & { [DIFERIBLE]?: true; [ERROR_GUARDADO]?: unknown };

/** Marca la petición: un error de su cuerpo se guarda en lugar de responderse al instante. */
export function permitirErrorDeCuerpoDiferido(solicitud: Request): void {
  (solicitud as ConMarcas)[DIFERIBLE] = true;
}

/** Guarda el error si la petición lo permite (y no hay ya uno). Devuelve `true` si lo guardó o ya había uno. */
export function guardarErrorDeCuerpo(solicitud: Request, error: unknown): boolean {
  const marcada = solicitud as ConMarcas;
  if (marcada[DIFERIBLE] !== true) return false;
  if (!(ERROR_GUARDADO in marcada)) marcada[ERROR_GUARDADO] = error;
  return true;
}

/**
 * Lanza el error guardado, si hay. Un `SyntaxError` del lector JSON es un 400 y un error de `http-errors` (por ejemplo, el 413 de un
 * cuerpo demasiado grande) conserva su estado, como hace Nest con los errores que llegan por `next(error)`.
 */
export function lanzarErrorDeCuerpoGuardado(solicitud: Request): void {
  const marcada = solicitud as ConMarcas;
  if (!(ERROR_GUARDADO in marcada)) return;
  const error = marcada[ERROR_GUARDADO];
  if (error instanceof SyntaxError) throw new HttpException('Bad Request', 400, { cause: error });
  const estado = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof estado === 'number' && estado >= 400 && estado < 500) {
    throw new HttpException('Client Error', estado, { cause: error });
  }
  throw error;
}
