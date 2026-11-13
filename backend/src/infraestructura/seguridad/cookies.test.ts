import { describe, expect, it } from 'vitest';
import { leerCookie, NOMBRE_COOKIE_PLATAFORMA, opcionesCookiePlataforma, RUTA_COOKIE_PLATAFORMA } from './cookies';

describe('leerCookie', () => {
  it.each([
    ['una sola cookie', 'aq_plataforma=abc', 'abc'],
    ['entre otras cookies', 'a=1; aq_plataforma=abc; b=2', 'abc'],
    ['con espacios alrededor', '  aq_plataforma = abc ;x=1', 'abc'],
    ['con comillas', 'aq_plataforma="abc"', 'abc'],
    ['con un valor codificado', 'aq_plataforma=a%20b', 'a b'],
    ['con un valor que no se puede decodificar', 'aq_plataforma=%E0%A4%A', '%E0%A4%A'],
    ['con valor vacío', 'aq_plataforma=', ''],
    ['repetida: la primera', 'aq_plataforma=uno; aq_plataforma=dos', 'uno'],
    ['con un signo igual en el valor', 'aq_plataforma=a=b', 'a=b'],
  ])('lee %s', (_caso, cabecera, esperado) => {
    expect(leerCookie(cabecera, NOMBRE_COOKIE_PLATAFORMA)).toBe(esperado);
  });

  it.each([
    ['sin cabecera', undefined],
    ['cabecera vacía', ''],
    ['otra cookie', 'otra=1'],
    ['un nombre que solo termina igual', 'xaq_plataforma=1'],
    ['un nombre que solo empieza igual', 'aq_plataforma2=1'],
    ['una parte sin signo igual', 'aq_plataforma'],
  ])('devuelve undefined con %s', (_caso, cabecera) => {
    expect(leerCookie(cabecera, NOMBRE_COOKIE_PLATAFORMA)).toBeUndefined();
  });
});

describe('opcionesCookiePlataforma', () => {
  it('es HttpOnly, SameSite=Strict y limitada a /api/plataforma, sin Secure fuera de producción', () => {
    for (const entorno of [undefined, 'development', 'test']) {
      expect(opcionesCookiePlataforma(entorno)).toEqual({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/plataforma',
        secure: false,
      });
    }
    expect(RUTA_COOKIE_PLATAFORMA).toBe('/api/plataforma');
  });

  it('con NODE_ENV=production agrega Secure', () => {
    expect(opcionesCookiePlataforma('production')).toMatchObject({ secure: true, httpOnly: true });
  });
});
