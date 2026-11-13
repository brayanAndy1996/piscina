import { describe, expect, it } from 'vitest';
import { esCierreDeSesion, esRutaDeAcademia, esRutaPermitidaConCambioPendiente } from './rutas-de-academia';

describe('esRutaDeAcademia (contrato de la spec 002)', () => {
  it.each([
    '/sesion',
    '/sesion/',
    '/sesion/clave',
    '/usuarios',
    '/usuarios/',
    '/usuarios/buscar-por-dni',
    '/usuarios/3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f/desactivar',
    '/no-existe',
    '/',
    '//usuarios',
    '/Sesion',
    '/USUARIOS',
    '/salud-publica',
    '/plataformas',
    '/ab',
    '/%73alud',
  ])('%s es una ruta de academia (exige sesión)', (ruta) => {
    expect(esRutaDeAcademia(ruta)).toBe(true);
  });

  it.each([
    '/salud',
    '/salud/',
    '/SALUD',
    '/plataforma',
    '/plataforma/sesion',
    '/plataforma/academias/3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f/administradores',
    '/Plataforma/academias',
    '/a',
    '/a/delfines',
    '/a/delfines/sesion',
    '/A/delfines/sesion',
  ])('%s no es una ruta de academia (salud, plataforma y /a)', (ruta) => {
    expect(esRutaDeAcademia(ruta)).toBe(false);
  });
});

describe('esCierreDeSesion', () => {
  it.each(['/sesion', '/sesion/', '/SESION'])('DELETE %s cierra la sesión', (ruta) => {
    expect(esCierreDeSesion('DELETE', ruta)).toBe(true);
  });

  it.each([
    ['GET', '/sesion'],
    ['POST', '/sesion'],
    ['DELETE', '/sesion/clave'],
    ['DELETE', '/usuarios'],
    ['DELETE', '/sesiones'],
    ['DELETE', '/sesion/otra'],
  ])('%s %s no es el cierre de sesión', (metodo, ruta) => {
    expect(esCierreDeSesion(metodo, ruta)).toBe(false);
  });
});

describe('esRutaPermitidaConCambioPendiente (criterio 21)', () => {
  it.each([
    ['GET', '/sesion'],
    ['GET', '/sesion/'],
    ['DELETE', '/sesion'],
    ['POST', '/sesion/clave'],
    ['POST', '/sesion/clave/'],
    ['POST', '/Sesion/Clave'],
  ])('%s %s se permite', (metodo, ruta) => {
    expect(esRutaPermitidaConCambioPendiente(metodo, ruta)).toBe(true);
  });

  it.each([
    ['GET', '/usuarios'],
    ['POST', '/usuarios'],
    ['POST', '/sesion'],
    ['GET', '/sesion/clave'],
    ['HEAD', '/sesion'],
    ['PUT', '/sesion'],
    ['POST', '/usuarios/buscar-por-dni'],
    ['GET', '/no-existe'],
  ])('%s %s no se permite', (metodo, ruta) => {
    expect(esRutaPermitidaConCambioPendiente(metodo, ruta)).toBe(false);
  });
});
