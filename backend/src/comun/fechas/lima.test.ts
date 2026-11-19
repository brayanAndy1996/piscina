import { afterEach, describe, expect, it } from 'vitest';
import { hoyEnLima } from './lima';

const TZ_ORIGINAL = process.env['TZ'];

afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = TZ_ORIGINAL;
});

describe('hoyEnLima (spec 004, criterio 14)', () => {
  it('el día cambia a las 05:00:00Z, que es la medianoche de Lima (UTC-5)', () => {
    expect(hoyEnLima(new Date('2026-11-30T04:59:59.000Z'))).toBe('2026-11-29');
    expect(hoyEnLima(new Date('2026-11-30T05:00:00.000Z'))).toBe('2026-11-30');
  });

  it('en el cambio de mes y de año', () => {
    expect(hoyEnLima(new Date('2026-12-01T04:59:59.999Z'))).toBe('2026-11-30');
    expect(hoyEnLima(new Date('2026-12-01T05:00:00.000Z'))).toBe('2026-12-01');
    expect(hoyEnLima(new Date('2027-01-01T04:59:59.000Z'))).toBe('2026-12-31');
    expect(hoyEnLima(new Date('2027-01-01T05:00:00.000Z'))).toBe('2027-01-01');
  });

  it('en el 29 de febrero de un año bisiesto y el paso a marzo', () => {
    expect(hoyEnLima(new Date('2028-03-01T04:59:59.000Z'))).toBe('2028-02-29');
    expect(hoyEnLima(new Date('2028-03-01T05:00:00.000Z'))).toBe('2028-03-01');
  });

  it('las 19:00 de Lima siguen siendo el mismo día, aunque en UTC ya sea el siguiente', () => {
    expect(hoyEnLima(new Date('2026-11-18T00:00:00.000Z'))).toBe('2026-11-17');
    expect(hoyEnLima(new Date('2026-11-18T03:59:59.000Z'))).toBe('2026-11-17');
  });

  it.each(['Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York', 'UTC'])(
    'no depende de la zona del proceso (TZ=%s)',
    (zona) => {
      process.env['TZ'] = zona;

      expect(hoyEnLima(new Date('2026-11-30T04:59:59.000Z'))).toBe('2026-11-29');
      expect(hoyEnLima(new Date('2026-11-30T05:00:00.000Z'))).toBe('2026-11-30');
      expect(hoyEnLima(new Date('2027-01-01T04:59:59.000Z'))).toBe('2026-12-31');
      expect(hoyEnLima(new Date('2027-01-01T05:00:00.000Z'))).toBe('2027-01-01');
    },
  );

  it('la prueba cambia de verdad la zona del proceso (con TZ=Asia/Tokyo el día local del mismo instante es otro)', () => {
    process.env['TZ'] = 'Asia/Tokyo';

    // 2026-11-30T04:59:59Z son las 13:59:59 del 30 en Tokio y las 23:59:59 del 29 en Lima.
    expect(new Date('2026-11-30T04:59:59.000Z').getDate()).toBe(30);
    expect(hoyEnLima(new Date('2026-11-30T04:59:59.000Z'))).toBe('2026-11-29');
  });

  it('con una fecha inválida falla en vez de dar un día equivocado', () => {
    expect(() => hoyEnLima(new Date(Number.NaN))).toThrow();
  });
});
