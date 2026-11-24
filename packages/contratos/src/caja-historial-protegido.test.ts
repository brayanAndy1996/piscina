// spec: 006-caja (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import * as cajaContratos from './caja';
import * as indice from './index';

// Criterio 40, PQ3, PQ4 y PQ13 (crítico, HU-27): los contratos del historial de cajas, en `packages/contratos/src/caja.ts`:
//   - `filtroHistorialCajasSchema`: objeto { desde?, hasta? } con `fechaSchema` y, si vienen los dos, las reglas del rango de PQ3 (`desde` posterior a
//     `hasta` -> error en `desde`: "La fecha inicial no puede ser posterior a la final."; más de 366 días contando los dos extremos (hasta - desde > 365) ->
//     error en `desde`: "El rango puede ser de como mucho 366 días."); un parámetro repetido o con corchetes (un arreglo o un objeto) es un error en su campo;
//     los errores de formato van primero, uno por campo, en el orden `desde`, `hasta`; si un campo tiene formato inválido, la regla del rango no se evalúa;
//   - `cajaHistorialSchema` (estricto, PQ4): exactamente `id`, `fecha`, `estado`, `deOtroDia`, `montoInicial`, `abiertaPor` (`personaCajaSchema`),
//     `totalIngresos` ({ efectivo, yape, transferencia }), `totalEgresos` ({ efectivo }) y `ultimoCierre` ({ numero, montoDeclarado, diferencia, resultado,
//     tardio, cerradoPor, cerradoEn } o null); los montos sin signo con `montoDeLecturaSchema`, la diferencia con `montoConSignoSchema`, `resultado` con
//     `resultadoCierreSchema`, `cerradoEn` en ISO;
//   - `respuestaHistorialCajasSchema` = { desde: fechaSchema, hasta: fechaSchema, cajas };
//   - `LIMITES_HISTORIAL_CAJAS` = { diasPorDefecto: 31, diasMaximos: 366 }.
// Se cargan por su nombre: antes de implementarlos la prueba falla con un mensaje claro de "falta la funcionalidad", no con un error de importación.

interface Esquema {
  safeParse(valor: unknown): {
    success: boolean;
    data?: unknown;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  };
}

function cargar<T>(nombre: string, desde: Record<string, unknown> = cajaContratos): T {
  const valor = desde[nombre];
  if (valor === undefined) {
    throw new Error(`Falta la funcionalidad de la 006b: "packages/contratos/src/caja.ts" no exporta ${nombre}.`);
  }
  return valor as T;
}

const filtro = () => cargar<Esquema>('filtroHistorialCajasSchema');
const cajaHistorial = () => cargar<Esquema>('cajaHistorialSchema');
const respuesta = () => cargar<Esquema>('respuestaHistorialCajasSchema');

const MENSAJE_INVERTIDO = 'La fecha inicial no puede ser posterior a la final.';
const MENSAJE_RANGO = 'El rango puede ser de como mucho 366 días.';

function errores(esquema: Esquema, valor: unknown): { campo: string; mensaje: string }[] {
  const resultado = esquema.safeParse(valor);
  expect(resultado.success, `se esperaba un error con ${JSON.stringify(valor)}`).toBe(false);
  return (resultado.error?.issues ?? []).map((issue) => ({
    campo: issue.path.map(String).join('.'),
    mensaje: issue.message,
  }));
}

describe('LIMITES_HISTORIAL_CAJAS (PQ13)', () => {
  it('son 31 días por defecto y 366 como máximo', () => {
    expect(cargar<unknown>('LIMITES_HISTORIAL_CAJAS')).toEqual({ diasPorDefecto: 31, diasMaximos: 366 });
  });
});

