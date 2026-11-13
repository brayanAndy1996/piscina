// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { estaBloqueado, evaluarIntentoFallido, type EstadoBloqueo } from './bloqueo';

// Criterio 108 (ataque ronda 4, F2; complementa los criterios 39 y 98) y precision P-27, parte unitaria: una fecha invalida
// leida de la base falla cerrada. `estaBloqueado(estado, ahora)` considera BLOQUEADA la cuenta si `bloqueadoHasta` no es nulo y
// no es un `Date` valido (incluido `new Date(NaN)`, o un valor que no es `Date`), o si `ahora` no es valido; y
// `evaluarIntentoFallido` con ese estado devuelve `YA_BLOQUEADA` sin cambiar nada. Las firmas no cambian.

const AHORA = new Date('2026-11-11T15:00:00.000Z');
const INVALIDA = new Date(Number.NaN);

describe('criterio 108: estaBloqueado falla cerrado con fechas invalidas', () => {
  it('criterio 108: bloqueadoHasta = new Date(NaN) esta bloqueada', () => {
    expect(estaBloqueado({ intentosFallidos: 5, bloqueadoHasta: INVALIDA }, AHORA)).toBe(true);
  });

  it('criterio 108: bloqueadoHasta = new Date(NaN) esta bloqueada aunque no haya intentos fallidos', () => {
    expect(estaBloqueado({ intentosFallidos: 0, bloqueadoHasta: INVALIDA }, AHORA)).toBe(true);
  });

  it.each([
    ['una fecha ISO en texto', '2026-11-11T14:00:00.000Z'],
    ['un numero', AHORA.getTime() - 1000],
    ['un objeto', {}],
    ['una cadena vacia', ''],
    ['un Date de otro tipo (objeto con getTime)', { getTime: () => 0 }],
  ])('criterio 108: bloqueadoHasta que no es un Date (%s) esta bloqueada', (_nombre, valor) => {
    const estado = { intentosFallidos: 5, bloqueadoHasta: valor } as unknown as EstadoBloqueo;

    expect(estaBloqueado(estado, AHORA)).toBe(true);
  });

  it('criterio 108: ahora invalido esta bloqueada, con o sin fecha de bloqueo', () => {
    expect(estaBloqueado({ intentosFallidos: 0, bloqueadoHasta: null }, INVALIDA)).toBe(true);
    expect(estaBloqueado({ intentosFallidos: 5, bloqueadoHasta: new Date(AHORA.getTime() - 1000) }, INVALIDA)).toBe(
      true,
    );
    expect(estaBloqueado({ intentosFallidos: 5, bloqueadoHasta: INVALIDA }, INVALIDA)).toBe(true);
  });

  it('criterio 108 (control): con fechas validas el resultado no cambia', () => {
    expect(estaBloqueado({ intentosFallidos: 0, bloqueadoHasta: null }, AHORA)).toBe(false);
    expect(estaBloqueado({ intentosFallidos: 5, bloqueadoHasta: new Date(AHORA.getTime() + 1) }, AHORA)).toBe(true);
    expect(estaBloqueado({ intentosFallidos: 5, bloqueadoHasta: AHORA }, AHORA)).toBe(false);
    expect(estaBloqueado({ intentosFallidos: 5, bloqueadoHasta: new Date(AHORA.getTime() - 1) }, AHORA)).toBe(false);
  });
});

describe('criterio 108: evaluarIntentoFallido con una fecha invalida devuelve YA_BLOQUEADA sin cambiar nada', () => {
  it.each([0, 1, 4, 5])('criterio 108: con %i fallos previos y bloqueadoHasta = new Date(NaN)', (previos) => {
    const estado: EstadoBloqueo = { intentosFallidos: previos, bloqueadoHasta: INVALIDA };

    expect(evaluarIntentoFallido(estado, AHORA)).toEqual({ tipo: 'YA_BLOQUEADA' });
  });

  it('criterio 108: no modifica el estado recibido', () => {
    const estado: EstadoBloqueo = { intentosFallidos: 4, bloqueadoHasta: INVALIDA };

    evaluarIntentoFallido(estado, AHORA);

    expect(estado.intentosFallidos).toBe(4);
    expect(Number.isNaN(estado.bloqueadoHasta?.getTime())).toBe(true);
  });

  it('criterio 108: con ahora invalido no cuenta el intento ni calcula un bloqueo', () => {
    const resultado = evaluarIntentoFallido({ intentosFallidos: 4, bloqueadoHasta: null }, INVALIDA);

    expect(resultado).toEqual({ tipo: 'YA_BLOQUEADA' });
  });

  it('criterio 108 (control): con fechas validas, el 5.o fallo bloquea 15 minutos', () => {
    const resultado = evaluarIntentoFallido({ intentosFallidos: 4, bloqueadoHasta: null }, AHORA);

    expect(resultado).toEqual({
      tipo: 'FALLO',
      estado: { intentosFallidos: 5, bloqueadoHasta: new Date(AHORA.getTime() + 15 * 60 * 1000) },
      bloquea: true,
    });
  });
});
