// spec: 006-caja (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../../infraestructura/prisma';

// Criterio 27 (crítico, HU-27, sección 4.3, D-03): el cálculo del esperado y de la diferencia es puro, exacto y sin base de datos.
//   `calcularResumen` y `calcularDiferencia` (`backend/src/modulos/caja/dominio/esperado.ts`, con `Decimal`):
//   esperado en efectivo = monto inicial + ingresos en efectivo - egresos; esperado en Yape = ingresos por Yape; esperado en transferencia = ingresos por
//   transferencia; diferencia = declarado - esperado en efectivo; resultado CUADRA si es 0, SOBRANTE si es mayor y FALTANTE si es menor. Casos: 0.10 + 0.20 da
//   exactamente 0.30; mil ingresos de 0.01 dan 10.00; un declarado de "126.49" frente a "126.50" da "-0.01" y FALTANTE; "0" frente a "0.00" da CUADRA.
//   Ningún paso usa `number`: las pruebas pasan montos que en coma flotante no cuadran y comparan con `Decimal.equals` (no con dos decimales redondeados), así
//   un error de 1e-15 se nota.
// La spec no fija la forma de los argumentos (precisión del test-writer, para que la implementación la siga):
//   calcularResumen({ montoInicial: Decimal, movimientos: { tipo: 'INGRESO' | 'EGRESO'; metodo: MetodoPago; monto: Decimal }[] })
//     -> { ingresos: { efectivo, yape, transferencia }, egresos: { efectivo }, esperado: { efectivo, yape, transferencia } }   (todos Decimal)
//   calcularDiferencia(declarado: Decimal, esperadoEfectivo: Decimal) -> { diferencia: Decimal, resultado: 'CUADRA' | 'SOBRANTE' | 'FALTANTE' }
// Se cargan con importación dinámica: antes de implementarlos la prueba falla con un mensaje claro. Los casos están escritos a mano, de forma independiente de
// la implementación.

type Metodo = 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA';
interface Movimiento {
  tipo: 'INGRESO' | 'EGRESO';
  metodo: Metodo;
  monto: Decimal;
}
interface Resumen {
  ingresos: { efectivo: Decimal; yape: Decimal; transferencia: Decimal };
  egresos: { efectivo: Decimal };
  esperado: { efectivo: Decimal; yape: Decimal; transferencia: Decimal };
}
interface Esperado {
  calcularResumen: (entrada: { montoInicial: Decimal; movimientos: readonly Movimiento[] }) => Resumen;
  calcularDiferencia: (
    declarado: Decimal,
    esperadoEfectivo: Decimal,
  ) => { diferencia: Decimal; resultado: 'CUADRA' | 'SOBRANTE' | 'FALTANTE' };
}

async function cargar(): Promise<Esperado> {
  const ruta = path.join(__dirname, 'esperado.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 006a: no se pudo cargar "backend/src/modulos/caja/dominio/esperado.ts" (${motivo}).`,
      { cause: error },
    );
  }
  for (const nombre of ['calcularResumen', 'calcularDiferencia']) {
    if (typeof modulo[nombre] !== 'function') {
      throw new Error(`Falta la funcionalidad de la 006a: "dominio/esperado.ts" no exporta ${nombre}.`);
    }
  }
  return modulo as unknown as Esperado;
}

const d = (texto: string): Decimal => new Decimal(texto);
const ingreso = (metodo: Metodo, monto: string): Movimiento => ({ tipo: 'INGRESO', metodo, monto: d(monto) });
const egreso = (monto: string): Movimiento => ({ tipo: 'EGRESO', metodo: 'EFECTIVO', monto: d(monto) });
/** Igualdad exacta: un valor que en coma flotante difiere en 1e-15 no es igual. */
const exacto = (valor: unknown, texto: string): boolean => new Decimal(String(valor)).equals(new Decimal(texto));

