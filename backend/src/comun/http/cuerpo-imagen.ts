import { HttpException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { FOTO_TAMANO_MAXIMO, FOTO_TIPOS } from '@aquagestion/contratos';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ErrorNegocio } from '../errores';
import { FiltroErrores } from '../filtros/filtro-errores';
import { responderError } from '../filtros/responder-error';

/** `PUT /api/a/{nombreCorto}/solicitudes/foto`, con o sin barra final y sin distinguir mayúsculas (como el enrutador de Express). */
const RUTA_DE_LA_FOTO = /^\/a\/[^/]+\/solicitudes\/foto\/?$/i;

/** `PUT /api/a/{nombreCorto}/solicitudes/comprobante` (007b, criterio 36), con las mismas reglas de dirección que la foto. */
const RUTA_DEL_COMPROBANTE = /^\/a\/[^/]+\/solicitudes\/comprobante\/?$/i;

/** El mismo mensaje para todo `IMAGEN_NO_VALIDA`: nada distingue por qué se rechazó una imagen (criterio 34). */
export const MENSAJE_IMAGEN_NO_VALIDA = 'La imagen no es válida. Sube una foto en JPEG o PNG de buen tamaño.';

/** 400 `IMAGEN_NO_VALIDA` sin `detalles`: el único cuerpo de todo rechazo de la imagen (criterio 34). */
export function imagenNoValida(): ErrorNegocio {
  return new ErrorNegocio(400, 'IMAGEN_NO_VALIDA', MENSAJE_IMAGEN_NO_VALIDA);
}

/** ¿Es la subida de la foto de la solicitud? `rutaBajoElPrefijo` es la ruta sin `/api` (`/a/delfines/solicitudes/foto`). */
export function esSubidaDeFoto(metodo: string, rutaBajoElPrefijo: string): boolean {
  return metodo === 'PUT' && RUTA_DE_LA_FOTO.test(rutaBajoElPrefijo);
}

/** ¿Es la subida del comprobante de pago de la solicitud (007b)? `rutaBajoElPrefijo` es la ruta sin `/api`. */
export function esSubidaDeComprobante(metodo: string, rutaBajoElPrefijo: string): boolean {
  return metodo === 'PUT' && RUTA_DEL_COMPROBANTE.test(rutaBajoElPrefijo);
}

/** ¿Es una subida de imagen de una persona sin sesión (la foto o el comprobante)? Las dos usan el lector binario y no el lector JSON. */
export function esSubidaDeImagen(metodo: string, rutaBajoElPrefijo: string): boolean {
  return esSubidaDeFoto(metodo, rutaBajoElPrefijo) || esSubidaDeComprobante(metodo, rutaBajoElPrefijo);
}

/** El tipo de medio de `Content-Type`: lo que va antes del `;`, recortado y en minúsculas (los parámetros se ignoran). */
export function tipoDeMedio(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/** `Content-Encoding` solo puede faltar o ser `identity` (sin distinguir mayúsculas, con espacios en los extremos): sin descompresión. */
function codificacionAdmitida(valor: string | undefined): boolean {
  return valor === undefined || valor.trim().toLowerCase() === 'identity';
}

/** El `Content-Length` declarado, o `null` si falta o no es un número válido. */
function largoDeclarado(solicitud: Request): number | null {
  const crudo = solicitud.headers['content-length'];
  if (typeof crudo !== 'string' || !/^[0-9]+$/.test(crudo.trim())) return null;
  return Number(crudo);
}

/**
 * Lector binario de la foto de la solicitud y del comprobante de pago (spec 005b, criterio 34 b y c; PB3, PB4; 007b, criterio 37), fuera del
 * lector JSON. Solo actúa en `PUT /api/a/{nombreCorto}/solicitudes/foto` y `PUT /api/a/{nombreCorto}/solicitudes/comprobante` (los mismos tipos y
 * el mismo tamaño máximo); se instala después de los límites por conexión (criterio 33, que cuentan antes de leer el
 * cuerpo) y antes del lector JSON, que deja esa ruta sin tocar (`noLeerCuerpoEn` de `crear-app.ts`). En este orden, la primera
 * comprobación que falla decide la respuesta, siempre antes de buscar la academia:
 *
 * 1. Tipo y codificación: el tipo de medio debe ser `image/jpeg` o `image/png` y `Content-Encoding` debe faltar o ser `identity` →
 *    si no, 400 `IMAGEN_NO_VALIDA`, sin leer el cuerpo.
 * 2. Tamaño: un `Content-Length` mayor que 5 242 880 bytes responde 413 `CARGA_EXCESIVA` sin leer nada; un cuerpo sin `Content-Length`
 *    deja de leerse al pasar el límite. Exactamente 5 242 880 bytes sigue adelante. Nunca se descomprime (`inflate: false`).
 *
 * El cuerpo queda en `req.body` como `Buffer` (sin cuerpo, `undefined`). Con un rechazo temprano se cierra la conexión, para no seguir
 * recibiendo un cuerpo que no se va a usar. Lo que sigue (academia, token, estado e imagen) lo decide `FotoService`.
 */
export function instalarLectorDeImagen(app: NestExpressApplication, prefijoApi: string): void {
  const filtro = app.get(FiltroErrores, { strict: false });
  const leer = express.raw({ type: () => true, limit: FOTO_TAMANO_MAXIMO, inflate: false });
  const tipos: readonly string[] = FOTO_TIPOS;

  const rechazar = (error: unknown, solicitud: Request, respuesta: Response, siguiente: NextFunction): void => {
    respuesta.setHeader('Connection', 'close');
    responderError(filtro, error, solicitud, respuesta, siguiente);
  };
  const demasiadoGrande = (): HttpException => new HttpException('Payload Too Large', 413);

  app.use(`/${prefijoApi}`, (solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    // Montado en `/api`: `path` ya es la ruta sin el prefijo.
    if (!esSubidaDeImagen(solicitud.method, solicitud.path)) {
      siguiente();
      return;
    }
    if (
      !tipos.includes(tipoDeMedio(solicitud.headers['content-type'])) ||
      !codificacionAdmitida(solicitud.headers['content-encoding'])
    ) {
      rechazar(imagenNoValida(), solicitud, respuesta, siguiente);
      return;
    }
    const largo = largoDeclarado(solicitud);
    if (largo !== null && largo > FOTO_TAMANO_MAXIMO) {
      rechazar(demasiadoGrande(), solicitud, respuesta, siguiente);
      return;
    }
    leer(solicitud, respuesta, (error?: unknown) => {
      if (error === undefined || error === null) {
        siguiente();
        return;
      }
      // Un cuerpo que pasa del límite (sin `Content-Length`) es 413; cualquier otro fallo del lector (cuerpo cortado, largo que no
      // coincide) es una imagen que no sirve.
      const tipo = (error as { type?: unknown }).type;
      rechazar(tipo === 'entity.too.large' ? demasiadoGrande() : imagenNoValida(), solicitud, respuesta, siguiente);
    });
  });
}
