import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { firmarToken, verificarToken } from './tokens';

// Spec 002, criterio 6: los tokens de academia llevan, además de sub, tipo y ver, la academia (`aca`).

const SECRETO = randomBytes(32).toString('base64url');
const AHORA = new Date('2026-11-11T15:00:00.000Z');
const IAT = Math.floor(AHORA.getTime() / 1000);
const USUARIO = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ACADEMIA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function cuerpoDe(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;
}

describe('firmarToken con aca', () => {
  it('incluye aca cuando se indica y no lleva el DNI, el nombre ni el rol', () => {
    const token = firmarToken({ sub: USUARIO, tipo: 'academia', ver: 2, aca: ACADEMIA }, SECRETO, AHORA, 43_200);

    expect(cuerpoDe(token)).toEqual({
      sub: USUARIO,
      tipo: 'academia',
      ver: 2,
      aca: ACADEMIA,
      iat: IAT,
      exp: IAT + 43_200,
    });
  });

  it('sin aca no agrega el claim (la sesión de plataforma no cambia)', () => {
    const token = firmarToken({ sub: USUARIO, tipo: 'plataforma', ver: 0 }, SECRETO, AHORA, 100);

    expect(Object.keys(cuerpoDe(token))).not.toContain('aca');
  });
});

describe('verificarToken con aca', () => {
  it('devuelve aca cuando el token lo trae', () => {
    const token = firmarToken({ sub: USUARIO, tipo: 'academia', ver: 2, aca: ACADEMIA }, SECRETO, AHORA, 100);

    expect(verificarToken(token, SECRETO, AHORA)).toEqual({
      sub: USUARIO,
      tipo: 'academia',
      ver: 2,
      aca: ACADEMIA,
      iat: IAT,
      exp: IAT + 100,
    });
  });

  it('un token sin aca sigue siendo válido y no inventa el claim', () => {
    const token = firmarToken({ sub: USUARIO, tipo: 'plataforma', ver: 0 }, SECRETO, AHORA, 100);

    const claims = verificarToken(token, SECRETO, AHORA);

    expect(claims).not.toBeNull();
    expect(claims && 'aca' in claims).toBe(false);
  });

  it('un token cuyo aca no es un texto no es válido', () => {
    const token = firmarToken(
      { sub: USUARIO, tipo: 'academia', ver: 0, aca: 12345 as unknown as string },
      SECRETO,
      AHORA,
      100,
    );

    expect(verificarToken(token, SECRETO, AHORA)).toBeNull();
  });
});
