import { describe, expect, it } from 'vitest';
import { cupoLibre, cuposParaMostrar, hayCupo } from './cupo';

// Criterio 9 de la 010a (D-06, RN-11, DT-4): el cupo libre con los números ya contados.

const base = { aforo: 20, ocupacion: 0, reservas: 0, esTitular: false, esMesSiguiente: true };

describe('cupoLibre', () => {
  it('mes siguiente: aforo − ocupación − reservas', () => {
    expect(cupoLibre({ ...base, ocupacion: 1, reservas: 19 })).toBe(0);
    expect(cupoLibre({ ...base, reservas: 19 })).toBe(1);
    expect(cupoLibre({ ...base, ocupacion: 15, reservas: 5 })).toBe(0);
  });

  it('mes siguiente: al titular las reservas no le restan (criterio 44): aforo − ocupación', () => {
    expect(cupoLibre({ ...base, reservas: 20, esTitular: true })).toBe(20);
    expect(cupoLibre({ ...base, ocupacion: 1, reservas: 20, esTitular: true })).toBe(19);
    expect(cupoLibre({ ...base, reservas: 20 })).toBe(0);
    expect(cupoLibre({ ...base, ocupacion: 20, reservas: 0, esTitular: true })).toBe(0);
  });

  it('mes siguiente: con más titulares que lugares (20 titulares, 19 lugares) el titular entra mientras quede un lugar', () => {
    expect(hayCupo({ ...base, ocupacion: 19, reservas: 20, esTitular: true })).toBe(true);
    expect(hayCupo({ ...base, ocupacion: 20, reservas: 20, esTitular: true })).toBe(false);
    expect(hayCupo({ ...base, ocupacion: 1, reservas: 20 })).toBe(false);
  });

  it('mes en curso: aforo − ocupación; ni las reservas ni la titularidad cuentan', () => {
    const enCurso = { ...base, esMesSiguiente: false };
    expect(cupoLibre({ ...enCurso, ocupacion: 19, reservas: 19 })).toBe(1);
    expect(cupoLibre({ ...enCurso, ocupacion: 19, reservas: 19, esTitular: true })).toBe(1);
    expect(cupoLibre({ ...enCurso, ocupacion: 20 })).toBe(0);
  });

  it('con el aforo bajado por debajo de los inscritos (DR-5) puede dar menos de 0 y no hay cupo para nadie', () => {
    // Aforo 20 con 25 matrículas de diciembre y 10 titulares sin renovar: 20 − 25 = −5 (al titular no le restan las reservas).
    const entrada = { ...base, ocupacion: 25, reservas: 10, esTitular: true };
    expect(cupoLibre(entrada)).toBe(-5);
    expect(hayCupo(entrada)).toBe(false);
    expect(cuposParaMostrar(entrada)).toBe(0);
  });

  it('hay cupo con 1 o más', () => {
    expect(hayCupo({ ...base, reservas: 19 })).toBe(true);
    expect(hayCupo({ ...base, reservas: 20 })).toBe(false);
    expect(cuposParaMostrar({ ...base, reservas: 15 })).toBe(5);
  });
});
