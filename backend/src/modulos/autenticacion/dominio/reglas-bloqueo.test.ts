import { describe, expect, it } from 'vitest';
import { CONFIGURACION_POR_DEFECTO } from '@aquagestion/contratos';
import { estaBloqueado, evaluarIntentoFallido, REGLAS_BLOQUEO_SUPERADMIN } from '../../academias/dominio/bloqueo';
import { minutosRestantes, reglasBloqueoDe } from './reglas-bloqueo';

const AHORA = new Date('2026-11-11T15:00:00.000Z');

describe('reglasBloqueoDe (criterios 9 de 002 y 13 de 003, DR-3)', () => {
  it('con la configuración por defecto son 5 intentos y 15 minutos', () => {
    expect(reglasBloqueoDe(CONFIGURACION_POR_DEFECTO)).toEqual({ maximoIntentos: 5, minutosBloqueo: 15 });
  });

  it('toma los intentos y los minutos de la configuración de la academia', () => {
    expect(reglasBloqueoDe({ intentosInicioSesion: 3, minutosBloqueo: 30 })).toEqual({
      maximoIntentos: 3,
      minutosBloqueo: 30,
    });
  });

  it('los 4 primeros fallos no bloquean y el 5.º bloquea 15 minutos (valores por defecto)', () => {
    const reglas = reglasBloqueoDe(CONFIGURACION_POR_DEFECTO);
    for (let intentos = 0; intentos < 4; intentos++) {
      const resultado = evaluarIntentoFallido({ intentosFallidos: intentos, bloqueadoHasta: null }, AHORA, reglas);
      expect(resultado).toMatchObject({ tipo: 'FALLO', bloquea: false });
    }
    const quinto = evaluarIntentoFallido({ intentosFallidos: 4, bloqueadoHasta: null }, AHORA, reglas);
    expect(quinto).toMatchObject({
      tipo: 'FALLO',
      bloquea: true,
      estado: { intentosFallidos: 5, bloqueadoHasta: new Date('2026-11-11T15:15:00.000Z') },
    });
  });

  it('con 3 intentos y 30 minutos, el 3.º fallo bloquea 30 minutos', () => {
    const reglas = reglasBloqueoDe({ intentosInicioSesion: 3, minutosBloqueo: 30 });
    expect(evaluarIntentoFallido({ intentosFallidos: 1, bloqueadoHasta: null }, AHORA, reglas)).toMatchObject({
      bloquea: false,
    });
    expect(evaluarIntentoFallido({ intentosFallidos: 2, bloqueadoHasta: null }, AHORA, reglas)).toMatchObject({
      bloquea: true,
      estado: { intentosFallidos: 3, bloqueadoHasta: new Date('2026-11-11T15:30:00.000Z') },
    });
  });

  it('bajar el máximo por debajo de los fallos que ya tiene la cuenta bloquea en el siguiente fallo (criterio 15 a)', () => {
    const reglas = reglasBloqueoDe({ intentosInicioSesion: 3, minutosBloqueo: 15 });
    expect(evaluarIntentoFallido({ intentosFallidos: 3, bloqueadoHasta: null }, AHORA, reglas)).toMatchObject({
      bloquea: true,
      estado: { intentosFallidos: 4 },
    });
  });

  it('un bloqueo ya puesto no cambia con otras reglas (criterio 15 b): lo decide bloqueado_hasta', () => {
    const bloqueadoHasta = new Date(AHORA.getTime() + 15 * 60_000);
    const estado = { intentosFallidos: 5, bloqueadoHasta };
    expect(estaBloqueado(estado, new Date(bloqueadoHasta.getTime() - 1))).toBe(true);
    expect(estaBloqueado(estado, bloqueadoHasta)).toBe(false);
    for (const reglas of [
      reglasBloqueoDe({ intentosInicioSesion: 10, minutosBloqueo: 5 }),
      REGLAS_BLOQUEO_SUPERADMIN,
    ]) {
      expect(evaluarIntentoFallido(estado, AHORA, reglas)).toEqual({ tipo: 'YA_BLOQUEADA' });
    }
  });

  it('el bloqueo del Superadmin sigue fijo en 5 intentos y 15 minutos (criterio 18)', () => {
    expect(REGLAS_BLOQUEO_SUPERADMIN).toEqual({ maximoIntentos: 5, minutosBloqueo: 15 });
  });
});

describe('minutosRestantes (criterio 19)', () => {
  const desde = (milisegundos: number) => new Date(AHORA.getTime() + milisegundos);

  it.each([
    ['30 minutos exactos', 30 * 60_000, 30],
    ['15 minutos exactos', 15 * 60_000, 15],
    ['14 minutos y 1 milisegundo', 14 * 60_000 + 1, 15],
    ['14 minutos y 59 segundos', 14 * 60_000 + 59_000, 15],
    ['1 minuto exacto', 60_000, 1],
    ['30 segundos', 30_000, 1],
    ['1 milisegundo', 1, 1],
    ['ya venció (0 ms)', 0, 1],
    ['ya venció (en el pasado)', -5 * 60_000, 1],
  ])('%s faltan %i ms: dice %i', (_nombre, milisegundos, esperados) => {
    expect(minutosRestantes(desde(milisegundos), AHORA)).toBe(esperados);
  });

  it('sin fecha o con una fecha no válida dice 1', () => {
    expect(minutosRestantes(null, AHORA)).toBe(1);
    expect(minutosRestantes(new Date(Number.NaN), AHORA)).toBe(1);
    expect(minutosRestantes(desde(60_000), new Date(Number.NaN))).toBe(1);
  });
});
