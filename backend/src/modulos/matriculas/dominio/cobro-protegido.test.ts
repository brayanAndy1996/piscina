// spec: 005-inscripcion-publica (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Decimal } from '../../../infraestructura/prisma';

// Criterios 8, 9 y 10 (críticos, HU-34, RN-25, D-03, RNF-12): el cálculo del cobro es puro, exacto y en America/Lima.
//   8. `clasesRestantes(clases, ahora)` cuenta, para cada fecha desde hoy hasta el último día del mes en curso (en Lima), las clases
//      elegidas cuyo día de la semana coincide; las de hoy cuentan solo si su hora de inicio en Lima es posterior a "ahora".
//   9. `montoProporcional(precio, clasesPorMes, clasesTotales)` = precio × clasesTotales ÷ clasesPorMes, exacto, redondeado hacia arriba
//      al sol entero UNA vez, al final (S/ 200 de 3 clases con 3 → S/ 200, no 201).
//  10. `calcularTotal({ base, montoAjustado?, descuento? })` sigue el orden de D-03 y redondea una sola vez al final.
// Se cargan con importación dinámica: antes de implementarlos la prueba falla con un mensaje claro. Los casos están escritos a mano,
// de forma independiente de la implementación.

type Dia = 1 | 2 | 3 | 4 | 5 | 6 | 7;
interface ClaseElegida {
  diaSemana: Dia;
  horaInicio: string;
}
interface Cobro {
  clasesRestantes: (clases: readonly ClaseElegida[], ahora: Date) => number;
  montoProporcional: (precio: Decimal, clasesPorMes: number, clasesTotales: number) => Decimal;
  calcularTotal: (entrada: { base: unknown; montoAjustado?: Decimal; descuento?: unknown }) => Decimal;
}

async function cargar(): Promise<Cobro> {
  const ruta = path.join(__dirname, 'cobro.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 005a: no se pudo cargar "backend/src/modulos/matriculas/dominio/cobro.ts" (${motivo}).`,
      {
        cause: error,
      },
    );
  }
  for (const nombre of ['clasesRestantes', 'montoProporcional', 'calcularTotal']) {
    if (typeof modulo[nombre] !== 'function') {
      throw new Error(`Falta la funcionalidad de la 005a: "dominio/cobro.ts" no exporta ${nombre}.`);
    }
  }
  return modulo as unknown as Cobro;
}

const clase = (diaSemana: Dia, horaInicio: string): ClaseElegida => ({ diaSemana, horaInicio });
const instante = (texto: string) => new Date(texto);
const LUNES = 1;
const MIERCOLES = 3;
const JUEVES = 4;
const VIERNES = 5;
const MARTES = 2;

const ZONA_ORIGINAL = process.env['TZ'];
afterEach(() => {
  if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ZONA_ORIGINAL;
});

