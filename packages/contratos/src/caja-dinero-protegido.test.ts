// spec: 006-caja (pruebas protegidas)
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Criterios 11, 27 y 39, en su parte de contratos (crítico el 11; prueba obligatoria el 39): `dinero.ts` suma
//   - `montoNoNegativoSchema`: como `montoSchema`, pero acepta "0" y "0.00" (de "0" a "99999.99", con hasta dos decimales); rechaza "-0";
//   - `montoConSignoSchema` (para leer respuestas, la diferencia): `-?` seguido de un monto con exactamente dos decimales;
//   - `restarMontos(a, b)`: la diferencia de dos montos de texto en céntimos enteros (`bigint`), sin `Number` ni `parseFloat`: "126.50" menos "126.49" da
//     "0.01" y al revés "-0.01".
// `montoSchema`, `MONTO_MAXIMO` y `montoCotizadoSchema` no cambian (su prueba es la de 004 y 005). Se cargan con importación dinámica: antes de implementarlos
// la prueba falla con un mensaje claro y no con un error de tipos. Los casos están escritos a mano, de forma independiente de la implementación. Precisión del
// test-writer (la spec no la fija): `restarMontos` recibe montos válidos para `montoNoNegativoSchema` (así se escribe el efectivo contado en la web, "80" o
// "80.5") y devuelve siempre un texto con dos decimales, con "-" delante si es negativo y nunca "-0.00".

interface Resultado {
  success: boolean;
}
interface Esquema {
  safeParse(valor: unknown): Resultado;
}
interface Dinero {
  montoNoNegativoSchema: Esquema;
  montoConSignoSchema: Esquema;
  restarMontos: (a: string, b: string) => string;
}

async function cargar(): Promise<Dinero> {
  const ruta = fileURLToPath(new URL('./dinero.ts', import.meta.url));
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 006a: no se pudo cargar "packages/contratos/src/dinero.ts" (${motivo}).`,
      {
        cause: error,
      },
    );
  }
  for (const nombre of ['montoNoNegativoSchema', 'montoConSignoSchema', 'restarMontos']) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 006a: "packages/contratos/src/dinero.ts" no exporta ${nombre}.`);
    }
  }
  return modulo as unknown as Dinero;
}

describe('criterio 11: montoNoNegativoSchema', () => {
  it.each([
    '0',
    '0.0',
    '0.00',
    '0.01',
    '0.5',
    '1',
    '150',
    '150.5',
    '150.50',
    '99999',
    '99999.9',
    '99999.99',
    '19.99',
    '8.2',
  ])('criterio 11: acepta el texto "%s"', async (texto) => {
    const { montoNoNegativoSchema } = await cargar();

    expect(montoNoNegativoSchema.safeParse(texto).success).toBe(true);
  });

  it.each([
    ['un número JSON entero', 150],
    ['un número JSON con decimales', 150.5],
    ['el número cero', 0],
    ['negativo', '-1'],
    ['negativo con decimales', '-0.01'],
    ['menos cero', '-0'],
    ['menos cero con decimales', '-0.00'],
    ['con tres decimales', '150.505'],
    ['con tres decimales en cero', '150.000'],
    ['en notación científica', '1e2'],
    ['con coma', '150,50'],
    ['con un espacio al inicio', ' 150'],
    ['con un espacio al final', '150 '],
    ['sobre el máximo', '100000'],
    ['sobre el máximo con decimales', '99999.991'],
    ['sobre el máximo con ceros', '100000.00'],
    ['vacío', ''],
    ['nulo', null],
    ['ausente', undefined],
    ['con signo más', '+100'],
    ['con ceros a la izquierda', '0150'],
    ['con punto final', '150.'],
    ['sin parte entera', '.5'],
    ['con letras', 'cien'],
    ['con dígitos que no son ASCII', '١٥٠'],
    ['un objeto', {}],
  ])('criterio 11: rechaza un monto %s', async (_nombre, valor) => {
    const { montoNoNegativoSchema } = await cargar();

    expect(montoNoNegativoSchema.safeParse(valor).success).toBe(false);
  });
});

