import { describe, expect, it } from 'vitest';
import { hashearClave, obtenerHashFicticio, verificarClave } from './claves';

describe('claves (argon2id)', () => {
  it('hashea con argon2id y una sal distinta cada vez, sin incluir la clave', async () => {
    const [uno, otro] = await Promise.all([hashearClave('Clave-Segura-2026'), hashearClave('Clave-Segura-2026')]);

    expect(uno.startsWith('$argon2id$')).toBe(true);
    expect(uno).not.toBe(otro);
    expect(uno).not.toContain('Clave-Segura-2026');
  });

  it('verifica la clave correcta y rechaza una equivocada', async () => {
    const hash = await hashearClave('Clave-Segura-2026');

    expect(await verificarClave(hash, 'Clave-Segura-2026')).toBe(true);
    expect(await verificarClave(hash, 'clave-segura-2026')).toBe(false);
    expect(await verificarClave(hash, '')).toBe(false);
  });

  it('un hash con formato inválido no valida nada y no lanza', async () => {
    expect(await verificarClave('esto-no-es-un-hash', 'cualquiera')).toBe(false);
    expect(await verificarClave('', 'cualquiera')).toBe(false);
  });

  it('el hash ficticio se calcula una sola vez, es argon2id y no coincide con claves comunes', async () => {
    const primero = obtenerHashFicticio();
    expect(obtenerHashFicticio()).toBe(primero);
    const hash = await primero;

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verificarClave(hash, 'password')).toBe(false);
  });
});
