// spec: 001-academias-aislamiento (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { cargarFuncionalidad, Prisma } from '../../../test/utilidades/ronda3';
import { cargarPuntoAutorizado, type PuntoAutorizado } from '../../../test/utilidades/ronda4';

// Criterio 114 (ataque ronda 4; complementa los criterios 85, 92 y 112) y precision P-25, parte unitaria (sin base de datos).
// `backend/src/infraestructura/prisma/index.ts` exporta:
//   - `Decimal` (la clase de decimales de Prisma, valor y tipo);
//   - `codigoDeErrorDeBase(error)` (SQLSTATE de cinco caracteres de un error de la base, de Prisma o del adaptador, o null) y
//     `esViolacionDeUnicidad(error)` (verdadero con el codigo P2002 de Prisma o con el SQLSTATE 23505);
//   - `sql`, `join` y `vacio`: `sql` es una etiqueta que solo acepta, como valores, primitivos (string, number, bigint, boolean,
//     null), Date, Decimal, Uint8Array, arreglos de esos valores y fragmentos del propio punto, y rechaza con TypeError cualquier
//     otro valor (tambien un `Sql` de Prisma); `join(elementos, separador?)` une con un separador de una lista cerrada ('coma',
//     'y', 'o'; por defecto 'coma'), rechaza otro separador, una lista vacia y un elemento no admitido; `vacio` es el fragmento
//     vacio. No existe un equivalente de `raw` ni de `Prisma.join` con separador libre;
//   - los fragmentos son opacos: objeto congelado sin prototipo (`Object.getPrototypeOf(f) === null`), sin claves propias
//     (`Reflect.ownKeys(f)` vacio) y sin camino a `Sql`, a `raw` ni al cliente.

