import { FOTO_TAMANO_MAXIMO, FOTO_TIPOS } from '@aquagestion/contratos';

/** El peso máximo de la foto en megabytes, para decirlo en los mensajes (5 MB = 5 242 880 bytes). */
export const FOTO_MEGABYTES_MAXIMOS = FOTO_TAMANO_MAXIMO / (1024 * 1024);

export const MENSAJE_FOTO_TIPO = 'La foto debe ser un archivo JPG o PNG.';
export const MENSAJE_FOTO_PESO = `La foto pesa más de ${FOTO_MEGABYTES_MAXIMOS} MB. Elige una más liviana.`;

/** Valor del atributo `accept` del selector de archivos. */
export const FOTO_ACCEPT = FOTO_TIPOS.join(',');

/**
 * Lo que se le avisa a la persona antes de subir el archivo, sin llamar a la API (criterios 43 y 44 de 005, PB14): su tipo no está en
 * `FOTO_TIPOS` o pasa de `FOTO_TAMANO_MAXIMO` (5 242 880 bytes pasan; uno más, no). Las dimensiones las comprueba solo la API.
 */
export function avisoDeArchivo(archivo: Pick<File, 'type' | 'size'>): string | null {
  if (!(FOTO_TIPOS as readonly string[]).includes(archivo.type)) return MENSAJE_FOTO_TIPO;
  if (archivo.size > FOTO_TAMANO_MAXIMO) return MENSAJE_FOTO_PESO;
  return null;
}
