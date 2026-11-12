// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cargarRegistroDeErrores, comoObjeto } from '../../../test/utilidades/ronda13';
import {
  comprobarSinValores,
  DNI_R14,
  encabezadoDe,
  errorFalsoDeBase,
  LANZA,
  MARCO_F,
  MARCO_G,
  MENSAJE_CON_MARCO,
  NOMBRE_DE_PRISMA,
  objetosConTipo,
} from '../../../test/utilidades/ronda14';

// Criterio 163 (ataque ronda 14, F1; precision del criterio 162 y de P-42), pruebas unitarias de `errorParaRegistro`
// (backend/src/infraestructura/prisma/index.ts) con errores falsos con forma de error de Prisma (`name: 'PrismaClientKnownRequestError'`,
// `code: 'P2007'`) y un mensaje que lleva una linea con la forma de un marco de la pila (`valor inválido\n    at DNI 44556677 alergia
// penicilina-r14`).
//
// La `pila` de un error de la base se lee solo DESPUES del encabezado exacto `nombre: mensaje` (o `nombre` solo si el mensaje es la cadena
// vacia): si `stack` no empieza con ese encabezado, si lo que sigue no empieza con un salto de linea, si `name`, `message` o `stack` no son
// cadenas, o si leer alguno lanza, se omite `pila` (falla cerrada). Lo demas del objeto limpio (`tipo`, `codigoPrisma`, ...) se sigue
// registrando. Vale en cada nivel de la cadena de causas (`cause` y `errors`).
//   (u1) encabezado exacto seguido de dos marcos: `pila` es exactamente esos dos marcos.
//   (u2) `stack` que no empieza con el encabezado: sin `pila`.
//   (u3) el encabezado seguido de algo que no es un salto de linea: sin `pila`.
//   (u4) mensaje vacio: el encabezado es `name` solo.
//   (u5) valores que no son cadenas o getters que lanzan: no lanza, sin `pila`, conserva `tipo` y `codigoPrisma`.
//   (u6) un `Error` propio con el error de (u2) como `cause`, y un `AggregateError` con el en `errors`: la causa convertida no tiene `pila`.

const DOS_MARCOS = `${MARCO_F}\n${MARCO_G}`;

async function registrar(error: unknown, contexto: string): Promise<Record<string, unknown>> {
  const { errorParaRegistro } = await cargarRegistroDeErrores();
  return comoObjeto(errorParaRegistro(error), contexto);
}

describe('criterio 163 (u1): con el encabezado exacto, la pila son solo los marcos que le siguen', () => {
  it('criterio 163 (u1): el stack es el encabezado seguido de dos marcos: pila es exactamente esos dos marcos', async () => {
    const error = errorFalsoDeBase();
    expect(
      error.stack,
      'precondicion: el stack empieza con el encabezado y trae la linea del mensaje con forma de marco',
    ).toContain(`at DNI ${DNI_R14}`);

    const resultado = await registrar(error, 'u1');

    expect(resultado['pila']).toBe(DOS_MARCOS);
    expect(resultado['tipo']).toBe(NOMBRE_DE_PRISMA);
    expect(resultado['codigoPrisma']).toBe('P2007');
    comprobarSinValores(resultado, 'u1');
  });

  it('criterio 163 (u1): con una linea del mensaje que empieza con espacios y "at " (varias, con tabulaciones), esas lineas no salen', async () => {
    const mensaje = `uno\n    at DNI ${DNI_R14}\n\tat alergia penicilina-r14\n  at otra ${DNI_R14}`;
    const error = errorFalsoDeBase({ message: mensaje });

    const resultado = await registrar(error, 'u1 variante');

    expect(resultado['pila']).toBe(DOS_MARCOS);
    comprobarSinValores(resultado, 'u1 variante');
  });

  it('criterio 163 (u1): sin lineas de marco despues del encabezado no hay pila y el valor no sale', async () => {
    const error = errorFalsoDeBase({ stack: encabezadoDe(NOMBRE_DE_PRISMA, MENSAJE_CON_MARCO) });

    const resultado = await registrar(error, 'u1 sin marcos');

    expect(resultado['pila']).toBeUndefined();
    expect(resultado['tipo']).toBe(NOMBRE_DE_PRISMA);
    comprobarSinValores(resultado, 'u1 sin marcos');
  });

  it('criterio 163 (u1): con muchos marcos se conserva un maximo (el de hoy, no mas de 40), siempre los primeros despues del encabezado', async () => {
    const marcos = Array.from({ length: 60 }, (_, i) => `    at funcion${i} (/repo/backend/src/f${i}.ts:${i}:1)`);
    const error = errorFalsoDeBase({
      stack: `${encabezadoDe(NOMBRE_DE_PRISMA, MENSAJE_CON_MARCO)}\n${marcos.join('\n')}`,
    });

    const resultado = await registrar(error, 'u1 muchos marcos');

    const lineas = String(resultado['pila']).split('\n');
    expect(lineas.length).toBeGreaterThan(0);
    expect(lineas.length).toBeLessThanOrEqual(40);
    expect(lineas).toEqual(marcos.slice(0, lineas.length));
    comprobarSinValores(resultado, 'u1 muchos marcos');
  });
});

