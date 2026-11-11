import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { firmarToken, verificarToken } from './tokens';

const SECRETO = 'secreto-de-prueba-con-mas-de-treinta-y-dos-caracteres';
const AHORA = new Date('2026-11-11T15:00:00.000Z');
const IAT = Math.floor(AHORA.getTime() / 1000);
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function base64url(texto: string): string {
  return Buffer.from(texto).toString('base64url');
}

function firmarCrudo(cabecera: object, claims: object, secreto = SECRETO): string {
  const cuerpo = `${base64url(JSON.stringify(cabecera))}.${base64url(JSON.stringify(claims))}`;
  return `${cuerpo}.${createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`;
}

const CLAIMS = { sub: ID, tipo: 'plataforma', ver: 3, iat: IAT, exp: IAT + 100 };

describe('firmarToken', () => {
  it('firma HS256 con iat de la hora recibida y exp = iat + duración', () => {
    const token = firmarToken({ sub: ID, tipo: 'plataforma', ver: 3 }, SECRETO, AHORA, 28_800);

    const [cabecera, cuerpo] = token.split('.');
    expect(JSON.parse(Buffer.from(cabecera ?? '', 'base64url').toString())).toMatchObject({ alg: 'HS256' });
    expect(JSON.parse(Buffer.from(cuerpo ?? '', 'base64url').toString())).toEqual({
      sub: ID,
      tipo: 'plataforma',
      ver: 3,
      iat: IAT,
      exp: IAT + 28_800,
    });
  });
});

describe('verificarToken', () => {
  it('acepta un token firmado por firmarToken', () => {
    const token = firmarToken({ sub: ID, tipo: 'plataforma', ver: 3 }, SECRETO, AHORA, 100);

    expect(verificarToken(token, SECRETO, AHORA)).toEqual(CLAIMS);
  });

  it('vale hasta un segundo antes de exp y deja de valer en exp, según la hora recibida', () => {
    const token = firmarToken({ sub: ID, tipo: 'plataforma', ver: 0 }, SECRETO, AHORA, 100);

    expect(verificarToken(token, SECRETO, new Date(AHORA.getTime() + 99_000))).not.toBeNull();
    expect(verificarToken(token, SECRETO, new Date(AHORA.getTime() + 100_000))).toBeNull();
    expect(verificarToken(token, SECRETO, new Date(AHORA.getTime() + 101_000))).toBeNull();
  });

  it.each([
    ['basura', () => 'no-es-un-jwt'],
    ['vacío', () => ''],
    [
      'otro secreto',
      () => firmarCrudo({ alg: 'HS256', typ: 'JWT' }, CLAIMS, 'otro-secreto-distinto-de-treinta-y-dos-caracteres'),
    ],
    ['alg none', () => `${base64url('{"alg":"none","typ":"JWT"}')}.${base64url(JSON.stringify(CLAIMS))}.`],
    ['otro algoritmo (HS512)', () => firmarCrudo({ alg: 'HS512', typ: 'JWT' }, CLAIMS)],
    [
      'firma alterada',
      () => {
        const [cabecera, cuerpo] = firmarCrudo({ alg: 'HS256', typ: 'JWT' }, CLAIMS).split('.');
        return `${cabecera}.${cuerpo}.${'A'.repeat(43)}`;
      },
    ],
    ['sin sub', () => firmarCrudo({ alg: 'HS256' }, { ...CLAIMS, sub: undefined })],
    ['sub que no es texto', () => firmarCrudo({ alg: 'HS256' }, { ...CLAIMS, sub: 7 })],
    ['sin tipo', () => firmarCrudo({ alg: 'HS256' }, { ...CLAIMS, tipo: undefined })],
    ['sin ver', () => firmarCrudo({ alg: 'HS256' }, { ...CLAIMS, ver: undefined })],
    ['ver fraccionario', () => firmarCrudo({ alg: 'HS256' }, { ...CLAIMS, ver: 1.5 })],
    ['ver como texto', () => firmarCrudo({ alg: 'HS256' }, { ...CLAIMS, ver: '3' })],
    ['sin exp (no vence nunca)', () => firmarCrudo({ alg: 'HS256' }, { ...CLAIMS, exp: undefined })],
    ['sin iat', () => firmarCrudo({ alg: 'HS256' }, { ...CLAIMS, iat: undefined })],
  ])('rechaza un token inválido: %s', (_caso, crear) => {
    expect(verificarToken(crear(), SECRETO, AHORA)).toBeNull();
  });
});
