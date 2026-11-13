// spec: 001-academias-aislamiento (pruebas protegidas)
import { VIAS_DEL_SERVIDOR, registrarPruebasDeCadenas } from '../utilidades/cadenas-estandar';

// Criterio 122 (ataque ronda 5, O3), vias que cambian valores compartidos con otras conexiones:
//   (c) ALTER DATABASE <base de pruebas> SET standard_conforming_strings = off (si el dueno puede; si no, se omite con aviso);
//   (d) ALTER ROLE ALL SET ... y ALTER ROLE ALL IN DATABASE <base> SET ... (exigen superusuario: en la nube se omiten con aviso);
//   (e) el archivo de configuracion del servidor, simulado con ALTER SYSTEM SET ... y pg_reload_conf() (solo superusuario).
// Corren en serie y despues de todos los demas proyectos que usan PostgreSQL (proyecto `backend-aislado` de vitest.config.mts,
// `sequence.groupOrder` 3). Cada via se restaura al final, tambien si la prueba falla. Las pruebas son las mismas que las de las
// vias locales (integracion/aislamiento/cadenas-estandar.test.ts).
registrarPruebasDeCadenas(VIAS_DEL_SERVIDOR);
