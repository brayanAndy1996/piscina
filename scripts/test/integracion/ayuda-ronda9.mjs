// spec: 001-academias-aislamiento (pruebas protegidas)
// Ayuda de las pruebas protegidas de la ronda 9 del ataque (criterio 148). No es una prueba: la importan los archivos `*.test.mjs` de
// esta carpeta.
//
// Criterio 148 (ataque ronda 9, O1): `db:crear` y el hook de sesion comparan el servidor, el puerto y la base de `DATABASE_URL_APP` con los
// de `DATABASE_URL`. Las pruebas protegidas anteriores usaban una `DATABASE_URL_APP` sobre `.../aquagestion` mientras `DATABASE_URL`
// apuntaba a una base temporal (antes `db:crear` solo tomaba de la app el usuario y la contrasena). Esta funcion adapta la URL de la app de cada
// caso a la `DATABASE_URL` del caso sin cambiar nada mas.

/**
 * `urlApp` con el servidor, el puerto y la base de `urlDesarrollo`. No cambia el usuario, la contrasena ni la cadena de consulta de
 * `urlApp` (a diferencia de `urlAppSobre`, que conserva la cadena de consulta de la otra URL). Un valor vacio o ausente se devuelve tal
 * cual (los casos que prueban que falta `DATABASE_URL_APP`).
 */
export function urlAppAlineada(urlApp, urlDesarrollo) {
  if (!urlApp) return urlApp;
  const app = new URL(urlApp);
  const desarrollo = new URL(urlDesarrollo);
  app.hostname = desarrollo.hostname;
  app.port = desarrollo.port;
  app.pathname = desarrollo.pathname;
  return app.toString();
}
