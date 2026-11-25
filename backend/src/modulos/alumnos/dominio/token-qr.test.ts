import { PATRON_TOKEN_QR, tokenDelContenidoQr, contenidoQr } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import { nuevoTokenQr } from './token-qr';

// Spec 008a, criterio 3 (prueba no protegida): el token son 32 bytes al azar en base64url, 43 caracteres, y el contenido del QR lo lee de vuelta.

describe('nuevoTokenQr', () => {
  it('da 43 caracteres de base64url sin relleno y 32 bytes', () => {
    for (let i = 0; i < 200; i += 1) {
      const token = nuevoTokenQr();
      expect(token).toMatch(PATRON_TOKEN_QR);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('no repite tokens', () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => nuevoTokenQr()));
    expect(tokens.size).toBe(2000);
  });

  it('el contenido del QR se lee de vuelta con tokenDelContenidoQr', () => {
    const token = nuevoTokenQr();
    expect(tokenDelContenidoQr(contenidoQr(token))).toBe(token);
  });
});