describe('criterio 163 (u2): un stack que no empieza con el encabezado exacto no da pila', () => {
  it.each([
    [
      'otro nombre y otro mensaje',
      () => `Otro: algo\n    at DNI ${DNI_R14} alergia penicilina-r14\n    at f (/repo/backend/src/f.ts:1:1)`,
    ],
    ['el encabezado con el mensaje cambiado', () => `${NOMBRE_DE_PRISMA}: otro mensaje\n${MARCO_F}\n${MARCO_G}`],
    ['el encabezado con otro nombre', () => `Error: ${MENSAJE_CON_MARCO}\n${MARCO_F}\n${MARCO_G}`],
    ['solo los marcos, sin encabezado', () => `${MARCO_F}\n${MARCO_G}`],
    ['el encabezado precedido de una linea', () => `antes\n${NOMBRE_DE_PRISMA}: ${MENSAJE_CON_MARCO}\n${MARCO_F}`],
    ['un stack vacio', () => ''],
  ])('criterio 163 (u2): %s: el resultado no tiene pila', async (_nombre, crearPila) => {
    const error = errorFalsoDeBase({ stack: crearPila() });

    const resultado = await registrar(error, 'u2');

    expect(resultado['pila']).toBeUndefined();
    expect(resultado['tipo']).toBe(NOMBRE_DE_PRISMA);
    expect(resultado['codigoPrisma']).toBe('P2007');
    comprobarSinValores(resultado, 'u2');
  });
});

describe('criterio 163 (u3): lo que sigue al encabezado debe empezar con un salto de linea', () => {
  it.each([
    ["' extra' y un marco con el valor", () => ` extra\n    at DNI ${DNI_R14}`],
    ['un espacio y un marco en la misma linea', () => ` ${MARCO_F.trim()}\n${MARCO_G}`],
    ['dos puntos', () => `:\n${MARCO_F}`],
    ['texto pegado al encabezado', () => `x\n${MARCO_F}`],
  ])('criterio 163 (u3): el encabezado seguido de %s: el resultado no tiene pila', async (_nombre, crearResto) => {
    const encabezado = encabezadoDe(NOMBRE_DE_PRISMA, MENSAJE_CON_MARCO);
    const error = errorFalsoDeBase({ stack: `${encabezado}${crearResto()}` });

    const resultado = await registrar(error, 'u3');

    expect(resultado['pila']).toBeUndefined();
    expect(resultado['tipo']).toBe(NOMBRE_DE_PRISMA);
    comprobarSinValores(resultado, 'u3');
  });
});

