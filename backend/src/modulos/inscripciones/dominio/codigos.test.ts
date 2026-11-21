import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashDeToken, nuevoCodigo, nuevoToken } from './codigos';

describe('nuevoCodigo (criterio 24)', () => {
  it('tiene el formato AQ- y 6 caracteres del alfabeto de Crockford, sin I, L, O ni U', () => {
    for (let i = 0; i < 500; i++) {
      const codigo = nuevoCodigo();
      expect(codigo).toMatch(/^AQ-[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(codigo.slice(3)).not.toMatch(/[ILOU]/);
    }
  });

  it('no repite en una muestra grande y usa todo el alfabeto', () => {
    const codigos = new Set<string>();
    const letras = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const codigo = nuevoCodigo();
      codigos.add(codigo);
      for (const letra of codigo.slice(3)) letras.add(letra);
    }
    expect(codigos.size).toBeGreaterThan(1990);
    expect(letras.size).toBe(32);
  });
});

describe('nuevoToken y hashDeToken (criterio 24)', () => {
  it('son 43 caracteres base64url de 32 bytes, distintos cada vez', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const token = nuevoToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      tokens.add(token);
    }
    expect(tokens.size).toBe(500);
  });

  it('el hash es el SHA-256 del token en hexadecimal (64 caracteres) y no contiene el token', () => {
    const token = nuevoToken();

    const hash = hashDeToken(token);

    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });
});
