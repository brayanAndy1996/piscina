import { FOTO_TAMANO_MAXIMO } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import { avisoDeArchivo, FOTO_ACCEPT, MENSAJE_FOTO_PESO, MENSAJE_FOTO_TIPO } from './validacion';

// Spec 005b, criterios 43 y 44 (PB14): el aviso de tipo y de peso se da antes de subir, con los límites de `fotos.ts`.

describe('aviso de la foto antes de subirla', () => {
  it.each(['image/jpeg', 'image/png'])('%s se acepta', (type) => {
    expect(avisoDeArchivo({ type, size: 1000 })).toBeNull();
  });

  it.each(['image/gif', 'image/webp', 'image/jpg', 'application/pdf', 'text/plain', ''])(
    '%s no es JPG ni PNG',
    (type) => {
      expect(avisoDeArchivo({ type, size: 1000 })).toBe(MENSAJE_FOTO_TIPO);
    },
  );

  it('5 242 880 bytes pasan y 5 242 881 no', () => {
    expect(FOTO_TAMANO_MAXIMO).toBe(5_242_880);
    expect(avisoDeArchivo({ type: 'image/png', size: 5_242_880 })).toBeNull();
    expect(avisoDeArchivo({ type: 'image/png', size: 5_242_881 })).toBe(MENSAJE_FOTO_PESO);
    expect(MENSAJE_FOTO_PESO).toContain('5 MB');
  });

  it('el selector acepta solo JPG y PNG', () => {
    expect(FOTO_ACCEPT).toBe('image/jpeg,image/png');
  });
});
