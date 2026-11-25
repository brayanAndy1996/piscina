// spec: 007-pagos (pruebas protegidas)
import { types } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Criterio 59 d (crítico, ronda adversarial 3 de la 007a; RN-22, RNF-06): en `idDeAuditoriaOrdenado(fechaHora)` (`backend/src/modulos/auditoria/id-ordenado.ts`) un `Date` es
// un valor con la ranura interna de fecha: el que `Date.prototype.getTime.call(valor)` acepta y que `util.types.isDate(valor)` reconoce, sin importar su prototipo ni el
// contexto donde se creó. Su instante es el de la ranura, no el de un `getTime` propio.
//   - Son un Date: uno de `vm.runInNewContext`, uno con el prototipo cambiado (a `null` o a otro objeto), una instancia de una subclase y uno real con un `getTime` propio.
//     Con un instante válido dan una id que cumple 59 b y lleva los milisegundos de la ranura; con un instante no válido lanzan `RangeError` (59 a).
//   - No son un Date: los primitivos y un `Proxy` (de un Date real o de otro objeto, revocado o con trampas que lanzan). Lanzan `RangeError`, no `TypeError` ni el error de una
//     trampa, y no cambian el estado.
// Los valores con trampas que lanzan se crean dentro de cada caso y nunca se pasan a los nombres de las pruebas ni a los mensajes de `expect`: imprimirlos dispararía las trampas.
// Este archivo no toca `id-ordenado.test.ts` (rondas 1 y 2): tiene su propio `generadorLimpio()`.

type Generador = (fechaHora: Date) => string;

const FORMATO = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const T0 = new Date('2026-11-24T15:00:00.000Z');
const MS_T0 = T0.getTime();

/** El generador de un módulo recién importado (con el estado en blanco). */
async function generadorLimpio(): Promise<Generador> {
  vi.resetModules();
  const ruta = pathToFileURL(path.join(__dirname, 'id-ordenado.ts')).href;
  const modulo = (await import(/* @vite-ignore */ ruta)) as { idDeAuditoriaOrdenado?: Generador };
  if (typeof modulo.idDeAuditoriaOrdenado !== 'function') {
    throw new Error('Falta la funcionalidad de la 001: "id-ordenado.ts" no exporta idDeAuditoriaOrdenado.');
  }
  return modulo.idDeAuditoriaOrdenado;
}

/** Los milisegundos que lleva el id en sus primeros 48 bits. */
function milisegundosDe(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}

/** Comprueba el formato, la unicidad y el orden estrictamente creciente (como texto) de una lista de ids emitidos en ese orden. */
function esperarValidasYCrecientes(ids: readonly string[]): void {
  for (const id of ids) expect(id).toMatch(FORMATO);
  expect(new Set(ids).size).toBe(ids.length);
  for (let i = 1; i < ids.length; i += 1) {
    if (!((ids[i] as string) > (ids[i - 1] as string))) {
      throw new Error(`El id ${i} (${ids[i]}) no es mayor que el anterior (${ids[i - 1]})`);
    }
  }
}

class FechaPropia extends Date {}

/** Un `Date` real de otro contexto (realm). */
function fechaDeVm(ms: number): Date {
  return vm.runInNewContext(`new Date(${ms})`) as Date;
}

/** Un `Date` real con el prototipo cambiado. */
function fechaConPrototipo(ms: number, prototipo: object | null): Date {
  return Object.setPrototypeOf(new Date(ms), prototipo) as Date;
}

/** Un `Date` real con un `getTime` propio que devuelve otro número (cuenta la ranura, no esto). */
function fechaConGetTimePropio(ms: number): Date {
  const fecha = new Date(ms);
  Object.defineProperty(fecha, 'getTime', { value: () => 5, configurable: true, writable: true });
  return fecha;
}

function lanzador(): never {
  throw new Error('trampa propia');
}

// --- Son un Date --------------------------------------------------------------------------------------------------------------------------------------------------------

/** Cada fábrica recibe un instante y devuelve un `Date` real de ese tipo. */
const DATES_REALES: [string, (ms: number) => Date][] = [
  ['un Date de otro contexto (vm.runInNewContext)', fechaDeVm],
  ['un Date real con el prototipo cambiado a null', (ms) => fechaConPrototipo(ms, null)],
  ['un Date real con el prototipo cambiado a un objeto vacío', (ms) => fechaConPrototipo(ms, {})],
  ['una instancia de una subclase de Date', (ms) => new FechaPropia(ms)],
  ['un Date real con un getTime propio que devuelve 5', fechaConGetTimePropio],
];

