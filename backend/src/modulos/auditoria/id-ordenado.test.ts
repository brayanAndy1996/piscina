// spec: 007-pagos (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Criterio 59 (crítico, ronda adversarial 1 de la 007a; RN-22, RNF-06): `idDeAuditoriaOrdenado(fechaHora)` (`backend/src/modulos/auditoria/id-ordenado.ts`) genera ids
// UUID versión 7: los milisegundos de `fechaHora`, un contador que no retrocede dentro del proceso y el resto al azar.
//   a) Una fecha no válida (un valor que no es un `Date`; un `Date` con `getTime()` igual a `NaN`; un instante anterior a `1970-01-01T00:00:00.000Z`; un instante
//      desde `+010889-08-02T05:31:50.656Z`, que no cabe en 48 bits) lanza `RangeError`, no devuelve un id y no cambia el estado del generador (el último milisegundo
//      y el contador).
//   b) Después de una o varias llamadas rechazadas, cada llamada con una fecha válida devuelve un id con el formato `^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
//      distinto de todos los anteriores del proceso y mayor, como texto, que cada uno de ellos (también que los emitidos antes del rechazo). Se cumple también con la
//      misma fecha repetida más de 4096 veces seguidas (el contador desborda al milisegundo siguiente) y con una fecha anterior a la última usada (un reloj que retrocede).
//   c) Si el contador desborda en el último milisegundo representable (2^48 - 1), lanza `RangeError` sin cambiar su estado y desde ahí toda llamada lanza `RangeError`:
//      no queda un id mayor que dar.
// El estado es del módulo: cada caso que necesita un generador limpio lo importa de nuevo con `vi.resetModules()`. La comparación «mayor como texto» es la de `<` entre
// cadenas (hexadecimales en minúscula y de ancho fijo).

type Generador = (fechaHora: Date) => string;

const FORMATO = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ULTIMO_MS = 2 ** 48 - 1;
const T0 = new Date('2026-11-24T15:00:00.000Z');

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

const FECHAS_NO_VALIDAS: [string, () => Date][] = [
  ['un Date con getTime() NaN', () => new Date(Number.NaN)],
  ['un instante anterior a 1970 (-1 ms)', () => new Date(-1)],
  ['un instante muy anterior a 1970', () => new Date('1969-12-31T23:59:59.999Z')],
  ['un instante que no cabe en 48 bits (2 ** 48 ms)', () => new Date(2 ** 48)],
  [
    'el primer instante que no cabe en 48 bits (+010889-08-02T05:31:50.656Z)',
    () => new Date('+010889-08-02T05:31:50.656Z'),
  ],
  ['un texto de fecha, que no es un Date', () => '2026-11-24' as unknown as Date],
  ['un número, que no es un Date', () => 0 as unknown as Date],
  ['null', () => null as unknown as Date],
  ['undefined', () => undefined as unknown as Date],
  ['un objeto con getTime(), que no es un Date', () => ({ getTime: () => T0.getTime() }) as unknown as Date],
];

describe('criterio 59 a: una fecha no válida lanza RangeError y no devuelve un id', () => {
  it.each(FECHAS_NO_VALIDAS)('criterio 59 a: %s', async (_nombre, fecha) => {
    const generar = await generadorLimpio();

    expect(() => generar(fecha())).toThrow(RangeError);
  });

  it('criterio 59 a: el primer instante representable (1970-01-01T00:00:00.000Z) y el último (2 ** 48 - 1) sí son válidos', async () => {
    const generar = await generadorLimpio();

    expect(generar(new Date(0))).toMatch(FORMATO);
    expect(generar(new Date(ULTIMO_MS))).toMatch(FORMATO);
  });
});