describe('filtroHistorialCajasSchema (PQ3)', () => {
  it.each([
    [{}],
    [{ desde: '2026-11-01' }],
    [{ hasta: '2026-11-30' }],
    [{ desde: '2026-11-01', hasta: '2026-11-30' }],
    [{ desde: '2026-11-01', hasta: '2026-11-01' }],
    [{ desde: '2025-11-11', hasta: '2026-11-11' }],
    [{ desde: '2024-02-29', hasta: '2025-02-28' }],
    [{ desde: '2024-01-01', hasta: '2024-12-31' }],
    [{ desde: '0001-01-01', hasta: '0001-01-15' }],
    [{ desde: '2099-12-01', hasta: '2099-12-31' }],
  ])('acepta %j (366 días o menos, desde no posterior a hasta)', (valor) => {
    const resultado = filtro().safeParse(valor);

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
    expect(resultado.data).toEqual(valor);
  });

  it.each([
    [{ desde: '2025-11-10', hasta: '2026-11-11' }, 'desde', MENSAJE_RANGO],
    [{ desde: '2023-12-31', hasta: '2024-12-31' }, 'desde', MENSAJE_RANGO],
    [{ desde: '2024-02-29', hasta: '2025-03-01' }, 'desde', MENSAJE_RANGO],
    [{ desde: '0001-01-01', hasta: '0002-01-02' }, 'desde', MENSAJE_RANGO],
    [{ desde: '2026-11-12', hasta: '2026-11-11' }, 'desde', MENSAJE_INVERTIDO],
    [{ desde: '2027-01-01', hasta: '2026-12-31' }, 'desde', MENSAJE_INVERTIDO],
  ])('rechaza %j con un solo error, en %s: "%s"', (valor, campo, mensaje) => {
    expect(errores(filtro(), valor)).toEqual([{ campo, mensaje }]);
  });

  it.each([
    [{ desde: '2026-02-30' }, ['desde']],
    [{ hasta: '2026-02-30' }, ['hasta']],
    [{ desde: '2026-13-01' }, ['desde']],
    [{ hasta: '2026-02-29' }, ['hasta']],
    [{ desde: '2026-11-01T00:00' }, ['desde']],
    [{ desde: '01/11/2026' }, ['desde']],
    [{ desde: '2026-1-5' }, ['desde']],
    [{ desde: 'hoy' }, ['desde']],
    [{ desde: '' }, ['desde']],
    [{ hasta: '' }, ['hasta']],
    [{ desde: 20261101 }, ['desde']],
    [{ desde: null }, ['desde']],
    [{ desde: ['2026-11-01', '2026-11-02'] }, ['desde']],
    [{ desde: ['2026-11-01'] }, ['desde']],
    [{ hasta: ['2026-11-01', '2026-11-01'] }, ['hasta']],
    [{ desde: { x: '2026-11-01' } }, ['desde']],
    [{ hasta: { x: '2026-11-01' } }, ['hasta']],
    [{ desde: 'x', hasta: 'y' }, ['desde', 'hasta']],
    [{ desde: '2026-02-30', hasta: '2026-02-31' }, ['desde', 'hasta']],
    [{ desde: ['a', 'b'], hasta: ['c'] }, ['desde', 'hasta']],
    [{ desde: '2026-02-30', hasta: '2026-01-01' }, ['desde']],
    [{ desde: '2027-01-01', hasta: '2026-02-30' }, ['hasta']],
    [{ desde: '2020-01-01', hasta: '' }, ['hasta']],
  ])(
    'rechaza %j con errores solo de formato en %j (uno por campo, desde primero, sin evaluar el rango)',
    (valor, campos) => {
      expect(errores(filtro(), valor).map((error) => error.campo)).toEqual(campos);
    },
  );
});

const UUID_CAJA = '6f1c6d3e-3b52-4d4b-9a40-0a7a3d6c9f11';
const UUID_PERSONA = '0b5f6b2e-2a1c-4e0e-8f55-7c0a9a1d2b33';
const persona = { id: UUID_PERSONA, nombres: 'Lucia', apellidos: 'Benites' };
const ultimoCierre = {
  numero: 1,
  montoDeclarado: '120.00',
  diferencia: '-6.50',
  resultado: 'FALTANTE',
  tardio: false,
  cerradoPor: persona,
  cerradoEn: '2026-11-10T23:00:00.000Z',
};
const cajaValida = {
  id: UUID_CAJA,
  fecha: '2026-11-10',
  estado: 'CERRADA',
  deOtroDia: true,
  montoInicial: '100.00',
  abiertaPor: persona,
  totalIngresos: { efectivo: '42.00', yape: '88.00', transferencia: '120.00' },
  totalEgresos: { efectivo: '15.50' },
  ultimoCierre,
};

/** Una copia profunda de la caja válida con el cambio indicado. */
function con(cambios: Record<string, unknown>): Record<string, unknown> {
  return { ...structuredClone(cajaValida), ...cambios };
}

