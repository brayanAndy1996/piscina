/**
 * La foto opcional de la solicitud de inscripción (spec 005b, criterios 34 a 37; PB4; D-20, D-24). Las constantes las usan la API (que
 * decide) y la web (que avisa antes de subir): una sola fuente.
 */

/** Tipos de medio que acepta la subida: JPEG o PNG. */
export const FOTO_TIPOS = ['image/jpeg', 'image/png'] as const;
export type FotoTipo = (typeof FOTO_TIPOS)[number];

/** 5 MB: 5 242 880 bytes exactos pasan; un byte más es 413 `CARGA_EXCESIVA`. */
export const FOTO_TAMANO_MAXIMO = 5 * 1024 * 1024;

/** Lado menor y mayor admitidos, en píxeles, tal como vienen en el archivo (antes de aplicar la orientación). Incluyen el borde. */
export const FOTO_LADO_MINIMO = 100;
export const FOTO_LADO_MAXIMO = 8000;

/** Megapíxeles máximos de la imagen subida (40 000 000 de píxeles). */
export const FOTO_PIXELES_MAXIMOS = 40_000_000;

/** Lado mayor de la foto que se guarda, en píxeles (sin agrandar una imagen más chica). */
export const FOTO_LADO_GUARDADO = 800;

/** Cabecera con el token de la solicitud en `PUT /api/a/{nombreCorto}/solicitudes/foto`. */
export const CABECERA_TOKEN_SOLICITUD = 'X-Token-Solicitud';
