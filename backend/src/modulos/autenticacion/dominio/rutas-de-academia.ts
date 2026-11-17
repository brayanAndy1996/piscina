/**
 * Qué rutas de la API son "de academia" (spec 002, contrato): todo lo que está bajo el prefijo `/api` salvo `/api/salud`,
 * `/api/plataforma/…` y `/api/a/…`. Toda ruta de academia exige una sesión de academia (cookie `aq_sesion`); las otras tienen su
 * propia regla. Funciones puras sobre la ruta relativa al prefijo (`/usuarios`, `/sesion/clave`).
 *
 * La clasificación falla cerrada: solo se exime lo que coincide exactamente con uno de los tres prefijos (sin distinguir
 * mayúsculas, como el enrutador de Express); cualquier otra cosa, incluidas las rutas que no existen, exige sesión.
 */
const NO_ES_DE_ACADEMIA = /^\/(?:salud|plataforma|a)(?:\/|$)/i;
const SESION = /^\/sesion\/?$/i;
const CAMBIO_DE_CLAVE = /^\/sesion\/clave\/?$/i;

export function esRutaDeAcademia(rutaBajoElPrefijo: string): boolean {
  return !NO_ES_DE_ACADEMIA.test(rutaBajoElPrefijo);
}

/** `DELETE /api/sesion`: cerrar la sesión no exige una sesión válida (criterio 17). */
export function esCierreDeSesion(metodo: string, rutaBajoElPrefijo: string): boolean {
  return metodo === 'DELETE' && SESION.test(rutaBajoElPrefijo);
}

/**
 * Lo único que se puede hacer con el cambio de contraseña pendiente (criterio 21): ver la sesión (`GET /api/sesion`), cerrarla
 * (`DELETE /api/sesion`, aparte) y cambiar la contraseña (`POST /api/sesion/clave`).
 */
export function esRutaPermitidaConCambioPendiente(metodo: string, rutaBajoElPrefijo: string): boolean {
  return (
    esCierreDeSesion(metodo, rutaBajoElPrefijo) ||
    (metodo === 'GET' && SESION.test(rutaBajoElPrefijo)) ||
    (metodo === 'POST' && CAMBIO_DE_CLAVE.test(rutaBajoElPrefijo))
  );
}
