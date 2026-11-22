import { describe, expect, it } from 'vitest';
import { esCierreTardio, esDeOtroDia } from './dia';

// Spec 006, criterios 12, 20 y 32 (prueba no protegida): el día de una caja es el de America/Lima del reloj, en los bordes de las 19:00, de la
// medianoche, del fin de mes y del fin de año. Las pruebas corren con TZ=UTC (vitest.config.mts): una versión que usara la zona del servidor
// fallaría desde las 19:00 de Lima.

const instante = (texto: string) => new Date(texto);

describe('esDeOtroDia', () => {
  it.each([
    ['2026-11-30', '2026-11-30T14:00:00.000Z', false], // 09:00 del 30 en Lima
    ['2026-11-30', '2026-12-01T00:30:00.000Z', false], // 19:30 del 30 en Lima (en UTC ya es el 1)
    ['2026-11-30', '2026-12-01T04:59:59.999Z', false], // 23:59:59.999 del 30 en Lima
    ['2026-11-30', '2026-12-01T05:00:00.000Z', true], // 00:00 del 1 de diciembre en Lima
    ['2026-12-31', '2027-01-01T04:59:59.999Z', false],
    ['2026-12-31', '2027-01-01T05:00:00.000Z', true],
    ['2026-11-15', '2026-11-17T15:00:00.000Z', true],
  ])('la caja del %s con la hora %s: de otro día = %s', (fecha, ahora, esperado) => {
    expect(esDeOtroDia(fecha, instante(ahora))).toBe(esperado);
  });

  it('una caja con fecha futura tampoco es de hoy: no admite movimientos', () => {
    expect(esDeOtroDia('2026-12-02', instante('2026-12-01T15:00:00.000Z'))).toBe(true);
  });
});

describe('esCierreTardio', () => {
  it.each([
    ['2026-11-30', '2026-12-01T15:00:00.000Z', true],
    ['2026-11-30', '2026-12-01T05:00:00.000Z', true],
    ['2026-11-30', '2026-12-01T04:59:59.999Z', false],
    ['2026-11-30', '2026-12-01T00:30:00.000Z', false], // 19:30 del 30 en Lima
    ['2026-11-30', '2026-12-01T01:30:00.000Z', false], // 20:30 del 30, después de la clase de 19:00 a 20:00
    ['2026-12-31', '2027-01-01T05:00:00.000Z', true],
    ['2026-12-31', '2027-01-01T04:59:59.999Z', false],
  ])('la caja del %s cerrada a las %s: tardío = %s', (fecha, cerradoEn, esperado) => {
    expect(esCierreTardio(fecha, instante(cerradoEn))).toBe(esperado);
  });
});
