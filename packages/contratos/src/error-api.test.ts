import { describe, expect, it } from 'vitest';
import { detallesValidacionSchema, errorApiSchema, type ErrorApi } from './index';

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

describe('detallesValidacionSchema (criterio 66)', () => {
  it('acepta una lista de errores con campo y mensaje, también con campo vacío para el cuerpo entero', () => {
    const detalles = {
      errores: [
        { campo: 'nombreCorto', mensaje: 'El nombre corto no es válido.' },
        { campo: 'datos.nombre', mensaje: 'Obligatorio.' },
        { campo: '', mensaje: 'El cuerpo no es válido.' },
      ],
    };
    expect(detallesValidacionSchema.parse(detalles)).toEqual(detalles);
    expect(detallesValidacionSchema.parse({ errores: [] })).toEqual({ errores: [] });
  });

  it.each([
    ['sin errores', {}],
    ['errores que no es una lista', { errores: 'x' }],
    ['un error sin mensaje', { errores: [{ campo: 'a' }] }],
    ['un error sin campo', { errores: [{ mensaje: 'x' }] }],
    ['un campo que no es texto', { errores: [{ campo: 1, mensaje: 'x' }] }],
  ])('rechaza detalles %s', (_nombre, valor) => {
    expect(detallesValidacionSchema.safeParse(valor).success).toBe(false);
  });

  it('un ErrorApi con detalles de validación cumple ambos esquemas', () => {
    const error = {
      codigo: 'SOLICITUD_INVALIDA',
      mensaje: 'La solicitud no es válida.',
      detalles: { errores: [{ campo: 'correo', mensaje: 'El correo no es válido.' }] },
    };
    expect(errorApiSchema.safeParse(error).success).toBe(true);
    expect(detallesValidacionSchema.safeParse(error.detalles).success).toBe(true);
  });
});
