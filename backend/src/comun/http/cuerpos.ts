import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { ErrorNegocio } from '../errores';
import { FiltroErrores } from '../filtros/filtro-errores';
import { responderError } from '../filtros/responder-error';
import { MENSAJE_SOLICITUD_INVALIDA } from '../validacion';

const METODOS_CON_CUERPO = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** `application/json`, con o sin `charset=utf-8` (sin distinguir mayúsculas), con espacios opcionales antes y después del `;`. */
const TIPO_JSON = /^application\/json\s*(?:;\s*charset=(?:utf-8|"utf-8")\s*)?$/i;

/** Tamaño máximo del cuerpo JSON: 100 KB (el valor por defecto del lector de Express). Más: 413 `CARGA_EXCESIVA`. */
export const LIMITE_CUERPO_JSON = '100kb';

const MENSAJE_SOLO_JSON = 'El cuerpo de la solicitud debe ser JSON (Content-Type: application/json).';

/** `true` si el `Content-Type` es JSON (criterio 74). */
export function esTipoJson(tipo: string | undefined): boolean {
  return tipo !== undefined && TIPO_JSON.test(tipo);
}

/** La petición trae cuerpo si declara `Content-Length` mayor que 0 o `Transfer-Encoding`. */
export function traeCuerpo(solicitud: Request): boolean {
  if (solicitud.headers['transfer-encoding'] !== undefined) return true;
  const largo = Number(solicitud.headers['content-length']);
  return Number.isFinite(largo) && largo > 0;
}

/**
 * Middlewares de los cuerpos de toda la API (criterio 74). Se instalan antes de `init()`, después de los de los
 * prefijos (límite del inicio de sesión y sesión del superadmin), y en este orden:
 *
 * 1. Tipo de contenido: `POST`, `PUT`, `PATCH` o `DELETE` con cuerpo y un tipo que no es `application/json` →
 *    400 `SOLICITUD_INVALIDA` con `detalles.errores = [{ campo: '', mensaje }]` y `Cache-Control: no-store`, sin
 *    leer el cuerpo.
 * 2. Lector JSON (`strict`, 100 KB). El lector `urlencoded` de Nest queda inerte (`type` nunca coincide): nada de
 *    formularios. Los nombres `jsonParser` y `urlencodedParser` hacen que Nest no registre los suyos.
 */
export function instalarLectorDeCuerpos(app: NestExpressApplication, prefijoApi: string): void {
  const filtro = app.get(FiltroErrores, { strict: false });

  app.use(`/${prefijoApi}`, (solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    if (
      METODOS_CON_CUERPO.has(solicitud.method) &&
      traeCuerpo(solicitud) &&
      !esTipoJson(solicitud.headers['content-type'])
    ) {
      respuesta.setHeader('Cache-Control', 'no-store');
      responderError(
        filtro,
        new ErrorNegocio(400, 'SOLICITUD_INVALIDA', MENSAJE_SOLICITUD_INVALIDA, {
          errores: [{ campo: '', mensaje: MENSAJE_SOLO_JSON }],
        }),
        solicitud,
        respuesta,
        siguiente,
      );
      return;
    }
    siguiente();
  });

  app.useBodyParser('json', { limit: LIMITE_CUERPO_JSON, strict: true });
  app.useBodyParser('urlencoded', { type: () => false });
}