describe('criterio 163 (u4): con el mensaje vacio, el encabezado es el nombre solo', () => {
  it('criterio 163 (u4): message vacio y stack "PrismaClientKnownRequestError\\n    at f (...)": pila es ese marco', async () => {
    const error = errorFalsoDeBase({ message: '', stack: `${NOMBRE_DE_PRISMA}\n${MARCO_F}` });

    const resultado = await registrar(error, 'u4');

    expect(resultado['pila']).toBe(MARCO_F);
    expect(resultado['tipo']).toBe(NOMBRE_DE_PRISMA);
    comprobarSinValores(resultado, 'u4');
  });

  it('criterio 163 (u4): message vacio y dos marcos: pila son los dos', async () => {
    const error = errorFalsoDeBase({ message: '' });

    const resultado = await registrar(error, 'u4 dos marcos');

    expect(resultado['pila']).toBe(DOS_MARCOS);
  });

  it('criterio 163 (u4): message vacio y un stack con "nombre: " (dos puntos y espacio) no es el encabezado exacto: sin pila', async () => {
    const error = errorFalsoDeBase({ message: '', stack: `${NOMBRE_DE_PRISMA}: \n    at DNI ${DNI_R14}\n${MARCO_F}` });

    const resultado = await registrar(error, 'u4 con dos puntos');

    expect(resultado['pila']).toBeUndefined();
    comprobarSinValores(resultado, 'u4 con dos puntos');
  });
});

describe('criterio 163 (u5): valores que no son cadenas y getters que lanzan', () => {
  const CASOS: readonly [string, () => Error][] = [
    ['stack es un numero', () => errorFalsoDeBase({ stack: 42 })],
    ['stack es undefined', () => errorFalsoDeBase({ stack: undefined })],
    ['stack es null', () => errorFalsoDeBase({ stack: null })],
    ['stack es un objeto con el valor', () => errorFalsoDeBase({ stack: { texto: `at ${DNI_R14}` } })],
    ['stack es un arreglo de lineas', () => errorFalsoDeBase({ stack: [`    at DNI ${DNI_R14}`, MARCO_F] })],
    ['message es un numero', () => errorFalsoDeBase({ message: 42, stack: `${NOMBRE_DE_PRISMA}: 42\n${MARCO_F}` })],
    [
      'message es un objeto',
      () => errorFalsoDeBase({ message: { dni: DNI_R14 }, stack: `${NOMBRE_DE_PRISMA}: [object Object]\n${MARCO_F}` }),
    ],
    ['name es un numero', () => errorFalsoDeBase({ name: 7, stack: `7: ${MENSAJE_CON_MARCO}\n${MARCO_F}` })],
    ['el getter de stack lanza', () => errorFalsoDeBase({ stack: LANZA })],
    [
      'el getter de message lanza',
      () => errorFalsoDeBase({ message: LANZA, stack: `${NOMBRE_DE_PRISMA}: x\n${MARCO_F}` }),
    ],
    ['el getter de name lanza', () => errorFalsoDeBase({ name: LANZA, stack: `x: ${MENSAJE_CON_MARCO}\n${MARCO_F}` })],
  ];

  it.each(CASOS)(
    'criterio 163 (u5): %s: no lanza, no tiene pila y conserva el codigo de Prisma',
    async (_nombre, crear) => {
      const { errorParaRegistro } = await cargarRegistroDeErrores();
      const error = crear();

      expect(() => errorParaRegistro(error)).not.toThrow();
      const resultado = comoObjeto(errorParaRegistro(error), 'u5');
      expect(resultado['pila']).toBeUndefined();
      expect(typeof resultado['tipo'], 'conserva tipo').toBe('string');
      expect(resultado['codigoPrisma'], 'conserva codigoPrisma').toBe('P2007');
      comprobarSinValores(resultado, 'u5');
    },
  );

  it.each(CASOS.filter(([nombre]) => !nombre.startsWith('name ') && !nombre.includes('getter de name')))(
    'criterio 163 (u5): %s: el tipo sigue siendo el nombre del error',
    async (_nombre, crear) => {
      const resultado = await registrar(crear(), 'u5 tipo');

      expect(resultado['tipo']).toBe(NOMBRE_DE_PRISMA);
    },
  );
});