describe('criterio 27: calcularResumen', () => {
  it('criterio 27: sin movimientos, el esperado en efectivo es el monto inicial y el de Yape y transferencia es 0', async () => {
    const { calcularResumen } = await cargar();

    const resumen = calcularResumen({ montoInicial: d('100'), movimientos: [] });

    expect(exacto(resumen.esperado.efectivo, '100')).toBe(true);
    expect(exacto(resumen.esperado.yape, '0')).toBe(true);
    expect(exacto(resumen.esperado.transferencia, '0')).toBe(true);
    expect(exacto(resumen.ingresos.efectivo, '0')).toBe(true);
    expect(exacto(resumen.egresos.efectivo, '0')).toBe(true);
  });

  it('criterio 27: el ejemplo de la spec: inicial 100.00, ingresos de 42.00 (efectivo), 88.00 (Yape) y 120.00 (transferencia) y un egreso de 15.50 dan esperado 126.50, 88.00 y 120.00', async () => {
    const { calcularResumen } = await cargar();

    const resumen = calcularResumen({
      montoInicial: d('100.00'),
      movimientos: [
        ingreso('EFECTIVO', '42.00'),
        ingreso('YAPE', '88.00'),
        ingreso('TRANSFERENCIA', '120.00'),
        egreso('15.50'),
      ],
    });

    expect(exacto(resumen.ingresos.efectivo, '42')).toBe(true);
    expect(exacto(resumen.ingresos.yape, '88')).toBe(true);
    expect(exacto(resumen.ingresos.transferencia, '120')).toBe(true);
    expect(exacto(resumen.egresos.efectivo, '15.5')).toBe(true);
    expect(exacto(resumen.esperado.efectivo, '126.5')).toBe(true);
    expect(exacto(resumen.esperado.yape, '88')).toBe(true);
    expect(exacto(resumen.esperado.transferencia, '120')).toBe(true);
  });

  it('criterio 27: el Yape y la transferencia no suman al efectivo esperado, y los egresos no los restan (D-04, sección 4.3)', async () => {
    const { calcularResumen } = await cargar();

    const resumen = calcularResumen({
      montoInicial: d('0'),
      movimientos: [ingreso('YAPE', '500'), ingreso('TRANSFERENCIA', '300'), egreso('0.01')],
    });

    expect(exacto(resumen.esperado.efectivo, '-0.01')).toBe(true);
    expect(exacto(resumen.esperado.yape, '500')).toBe(true);
    expect(exacto(resumen.esperado.transferencia, '300')).toBe(true);
  });

  it('criterio 27: 0.10 + 0.20 da exactamente 0.30 (en coma flotante da 0.30000000000000004)', async () => {
    const { calcularResumen } = await cargar();

    const resumen = calcularResumen({
      montoInicial: d('0'),
      movimientos: [ingreso('EFECTIVO', '0.10'), ingreso('EFECTIVO', '0.20')],
    });

    expect(exacto(resumen.ingresos.efectivo, '0.30')).toBe(true);
    expect(exacto(resumen.esperado.efectivo, '0.30')).toBe(true);
  });

  it('criterio 27: mil ingresos de 0.01 dan exactamente 10.00 (sumados como números de coma flotante no dan exactamente 10)', async () => {
    const { calcularResumen } = await cargar();

    const resumen = calcularResumen({
      montoInicial: d('0'),
      movimientos: Array.from({ length: 1000 }, () => ingreso('EFECTIVO', '0.01')),
    });

    expect(exacto(resumen.ingresos.efectivo, '10.00')).toBe(true);
    expect(exacto(resumen.esperado.efectivo, '10.00')).toBe(true);
  });

  it('criterio 27: mil ingresos por Yape de 0.01 y mil egresos de 0.01 también son exactos', async () => {
    const { calcularResumen } = await cargar();

    const resumen = calcularResumen({
      montoInicial: d('10.00'),
      movimientos: [
        ...Array.from({ length: 1000 }, () => ingreso('YAPE', '0.01')),
        ...Array.from({ length: 1000 }, () => egreso('0.01')),
      ],
    });

    expect(exacto(resumen.esperado.yape, '10.00')).toBe(true);
    expect(exacto(resumen.egresos.efectivo, '10.00')).toBe(true);
    expect(exacto(resumen.esperado.efectivo, '0.00')).toBe(true);
  });

  it('criterio 27: montos que en coma flotante no cuadran (0.1, 0.2, 0.7, 1.15, 8.2, 19.99 y 33.33) suman exactamente 63.67 en efectivo', async () => {
    const { calcularResumen } = await cargar();

    const resumen = calcularResumen({
      montoInicial: d('0'),
      movimientos: ['0.1', '0.2', '0.7', '1.15', '8.2', '19.99', '33.33'].map((monto) => ingreso('EFECTIVO', monto)),
    });

    expect(exacto(resumen.ingresos.efectivo, '63.67')).toBe(true);
  });

  it('criterio 27: un monto inicial que en coma flotante no cuadra (0.1) más ingresos de 0.2 y menos un egreso de 0.3 da exactamente 0', async () => {
    const { calcularResumen } = await cargar();

    const resumen = calcularResumen({
      montoInicial: d('0.1'),
      movimientos: [ingreso('EFECTIVO', '0.2'), egreso('0.3')],
    });

    expect(exacto(resumen.esperado.efectivo, '0')).toBe(true);
  });

  it('criterio 27: no depende del orden de los movimientos', async () => {
    const { calcularResumen } = await cargar();
    const movimientos = [
      ingreso('EFECTIVO', '42.00'),
      egreso('15.50'),
      ingreso('YAPE', '88.00'),
      ingreso('EFECTIVO', '0.10'),
    ];

    const normal = calcularResumen({ montoInicial: d('100'), movimientos });
    const alReves = calcularResumen({ montoInicial: d('100'), movimientos: [...movimientos].reverse() });

    expect(exacto(normal.esperado.efectivo, String(alReves.esperado.efectivo))).toBe(true);
    expect(exacto(normal.esperado.efectivo, '126.6')).toBe(true);
  });

  it('criterio 27: no cambia los movimientos que recibe', async () => {
    const { calcularResumen } = await cargar();
    const movimientos = [ingreso('EFECTIVO', '42.00'), egreso('15.50')];
    const copia = movimientos.map((m) => ({ ...m, monto: d(m.monto.toString()) }));

    calcularResumen({ montoInicial: d('100'), movimientos });

    expect(movimientos.map((m) => [m.tipo, m.metodo, m.monto.toString()])).toEqual(
      copia.map((m) => [m.tipo, m.metodo, m.monto.toString()]),
    );
  });
});

