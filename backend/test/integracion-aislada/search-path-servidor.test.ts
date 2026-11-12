// spec: 001-academias-aislamiento (pruebas protegidas)
import { VIAS_DEL_SERVIDOR, registrarPruebasDeSearchPath } from '../utilidades/search-path';

// Criterio 121 (ataque ronda 5, F2 (a) y (c)), vias que cambian valores compartidos con otras conexiones:
//   (c) ALTER DATABASE <base de pruebas> SET search_path ... (si el dueno puede; si no, se omite con aviso);
//   (d) ALTER ROLE ALL SET search_path ... y ALTER ROLE ALL IN DATABASE <base> SET search_path ... (exigen superusuario: en la
//       nube se omiten con aviso; corren en Docker y en la CI).
// Corren en serie y despues de todos los demas proyectos que usan PostgreSQL (proyecto `backend-aislado` de vitest.config.mts,
// `sequence.groupOrder` 3), sin dejar de formar parte de `npm test`, para que ninguna otra conexion de la suite vea un
// `search_path` distinto mientras dura la contaminacion. Cada via se restaura al final, tambien si la prueba falla. Las pruebas son
// las mismas que las de las vias locales (integracion/aislamiento/search-path.test.ts).
registrarPruebasDeSearchPath(VIAS_DEL_SERVIDOR);
