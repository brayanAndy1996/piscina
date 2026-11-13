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
const MENSAJE_CODIFICACION = 'La codificación del contenido (Content-Encoding) debe ser identity, gzip o deflate.';
const MENSAJE_CUERPO_COMPRIMIDO = 'El cuerpo comprimido de la solicitud no es válido.';
const MENSAJE_UTF8_INVALIDO = 'El cuerpo de la solicitud debe estar codificado en UTF-8 válido.';

/** Tipo con el que `verificarUtf8` marca su error, para reconocerlo después del lector (`body-parser` lo conserva). */
const TIPO_ERROR_UTF8 = 'aquagestion.utf8-invalido';

/**
 * `verify` del lector JSON (criterio 105): recibe los bytes del cuerpo ya descomprimidos y lanza un error si no son UTF-8
 * válido (`0xFF`, `0xC3 0x28`, secuencias demasiado largas, sustitutos codificados o una secuencia cortada al final). Así nunca
 * se guarda U+FFFD en lugar de lo que envió el cliente: el lector no llega a decodificar ni a interpretar el cuerpo.
 */
const decodificadorEstricto = new TextDecoder('utf-8', { fatal: true });
function verificarUtf8(_solicitud: unknown, _respuesta: unknown, cuerpo: Buffer): void {
  try {
    decodificadorEstricto.decode(cuerpo);
  } catch {
    throw Object.assign(new Error(MENSAJE_UTF8_INVALIDO), { type: TIPO_ERROR_UTF8 });
  }
}

/** El error que lanza `verificarUtf8`, tal como lo deja `body-parser` (`entity.verify.failed` con 403 salvo que el error traiga su tipo). */
function esErrorDeUtf8(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { type?: unknown }).type === TIPO_ERROR_UTF8;
}

/** Únicos valores de `Content-Encoding` que se admiten (criterio 89), en minúsculas y sin espacios. */
const CODIFICACIONES_ADMITIDAS: ReadonlySet<string> = new Set(['identity', 'gzip', 'deflate']);

/**
 * `true` si el valor de `Content-Encoding` es admisible: la cabecera ausente, o un único valor `identity`, `gzip` o
 * `deflate` (sin distinguir mayúsculas, con espacios en los extremos). Una lista, un valor vacío o cualquier otro valor
 * no se admite (criterio 89).
 */
export function esCodificacionAdmitida(valor: string | string[] | undefined): boolean {
  if (valor === undefined) return true;
  if (typeof valor !== 'string') return false;
  return CODIFICACIONES_ADMITIDAS.has(valor.trim().toLowerCase());
}

/** Errores de descompresión de zlib (`Z_DATA_ERROR`, `Z_BUF_ERROR`…) que `body-parser` deja con estado 400. */
function esErrorDeDescompresion(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' && code.startsWith('Z_');
}

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
 * 2. Codificación del contenido: con cuerpo, `Content-Encoding` solo puede faltar o ser uno de `identity`, `gzip` o
 *    `deflate`; otro valor, una lista o un valor vacío → el mismo 400, sin interpretar el cuerpo. Nunca 415
 *    (criterio 89).
 * 3. Lector JSON (`strict`, 100 KB, `inflate`, UTF-8 estricto: un cuerpo que no es UTF-8 válido da el mismo 400, criterio 105). El límite se aplica a los bytes ya descomprimidos: una "bomba" de
 *    compresión da 413 `CARGA_EXCESIVA`. Un cuerpo `gzip` o `deflate` corrupto da el mismo 400 de la codificación. El lector
 *    `urlencoded` de Nest queda inerte (`type` nunca coincide): nada de formularios. Los nombres `jsonParser` y
 *    `urlencodedParser` hacen que Nest no registre los suyos.
 */
export function instalarLectorDeCuerpos(app: NestExpressApplication, prefijoApi: string): void {
  const filtro = app.get(FiltroErrores, { strict: false });

  /** Responde el 400 `SOLICITUD_INVALIDA` con `detalles.errores = [{ campo: '', mensaje }]` y `Cache-Control: no-store`. */
  const rechazar = (mensaje: string, solicitud: Request, respuesta: Response, siguiente: NextFunction): void => {
    respuesta.setHeader('Cache-Control', 'no-store');
    responderError(
      filtro,
      new ErrorNegocio(400, 'SOLICITUD_INVALIDA', MENSAJE_SOLICITUD_INVALIDA, { errores: [{ campo: '', mensaje }] }),
      solicitud,
      respuesta,
      siguiente,
    );
  };

  app.use(`/${prefijoApi}`, (solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    if (
      METODOS_CON_CUERPO.has(solicitud.method) &&
      traeCuerpo(solicitud) &&
      !esTipoJson(solicitud.headers['content-type'])
    ) {
      rechazar(MENSAJE_SOLO_JSON, solicitud, respuesta, siguiente);
      return;
    }
    siguiente();
  });

  app.use(`/${prefijoApi}`, (solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    if (
      METODOS_CON_CUERPO.has(solicitud.method) &&
      traeCuerpo(solicitud) &&
      !esCodificacionAdmitida(solicitud.headers['content-encoding'])
    ) {
      rechazar(MENSAJE_CODIFICACION, solicitud, respuesta, siguiente);
      return;
    }
    siguiente();
  });

  // Los tipos de Nest omiten `verify` (lo usa para `rawBody`), pero el lector de Express lo recibe tal cual cuando `rawBody` está
  // apagado: `verify` ve los bytes ya descomprimidos y antes de decodificarlos (criterio 105).
  const opcionesJson = { limit: LIMITE_CUERPO_JSON, strict: true, inflate: true, verify: verificarUtf8 };
  app.useBodyParser('json', opcionesJson);
  // Un cuerpo comprimido corrupto es un 400 como el resto de los de este criterio; los demás errores del lector (tamaño,
  // JSON inválido) siguen su camino al filtro global.
  app.use(`/${prefijoApi}`, (error: unknown, solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    if (esErrorDeDescompresion(error)) {
      rechazar(MENSAJE_CUERPO_COMPRIMIDO, solicitud, respuesta, siguiente);
      return;
    }
    if (esErrorDeUtf8(error)) {
      rechazar(MENSAJE_UTF8_INVALIDO, solicitud, respuesta, siguiente);
      return;
    }
    siguiente(error);
  });
  app.useBodyParser('urlencoded', { type: () => false });
}
