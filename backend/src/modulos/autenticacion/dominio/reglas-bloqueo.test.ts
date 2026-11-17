import { describe, expect, it } from 'vitest';
import { estaBloqueado, evaluarIntentoFallido } from '../../academias/dominio/bloqueo';
import { REGLAS_BLOQUEO_USUARIO } from './reglas-bloqueo';

const AHORA = new Date('2026-11-11T15:00:00.000Z');

describe('REGLAS_BLOQUEO_USUARIO (criterio 9, DR-3)', () => {
  it('son 5 intentos y 15 minutos', () => {
    expect(REGLAS_BLOQUEO_USUARIO).toEqual({ maximoIntentos: 5, minutosBloqueo: 15 });
  });

  it('los 4 primeros fallos no bloquean y el 5.º bloquea 15 minutos', () => {
    for (let intentos = 0; intentos < 4; intentos++) {
      const resultado = evaluarIntentoFallido(
        { intentosFallidos: intentos, bloqueadoHasta: null },
        AHORA,
        REGLAS_BLOQUEO_USUARIO,
      );
      expect(resultado).toMatchObject({ tipo: 'FALLO', bloquea: false });
    }
    const quinto = evaluarIntentoFallido({ intentosFallidos: 4, bloqueadoHasta: null }, AHORA, REGLAS_BLOQUEO_USUARIO);
    expect(quinto).toMatchObject({
      tipo: 'FALLO',
      bloquea: true,
      estado: { intentosFallidos: 5, bloqueadoHasta: new Date('2026-11-11T15:15:00.000Z') },
    });
  });

  it('el bloqueo dura hasta el minuto 15 exacto (a esa hora ya no está bloqueada)', () => {
    const bloqueadoHasta = new Date(AHORA.getTime() + 15 * 60_000);
    expect(estaBloqueado({ intentosFallidos: 5, bloqueadoHasta }, new Date(bloqueadoHasta.getTime() - 1))).toBe(true);
    expect(estaBloqueado({ intentosFallidos: 5, bloqueadoHasta }, bloqueadoHasta)).toBe(false);
  });
});