describe('criterio 114: punto autorizado (unitaria)', () => {
  let punto: PuntoAutorizado;

  beforeEach(async () => {
    punto = await cargarPuntoAutorizado();
  });

  /** `sql` llamada como funcion con un arreglo bien formado (partes con su `raw`) y los valores indicados. */
  const plantilla = (partes: string[]) =>
    Object.assign([...partes], { raw: [...partes] }) as unknown as TemplateStringsArray & string[];

  describe('criterio 114: lo que exporta', () => {
    it('criterio 114: Decimal es la clase de decimales de Prisma (valor y tipo)', () => {
      expect(punto.Decimal).toBe(Prisma.Decimal);
      expect(new punto.Decimal('10.50').equals('10.5')).toBe(true);
      expect(punto.Decimal.isDecimal(new punto.Decimal(1))).toBe(true);
    });

    it('criterio 114: no se exporta un equivalente de raw ni la clase Sql', async () => {
      const modulo = await cargarFuncionalidad<Record<string, unknown>>('infraestructura/prisma/index.ts', [
        'BaseDatos',
      ]);

      expect(modulo['raw']).toBeUndefined();
      expect(modulo['Sql']).toBeUndefined();
    });
  });

  describe('criterio 114: los fragmentos son opacos', () => {
    const fragmentos = (p: PuntoAutorizado): [string, object][] => [
      ['sql sin valores', p.sql`SELECT 1`],
      ['sql con un valor', p.sql`SELECT ${1}`],
      ['sql con un fragmento', p.sql`SELECT ${p.sql`2`}`],
      ['join', p.join([1, 2])],
      ['vacio', p.vacio],
    ];

    it.each([0, 1, 2, 3, 4])(
      'criterio 114: el fragmento %i es un objeto congelado sin prototipo y sin claves propias',
      (i) => {
        const [nombre, fragmento] = fragmentos(punto)[i] as [string, object];

        expect(Object.getPrototypeOf(fragmento), nombre).toBeNull();
        expect(Object.isFrozen(fragmento), nombre).toBe(true);
        expect(Reflect.ownKeys(fragmento), nombre).toEqual([]);
      },
    );

    it.each([0, 1, 2, 3, 4])(
      'criterio 114: el fragmento %i no tiene camino a Sql, a raw, al constructor ni al cliente',
      (i) => {
        const fragmento = (fragmentos(punto)[i] as [string, object])[1] as Record<string, unknown>;

        for (const nombre of [
          'constructor',
          'prototype',
          '__proto__',
          'sql',
          'text',
          'strings',
          'values',
          'raw',
          'queryRaw',
        ]) {
          expect(fragmento[nombre], nombre).toBeUndefined();
        }
        expect(fragmento instanceof Prisma.Sql).toBe(false);
        expect(() => JSON.stringify(fragmento)).not.toThrow();
        expect(JSON.stringify(fragmento)).toBe('{}');
      },
    );

    it('criterio 114: no se puede agregar ni cambiar una propiedad de un fragmento', () => {
      const fragmento = punto.sql`SELECT 1` as Record<string, unknown>;

      expect(Reflect.set(fragmento, 'sql', 'SELECT 2')).toBe(false);
      expect(Reflect.defineProperty(fragmento, 'raw', { value: 1 })).toBe(false);
      expect(Reflect.ownKeys(fragmento)).toEqual([]);
    });
  });

  describe('criterio 114: sql', () => {
    it.each([
      ['una cadena', 'texto'],
      ['un numero', 5],
      ['un bigint', 5n],
      ['un booleano', true],
      ['null', null],
      ['un Date', new Date('2026-11-12T03:30:00.000Z')],
      ['un Uint8Array', new Uint8Array([1, 2])],
      ['un arreglo de numeros', [1, 2, 3]],
      ['un arreglo de cadenas', ['a', 'b']],
      ['un arreglo vacio', []],
      ['un arreglo de Date', [new Date(0)]],
    ])('criterio 114: acepta %s como valor', (_nombre, valor) => {
      const fragmento = punto.sql`SELECT ${valor}`;

      expect(Object.getPrototypeOf(fragmento)).toBeNull();
    });

    it('criterio 114: acepta un Decimal, un arreglo de Decimal y un fragmento como valor', () => {
      expect(() => punto.sql`SELECT ${new punto.Decimal('1.5')}`).not.toThrow();
      expect(() => punto.sql`SELECT ${[new punto.Decimal('1.5')]}`).not.toThrow();
      expect(() => punto.sql`SELECT ${punto.sql`1`}`).not.toThrow();
      expect(() => punto.sql`SELECT ${punto.vacio}`).not.toThrow();
    });

    it.each([
      ['un Sql de Prisma', Prisma.sql`SELECT 1`],
      ['Prisma.raw', Prisma.raw('RESET ALL')],
      ['Prisma.empty', Prisma.empty],
      ['un objeto cualquiera', { texto: 'x' }],
      ['un objeto con forma de Sql', { sql: 'SELECT 1', values: [] }],
      ['un objeto sin prototipo', Object.create(null) as object],
      ['una funcion', () => 1],
      ['undefined', undefined],
      ['un simbolo', Symbol('x')],
      ['un Map', new Map()],
      ['un arreglo con un objeto', [{ a: 1 }]],
      ['un arreglo con un Sql de Prisma', [Prisma.sql`SELECT 1`]],
      ['una clase', class Algo {}],
    ])('criterio 114: rechaza %s como valor con TypeError', (_nombre, valor) => {
      expect(() => punto.sql`SELECT ${valor}`).toThrow(TypeError);
    });

    it('criterio 114: llamada como funcion con un arreglo sin raw, rechaza con TypeError', () => {
      const llamar = (...argumentos: unknown[]): unknown => Reflect.apply(punto.sql, undefined, argumentos);

      expect(() => llamar(['SELECT 1'])).toThrow(TypeError);
      expect(() => llamar('SELECT 1')).toThrow(TypeError);
      expect(() => llamar({ strings: ['SELECT 1'], raw: ['SELECT 1'] })).toThrow(TypeError);
      expect(() => llamar()).toThrow(TypeError);
    });

    it('criterio 114: llamada como funcion con partes y raw de largos distintos o con un elemento que no es cadena, rechaza con TypeError', () => {
      const llamar = (...argumentos: unknown[]): unknown => Reflect.apply(punto.sql, undefined, argumentos);

      expect(() => llamar(Object.assign(['a', 'b'], { raw: ['a'] }), 1)).toThrow(TypeError);
      expect(() => llamar(Object.assign(['a'], { raw: 'a' }))).toThrow(TypeError);
      expect(() => llamar(Object.assign([1], { raw: ['1'] }))).toThrow(TypeError);
      expect(() => llamar(Object.assign(['1'], { raw: [1] }))).toThrow(TypeError);
    });

    it('criterio 114: llamada como funcion con partes bien formadas y un elemento mas que los valores, acepta', () => {
      const llamar = (...argumentos: unknown[]): object => Reflect.apply(punto.sql, undefined, argumentos) as object;
      const fragmento = llamar(plantilla(['SELECT ', ' + ', '']), 1, 2);

      expect(Object.getPrototypeOf(fragmento)).toBeNull();
      expect(() => llamar(plantilla(['SELECT ', '']), 1, 2)).toThrow(TypeError);
      expect(() => llamar(plantilla(['SELECT ', ' + ', '']), 1)).toThrow(TypeError);
    });
  });

  describe('criterio 114: join', () => {
    it.each([undefined, 'coma', 'y', 'o'] as const)('criterio 114: acepta el separador %s', (separador) => {
      const fragmento = punto.join([1, 2, 3], separador);

      expect(Object.getPrototypeOf(fragmento)).toBeNull();
    });

    it.each([
      ['una cadena libre', ', '],
      ['un separador SQL', '; RESET ALL; '],
      ['AND en mayusculas', 'AND'],
      ['Y en mayusculas', 'Y'],
      ['una cadena vacia', ''],
      ['constructor', 'constructor'],
      ['toString', 'toString'],
      ['__proto__', '__proto__'],
      ['hasOwnProperty', 'hasOwnProperty'],
      ['un numero', 1],
      ['null', null],
      ['un objeto', { valueOf: (): string => 'coma' }],
    ])('criterio 114: rechaza %s como separador con TypeError', (_nombre, separador) => {
      expect(() => punto.join([1, 2], separador as never)).toThrow(TypeError);
    });

    it('criterio 114: rechaza una lista vacia con TypeError', () => {
      expect(() => punto.join([])).toThrow(TypeError);
      expect(() => punto.join([], 'y')).toThrow(TypeError);
    });

    it('criterio 114: rechaza un elemento no admitido con TypeError (un Sql de Prisma, un objeto, una funcion, undefined)', () => {
      expect(() => punto.join([1, Prisma.sql`SELECT 1`])).toThrow(TypeError);
      expect(() => punto.join([{ a: 1 }])).toThrow(TypeError);
      expect(() => punto.join([() => 1])).toThrow(TypeError);
      expect(() => punto.join([undefined])).toThrow(TypeError);
    });

    it('criterio 114: une valores y fragmentos', () => {
      expect(() => punto.join(['a', punto.sql`b = ${1}`, new Date(0), null])).not.toThrow();
    });
  });

  describe('criterio 114: vacio', () => {
    it('criterio 114: vacio es un fragmento unico, congelado y sin prototipo', () => {
      expect(Object.getPrototypeOf(punto.vacio)).toBeNull();
      expect(Object.isFrozen(punto.vacio)).toBe(true);
      expect(Reflect.ownKeys(punto.vacio)).toEqual([]);
    });
  });

  describe('criterio 114: codigoDeErrorDeBase y esViolacionDeUnicidad con errores construidos', () => {
    // La forma real (Prisma 7 con @prisma/adapter-pg) la fija la prueba de integracion: una insercion duplicada da P2010 (raw) o
    // P2002 (delegado) con `meta.driverAdapterError.cause.originalCode` = '23505'; un error de RLS da P2010 con
    // `meta.driverAdapterError.cause.code` = '42501'.
    const conocido = (codigo: string, meta?: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError('fallo', { code: codigo, clientVersion: 'prueba', meta });
    const delAdaptador = (causa: Record<string, unknown>) => ({
      driverAdapterError: { name: 'DriverAdapterError', cause: causa },
    });

    it('criterio 114: un P2002 de Prisma es una violacion de unicidad', () => {
      expect(punto.esViolacionDeUnicidad(conocido('P2002'))).toBe(true);
      expect(punto.esViolacionDeUnicidad(conocido('P2002', { target: ['clave'] }))).toBe(true);
    });

    it('criterio 114: un P2010 de un $queryRaw con SQLSTATE 23505 (en meta.driverAdapterError.cause.originalCode) es una violacion de unicidad con codigo 23505', () => {
      const error = conocido(
        'P2010',
        delAdaptador({ originalCode: '23505', originalMessage: 'duplicate key', kind: 'UniqueConstraintViolation' }),
      );

      expect(punto.esViolacionDeUnicidad(error)).toBe(true);
      expect(punto.codigoDeErrorDeBase(error)).toBe('23505');
    });

    it('criterio 114: un P2002 con el SQLSTATE en meta.driverAdapterError.cause.originalCode da el codigo 23505', () => {
      const error = conocido(
        'P2002',
        delAdaptador({ originalCode: '23505', originalMessage: 'duplicate key', kind: 'UniqueConstraintViolation' }),
      );

      expect(punto.codigoDeErrorDeBase(error)).toBe('23505');
    });

    it('criterio 114: un P2010 con SQLSTATE 42501 (en meta.driverAdapterError.cause.code) da el codigo 42501 y no es unicidad', () => {
      const error = conocido(
        'P2010',
        delAdaptador({
          kind: 'postgres',
          code: '42501',
          severity: 'ERROR',
          message: 'new row violates row-level security policy',
        }),
      );

      expect(punto.codigoDeErrorDeBase(error)).toBe('42501');
      expect(punto.esViolacionDeUnicidad(error)).toBe(false);
    });

    it('criterio 114: un error del adaptador de PostgreSQL con code 23505 es una violacion de unicidad con codigo 23505', () => {
      const error = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });

      expect(punto.esViolacionDeUnicidad(error)).toBe(true);
      expect(punto.codigoDeErrorDeBase(error)).toBe('23505');
    });

    it('criterio 114: un DriverAdapterError de Prisma con SQLSTATE 23505 es una violacion de unicidad con codigo 23505', async () => {
      const { DriverAdapterError } = await import('@prisma/driver-adapter-utils');
      const error = new DriverAdapterError({
        kind: 'UniqueConstraintViolation',
        constraint: { index: 'configuraciones_pkey' },
      } as never);
      Object.assign(error.cause, { originalCode: '23505', originalMessage: 'duplicate key' });

      expect(punto.esViolacionDeUnicidad(error)).toBe(true);
      expect(punto.codigoDeErrorDeBase(error)).toBe('23505');
    });

    it.each(['23503', '42501', '40001', '23502', '22001'])(
      'criterio 114: el SQLSTATE %s no es una violacion de unicidad y se devuelve tal cual',
      (codigo) => {
        const error = Object.assign(new Error('fallo'), { code: codigo });

        expect(punto.esViolacionDeUnicidad(error)).toBe(false);
        expect(punto.codigoDeErrorDeBase(error)).toBe(codigo);
      },
    );

    it.each([
      ['un Error comun', new Error('otra cosa')],
      ['un Error con un code que no es SQLSTATE (ECONNRESET)', Object.assign(new Error('x'), { code: 'ECONNRESET' })],
      ['un Error con un code de cuatro caracteres', Object.assign(new Error('x'), { code: '2350' })],
      ['un Error con un code de seis caracteres', Object.assign(new Error('x'), { code: '235055' })],
      ['una cadena', '23505'],
      ['un numero', 23505],
      ['null', null],
      ['undefined', undefined],
      ['un objeto vacio', {}],
    ])('criterio 114: %s da null y no es una violacion de unicidad', (_nombre, error) => {
      expect(punto.codigoDeErrorDeBase(error)).toBeNull();
      expect(punto.esViolacionDeUnicidad(error)).toBe(false);
    });
  });
});
