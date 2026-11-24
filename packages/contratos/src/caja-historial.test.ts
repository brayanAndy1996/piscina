import { describe, expect, it } from 'vitest';
import {
  filtroHistorialCajasSchema,
  LIMITES_HISTORIAL_CAJAS,
  MENSAJE_RANGO_DEMASIADO_LARGO,
  MENSAJE_RANGO_INVERTIDO,
  mensajeDelRangoDelHistorial,
  rangoDelHistorial,
} from './caja';
import { formatearSoles } from './dinero';

// Spec 006b, PQ3 y PQ10 (pruebas no protegidas; las protegidas de los esquemas están en `caja-historial-protegido.test.ts`): las cuentas de
// calendario del rango, sin zona horaria, y `formatearSoles`, que pasa de la web a este paquete para la web y el PDF.

describe('rangoDelHistorial (PQ3)', () => {
  it.each([
    [{}, '2026-11-11', '2026-10-12', '2026-11-11'],
    [{ hasta: '2026-11-05' }, '2026-11-11', '2026-10-06', '2026-11-05'],
    [{ desde: '2026-11-01' }, '2026-11-11', '2026-11-01', '2026-11-11'],
    [{ desde: '2026-11-01', hasta: '2026-11-30' }, '2026-11-11', '2026-11-01', '2026-11-30'],
    [{ hasta: '2099-12-31' }, '2026-11-11', '2099-12-01', '2099-12-31'],
    [{ hasta: '0001-01-15' }, '2026-11-11', '0001-01-01', '0001-01-15'],
    [{ hasta: '2026-01-05' }, '2026-11-11', '2025-12-06', '2026-01-05'],
    [{}, '2028-03-01', '2028-01-31', '2028-03-01'],
    [{}, '2026-03-01', '2026-01-30', '2026-03-01'],
  ])('%j con hoy %s da %s a %s', (filtro, hoy, desde, hasta) => {
    expect(rangoDelHistorial(filtro, hoy)).toEqual({ desde, hasta });
  });

  it('no se mueve con la zona horaria del proceso', () => {
    const zona = process.env['TZ'];
    try {
      for (const otra of ['Asia/Tokyo', 'Pacific/Kiritimati', 'America/New_York']) {
        process.env['TZ'] = otra;

        expect(rangoDelHistorial({}, '2026-11-11')).toEqual({ desde: '2026-10-12', hasta: '2026-11-11' });
      }
    } finally {
      if (zona === undefined) delete process.env['TZ'];
      else process.env['TZ'] = zona;
    }
  });

  it('el rango por defecto tiene 31 días contando los dos extremos', () => {
    expect(LIMITES_HISTORIAL_CAJAS.diasPorDefecto).toBe(31);
    expect(mensajeDelRangoDelHistorial('2026-10-12', '2026-11-11')).toBeNull();
  });
});

describe('mensajeDelRangoDelHistorial (PQ3)', () => {
  it.each([
    ['2026-11-11', '2026-11-11', null],
    ['2025-11-11', '2026-11-11', null],
    ['2025-11-10', '2026-11-11', MENSAJE_RANGO_DEMASIADO_LARGO],
    ['2024-02-29', '2025-02-28', null],
    ['2024-02-29', '2025-03-01', MENSAJE_RANGO_DEMASIADO_LARGO],
    ['2026-11-12', '2026-11-11', MENSAJE_RANGO_INVERTIDO],
    ['0001-01-01', '9999-12-31', MENSAJE_RANGO_DEMASIADO_LARGO],
    ['9999-12-31', '0001-01-01', MENSAJE_RANGO_INVERTIDO],
  ])('de %s a %s: %s', (desde, hasta, esperado) => {
    expect(mensajeDelRangoDelHistorial(desde, hasta)).toBe(esperado);
  });
});

describe('filtroHistorialCajasSchema (PQ3)', () => {
  it('ignora los parámetros que no son suyos y no deja pasar una clave de más al resultado', () => {
    const resultado = filtroHistorialCajasSchema.safeParse({ desde: '2026-11-01', academiaId: 'otra' });

    expect(resultado.success).toBe(true);
    expect(resultado.data).toEqual({ desde: '2026-11-01' });
  });

  it('un valor undefined (parámetro ausente) vale como ausente', () => {
    const resultado = filtroHistorialCajasSchema.safeParse({ desde: undefined, hasta: undefined });

    expect(resultado.success).toBe(true);
  });
});

describe('formatearSoles (PQ10)', () => {
  it.each([
    ['120.00', 'S/ 120.00'],
    ['88', 'S/ 88.00'],
    ['0', 'S/ 0.00'],
    ['0.01', 'S/ 0.01'],
    ['1200.5', 'S/ 1,200.50'],
    ['99999.99', 'S/ 99,999.99'],
    ['9999999999.99', 'S/ 9,999,999,999.99'],
    ['007', 'S/ 7.00'],
    ['90071992547409.93', 'S/ 90,071,992,547,409.93'],
  ])('%s se escribe %s', (monto, esperado) => {
    expect(formatearSoles(monto)).toBe(esperado);
  });

  it.each(['-4.50', '1e2', '120,50', ' 120', ''])('un texto que no es un monto (%j) se muestra tal cual', (texto) => {
    expect(formatearSoles(texto)).toBe(`S/ ${texto}`);
  });
});
