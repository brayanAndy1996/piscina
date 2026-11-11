// spec: 001-academias-aislamiento (pruebas protegidas)
import { registrarPruebasDeFormato } from '../utilidades/formato-sesion';

// Criterio 107 (ataque ronda 4, F2), vias que cambian valores compartidos con otras conexiones:
//   (c) ALTER DATABASE <base de pruebas> SET ... (si el dueno puede; si no, se omite con aviso);
//   (d) ALTER ROLE ALL SET ... y ALTER ROLE ALL IN DATABASE <base> SET ... (exigen superusuario: en la nube se omiten con aviso;
//       corren en Docker y en la CI);
//   (e) el archivo de configuracion del servidor, simulado con ALTER SYSTEM SET ... y pg_reload_conf() (solo superusuario).
// Corren en serie y despues de todos los demas proyectos que usan PostgreSQL (proyecto `backend-aislado` de vitest.config.mts,
// `sequence.groupOrder` 3), sin dejar de formar parte de `npm test`, para que ninguna otra conexion de la suite vea un formato
// distinto mientras dura la contaminacion. Cada via se restaura al final, tambien si la prueba falla. Las pruebas son las mismas
// que las de las vias locales (formato-sesion.test.ts): bloqueo, listado con fechas, tipos leidos y current_setting.
registrarPruebasDeFormato(['base', 'roles', 'roles-base', 'servidor']);
