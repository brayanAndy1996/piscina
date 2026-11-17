import { describe, expect, it } from 'vitest';
import { leerCookie, NOMBRE_COOKIE_ACADEMIA, opcionesCookieAcademia, RUTA_COOKIE_ACADEMIA } from './cookies';

// Spec 002, criterios 5 y 19: la cookie de sesión de academia.

describe('opcionesCookieAcademia', () => {
  it('es HttpOnly, SameSite=Strict y Path=/api, sin Secure fuera de producción', () => {
    for (const entorno of [undefined, 'development', 'test']) {
      expect(opcionesCookieAcademia(entorno)).toEqual({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api',
        secure: false,
      });
    }
  });

  it('con NODE_ENV=production lleva Secure', () => {
    expect(opcionesCookieAcademia('production')).toEqual({
      httpOnly: true,
      sameSite: 'strict',
      path: '/api',
      secure: true,
    });
  });

  it('el nombre y la ruta son los del contrato', () => {
    expect(NOMBRE_COOKIE_ACADEMIA).toBe('aq_sesion');
    expect(RUTA_COOKIE_ACADEMIA).toBe('/api');
  });
});

describe('leerCookie con aq_sesion', () => {
  it('lee la cookie de academia sin confundirla con la de plataforma', () => {
    const cabecera = 'aq_plataforma=de-plataforma; aq_sesion=de-academia';

    expect(leerCookie(cabecera, NOMBRE_COOKIE_ACADEMIA)).toBe('de-academia');
    expect(leerCookie('aq_plataforma=solo', NOMBRE_COOKIE_ACADEMIA)).toBeUndefined();
  });
});
