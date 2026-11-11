import { describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo, RelojSistema, type Reloj } from './index';

describe('RelojSistema', () => {
  it('devuelve la hora del sistema', () => {
    const reloj: Reloj = new RelojSistema();
    const antes = Date.now();
    const ahora = reloj.ahora().getTime();
    const despues = Date.now();
    expect(ahora).toBeGreaterThanOrEqual(antes);
    expect(ahora).toBeLessThanOrEqual(despues);
  });
});

describe('RelojFijo', () => {
  const inicio = new Date('2026-03-15T19:00:00-05:00');

  it('devuelve siempre la hora inicial hasta que se cambie', () => {
    const reloj = new RelojFijo(inicio);
    expect(reloj.ahora().toISOString()).toBe('2026-03-16T00:00:00.000Z');
    expect(reloj.ahora().toISOString()).toBe('2026-03-16T00:00:00.000Z');
  });

  it('permite fijar otra hora', () => {
    const reloj = new RelojFijo(inicio);
    reloj.fijar(new Date('2026-04-01T10:30:00.000Z'));
    expect(reloj.ahora().toISOString()).toBe('2026-04-01T10:30:00.000Z');
  });

  it('permite avanzar la hora, incluso cruzando de día', () => {
    const reloj = new RelojFijo(inicio);
    reloj.avanzar(60 * 60 * 1000);
    expect(reloj.ahora().toISOString()).toBe('2026-03-16T01:00:00.000Z');
    reloj.avanzar(24 * 60 * 60 * 1000);
    expect(reloj.ahora().toISOString()).toBe('2026-03-17T01:00:00.000Z');
  });

  it('devuelve copias: mutar el resultado no cambia la hora interna', () => {
    const reloj = new RelojFijo(inicio);
    reloj.ahora().setFullYear(1999);
    expect(reloj.ahora().getFullYear()).toBe(2026);
  });

  it('no se altera si se muta la fecha con la que se creó o se fijó', () => {
    const fecha = new Date('2026-05-01T00:00:00.000Z');
    const reloj = new RelojFijo(fecha);
    fecha.setFullYear(1999);
    expect(reloj.ahora().getUTCFullYear()).toBe(2026);

    const otra = new Date('2026-06-01T00:00:00.000Z');
    reloj.fijar(otra);
    otra.setFullYear(1999);
    expect(reloj.ahora().getUTCFullYear()).toBe(2026);
  });
});

describe('RELOJ', () => {
  it('es un token único', () => {
    expect(typeof RELOJ).toBe('symbol');
  });
});