describe('cajaHistorialSchema (PQ4)', () => {
  it('acepta una caja cerrada con su último cierre, una abierta sin cierre y una reabierta (ABIERTA con ultimoCierre)', () => {
    for (const valor of [
      cajaValida,
      con({ estado: 'ABIERTA', deOtroDia: false, ultimoCierre: null }),
      con({ estado: 'ABIERTA', ultimoCierre: { ...ultimoCierre, numero: 2, resultado: 'CUADRA', diferencia: '0.00' } }),
      con({ ultimoCierre: { ...ultimoCierre, resultado: 'SOBRANTE', diferencia: '0.30', tardio: true } }),
      con({ montoInicial: '0.00', totalIngresos: { efectivo: '0.00', yape: '0.00', transferencia: '0.00' } }),
    ]) {
      const resultado = cajaHistorial().safeParse(valor);

      expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
    }
  });

  it.each([
    'id',
    'fecha',
    'estado',
    'deOtroDia',
    'montoInicial',
    'abiertaPor',
    'totalIngresos',
    'totalEgresos',
    'ultimoCierre',
  ])('rechaza una caja sin la clave %s (es obligatoria; ultimoCierre vale null, no puede faltar)', (clave) => {
    const sin = { ...structuredClone(cajaValida) } as Record<string, unknown>;
    delete sin[clave];

    expect(errores(cajaHistorial(), sin).length).toBeGreaterThan(0);
  });

  it.each([
    ['una clave de más', con({ abiertaEn: '2026-11-10T14:00:00.000Z' })],
    ['el DNI de más', con({ dni: '12345678' })],
    ['los movimientos de más', con({ movimientos: [] })],
    ['los cierres de más', con({ cierres: [] })],
    ['el resumen de más', con({ resumen: {} })],
    ['el DNI de quien abrió', con({ abiertaPor: { ...persona, dni: '12345678' } })],
    ['quien abrió sin id', con({ abiertaPor: { nombres: 'Lucia', apellidos: 'Benites' } })],
    ['quien abrió con un id que no es UUID', con({ abiertaPor: { ...persona, id: 'x' } })],
    ['un id de caja que no es UUID', con({ id: 'x' })],
    ['una fecha que no existe', con({ fecha: '2026-02-30' })],
    ['una fecha con hora', con({ fecha: '2026-11-10T00:00:00Z' })],
    ['un estado desconocido', con({ estado: 'ANULADA' })],
    ['un estado en minúsculas', con({ estado: 'abierta' })],
    ['deOtroDia como texto', con({ deOtroDia: 'si' })],
    ['un monto inicial sin decimales', con({ montoInicial: '100' })],
    ['un monto inicial con un decimal', con({ montoInicial: '100.5' })],
    ['un monto inicial como número', con({ montoInicial: 100 })],
    ['un monto inicial negativo', con({ montoInicial: '-1.00' })],
    ['un monto inicial en notación científica', con({ montoInicial: '1e2' })],
    ['ingresos sin transferencia', con({ totalIngresos: { efectivo: '1.00', yape: '1.00' } })],
    [
      'ingresos con un método de más',
      con({ totalIngresos: { efectivo: '1.00', yape: '1.00', transferencia: '1.00', tarjeta: '1.00' } }),
    ],
    ['un ingreso negativo', con({ totalIngresos: { efectivo: '-1.00', yape: '1.00', transferencia: '1.00' } })],
    [
      'un ingreso con tres decimales',
      con({ totalIngresos: { efectivo: '1.005', yape: '1.00', transferencia: '1.00' } }),
    ],
    ['egresos con yape (los egresos son solo en efectivo)', con({ totalEgresos: { efectivo: '1.00', yape: '1.00' } })],
    ['egresos sin efectivo', con({ totalEgresos: {} })],
    ['egresos como número', con({ totalEgresos: 15.5 })],
    ['ultimoCierre con una clave de más', con({ ultimoCierre: { ...ultimoCierre, observacion: 'x' } })],
    ['ultimoCierre con el esperado de más', con({ ultimoCierre: { ...ultimoCierre, esperado: {} } })],
    ['ultimoCierre sin quién cerró', con({ ultimoCierre: { ...ultimoCierre, cerradoPor: undefined } })],
    [
      'ultimoCierre con quién cerró con DNI',
      con({ ultimoCierre: { ...ultimoCierre, cerradoPor: { ...persona, dni: '1' } } }),
    ],
    ['ultimoCierre con el declarado sin decimales', con({ ultimoCierre: { ...ultimoCierre, montoDeclarado: '120' } })],
    ['ultimoCierre con la diferencia con un decimal', con({ ultimoCierre: { ...ultimoCierre, diferencia: '-6.5' } })],
    ['ultimoCierre con la diferencia "-0.00"', con({ ultimoCierre: { ...ultimoCierre, diferencia: '-0.00' } })],
    ['ultimoCierre con la diferencia como número', con({ ultimoCierre: { ...ultimoCierre, diferencia: -6.5 } })],
    ['ultimoCierre con un resultado desconocido', con({ ultimoCierre: { ...ultimoCierre, resultado: 'OTRO' } })],
    ['ultimoCierre con tardio como texto', con({ ultimoCierre: { ...ultimoCierre, tardio: 'no' } })],
    ['ultimoCierre con el número como texto', con({ ultimoCierre: { ...ultimoCierre, numero: '1' } })],
    ['ultimoCierre con una fecha que no es ISO', con({ ultimoCierre: { ...ultimoCierre, cerradoEn: '10/11/2026' } })],
    ['ultimoCierre con una fecha que no existe', con({ ultimoCierre: { ...ultimoCierre, cerradoEn: 'ayer' } })],
  ])('rechaza %s', (_nombre, valor) => {
    expect(errores(cajaHistorial(), valor).length).toBeGreaterThan(0);
  });

  it('acepta una diferencia mayor que 100000.00 en una caja de lecturas grandes (el tope de lectura es el de numeric(12,2))', () => {
    const grande = con({
      montoInicial: '123456.00',
      totalIngresos: { efectivo: '9999999999.99', yape: '0.00', transferencia: '0.00' },
      ultimoCierre: { ...ultimoCierre, montoDeclarado: '0.00', diferencia: '-123456.78' },
    });

    expect(cajaHistorial().safeParse(grande).success).toBe(true);
  });
});

