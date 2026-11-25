import { FOTO_LADO_MAXIMO, FOTO_LADO_MINIMO, FOTO_PIXELES_MAXIMOS, type FotoTipo } from '@aquagestion/contratos';
import sharp from 'sharp';
import { imagenNoValida } from './cuerpo-imagen';

// `sharp` guarda en memoria las últimas operaciones por defecto: en un servidor que recibe imágenes de desconocidos no sirve de nada.
sharp.cache(false);

/** Las firmas de los primeros bytes: lo que dice ser el archivo tiene que coincidir con el tipo que declara el cliente (criterio 34 g de 005). */
const FIRMA_JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FORMATO_DE_SHARP: Readonly<Record<FotoTipo, string>> = { 'image/jpeg': 'jpeg', 'image/png': 'png' };
const CALIDAD_JPEG = 85;

/**
 * Valida una imagen subida por una persona y la vuelve a codificar (criterios 34 g y 35 de 005; 40 de 007): firma coherente con el tipo
 * declarado, que `sharp` la decodifique (también una cortada), lados de 100 a 8000 píxeles y como mucho 40 megapíxeles, tal como vienen en el
 * archivo (antes de la orientación). Sale un JPEG de como mucho `ladoMaximo` píxeles de lado mayor (sin agrandar), con la orientación aplicada
 * y sin metadatos (`sharp` no copia ninguno si no se le pide): lo guardado nunca es el archivo subido. Cualquier fallo, de lo que sea, es el
 * mismo 400 `IMAGEN_NO_VALIDA`. La usan la foto del alumno (800 píxeles) y el comprobante de pago (2000 píxeles, para que el número se lea).
 */
export async function recodificarImagen(cuerpo: Buffer, tipo: FotoTipo, ladoMaximo: number): Promise<Buffer> {
  const firma = tipo === 'image/jpeg' ? FIRMA_JPEG : FIRMA_PNG;
  if (cuerpo.length < firma.length || !cuerpo.subarray(0, firma.length).equals(firma)) throw imagenNoValida();
  try {
    const imagen = sharp(cuerpo, { limitInputPixels: FOTO_PIXELES_MAXIMOS, failOn: 'error' });
    const { format, width, height } = await imagen.metadata();
    if (format !== FORMATO_DE_SHARP[tipo] || width === undefined || height === undefined) throw imagenNoValida();
    if (
      Math.min(width, height) < FOTO_LADO_MINIMO ||
      Math.max(width, height) > FOTO_LADO_MAXIMO ||
      width * height > FOTO_PIXELES_MAXIMOS
    ) {
      throw imagenNoValida();
    }
    return await imagen
      .rotate()
      .resize({ width: ladoMaximo, height: ladoMaximo, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: CALIDAD_JPEG, mozjpeg: true })
      .toBuffer();
  } catch {
    throw imagenNoValida();
  }
}