describe('criterio 59 a y b: el rechazo no cambia el estado y las llamadas siguientes no se ven afectadas', () => {
  it.each(FECHAS_NO_VALIDAS)(
    'criterio 59 b: una id válida antes y varias después de un rechazo (%s): todas con el formato, distintas y crecientes',
    async (_nombre, fecha) => {
      const generar = await generadorLimpio();
      const ids = [generar(T0)];

      expect(() => generar(fecha())).toThrow(RangeError);
      for (let i = 0; i < 5; i += 1) ids.push(generar(T0));

      esperarValidasYCrecientes(ids);
      for (const id of ids) expect(milisegundosDe(id)).toBe(T0.getTime());
    },
  );

  it('criterio 59 b: la primera llamada de un generador limpio con una fecha no válida lanza y la siguiente, válida, da un id con los milisegundos de la fecha', async () => {
    const generar = await generadorLimpio();

    expect(() => generar(new Date(Number.NaN))).toThrow(RangeError);
    const id = generar(T0);

    expect(id).toMatch(FORMATO);
    expect(id).not.toContain('NaN');
    expect(milisegundosDe(id)).toBe(T0.getTime());
  });

  it('criterio 59 b: varios rechazos seguidos, de todas las formas, entre ids válidas no dañan el orden ni el formato', async () => {
    const generar = await generadorLimpio();
    const ids: string[] = [];

    ids.push(generar(T0));
    for (const [, fecha] of FECHAS_NO_VALIDAS) {
      expect(() => generar(fecha())).toThrow(RangeError);
      ids.push(generar(T0));
      ids.push(generar(new Date(T0.getTime() + 1)));
    }

    esperarValidasYCrecientes(ids);
  });

  it('criterio 59 b: un rechazo no atrasa el contador: la id que sigue es mayor que todas las emitidas antes en el mismo milisegundo', async () => {
    const generar = await generadorLimpio();
    const antes = Array.from({ length: 50 }, () => generar(T0));

    expect(() => generar(new Date(Number.NaN))).toThrow(RangeError);
    const despues = Array.from({ length: 50 }, () => generar(T0));

    esperarValidasYCrecientes([...antes, ...despues]);
  });

  it('criterio 59 b: un rechazo por una fecha de otro milisegundo no mueve el último milisegundo: las ids siguientes en T0 siguen creciendo', async () => {
    const generar = await generadorLimpio();
    const ids = [generar(T0)];

    expect(() => generar(new Date(2 ** 48))).toThrow(RangeError);
    expect(() => generar(new Date(-1))).toThrow(RangeError);
    ids.push(generar(T0), generar(T0), generar(new Date(T0.getTime() + 1)));

    esperarValidasYCrecientes(ids);
  });
});

// Ronda adversarial 2 de la 007a: un objeto con el prototipo de Date pasa `instanceof Date`, pero no es un Date (no tiene el valor interno de fecha); `getTime()` puede
// lanzar un TypeError, lanzar otro error, devolver un número que parece válido o algo que no es un número. En todos los casos es «un valor que no es un Date»: RangeError.
const FALSOS_DATE: [string, () => Date][] = [
  ['Object.create(Date.prototype) (getTime() lanza TypeError)', () => Object.create(Date.prototype) as Date],
  [
    'un objeto con prototipo Date y getTime() propio que devuelve 5',
    () => Object.setPrototypeOf({ getTime: () => 5 }, Date.prototype) as Date,
  ],
  [
    'un objeto con prototipo Date y getTime() propio que devuelve un instante válido',
    () => Object.setPrototypeOf({ getTime: () => T0.getTime() }, Date.prototype) as Date,
  ],
  [
    'un objeto con prototipo Date y getTime() propio que lanza un Error',
    () =>
      Object.setPrototypeOf(
        {
          getTime: () => {
            throw new Error('getTime roto');
          },
        },
        Date.prototype,
      ) as Date,
  ],
  [
    'un objeto con prototipo Date y getTime() propio que devuelve un texto',
    () => Object.setPrototypeOf({ getTime: () => '5' }, Date.prototype) as Date,
  ],
  [
    'un objeto con prototipo Date y getTime() propio que devuelve NaN',
    () => Object.setPrototypeOf({ getTime: () => Number.NaN }, Date.prototype) as Date,
  ],
];

describe('criterio 59 a y b (ronda adversarial 2 de la 007a): un objeto con prototipo Date que no es un Date lanza RangeError', () => {
  it.each(FALSOS_DATE)('criterio 59 a: %s lanza RangeError, no TypeError ni otro error', async (_nombre, fecha) => {
    const generar = await generadorLimpio();

    expect(() => generar(fecha())).toThrow(RangeError);
  });

  it.each(FALSOS_DATE)(
    'criterio 59 b: una id válida antes y varias después del rechazo de %s: todas con el formato, distintas y crecientes',
    async (_nombre, fecha) => {
      const generar = await generadorLimpio();
      const ids = [generar(T0)];

      expect(() => generar(fecha())).toThrow(RangeError);
      for (let i = 0; i < 5; i += 1) ids.push(generar(T0));
      ids.push(generar(new Date(T0.getTime() + 1)));

      esperarValidasYCrecientes(ids);
    },
  );

  it('criterio 59 b: varios falsos Date seguidos entre ids válidas no dañan el orden ni el formato', async () => {
    const generar = await generadorLimpio();
    const ids: string[] = [];

    ids.push(generar(T0));
    for (const [, fecha] of FALSOS_DATE) {
      expect(() => generar(fecha())).toThrow(RangeError);
      ids.push(generar(T0));
    }

    esperarValidasYCrecientes(ids);
  });
});