describe('criterio 8: clasesRestantes (America/Lima)', () => {
  const lmv18 = [clase(LUNES, '18:00'), clase(MIERCOLES, '18:00'), clase(VIERNES, '18:00')];

  it('criterio 8: miércoles 11 de noviembre de 2026, 10:00 en Lima: cuenta los lunes, miércoles y viernes que faltan (la clase de hoy a las 18:00 todavía no empezó)', async () => {
    const { clasesRestantes } = await cargar();

    // Lunes 16, 23 y 30; miércoles 11, 18 y 25; viernes 13, 20 y 27.
    expect(clasesRestantes(lmv18, instante('2026-11-11T15:00:00.000Z'))).toBe(9);
  });

  it('criterio 8: el mismo día, la clase de 08:00 que ya empezó no cuenta y la de 18:00 sí', async () => {
    const { clasesRestantes } = await cargar();

    expect(clasesRestantes([clase(MIERCOLES, '08:00')], instante('2026-11-11T15:00:00.000Z'))).toBe(2);
    expect(clasesRestantes([clase(MIERCOLES, '18:00')], instante('2026-11-11T15:00:00.000Z'))).toBe(3);
  });

  it('criterio 8: la clase de 19:00 a las 18:59:59 de Lima todavía cuenta y a las 19:00:00 ya no (borde exacto)', async () => {
    const { clasesRestantes } = await cargar();
    const viernes19 = [clase(VIERNES, '19:00')];

    // Viernes 20 de noviembre: quedan el 20 (si no empezó) y el 27.
    expect(clasesRestantes(viernes19, instante('2026-11-20T23:59:59.000Z'))).toBe(2);
    expect(clasesRestantes(viernes19, instante('2026-11-21T00:00:00.000Z'))).toBe(1);
  });

  it('criterio 8: una clase que empieza exactamente en "ahora" ya no cuenta (la hora de inicio debe ser posterior)', async () => {
    const { clasesRestantes } = await cargar();

    expect(clasesRestantes([clase(MIERCOLES, '10:00')], instante('2026-11-11T14:59:59.000Z'))).toBe(3);
    expect(clasesRestantes([clase(MIERCOLES, '10:00')], instante('2026-11-11T15:00:00.000Z'))).toBe(2);
  });

  it('criterio 8: el último día del mes después de la última clase quedan 0 (lunes 30 de noviembre a las 20:00 y a las 23:59:59 de Lima)', async () => {
    const { clasesRestantes } = await cargar();

    expect(clasesRestantes([clase(LUNES, '19:00')], instante('2026-12-01T01:00:00.000Z'))).toBe(0);
    expect(clasesRestantes(lmv18, instante('2026-12-01T04:59:59.000Z'))).toBe(0);
    expect(
      clasesRestantes([clase(LUNES, '19:00')], instante('2026-12-01T00:59:59.000Z')),
      'a las 19:59:59 de Lima la clase de las 19:00 ya empezó',
    ).toBe(0);
    expect(
      clasesRestantes([clase(LUNES, '19:00')], instante('2026-11-30T23:59:59.000Z')),
      '18:59:59 del lunes 30: sí',
    ).toBe(1);
  });

  it('criterio 8: un día de la semana que ya no vuelve en el mes da 0 aunque falten días', async () => {
    const { clasesRestantes } = await cargar();

    // Martes 24 de noviembre es el último martes de 2026-11; el 25 ya no quedan martes.
    expect(clasesRestantes([clase(MARTES, '18:00')], instante('2026-11-25T13:00:00.000Z'))).toBe(0);
    expect(clasesRestantes([clase(MARTES, '18:00')], instante('2026-11-24T13:00:00.000Z'))).toBe(1);
  });

  it('criterio 8: sin clases elegidas da 0', async () => {
    const { clasesRestantes } = await cargar();

    expect(clasesRestantes([], instante('2026-11-11T15:00:00.000Z'))).toBe(0);
  });

  it('criterio 8: un mes con cinco lunes (noviembre de 2026) desde el domingo 1 a las 10:00 cuenta los cinco; con dos clases el mismo lunes, el doble', async () => {
    const { clasesRestantes } = await cargar();

    expect(clasesRestantes([clase(LUNES, '18:00')], instante('2026-11-01T15:00:00.000Z'))).toBe(5);
    expect(clasesRestantes([clase(LUNES, '17:00'), clase(LUNES, '18:00')], instante('2026-11-01T15:00:00.000Z'))).toBe(
      10,
    );
  });

  it('criterio 8: febrero de 2027 (28 días, empieza en lunes): cuatro lunes, y el lunes 1 a las 18:00 ya no cuenta el de las 18:00', async () => {
    const { clasesRestantes } = await cargar();

    expect(clasesRestantes([clase(LUNES, '18:00')], instante('2027-02-01T13:00:00.000Z'))).toBe(4); // 08:00 de Lima
    expect(clasesRestantes([clase(LUNES, '18:00')], instante('2027-02-01T23:00:00.000Z'))).toBe(3); // 18:00 de Lima
    expect(clasesRestantes([clase(MARTES, '08:00')], instante('2027-02-28T13:00:00.000Z'))).toBe(0); // domingo 28: no hay más martes
  });

  it('criterio 8: febrero de un año bisiesto (2028) tiene un día más: el martes 29 cuenta', async () => {
    const { clasesRestantes } = await cargar();

    // El 29 de febrero de 2028 es martes.
    expect(clasesRestantes([clase(MARTES, '18:00')], instante('2028-02-28T13:00:00.000Z'))).toBe(1);
    expect(clasesRestantes([clase(MARTES, '18:00')], instante('2028-02-29T13:00:00.000Z'))).toBe(1);
    // Marzo de 2028 empieza en miércoles: martes 7, 14, 21 y 28.
    expect(clasesRestantes([clase(MARTES, '18:00')], instante('2028-03-01T13:00:00.000Z'))).toBe(4);
  });

  it('criterio 8: cambio de año: el 31 de diciembre a las 15:00 de Lima la clase del jueves a las 18:00 cuenta una vez; a las 23:59:59 ya no; el 1 de enero es otro mes', async () => {
    const { clasesRestantes } = await cargar();
    const jueves18 = [clase(JUEVES, '18:00')];

    expect(clasesRestantes(jueves18, instante('2026-12-31T20:00:00.000Z'))).toBe(1);
    expect(clasesRestantes(jueves18, instante('2027-01-01T04:59:59.000Z'))).toBe(0);
    // 00:00:00 del viernes 1 de enero de 2027 en Lima: enero tiene cinco viernes (1, 8, 15, 22 y 29).
    expect(clasesRestantes([clase(VIERNES, '08:00')], instante('2027-01-01T05:00:00.000Z'))).toBe(5);
  });

  it.each(['Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC'])(
    'criterio 8: con el proceso en la zona %s da lo mismo que en Lima (borde de las 19:00, fin de mes y cambio de año)',
    async (zona) => {
      const { clasesRestantes } = await cargar();
      process.env['TZ'] = zona;

      expect(clasesRestantes([clase(VIERNES, '19:00')], instante('2026-11-20T23:59:59.000Z'))).toBe(2);
      expect(clasesRestantes([clase(VIERNES, '19:00')], instante('2026-11-21T00:00:00.000Z'))).toBe(1);
      expect(clasesRestantes(lmv18, instante('2026-11-11T15:00:00.000Z'))).toBe(9);
      expect(clasesRestantes(lmv18, instante('2026-12-01T04:59:59.000Z'))).toBe(0);
      expect(clasesRestantes([clase(JUEVES, '18:00')], instante('2026-12-31T20:00:00.000Z'))).toBe(1);
      expect(clasesRestantes([clase(VIERNES, '08:00')], instante('2027-01-01T05:00:00.000Z'))).toBe(5);
    },
  );
});

