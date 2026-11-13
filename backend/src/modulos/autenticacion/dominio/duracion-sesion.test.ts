import { describe, expect, it } from 'vitest';
import {
  DURACION_SESION_ALUMNO_SEGUNDOS,
  DURACION_SESION_PERSONAL_SEGUNDOS,
  duracionSesionSegundos,
} from './duracion-sesion';

describe('duracionSesionSegundos (criterio 5, DR-8)', () => {
  it.each(['ADMIN', 'SECRETARIA', 'ENTRENADOR'] as const)('el personal (%s) tiene 12 horas', (rol) => {
    expect(duracionSesionSegundos(rol)).toBe(43_200);
    expect(DURACION_SESION_PERSONAL_SEGUNDOS).toBe(12 * 60 * 60);
  });

  it('el alumno tiene 30 días', () => {
    expect(duracionSesionSegundos('ALUMNO')).toBe(2_592_000);
    expect(DURACION_SESION_ALUMNO_SEGUNDOS).toBe(30 * 24 * 60 * 60);
  });
});