describe('criterio 27: calcularDiferencia', () => {
  it.each([
    ['126.49', '126.50', '-0.01', 'FALTANTE'],
    ['126.51', '126.50', '0.01', 'SOBRANTE'],
    ['126.50', '126.50', '0', 'CUADRA'],
    ['0', '0.00', '0', 'CUADRA'],
    ['0.00', '0', '0', 'CUADRA'],
    ['80', '84.50', '-4.50', 'FALTANTE'],
    ['130.50', '126.50', '4', 'SOBRANTE'],
    ['0', '126.50', '-126.50', 'FALTANTE'],
    ['0.30', '0.3', '0', 'CUADRA'],
    ['1.10', '1.00', '0.10', 'SOBRANTE'],
    ['99999.99', '0.01', '99999.98', 'SOBRANTE'],
    ['10', '-0.01', '10.01', 'SOBRANTE'],
  ])(
    'criterio 27: declarado %s frente a esperado %s da diferencia %s y %s',
    async (declarado, esperado, diferencia, resultado) => {
      const { calcularDiferencia } = await cargar();

      const calculado = calcularDiferencia(d(declarado), d(esperado));

      expect(exacto(calculado.diferencia, diferencia), `diferencia ${String(calculado.diferencia)}`).toBe(true);
      expect(calculado.resultado).toBe(resultado);
    },
  );

  it('criterio 27: una diferencia de un céntimo en cualquier sentido no cuadra', async () => {
    const { calcularDiferencia } = await cargar();

    expect(calcularDiferencia(d('0.01'), d('0')).resultado).toBe('SOBRANTE');
    expect(calcularDiferencia(d('0'), d('0.01')).resultado).toBe('FALTANTE');
  });

  it('criterio 27: la diferencia es exacta con montos que en coma flotante no cuadran (0.3 - 0.1 = 0.2; 1.15 - 1.1 = 0.05)', async () => {
    const { calcularDiferencia } = await cargar();

    expect(exacto(calcularDiferencia(d('0.3'), d('0.1')).diferencia, '0.2')).toBe(true);
    expect(exacto(calcularDiferencia(d('1.15'), d('1.1')).diferencia, '0.05')).toBe(true);
    expect(calcularDiferencia(d('0.1').plus(d('0.2')), d('0.3')).resultado).toBe('CUADRA');
  });
});