describe('respuestaHistorialCajasSchema (PQ3, PQ13)', () => {
  it('acepta { desde, hasta, cajas } con la lista vacía y con cajas', () => {
    for (const valor of [
      { desde: '2026-10-12', hasta: '2026-11-11', cajas: [] },
      { desde: '0001-01-01', hasta: '0001-01-15', cajas: [cajaValida] },
      { desde: '2026-10-12', hasta: '2026-11-11', cajas: [cajaValida, con({ estado: 'ABIERTA', ultimoCierre: null })] },
    ]) {
      const resultado = respuesta().safeParse(valor);

      expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
    }
  });

  it.each([
    ['sin desde', { hasta: '2026-11-11', cajas: [] }],
    ['sin hasta', { desde: '2026-10-12', cajas: [] }],
    ['sin cajas', { desde: '2026-10-12', hasta: '2026-11-11' }],
    ['con una clave de más', { desde: '2026-10-12', hasta: '2026-11-11', cajas: [], total: 0 }],
    ['con la paginación de más', { desde: '2026-10-12', hasta: '2026-11-11', cajas: [], siguiente: null }],
    ['con un desde que no existe', { desde: '2026-02-30', hasta: '2026-11-11', cajas: [] }],
    ['con un hasta con hora', { desde: '2026-10-12', hasta: '2026-11-11T00:00', cajas: [] }],
    ['con cajas que no son cajas', { desde: '2026-10-12', hasta: '2026-11-11', cajas: [{ id: 'x' }] }],
    ['con una caja con el DNI de más', { desde: '2026-10-12', hasta: '2026-11-11', cajas: [con({ dni: '1' })] }],
    ['con cajas que no es una lista', { desde: '2026-10-12', hasta: '2026-11-11', cajas: cajaValida }],
    ['solo con cajas (el contrato anterior)', { cajas: [] }],
  ])('rechaza una respuesta %s', (_nombre, valor) => {
    expect(errores(respuesta(), valor).length).toBeGreaterThan(0);
  });
});

describe('el índice del paquete exporta los contratos del historial (PQ13)', () => {
  it.each([
    'filtroHistorialCajasSchema',
    'cajaHistorialSchema',
    'respuestaHistorialCajasSchema',
    'LIMITES_HISTORIAL_CAJAS',
  ])('exporta %s desde @aquagestion/contratos (index.ts)', (nombre) => {
    expect(cargar<unknown>(nombre, indice), `${nombre} debe salir también del índice`).toBe(cargar<unknown>(nombre));
  });
});