describe('criterio 9: montoProporcional (exacto, redondeo hacia arriba una sola vez)', () => {
  async function monto(precio: string, clasesPorMes: number, clasesTotales: number): Promise<string> {
    const { montoProporcional } = await cargar();
    const resultado = montoProporcional(new Decimal(precio), clasesPorMes, clasesTotales);
    expect(Decimal.isDecimal(resultado), 'devuelve un Decimal, no un number').toBe(true);
    return new Decimal(resultado).toFixed(2);
  }

  it.each([
    ['S/ 100 de 12 clases con 12 (mes completo)', '100', 12, 12, '100.00'],
    ['S/ 100 de 12 clases con 5 (41.67)', '100', 12, 5, '42.00'],
    ['S/ 210 de 12 clases con 5 (87.50)', '210', 12, 5, '88.00'],
    ['S/ 200 de 3 clases con 3: 200, no 201 (dividir primero y redondear el cociente)', '200', 3, 3, '200.00'],
    ['S/ 100 de 3 clases con 1 (33.33)', '100', 3, 1, '34.00'],
    ['S/ 120.50 de 12 clases con 12: el total siempre se redondea al sol (D-03)', '120.50', 12, 12, '121.00'],
    ['S/ 120.00 de 12 con 9 (90 exacto)', '120.00', 12, 9, '90.00'],
    ['S/ 0.01 de 1 clase con 1', '0.01', 1, 1, '1.00'],
    ['S/ 99999.99 de 31 clases con 31', '99999.99', 31, 31, '100000.00'],
    ['S/ 99999.99 de 31 clases con 1 (3225.80…)', '99999.99', 31, 1, '3226.00'],
    ['S/ 10 de 3 clases con 3: 10, no 11', '10', 3, 3, '10.00'],
    ['S/ 70 de 7 clases con 3 (30 exacto)', '70', 7, 3, '30.00'],
  ])('criterio 9: %s', async (_nombre, precio, porMes, totales, esperado) => {
    expect(await monto(precio, porMes, totales)).toBe(esperado);
  });

  it('criterio 9 (propiedades): para muchos precios y clases, el resultado es un entero, nunca menor que el valor exacto ni mayor que ese valor más 1; con todas las clases es el precio redondeado hacia arriba', async () => {
    const { montoProporcional } = await cargar();
    const precios = [
      '0.01',
      '0.50',
      '1',
      '7.77',
      '33.33',
      '49.99',
      '99.99',
      '100',
      '120.50',
      '150',
      '210',
      '999.99',
      '12345.67',
      '99999.99',
    ];
    const centimos = (texto: string): bigint => {
      const [enteros = '0', decimales = ''] = texto.split('.');
      return BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, '0').slice(0, 2));
    };
    let casos = 0;

    for (const precio of precios) {
      for (let porMes = 1; porMes <= 31; porMes++) {
        for (let totales = 1; totales <= porMes; totales++) {
          const resultado = new Decimal(montoProporcional(new Decimal(precio), porMes, totales));
          expect(resultado.isInteger(), `${precio} ${totales}/${porMes}`).toBe(true);
          const soles = BigInt(resultado.toFixed(0));
          // exacto = c × t ÷ (m × 100) soles; el entero debe cumplir exacto <= soles < exacto + 1.
          const numerador = centimos(precio) * BigInt(totales);
          const denominador = BigInt(porMes) * 100n;
          expect(soles * denominador >= numerador, `${precio} ${totales}/${porMes} no es menor que lo exacto`).toBe(
            true,
          );
          expect(
            (soles - 1n) * denominador < numerador,
            `${precio} ${totales}/${porMes} no pasa de lo exacto más 1`,
          ).toBe(true);
          if (totales === porMes) {
            expect(soles, `${precio} con todas las clases`).toBe((centimos(precio) + 99n) / 100n);
          }
          casos += 1;
        }
      }
    }
    expect(casos).toBeGreaterThan(5000);
  });
});