describe('criterio 59 d: un Date real, de cualquier contexto, prototipo o subclase, con un instante válido da una id válida con los milisegundos de su ranura', () => {
  it.each(DATES_REALES)(
    'criterio 59 d: %s es un Date (util.types.isDate) y es la primera llamada de un generador limpio',
    async (_nombre, fabrica) => {
      const generar = await generadorLimpio();
      const fecha = fabrica(MS_T0);
      expect(types.isDate(fecha)).toBe(true);

      const id = generar(fecha);

      expect(id).toMatch(FORMATO);
      expect(milisegundosDe(id)).toBe(MS_T0);
    },
  );

  it.each(DATES_REALES)(
    'criterio 59 d: %s con una id anterior: la id lleva los milisegundos de la ranura, es válida y mayor que la anterior',
    async (_nombre, fabrica) => {
      const generar = await generadorLimpio();
      const anterior = generar(T0);
      const fecha = fabrica(MS_T0 + 1000);
      expect(types.isDate(fecha)).toBe(true);

      const id = generar(fecha);

      expect(milisegundosDe(id)).toBe(MS_T0 + 1000);
      esperarValidasYCrecientes([anterior, id]);
    },
  );

  it.each(DATES_REALES)(
    'criterio 59 d: %s, repetido varias veces entre ids de un Date común, da ids válidas, distintas y crecientes',
    async (_nombre, fabrica) => {
      const generar = await generadorLimpio();
      const ids: string[] = [];

      for (let i = 0; i < 5; i += 1) {
        const fecha = fabrica(MS_T0);
        expect(types.isDate(fecha)).toBe(true);
        ids.push(generar(fecha), generar(T0));
      }

      esperarValidasYCrecientes(ids);
      for (const id of ids) expect(milisegundosDe(id)).toBe(MS_T0);
    },
  );
});

// Instantes no válidos en esos mismos tipos de Date: se rechazan como cualquier Date (59 a) y no dañan el estado (59 b).
const INSTANTES_NO_VALIDOS: [string, number][] = [
  ['NaN', Number.NaN],
  ['un instante anterior a 1970 (-1 ms)', -1],
  ['un instante que no cabe en 48 bits (2 ** 48 ms)', 2 ** 48],
];

describe('criterio 59 d y a: un Date real de esos tipos con un instante no válido lanza RangeError y no daña el generador', () => {
  for (const [nombreTipo, fabrica] of DATES_REALES) {
    for (const [nombreInstante, ms] of INSTANTES_NO_VALIDOS) {
      it(`criterio 59 d: ${nombreTipo} con ${nombreInstante}: RangeError, y las ids de antes y de después son válidas, distintas y crecientes`, async () => {
        const generar = await generadorLimpio();
        const ids = [generar(T0)];
        const fecha = fabrica(ms);
        expect(types.isDate(fecha)).toBe(true);

        expect(() => generar(fecha)).toThrow(RangeError);
        for (let i = 0; i < 5; i += 1) ids.push(generar(T0));

        esperarValidasYCrecientes(ids);
      });
    }
  }

  it('criterio 59 d: un Date de vm con NaN en la primera llamada de un generador limpio lanza RangeError y la siguiente, válida, lleva los milisegundos de la fecha', async () => {
    const generar = await generadorLimpio();
    const fecha = vm.runInNewContext('new Date(NaN)') as Date;
    expect(types.isDate(fecha)).toBe(true);

    expect(() => generar(fecha)).toThrow(RangeError);
    const id = generar(T0);

    expect(id).toMatch(FORMATO);
    expect(milisegundosDe(id)).toBe(MS_T0);
  });

  it('criterio 59 d: un Date con el prototipo cambiado a null y -1 ms lanza RangeError y la id siguiente es válida y mayor que la anterior', async () => {
    const generar = await generadorLimpio();
    const anterior = generar(T0);
    const fecha = fechaConPrototipo(-1, null);
    expect(types.isDate(fecha)).toBe(true);

    expect(() => generar(fecha)).toThrow(RangeError);
    const siguiente = generar(T0);

    esperarValidasYCrecientes([anterior, siguiente]);
  });
});

// --- No son un Date -----------------------------------------------------------------------------------------------------------------------------------------------

