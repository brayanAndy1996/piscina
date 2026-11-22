import { describe, expect, it } from 'vitest';
import { tieneBidiOSeparadores } from './texto';

describe('tieneBidiOSeparadores', () => {
  it.each(['؜', '‎', '‏', '‪', '‮', '⁦', '⁩', ' ', ' '])('detecta el carácter %j', (caracter) => {
    expect(tieneBidiOSeparadores(`B001${caracter}321`)).toBe(true);
  });

  it.each(['', 'B001-123', 'Compra de útiles', '​', 'ㅤ', 'é'])('no detecta nada en %j', (texto) => {
    expect(tieneBidiOSeparadores(texto)).toBe(false);
  });
});
