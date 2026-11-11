import { describe, expect, it } from 'vitest';
import { errorApiSchema, type ErrorApi } from './index';

describe('errorApiSchema', () => {
  it('acepta un error sin detalles', () => {
    const error: ErrorApi = { codigo: 'NO_ENCONTRADO', mensaje: 'No se encontró el recurso solicitado.' };
    expect(errorApiSchema.parse(error)).toEqual(error);
  });

  it('acepta un error con detalles de cualquier forma', () => {
    expect(
      errorApiSchema.safeParse({ codigo: 'ERROR_INTERNO', mensaje: 'Falló.', detalles: { campo: ['obligatorio'] } })
        .success,
    ).toBe(true);
  });

  it.each([
    ['sin mensaje', { codigo: 'NO_ENCONTRADO' }],
    ['mensaje vacío', { codigo: 'NO_ENCONTRADO', mensaje: '' }],
    ['código en minúsculas', { codigo: 'no_encontrado', mensaje: 'x' }],
    ['código con espacios', { codigo: 'NO ENCONTRADO', mensaje: 'x' }],
    ['sin código', { mensaje: 'x' }],
    ['no es un objeto', 'error'],
  ])('rechaza un error inválido (%s)', (_nombre, valor) => {
    expect(errorApiSchema.safeParse(valor).success).toBe(false);
  });
});
