import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sinControles, textoVisibleSchema, tieneControles } from './texto';

describe('tieneControles', () => {
  it.each(['\u0000', '\t', '\n', '\r', '\u007f', '\u0085', '\u009f', '\ud800', '\udc00'])(
    'detecta el control o el sustituto suelto %j',
    (c) => {
      expect(tieneControles(`a${c}b`)).toBe(true);
    },
  );

  it.each(['Academia Ñandú', 'Club 3', '😀', 'a​b', '‮', 'Del fines'])('acepta %j', (texto) => {
    expect(tieneControles(texto)).toBe(false);
  });
});

describe('sinControles', () => {
  it('conserva el tipo de esquema para seguir encadenando y rechaza controles', () => {
    const esquema = sinControles(z.string().min(1)).pipe(z.string().max(5));

    expect(esquema.safeParse('abc').success).toBe(true);
    expect(esquema.safeParse('a\nb').success).toBe(false);
  });
});

describe('textoVisibleSchema', () => {
  const esquema = textoVisibleSchema({ sujeto: 'El texto', min: 3, max: 10 });

  it('recorta y guarda el valor tal como llega', () => {
    expect(esquema.parse('  Club 3 ')).toBe('Club 3');
  });

  it.each(['Delfines‮', '⁦Delfines⁩', 'Del fi', 'Del fi', 'Del\nfi', 'Del\ud800fi'])('rechaza %j', (texto) => {
    expect(esquema.safeParse(texto).success).toBe(false);
  });

  it.each(['​'.repeat(4), 'a​b', 'a b', 'áb', 'ab‍‍'])('rechaza %j: menos de 3 caracteres visibles', (texto) => {
    expect(esquema.safeParse(texto).success).toBe(false);
  });

  it('respeta el largo mínimo y máximo con los mensajes del sujeto', () => {
    const corto = esquema.safeParse('ab');
    const largo = esquema.safeParse('abcdefghijk');

    expect(corto.error?.issues[0]?.message).toBe('El texto debe tener al menos 3 caracteres.');
    expect(largo.error?.issues[0]?.message).toBe('El texto debe tener como máximo 10 caracteres.');
  });

  it.each(['Academia', 'Club 3', 'A.1', '😀😀😀'])('acepta %j', (texto) => {
    expect(esquema.safeParse(texto).success).toBe(true);
  });
});
