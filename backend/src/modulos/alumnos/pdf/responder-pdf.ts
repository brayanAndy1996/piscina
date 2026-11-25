import type { Response } from 'express';

/**
 * Responde 200 con el PDF del carnet ya completo (spec 008a, criterio 11): descarga con el nombre fijo `carnet.pdf` (sin nombres, DNI ni token) y sin
 * caché. Se escribe después de armar el documento: si el generador falla, el error sube antes de escribir nada y el filtro global responde el 500
 * JSON.
 */
export function responderConPdf(respuesta: Response, contenido: Buffer): void {
  respuesta.status(200);
  respuesta.setHeader('Content-Type', 'application/pdf');
  respuesta.setHeader('Content-Disposition', 'attachment; filename="carnet.pdf"');
  respuesta.setHeader('Content-Length', String(contenido.length));
  respuesta.end(contenido);
}
