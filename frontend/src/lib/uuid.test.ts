import { afterEach, describe, expect, it, vi } from 'vitest';
import { nuevaClaveUuid } from './uuid';

const PATRON = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('nuevaClaveUuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('da un UUID v4 distinto cada vez', () => {
    const claves = new Set(Array.from({ length: 50 }, () => nuevaClaveUuid()));
    expect(claves.size).toBe(50);
    for (const clave of claves) expect(clave).toMatch(PATRON);
  });

  it('sin randomUUID (contexto no seguro) también da un UUID v4', () => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => original.getRandomValues(bytes),
    });
    expect(nuevaClaveUuid()).toMatch(PATRON);
  });
});
