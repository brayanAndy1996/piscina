import { describe, expect, it } from 'vitest';
import {
  ESTADO_SIN_FALLOS,
  estaBloqueado,
  evaluarIntentoFallido,
  REGLAS_BLOQUEO_SUPERADMIN,
  type EstadoBloqueo,
} from './bloqueo';

const AHORA = new Date('2026-11-11T15:00:00.000Z');
const QUINCE_MINUTOS = 15 * 60 * 1000;

describe('REGLAS_BLOQUEO_SUPERADMIN', () => {
  it('son 5 intentos y 15 minutos (DR-3)', () => {
    expect(REGLAS_BLOQUEO_SUPERADMIN).toEqual({ maximoIntentos: 5, minutosBloqueo: 15 });
  });
});

describe('estaBloqueado', () => {
  it('sin fecha de bloqueo, no está bloqueada', () => {
    expect(estaBloqueado(ESTADO_SIN_FALLOS, AHORA)).toBe(false);
  });

  it('está bloqueada hasta un instante antes del plazo y deja de estarlo justo en el plazo', () => {
    const estado: EstadoBloqueo = { intentosFallidos: 5, bloqueadoHasta: new Date(AHORA.getTime() + 1) };
    expect(estaBloqueado(estado, AHORA)).toBe(true);
    expect(estaBloqueado({ ...estado, bloqueadoHasta: AHORA }, AHORA)).toBe(false);
    expect(estaBloqueado({ ...estado, bloqueadoHasta: new Date(AHORA.getTime() - 1) }, AHORA)).toBe(false);
  });
});

describe('evaluarIntentoFallido', () => {
  it.each([0, 1, 2, 3])('con %i fallos previos cuenta uno más y no bloquea', (previos) => {
    const resultado = evaluarIntentoFallido({ intentosFallidos: previos, bloqueadoHasta: null }, AHORA);
    expect(resultado).toEqual({
      tipo: 'FALLO',
      estado: { intentosFallidos: previos + 1, bloqueadoHasta: null },
      bloquea: false,
    });
  });

  it('el 5.º fallo bloquea 15 minutos y deja el contador en 5', () => {
    const resultado = evaluarIntentoFallido({ intentosFallidos: 4, bloqueadoHasta: null }, AHORA);
    expect(resultado).toEqual({
      tipo: 'FALLO',
      estado: { intentosFallidos: 5, bloqueadoHasta: new Date(AHORA.getTime() + QUINCE_MINUTOS) },
      bloquea: true,
    });
  });

  it('con la cuenta ya bloqueada no cambia nada', () => {
    const estado: EstadoBloqueo = { intentosFallidos: 5, bloqueadoHasta: new Date(AHORA.getTime() + 1000) };
    expect(evaluarIntentoFallido(estado, AHORA)).toEqual({ tipo: 'YA_BLOQUEADA' });
  });

  it('cumplido el bloqueo, el conteo vuelve a empezar desde 1', () => {
    const resultado = evaluarIntentoFallido({ intentosFallidos: 5, bloqueadoHasta: AHORA }, AHORA);
    expect(resultado).toEqual({
      tipo: 'FALLO',
      estado: { intentosFallidos: 1, bloqueadoHasta: null },
      bloquea: false,
    });
  });

  it('respeta reglas distintas', () => {
    const reglas = { maximoIntentos: 2, minutosBloqueo: 1 };
    const primero = evaluarIntentoFallido(ESTADO_SIN_FALLOS, AHORA, reglas);
    const segundo = evaluarIntentoFallido({ intentosFallidos: 1, bloqueadoHasta: null }, AHORA, reglas);
    expect(primero).toMatchObject({ bloquea: false });
    expect(segundo).toEqual({
      tipo: 'FALLO',
      estado: { intentosFallidos: 2, bloqueadoHasta: new Date(AHORA.getTime() + 60_000) },
      bloquea: true,
    });
  });

  it('no modifica el estado recibido', () => {
    const estado: EstadoBloqueo = { intentosFallidos: 4, bloqueadoHasta: null };
    evaluarIntentoFallido(estado, AHORA);
    expect(estado).toEqual({ intentosFallidos: 4, bloqueadoHasta: null });
  });
});