describe('criterio 28 y 29: montoConSignoSchema (la diferencia de una respuesta)', () => {
  it.each(['0.00', '0.01', '-0.01', '126.50', '-4.50', '4.00', '-100.00', '99999.99', '-99999.99'])(
    'criterio 29: acepta el texto "%s"',
    async (texto) => {
      const { montoConSignoSchema } = await cargar();

      expect(montoConSignoSchema.safeParse(texto).success).toBe(true);
    },
  );

  it.each([
    ['sin decimales', '1'],
    ['con un decimal', '1.5'],
    ['con tres decimales', '1.505'],
    ['solo el signo', '-'],
    ['vacío', ''],
    ['con un espacio al inicio', ' 1.00'],
    ['con dos signos', '--1.00'],
    ['con signo más', '+1.00'],
    ['en notación científica', '1e2'],
    ['con coma', '1,00'],
    ['un número JSON', 5],
    ['nulo', null],
  ])('criterio 29: rechaza un valor %s', async (_nombre, valor) => {
    const { montoConSignoSchema } = await cargar();

    expect(montoConSignoSchema.safeParse(valor).success).toBe(false);
  });
});

describe('criterio 39: restarMontos', () => {
  it.each([
    ['126.50', '126.49', '0.01'],
    ['126.49', '126.50', '-0.01'],
    ['100.00', '100.00', '0.00'],
    ['100', '100.00', '0.00'],
    ['80', '84.50', '-4.50'],
    ['84.50', '80', '4.50'],
    ['0', '126.50', '-126.50'],
    ['126.50', '0', '126.50'],
    ['0', '0', '0.00'],
    ['99999.99', '0', '99999.99'],
    ['99999.99', '0.01', '99999.98'],
    ['0.01', '99999.99', '-99999.98'],
    ['80.5', '80.49', '0.01'],
    ['1200.5', '0.5', '1200.00'],
  ])('criterio 39: "%s" menos "%s" da "%s"', async (a, b, esperado) => {
    const { restarMontos } = await cargar();

    expect(restarMontos(a, b)).toBe(esperado);
  });

  it.each([
    ['0.3', '0.1', '0.20'],
    ['0.1', '0.3', '-0.20'],
    ['1.15', '1.1', '0.05'],
    ['8.2', '8.1', '0.10'],
    ['4.35', '4.34', '0.01'],
  ])(
    'criterio 39: montos que en coma flotante no cuadran: "%s" menos "%s" da exactamente "%s"',
    async (a, b, esperado) => {
      const { restarMontos } = await cargar();

      expect(restarMontos(a, b)).toBe(esperado);
    },
  );

  it('criterio 39: el resultado de dos montos iguales es "0.00" y nunca "-0.00"', async () => {
    const { restarMontos } = await cargar();

    for (const monto of ['0', '0.00', '0.01', '126.50', '99999.99']) {
      expect(restarMontos(monto, monto)).toBe('0.00');
    }
  });

  it('criterio 39: restar y volver a restar da el signo contrario (a - b = -(b - a)) con muchos montos', async () => {
    const { restarMontos } = await cargar();
    const montos = ['0', '0.01', '0.1', '0.99', '1', '19.99', '126.5', '126.50', '4999.99', '99999.99'];

    for (const a of montos) {
      for (const b of montos) {
        const adelante = restarMontos(a, b);
        const atras = restarMontos(b, a);
        expect(atras, `${a} - ${b}`).toBe(
          adelante === '0.00' ? '0.00' : adelante.startsWith('-') ? adelante.slice(1) : `-${adelante}`,
        );
      }
    }
  });

  it('criterio 39: el resultado coincide con la resta en céntimos enteros (bigint) de cada par de montos', async () => {
    const { restarMontos } = await cargar();
    const centimos = (texto: string): bigint => {
      const [enteros = '0', decimales = ''] = texto.split('.');
      return BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, '0') || '0');
    };
    const texto = (valor: bigint): string => {
      const negativo = valor < 0n;
      const absoluto = negativo ? -valor : valor;
      return `${negativo ? '-' : ''}${absoluto / 100n}.${(absoluto % 100n).toString().padStart(2, '0')}`;
    };
    const montos = ['0', '0.01', '0.07', '1.15', '8.2', '33.33', '84.5', '126.50', '1200.05', '99999.99'];

    for (const a of montos) {
      for (const b of montos) {
        expect(restarMontos(a, b), `${a} - ${b}`).toBe(texto(centimos(a) - centimos(b)));
      }
    }
  });
});