/** Cada fábrica crea el valor dentro del caso: los `Proxy` con trampas que lanzan no se pasan a nombres ni a mensajes. */
const NO_SON_DATE: [string, () => Date][] = [
  [
    'un Proxy revocado de un Date',
    () => {
      const { proxy, revoke } = Proxy.revocable(new Date(MS_T0), {});
      revoke();
      return proxy;
    },
  ],
  [
    'un Proxy revocado de un objeto',
    () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      return proxy as unknown as Date;
    },
  ],
  [
    'un Proxy de un Date con la trampa getPrototypeOf que lanza',
    () => new Proxy(new Date(MS_T0), { getPrototypeOf: lanzador }),
  ],
  ['un Proxy de un Date con la trampa get que lanza', () => new Proxy(new Date(MS_T0), { get: lanzador })],
  ['un Proxy de un Date con la trampa has que lanza', () => new Proxy(new Date(MS_T0), { has: lanzador })],
  [
    'un Proxy de un Date con la trampa getOwnPropertyDescriptor que lanza',
    () => new Proxy(new Date(MS_T0), { getOwnPropertyDescriptor: lanzador }),
  ],
  [
    'un Proxy de un Date con todas esas trampas que lanzan',
    () =>
      new Proxy(new Date(MS_T0), {
        getPrototypeOf: lanzador,
        get: lanzador,
        has: lanzador,
        getOwnPropertyDescriptor: lanzador,
      }),
  ],
  ['un Proxy de un Date sin trampas', () => new Proxy(new Date(MS_T0), {})],
  ['un Proxy de un Date de otro contexto sin trampas', () => new Proxy(fechaDeVm(MS_T0), {})],
  [
    'un Proxy de un objeto con el prototipo de Date y un getTime propio que devuelve T0',
    () => new Proxy(Object.setPrototypeOf({ getTime: () => MS_T0 }, Date.prototype) as Date, {}),
  ],
  [
    'un Proxy de un objeto cualquiera con un getTime propio',
    () => new Proxy({ getTime: () => MS_T0 }, {}) as unknown as Date,
  ],
  [
    'un Proxy de un objeto cualquiera con trampas que lanzan',
    () => new Proxy({}, { getPrototypeOf: lanzador, get: lanzador, has: lanzador }) as unknown as Date,
  ],
  [
    'un Proxy de una función con la trampa get que lanza',
    () => new Proxy(function () {}, { get: lanzador }) as unknown as Date,
  ],
  ['un bigint (0n)', () => 0n as unknown as Date],
  ['un bigint con el valor de T0', () => BigInt(MS_T0) as unknown as Date],
  ['un símbolo', () => Symbol('fecha') as unknown as Date],
  ['true', () => true as unknown as Date],
  ['false', () => false as unknown as Date],
  ['un texto de fecha', () => '2026-11-24T15:00:00.000Z' as unknown as Date],
  ['un número con el valor de T0', () => MS_T0 as unknown as Date],
];

describe('criterio 59 d: un Proxy o un primitivo no es un Date y lanza RangeError, no TypeError ni el error de una trampa', () => {
  it.each(NO_SON_DATE)(
    'criterio 59 d: %s no es un Date (util.types.isDate) y lanza RangeError',
    async (_nombre, fabrica) => {
      const generar = await generadorLimpio();
      const valor = fabrica();
      expect(types.isDate(valor)).toBe(false);

      expect(() => generar(valor)).toThrow(RangeError);
    },
  );

  it.each(NO_SON_DATE)('criterio 59 d: %s no devuelve un id', async (_nombre, fabrica) => {
    const generar = await generadorLimpio();
    const valor = fabrica();
    let resultado: string;

    try {
      generar(valor);
      resultado = 'devolvió un id';
    } catch (error) {
      resultado = error instanceof RangeError ? 'RangeError' : 'otro error';
    }

    expect(resultado).toBe('RangeError');
  });

  it.each(NO_SON_DATE)(
    'criterio 59 b: una id válida antes y varias después del rechazo de %s: todas con el formato, distintas y crecientes',
    async (_nombre, fabrica) => {
      const generar = await generadorLimpio();
      const ids = [generar(T0)];
      const valor = fabrica();
      expect(types.isDate(valor)).toBe(false);

      expect(() => generar(valor)).toThrow(RangeError);
      for (let i = 0; i < 5; i += 1) ids.push(generar(T0));
      ids.push(generar(new Date(MS_T0 + 1)));

      esperarValidasYCrecientes(ids);
    },
  );

  it('criterio 59 b: la primera llamada de un generador limpio con un Proxy lanza y la siguiente, válida, da una id con los milisegundos de la fecha', async () => {
    const generar = await generadorLimpio();
    const valor = new Proxy(new Date(MS_T0), { getPrototypeOf: lanzador, get: lanzador });
    expect(types.isDate(valor)).toBe(false);

    expect(() => generar(valor)).toThrow(RangeError);
    const id = generar(T0);

    expect(id).toMatch(FORMATO);
    expect(milisegundosDe(id)).toBe(MS_T0);
  });

  it('criterio 59 b: todos los Proxy y primitivos seguidos, entre ids válidas, no dañan el orden ni el formato', async () => {
    const generar = await generadorLimpio();
    const ids: string[] = [generar(T0)];

    for (const [, fabrica] of NO_SON_DATE) {
      expect(() => generar(fabrica())).toThrow(RangeError);
      ids.push(generar(T0));
    }
    ids.push(generar(new Date(MS_T0 + 1)));

    esperarValidasYCrecientes(ids);
  });

  it('criterio 59 b: un rechazo no atrasa el contador: tras 50 ids en el mismo milisegundo y un Proxy rechazado, las 50 siguientes son mayores', async () => {
    const generar = await generadorLimpio();
    const antes = Array.from({ length: 50 }, () => generar(T0));

    expect(() => generar(new Proxy(new Date(MS_T0), { get: lanzador }))).toThrow(RangeError);
    const despues = Array.from({ length: 50 }, () => generar(T0));

    esperarValidasYCrecientes([...antes, ...despues]);
  });
});
