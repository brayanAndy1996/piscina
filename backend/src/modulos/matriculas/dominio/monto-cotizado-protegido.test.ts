// spec: 005-inscripcion-publica (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../../infraestructura/prisma';

// Criterio 50 (crítico, RN-25, HU-34, D-03, criterios 9, 12 y 19; ataque ronda 1, F2): para todo precio válido de `montoSchema` (hasta
// "99999.99") y todo `clasesTotales` de 1 a `clasesPorMes`, el monto de `montoProporcional` cumple `montoCotizadoSchema` (un texto con
// hasta dos decimales, mayor que 0 y como mucho "100000.00"): lo que la cotización puede dar siempre se puede enviar como `montoMostrado`.
// No se recorren los 10 millones de precios: se recorren todos los de los bordes (de S/ 99999.00 a S/ 99999.99 y de S/ 0.01 a S/ 1.00) y
// una muestra amplia y determinista del resto, con todas las combinaciones de clases de 1 a 31.

interface Cobro {
  montoProporcional: (precio: Decimal, clasesPorMes: number, clasesTotales: number) => Decimal;
}
interface Esquema {
  safeParse(valor: unknown): { success: boolean };
}

async function cargarCobro(): Promise<Cobro> {
  const ruta = path.join(__dirname, 'cobro.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`Falta la funcionalidad de la 005a: no se pudo cargar "dominio/cobro.ts" (${motivo}).`, {
      cause: error,
    });
  }
  if (typeof modulo['montoProporcional'] !== 'function') {
    throw new Error('Falta la funcionalidad de la 005a: "dominio/cobro.ts" no exporta montoProporcional.');
  }
  return modulo as unknown as Cobro;
}

async function cargarEsquema(nombre: 'montoSchema' | 'montoCotizadoSchema'): Promise<Esquema> {
  const modulo = (await import('@aquagestion/contratos')) as unknown as Record<string, unknown>;
  const esquema = modulo[nombre];
  if (esquema === undefined) {
    throw new Error(`Falta la funcionalidad de la 005a: @aquagestion/contratos no exporta ${nombre}.`);
  }
  return esquema as Esquema;
}

const aTexto = (centimos: number): string => {
  const enteros = Math.floor(centimos / 100);
  const resto = centimos % 100;
  return `${enteros}.${String(resto).padStart(2, '0')}`;
};

/** Precios en céntimos: los dos bordes completos y una muestra pseudoaleatoria determinista (Park-Miller) del resto. */
function preciosDePrueba(): string[] {
  const centimos = new Set<number>();
  for (let c = 99999_00; c <= 99999_99; c++) centimos.add(c);
  for (let c = 1; c <= 100; c++) centimos.add(c);
  let semilla = 20_261_120;
  for (let i = 0; i < 400; i++) {
    semilla = (semilla * 48_271) % 2_147_483_647;
    centimos.add(1 + (semilla % 99999_99));
  }
  return [...centimos].map(aTexto);
}

describe('criterio 50: lo que cotiza montoProporcional siempre cumple montoCotizadoSchema', () => {
  it('criterio 50 (propiedad): para todo precio válido de montoSchema y todo clasesTotales de 1 a clasesPorMes, el monto cumple montoCotizadoSchema', async () => {
    const { montoProporcional } = await cargarCobro();
    const montoSchema = await cargarEsquema('montoSchema');
    const montoCotizadoSchema = await cargarEsquema('montoCotizadoSchema');
    const precios = preciosDePrueba();
    let casos = 0;
    let rechazados = 0;
    let primeroRechazado = '';

    for (const precio of precios) {
      expect(montoSchema.safeParse(precio).success, `el precio ${precio} es válido para el plan`).toBe(true);
      for (let porMes = 1; porMes <= 31; porMes++) {
        for (let totales = 1; totales <= porMes; totales++) {
          const monto = new Decimal(montoProporcional(new Decimal(precio), porMes, totales)).toFixed(2);
          if (!montoCotizadoSchema.safeParse(monto).success) {
            rechazados += 1;
            if (!primeroRechazado) primeroRechazado = `${precio} ${totales}/${porMes} → ${monto}`;
          }
          casos += 1;
        }
      }
    }

    expect(casos).toBeGreaterThan(200_000);
    expect(rechazados, `el primer monto rechazado: ${primeroRechazado}`).toBe(0);
  });

  it.each([
    ['99999.01', 12, 12, '100000.00'],
    ['99999.99', 12, 12, '100000.00'],
    ['99999.99', 31, 31, '100000.00'],
    ['99999.00', 12, 12, '99999.00'],
    ['99999.50', 1, 1, '100000.00'],
  ])(
    'criterio 50: S/ %s de %i clases con %i da %s (el máximo que se alcanza al redondear)',
    async (precio, porMes, totales, esperado) => {
      const { montoProporcional } = await cargarCobro();
      const montoCotizadoSchema = await cargarEsquema('montoCotizadoSchema');

      const monto = new Decimal(montoProporcional(new Decimal(precio), porMes, totales)).toFixed(2);

      expect(monto).toBe(esperado);
      expect(montoCotizadoSchema.safeParse(monto).success).toBe(true);
    },
  );
});
