import { describe, expect, it } from 'vitest';
import { cambiosPedidosClase, esReactivacion, ordenDeClases } from './clase';

const ENTRENADOR = '3f2b8f0e-6a6c-4c1e-9a53-0d1c2b3a4e5f';
const OTRO = '9a1c7e2d-4b5f-4c3a-8d6e-1f2a3b4c5d6e';
const GUARDADA = { entrenadorId: ENTRENADOR, aforo: 30, activo: true };

describe('cambiosPedidosClase (criterio 21)', () => {
  it('lo que ya vale no es un cambio, aunque el entrenador venga en mayúsculas', () => {
    expect(cambiosPedidosClase(GUARDADA, { aforo: 30 }).campos).toEqual([]);
    expect(cambiosPedidosClase(GUARDADA, { activo: true }).campos).toEqual([]);
    expect(cambiosPedidosClase(GUARDADA, { entrenadorId: ENTRENADOR.toUpperCase() }).campos).toEqual([]);
  });

  it('devuelve solo los campos que cambian, con antes y después, y la clase resultante', () => {
    const cambios = cambiosPedidosClase(GUARDADA, { entrenadorId: OTRO.toUpperCase(), aforo: 30, activo: false });

    expect(cambios.campos).toEqual(['entrenadorId', 'activo']);
    expect(cambios.antes).toEqual({ entrenadorId: ENTRENADOR, activo: true });
    expect(cambios.despues).toEqual({ entrenadorId: OTRO, activo: false });
    expect(cambios.resultante).toEqual({ entrenadorId: OTRO, aforo: 30, activo: false });
  });

  it('un cambio de aforo trae solo el aforo', () => {
    const cambios = cambiosPedidosClase(GUARDADA, { aforo: 25 });

    expect(cambios.antes).toEqual({ aforo: 30 });
    expect(cambios.despues).toEqual({ aforo: 25 });
  });
});

describe('esReactivacion', () => {
  it('solo una clase inactiva que queda activa', () => {
    const inactiva = { ...GUARDADA, activo: false };
    expect(esReactivacion(inactiva, { ...inactiva, activo: true })).toBe(true);
    expect(esReactivacion(GUARDADA, GUARDADA)).toBe(false);
    expect(esReactivacion(GUARDADA, { ...GUARDADA, activo: false })).toBe(false);
    expect(esReactivacion(inactiva, inactiva)).toBe(false);
  });
});

describe('ordenDeClases (criterio 24)', () => {
  it('ordena por día, hora de inicio, nivel (BASICO, INTERMEDIO, AVANZADO) y id', () => {
    const clases = [
      { id: 'd', diaSemana: 2, horaInicio: '08:00', nivel: 'BASICO' as const },
      { id: 'c', diaSemana: 1, horaInicio: '19:00', nivel: 'BASICO' as const },
      { id: 'b', diaSemana: 1, horaInicio: '09:00', nivel: 'AVANZADO' as const },
      { id: 'a', diaSemana: 1, horaInicio: '09:00', nivel: 'BASICO' as const },
      { id: 'f', diaSemana: 1, horaInicio: '09:00', nivel: 'INTERMEDIO' as const },
      { id: 'e', diaSemana: 1, horaInicio: '09:00', nivel: 'INTERMEDIO' as const },
    ];

    expect([...clases].sort(ordenDeClases).map((clase) => clase.id)).toEqual(['a', 'e', 'f', 'b', 'c', 'd']);
  });
});
