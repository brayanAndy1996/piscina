import { describe, expect, it } from 'vitest';
import { restriccionDeUnicidadViolada } from './errores-base';

// Criterio 32 (ronda 1): el nombre de la restricción violada sale de los campos estructurados del error, nunca del mensaje.

const delAdaptador = (causa: Record<string, unknown>) =>
  Object.assign(new Error('fallo'), {
    code: 'P2010',
    meta: { driverAdapterError: { name: 'DriverAdapterError', cause: causa } },
  });

describe('restriccionDeUnicidadViolada', () => {
  it('lee constraint.index de meta.driverAdapterError.cause (un $queryRaw de Prisma 7)', () => {
    const error = delAdaptador({
      originalCode: '23505',
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'clases_nivel_bloque_activo_key' },
    });

    expect(restriccionDeUnicidadViolada(error)).toBe('clases_nivel_bloque_activo_key');
  });

  it('lee constraint como texto del error del adaptador de PostgreSQL', () => {
    const error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'clases_entrenador_bloque_activo_key',
    });

    expect(restriccionDeUnicidadViolada(error)).toBe('clases_entrenador_bloque_activo_key');
  });

  it('no mira el mensaje: un mensaje con un nombre sin campo estructurado da null', () => {
    const error = delAdaptador({
      originalCode: '23505',
      originalMessage: 'duplicate key value violates unique constraint "clases_nivel_bloque_activo_key"',
    });

    expect(restriccionDeUnicidadViolada(error)).toBeNull();
  });

  it.each([
    [
      'un error que no es de unicidad',
      Object.assign(new Error('x'), { code: '23514', constraint: 'planes_precio_positivo' }),
    ],
    ['un Error común', new Error('clases_nivel_bloque_activo_key')],
    ['null', null],
    ['una cadena', 'clases_nivel_bloque_activo_key'],
  ])('%s da null', (_nombre, error) => {
    expect(restriccionDeUnicidadViolada(error)).toBeNull();
  });
});