describe('criterio 10: calcularTotal (orden completo de D-03)', () => {
  // La spec fija `calcularTotal(entrada: { base: Racional; montoAjustado?: Decimal; descuento?: Descuento }): Decimal` sin dar la forma
  // de `Racional` ni de `Descuento`. Se usan las del plan (sección 3): `Racional = { numerador: bigint; denominador: bigint }` y
  // `Descuento = { tipo: 'PORCENTAJE' | 'MONTO_FIJO'; valor: Decimal }` (P1 de la spec). Solo estas dos funciones
  // dependen de esa forma.
  const racional = (numerador: bigint, denominador: bigint) => ({ numerador, denominador });
  const porcentaje = (valor: string) => ({ tipo: 'PORCENTAJE' as const, valor: new Decimal(valor) });
  const fijo = (valor: string) => ({ tipo: 'MONTO_FIJO' as const, valor: new Decimal(valor) });

  async function total(entrada: { base: unknown; montoAjustado?: Decimal; descuento?: unknown }): Promise<string> {
    const { calcularTotal } = await cargar();
    const resultado = calcularTotal(entrada);
    expect(Decimal.isDecimal(resultado), 'devuelve un Decimal').toBe(true);
    return new Decimal(resultado).toFixed(2);
  }

  it('criterio 10: sin ajuste ni descuento es el monto proporcional redondeado hacia arriba: S/ 100 de 12 clases con 5 → S/ 42', async () => {
    expect(await total({ base: racional(500n, 12n) })).toBe('42.00');
  });

  it('criterio 10: la tabla de D-03: S/ 100 de 12 clases con 5 y 10 % de descuento (41.67 × 0.90 = 37.50) → S/ 38', async () => {
    expect(await total({ base: racional(500n, 12n), descuento: porcentaje('10') })).toBe('38.00');
  });

  it('criterio 10: S/ 210 de 12 clases con 5 (87.50) → S/ 88', async () => {
    expect(await total({ base: racional(1050n, 12n) })).toBe('88.00');
  });

  it('criterio 10: el redondeo es uno solo y al final: 100 ÷ 3 con 10 % de descuento es 30 exacto (redondear antes daría 34 × 0.9 = 31)', async () => {
    expect(await total({ base: racional(100n, 3n), descuento: porcentaje('10') })).toBe('30.00');
  });

  it('criterio 10: un descuento fijo mayor que el monto deja el total en S/ 0, nunca negativo', async () => {
    expect(await total({ base: racional(500n, 12n), descuento: fijo('50') })).toBe('0.00');
    expect(await total({ base: racional(100n, 1n), descuento: fijo('100.01') })).toBe('0.00');
    expect(await total({ base: racional(100n, 1n), descuento: fijo('100') })).toBe('0.00');
  });

  it('criterio 10: un descuento fijo menor que el monto se resta del monto sin redondear: 41.67 − 10 = 31.67 → S/ 32', async () => {
    expect(await total({ base: racional(500n, 12n), descuento: fijo('10') })).toBe('32.00');
  });

  it('criterio 10: el descuento de porcentaje va de 0 a 100: 0 % no cambia el total y 100 % lo deja en S/ 0', async () => {
    expect(await total({ base: racional(500n, 12n), descuento: porcentaje('0') })).toBe('42.00');
    expect(await total({ base: racional(500n, 12n), descuento: porcentaje('100') })).toBe('0.00');
  });

  it('criterio 10: el monto ajustado reemplaza al calculado (y se redondea hacia arriba al final)', async () => {
    expect(await total({ base: racional(500n, 12n), montoAjustado: new Decimal('80') })).toBe('80.00');
    expect(await total({ base: racional(500n, 12n), montoAjustado: new Decimal('80.50') })).toBe('81.00');
    expect(await total({ base: racional(500n, 12n), montoAjustado: new Decimal('20') })).toBe('20.00');
  });

  it('criterio 10: el descuento se aplica sobre el monto ajustado, sin redondear antes: 80 con 10 % → 72; 85 con 10 % (76.5) → 77', async () => {
    expect(
      await total({ base: racional(500n, 12n), montoAjustado: new Decimal('80'), descuento: porcentaje('10') }),
    ).toBe('72.00');
    expect(
      await total({ base: racional(500n, 12n), montoAjustado: new Decimal('85'), descuento: porcentaje('10') }),
    ).toBe('77.00');
    expect(await total({ base: racional(500n, 12n), montoAjustado: new Decimal('30'), descuento: fijo('40') })).toBe(
      '0.00',
    );
  });
});
