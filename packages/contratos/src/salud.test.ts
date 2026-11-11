import { describe, expect, it } from 'vitest';
import { respuestaSaludSchema, type RespuestaSalud } from './index';

describe('respuestaSaludSchema', () => {
  it('acepta la respuesta correcta', () => {
    const respuesta: RespuestaSalud = { estado: 'ok', baseDatos: 'ok' };
    expect(respuestaSaludSchema.parse(respuesta)).toEqual(respuesta);
  });

  it('acepta la respuesta de error', () => {
    expect(respuestaSaludSchema.safeParse({ estado: 'error', baseDatos: 'error' }).success).toBe(true);
  });

  it.each([
    ['sin campos', {}],
    ['sin baseDatos', { estado: 'ok' }],
    ['valor desconocido', { estado: 'ok', baseDatos: 'lenta' }],
    ['tipo incorrecto', { estado: true, baseDatos: 'ok' }],
    ['no es un objeto', 'ok'],
    ['nulo', null],
  ])('rechaza una respuesta inválida (%s)', (_nombre, valor) => {
    expect(respuestaSaludSchema.safeParse(valor).success).toBe(false);
  });
});
