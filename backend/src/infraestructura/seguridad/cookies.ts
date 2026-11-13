import type { CookieOptions } from 'express';

/** Nombre de la cookie de sesión de la plataforma (Superadmin). */
export const NOMBRE_COOKIE_PLATAFORMA = 'aq_plataforma';

/** La cookie solo se envía a las rutas de la plataforma: nunca llega a las de las academias. */
export const RUTA_COOKIE_PLATAFORMA = '/api/plataforma';

/** Nombre de la cookie de sesión de los usuarios de una academia (spec 002). Una sola por navegador (DT-3). */
export const NOMBRE_COOKIE_ACADEMIA = 'aq_sesion';

/** La cookie de academia vale en toda la API, salvo en la plataforma, que no la lee (criterio 19). */
export const RUTA_COOKIE_ACADEMIA = '/api';

/**
 * Lee el valor de una cookie de la cabecera `Cookie`. Devuelve el primer valor con ese nombre, o `undefined`. Se lee a
 * mano para no depender de un middleware global: la sesión solo se busca en la cookie y nunca en `Authorization`.
 */
export function leerCookie(cabecera: string | undefined, nombre: string): string | undefined {
  if (!cabecera) return undefined;
  for (const parte of cabecera.split(';')) {
    const igual = parte.indexOf('=');
    if (igual < 0 || parte.slice(0, igual).trim() !== nombre) continue;
    let valor = parte.slice(igual + 1).trim();
    if (valor.length >= 2 && valor.startsWith('"') && valor.endsWith('"')) valor = valor.slice(1, -1);
    try {
      return decodeURIComponent(valor);
    } catch {
      return valor;
    }
  }
  return undefined;
}

/**
 * Atributos de la cookie de plataforma: `HttpOnly`, `SameSite=Strict`, `Path=/api/plataforma` y, con
 * `NODE_ENV=production`, `Secure` (fuera de producción no, para poder usar `http://localhost`).
 */
export function opcionesCookiePlataforma(nodeEnv: string | undefined): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: RUTA_COOKIE_PLATAFORMA,
    secure: nodeEnv === 'production',
  };
}

/**
 * Atributos de la cookie de sesión de academia: `HttpOnly`, `SameSite=Strict`, `Path=/api` y, con `NODE_ENV=production`, `Secure`.
 * La duración (`maxAge`) la pone quien responde, según el rol (criterio 5).
 */
export function opcionesCookieAcademia(nodeEnv: string | undefined): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: RUTA_COOKIE_ACADEMIA,
    secure: nodeEnv === 'production',
  };
}
