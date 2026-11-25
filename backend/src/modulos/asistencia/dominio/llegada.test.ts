import { afterEach, describe, expect, it } from 'vitest';
import { estadoDeLlegada } from './llegada';
import { ventanaDeLaClase } from './ventana';

// Criterios 10 y 20 de la 009a: puntual hasta inicio + tolerancia comparado por minuto (DT-3); la clase de las 18:00 de Lima.

const TZ_ORIGINAL = process.env['TZ'];
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = TZ_ORIGINAL;
});

describe.each(['UTC', 'Asia/Tokyo'])('estado de llegada, con el proceso en TZ=%s', (zona) => {
  const { inicio } = (() => {
    process.env['TZ'] = zona;
    return ventanaDeLaClase('2026-11-16', '18:00', '19:00');
  })();
  const llegada = (horaMinutoSegundo: string) => new Date(`2026-11-16T${horaMinutoSegundo}-05:00`);
  const estado = (hora: string, tolerancia: number) => {
    process.env['TZ'] = zona;
    return estadoDeLlegada(llegada(hora), inicio, tolerancia);
  };

  it('con 10 minutos: 18:10:59.999 es puntual y 18:11:00.000 es tarde', () => {
    expect(estado('18:10:59.999', 10)).toBe('PUNTUAL');
    expect(estado('18:11:00.000', 10)).toBe('TARDE');
  });

  it('con 0 minutos: 18:00:59.999 es puntual y 18:01:00.000 es tarde', () => {
    expect(estado('18:00:59.999', 0)).toBe('PUNTUAL');
    expect(estado('18:01:00.000', 0)).toBe('TARDE');
  });

  it('con 30 minutos: 18:30:59.999 es puntual y 18:31:00.000 es tarde', () => {
    expect(estado('18:30:59.999', 30)).toBe('PUNTUAL');
    expect(estado('18:31:00.000', 30)).toBe('TARDE');
  });

  it('justo al inicio y hasta el primer minuto es puntual con cualquier tolerancia', () => {
    expect(estado('18:00:00.000', 0)).toBe('PUNTUAL');
    expect(estado('18:00:00.000', 10)).toBe('PUNTUAL');
  });

  it('una llegada antes del inicio es puntual', () => {
    expect(estado('17:59:59.999', 0)).toBe('PUNTUAL');
  });

  it('la hora que se muestra (HH:MM) nunca contradice el estado: 18:10:30 con 10 minutos es «18:10» y puntual', () => {
    expect(estado('18:10:30.000', 10)).toBe('PUNTUAL');
  });
});
