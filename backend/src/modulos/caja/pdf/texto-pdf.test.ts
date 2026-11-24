import { describe, expect, it } from 'vitest';
import { textoParaPdf } from './texto-pdf';

// Spec 006b, PQ11 (prueba no protegida; las protegidas están en `pdf-texto.test.ts`): `textoParaPdf` normaliza a NFC y reemplaza por `?`, uno por
// punto de código, todo lo que no esté entre U+0020 y U+007E ni entre U+00A0 y U+00FF.

describe('textoParaPdf', () => {
  it.each([
    ['Piña', 'Piña'],
    ['Ñandú', 'Ñandú'],
    ['é', 'é'],
    ['\u{1F600}', '?'],
    ['Ω', '?'],
    ['’', '?'],
    ['B​1', 'B?1'],
    ['a b­c', 'a b­c'],
    ['a\tb\nc\rd', 'a?b?c?d'],
    ['a\uD800b', 'a?b'],
    ['', ''],
  ])('%j sale %j', (entrada, esperado) => {
    expect(textoParaPdf(entrada)).toBe(esperado);
  });

  it('es idempotente y solo deja caracteres de U+0020 a U+007E y de U+00A0 a U+00FF', () => {
    const todo = Array.from({ length: 0x3000 }, (_, i) => String.fromCharCode(i)).join('') + '\u{1F600}\u{10FFFF}';

    const una = textoParaPdf(todo);

    expect(textoParaPdf(una)).toBe(una);
    expect([...una].every((c) => (c >= ' ' && c <= '~') || (c >= '\u00A0' && c <= '\u00FF'))).toBe(true);
  });
});
