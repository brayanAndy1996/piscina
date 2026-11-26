import { describe, expect, it } from 'vitest';
import {
  diaDeLaSemanaDeFecha,
  diaDeLaSemanaEnLima,
  diaIsoDeAbreviatura,
  formatearFecha,
  formatearFechaCalendario,
  formatearFechaHora,
  formatearHora,
  formatearMes,
  hoyEnLima,
  mesActualEnLima,
  mesAnterior,
} from './fechas';

describe('fechas en America/Lima', () => {
  it('formatea la fecha con dd/MM/yyyy', () => {
    expect(formatearFecha('2026-11-12T03:00:00.000Z')).toBe('11/11/2026');
  });

  it('formatea solo la hora con HH:mm de 24 horas', () => {
    expect(formatearHora('2026-11-12T03:05:00.000Z')).toBe('22:05');
    // Medianoche en Lima (05:00 UTC): "00:00" y no "24:00".
    expect(formatearHora('2026-11-12T05:00:00.000Z')).toBe('00:00');
    // Las 19:30 en Lima ya son el día siguiente en UTC.
    expect(formatearHora('2026-12-01T00:30:00.000Z')).toBe('19:30');
  });

  it('formatea fecha y hora con dd/MM/yyyy HH:mm de 24 horas', () => {
    expect(formatearFechaHora('2026-11-12T03:05:00.000Z')).toBe('11/11/2026 22:05');
    // Medianoche en Lima (05:00 UTC): "00:00" y no "24:00".
    expect(formatearFechaHora('2026-11-12T05:00:00.000Z')).toBe('12/11/2026 00:00');
  });

  it('una fecha de calendario AAAA-MM-DD se muestra como dd/MM/yyyy sin tocar la zona horaria', () => {
    expect(formatearFechaCalendario('2026-11-30')).toBe('30/11/2026');
    expect(formatearFechaCalendario('2027-01-01')).toBe('01/01/2027');
  });

  it('el día de la semana se decide en Lima, de 1 (lunes) a 7 (domingo)', () => {
    // 2026-11-16 es lunes. 04:59 UTC todavía es domingo 23:59 en Lima; 05:00 UTC ya es lunes.
    expect(diaDeLaSemanaEnLima(new Date('2026-11-16T04:59:00.000Z'))).toBe(7);
    expect(diaDeLaSemanaEnLima(new Date('2026-11-16T05:00:00.000Z'))).toBe(1);
    expect(diaDeLaSemanaEnLima(new Date('2026-11-18T15:00:00.000Z'))).toBe(3);
  });

  it('si no se reconoce la abreviatura del día, falla en vez de devolver lunes', () => {
    expect(diaIsoDeAbreviatura('Sun')).toBe(7);
    expect(() => diaIsoDeAbreviatura('lun')).toThrow(/No se reconoce el día/);
    expect(() => diaIsoDeAbreviatura('')).toThrow(/No se reconoce el día/);
  });
});

describe('mes en palabras', () => {
  it('un mes AAAA-MM se muestra como "noviembre de 2026"', () => {
    expect(formatearMes('2026-11')).toBe('noviembre de 2026');
    expect(formatearMes('2027-01')).toBe('enero de 2027');
  });

  it('un texto que no es un mes se muestra tal cual', () => {
    expect(formatearMes('2026-13')).toBe('2026-13');
  });
});

describe('hoy en Lima', () => {
  it('es la fecha de Lima, no la de UTC ni la del navegador', () => {
    expect(hoyEnLima(new Date('2026-11-22T04:59:59.000Z'))).toBe('2026-11-21');
    expect(hoyEnLima(new Date('2026-11-22T05:00:00.000Z'))).toBe('2026-11-22');
    expect(hoyEnLima(new Date('2026-11-23T04:30:00.000Z'))).toBe('2026-11-22');
  });
});

describe('el mes y el día de una fecha de calendario (009b)', () => {
  it('el mes actual sigue a Lima, no a UTC', () => {
    expect(mesActualEnLima(new Date('2026-12-01T04:59:00.000Z'))).toBe('2026-11');
    expect(mesActualEnLima(new Date('2026-12-01T05:00:00.000Z'))).toBe('2026-12');
  });

  it('el mes anterior cruza el cambio de año', () => {
    expect(mesAnterior('2026-11')).toBe('2026-10');
    expect(mesAnterior('2026-01')).toBe('2025-12');
  });

  it('el día de la semana de una fecha de calendario no depende de la zona', () => {
    expect(diaDeLaSemanaDeFecha('2026-11-23')).toBe(1);
    expect(diaDeLaSemanaDeFecha('2026-11-29')).toBe(7);
    expect(diaDeLaSemanaDeFecha('2026-11-25')).toBe(3);
  });
});