describe('criterio 163 (u6): en cada nivel de la cadena de causas', () => {
  const stackAlterado = (): string =>
    `Otro: algo\n    at DNI ${DNI_R14} alergia penicilina-r14\n    at f (/repo/backend/src/f.ts:1:1)`;

  it('criterio 163 (u6): un Error propio con el error de (u2) como cause: la causa convertida no tiene pila y nada contiene los valores', async () => {
    const propio = new Error('No se pudo completar la operacion de prueba', {
      cause: errorFalsoDeBase({ stack: stackAlterado() }),
    });

    const resultado = await registrar(propio, 'u6 cause');

    expect(resultado).not.toBe(propio);
    expect(resultado['mensaje']).toBe('No se pudo completar la operacion de prueba');
    const causa = comoObjeto(resultado['causa'], 'u6 causa');
    expect(causa['tipo']).toBe(NOMBRE_DE_PRISMA);
    expect(causa['codigoPrisma']).toBe('P2007');
    expect(causa['pila']).toBeUndefined();
    comprobarSinValores(resultado, 'u6 cause');
  });

  it('criterio 163 (u6): un AggregateError con el error de (u2) en errors: el error convertido no tiene pila y nada contiene los valores', async () => {
    const agregado = new AggregateError(
      [new Error('otro'), errorFalsoDeBase({ stack: stackAlterado() })],
      'varios fallos',
    );

    const resultado = await registrar(agregado, 'u6 errors');

    expect(resultado).not.toBe(agregado);
    const deLaBase = objetosConTipo(resultado, NOMBRE_DE_PRISMA);
    expect(deLaBase, 'el error de la base se convirtio a su forma limpia').toHaveLength(1);
    expect(deLaBase[0]?.['pila']).toBeUndefined();
    expect(deLaBase[0]?.['codigoPrisma']).toBe('P2007');
    comprobarSinValores(resultado, 'u6 errors');
  });

  it('criterio 163 (u6): varios niveles de cause (propio -> propio -> error de la base con el stack alterado): sin pila y sin valores', async () => {
    const profundo = new Error('nivel 1', {
      cause: new Error('nivel 2', {
        cause: new Error('nivel 3', { cause: errorFalsoDeBase({ stack: stackAlterado() }) }),
      }),
    });

    const resultado = await registrar(profundo, 'u6 profundo');

    const deLaBase = objetosConTipo(resultado, NOMBRE_DE_PRISMA);
    expect(deLaBase).toHaveLength(1);
    expect(deLaBase[0]?.['pila']).toBeUndefined();
    comprobarSinValores(resultado, 'u6 profundo');
  });

  it('criterio 163 (u6): un error de la base valido (encabezado exacto) como cause conserva solo sus marcos en cada nivel', async () => {
    const propio = new Error('propio', { cause: new Error('intermedio', { cause: errorFalsoDeBase() }) });
    const agregado = new AggregateError([errorFalsoDeBase()], 'varios');

    for (const [nombre, error] of [
      ['cause', propio],
      ['errors', agregado],
    ] as const) {
      const resultado = await registrar(error, `u6 valido ${nombre}`);

      const deLaBase = objetosConTipo(resultado, NOMBRE_DE_PRISMA);
      expect(deLaBase, nombre).toHaveLength(1);
      expect(deLaBase[0]?.['pila'], nombre).toBe(DOS_MARCOS);
      comprobarSinValores(resultado, `u6 valido ${nombre}`);
    }
  });
});

describe('criterio 163: lo que no cambia', () => {
  it('criterio 163 (control, 162 sin cambios): un Error que no es de la base se devuelve tal cual, con su mensaje y su pila completos', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const comun = new Error('fallo comun de prueba r14');

    expect(errorParaRegistro(comun)).toBe(comun);
    expect(comun.stack).toContain('fallo comun de prueba r14');
  });

  it('criterio 163 (control, 162 sin cambios): un error de la base no lleva mensaje, causa ni stack en el objeto limpio', async () => {
    const resultado = await registrar(errorFalsoDeBase(), 'claves');

    const permitidas = ['tipo', 'codigoPrisma', 'sqlstate', 'codigoDeSistema', 'modelo', 'pila'];
    for (const clave of Object.keys(resultado)) expect(permitidas, `clave inesperada: ${clave}`).toContain(clave);
  });
});