describe('criterio 59 b: orden, unicidad y formato con muchas llamadas y con el reloj hacia atrás', () => {
  it('criterio 59 b: la misma fecha repetida 5000 veces seguidas (el contador desborda al milisegundo siguiente) da ids válidas, distintas y crecientes', async () => {
    const generar = await generadorLimpio();

    const ids = Array.from({ length: 5000 }, () => generar(T0));

    esperarValidasYCrecientes(ids);
  });

  it('criterio 59 b: 5000 llamadas con la misma fecha, un rechazo en medio y 5000 más siguen siendo válidas, distintas y crecientes', async () => {
    const generar = await generadorLimpio();
    const ids = Array.from({ length: 5000 }, () => generar(T0));

    expect(() => generar(new Date(Number.NaN))).toThrow(RangeError);
    for (let i = 0; i < 5000; i += 1) ids.push(generar(T0));

    esperarValidasYCrecientes(ids);
  });

  it('criterio 59 b: una fecha anterior a la última usada (un reloj que retrocede) da una id válida y mayor que todas las anteriores', async () => {
    const generar = await generadorLimpio();
    const ids = [generar(T0), generar(new Date(T0.getTime() + 5000))];

    ids.push(generar(new Date(T0.getTime() - 60_000)), generar(new Date(0)), generar(T0));

    esperarValidasYCrecientes(ids);
  });

  it('criterio 59 b: un reloj que retrocede alternado con la misma fecha, 10000 llamadas, da ids válidas, distintas y crecientes', async () => {
    const generar = await generadorLimpio();
    const ids: string[] = [];

    for (let i = 0; i < 10_000; i += 1) ids.push(generar(i % 3 === 0 ? new Date(T0.getTime() - 1000) : T0));

    esperarValidasYCrecientes(ids);
  });

  it('criterio 59 b: una fecha anterior a la última, después de un rechazo, sigue dando una id mayor que las emitidas antes del rechazo', async () => {
    const generar = await generadorLimpio();
    const ids = [generar(T0), generar(new Date(T0.getTime() + 1000))];

    expect(() => generar(new Date(Number.NaN))).toThrow(RangeError);
    ids.push(generar(new Date(T0.getTime() - 1000)), generar(T0));

    esperarValidasYCrecientes(ids);
  });
});

describe('criterio 59 c: nunca un id fuera del formato en el último milisegundo representable', () => {
  // Cada caso importa su propio módulo: llevar el generador al máximo no puede afectar a los demás.
  it('criterio 59 c: en un módulo recién importado, 4097 llamadas con new Date(2 ** 48 - 1): las 4096 primeras dan ids válidas y crecientes y la 4097.ª lanza RangeError', async () => {
    const generar = await generadorLimpio();
    const maxima = new Date(ULTIMO_MS);

    const ids = Array.from({ length: 4096 }, () => generar(maxima));

    esperarValidasYCrecientes(ids);
    for (const id of ids) expect(milisegundosDe(id)).toBe(ULTIMO_MS);
    expect(() => generar(maxima)).toThrow(RangeError);
  });

  it('criterio 59 c: después del desborde, una llamada más con esa fecha vuelve a lanzar RangeError (el estado quedó en el máximo)', async () => {
    const generar = await generadorLimpio();
    const maxima = new Date(ULTIMO_MS);
    for (let i = 0; i < 4096; i += 1) generar(maxima);
    expect(() => generar(maxima)).toThrow(RangeError);

    expect(() => generar(maxima)).toThrow(RangeError);
    expect(() => generar(maxima)).toThrow(RangeError);
  });

  it('criterio 59 c: después del desborde, una llamada con una fecha anterior también lanza RangeError: no hay un id mayor que dar', async () => {
    const generar = await generadorLimpio();
    const maxima = new Date(ULTIMO_MS);
    for (let i = 0; i < 4096; i += 1) generar(maxima);
    expect(() => generar(maxima)).toThrow(RangeError);

    expect(() => generar(T0)).toThrow(RangeError);
    expect(() => generar(new Date(0))).toThrow(RangeError);
  });

  it('criterio 59 c: nunca devuelve un id con un desborde: ni la 4097.ª llamada ni las siguientes devuelven un texto', async () => {
    const generar = await generadorLimpio();
    const maxima = new Date(ULTIMO_MS);
    for (let i = 0; i < 4096; i += 1) generar(maxima);

    const resultados: unknown[] = [];
    for (let i = 0; i < 3; i += 1) {
      try {
        resultados.push(generar(maxima));
      } catch (error) {
        resultados.push(error);
      }
    }

    for (const resultado of resultados) expect(resultado).toBeInstanceOf(RangeError);
  });

  it('criterio 59 c: un generador limpio importado después sigue funcionando con normalidad (el máximo de otro módulo no lo afecta)', async () => {
    const agotado = await generadorLimpio();
    const maxima = new Date(ULTIMO_MS);
    for (let i = 0; i < 4096; i += 1) agotado(maxima);
    expect(() => agotado(maxima)).toThrow(RangeError);

    const limpio = await generadorLimpio();

    esperarValidasYCrecientes([limpio(T0), limpio(T0), limpio(new Date(T0.getTime() + 1))]);
  });
});
