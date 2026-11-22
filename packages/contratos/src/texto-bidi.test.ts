import { describe, expect, it } from 'vitest';
import { tieneBidiOSeparadores } from './texto';

describe('tieneBidiOSeparadores', () => {
  it.each(['\u061C', '\u200E', '\u200F', '\u202A', '\u202E', '\u2066', '\u2069', '\u2028', '\u2029'])(
    'detecta el carácter %j',
    (caracter) => {
      expect(tieneBidiOSeparadores(`B001${caracter}321`)).toBe(true);
    },
  );

  it.each(['', 'B001-123', 'Compra de útiles', '\u200B', '\u3164', 'e\u0301'])('no detecta nada en %j', (texto) => {
    expect(tieneBidiOSeparadores(texto)).toBe(false);
  });
});
