// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import {
  cargarClaseAbortada,
  cargarRegistroDeErrores,
  comoObjeto,
  DNI_DE_PRUEBA,
  propiasComoJson,
  textoCompleto,
} from '../../../test/utilidades/ronda13';
import { cargarFuncionalidad, Prisma } from '../../../test/utilidades/ronda3';

// Criterios 161 y 162 (ataque ronda 13, F2 y O1; P-42 y precision de P-36), pruebas unitarias de `backend/src/infraestructura/prisma/index.ts`
// (el punto autorizado exporta `CausaLimpia`, `causaLimpia`, `esErrorDeBase` y `errorParaRegistro`) y del constructor de
// `ErrorTransaccionAbortada`, con errores falsos con forma de error de Prisma (y algunos reales construidos sin base de datos):
//   161  el constructor de `ErrorTransaccionAbortada` reemplaza la causa por una `CausaLimpia` (un `Error` de AquaGestion con un texto fijo, sin el
//        mensaje, el `meta`, la pila ni la `cause` del error original; con `code` igual al SQLSTATE); si ya recibe una `CausaLimpia`, la conserva;
//   162  `errorParaRegistro(error)`: un error de Prisma o de la base se convierte en un objeto plano con solo `tipo`, `codigoPrisma`, `sqlstate`,
//        `codigoDeSistema`, `modelo` y `pila` (solo los marcos); un `Error` comun con un error de la base en su cadena de causas se convierte en
//        `{ tipo, mensaje, pila, causa }`; cualquier otro `Error` (incluida una `CausaLimpia` y un `ErrorTransaccionAbortada`) se devuelve tal
//        cual; un valor que no es un `Error` se convierte en `{ tipo: typeof valor }`. Ninguna de las funciones lanza con ninguna entrada.

const MENSAJE_DE_PRISMA = `Invalid input syntax for type inet: "DNI ${DNI_DE_PRUEBA}"`;
const PILA_DE_PRISMA = [
  `PrismaClientKnownRequestError: ${MENSAJE_DE_PRISMA}`,
  `Invalid \`prisma.auditoria.create()\` invocation: data: { ip: "DNI ${DNI_DE_PRUEBA}" }`,
  '    at falso (/repo/backend/src/falso.ts:10:5)',
  '    at otro (/repo/backend/src/otro.ts:20:7)',
].join('\n');

/** Una causa falsa con la forma de un error de Prisma (P2007 por un `22P02` del adaptador), con el valor rechazado por todas partes. */
function causaFalsaDePrisma(): Error {
  const error = Object.assign(new Error(MENSAJE_DE_PRISMA), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2007',
    clientVersion: '7.0.0',
    meta: {
      modelName: 'Auditoria',
      driverAdapterError: {
        cause: { originalCode: '22P02', originalMessage: `invalid input syntax for type inet: "DNI ${DNI_DE_PRUEBA}"` },
      },
    },
  });
  error.stack = PILA_DE_PRISMA;
  Object.defineProperty(error, 'cause', {
    value: new Error(`causa interna con DNI ${DNI_DE_PRUEBA}`),
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return error;
}

/** Un error con la forma del P2002 (unicidad) de Prisma, con el valor en el mensaje y en `meta.target`. */
function errorFalsoDeUnicidad(): Error {
  const error = Object.assign(new Error(`Unique constraint failed on the fields: (\`dni\`) = (${DNI_DE_PRUEBA})`), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2002',
    meta: { modelName: 'Auditoria', target: ['dni'], valor: DNI_DE_PRUEBA },
  });
  error.stack = [
    `PrismaClientKnownRequestError: ${error.message}`,
    `Invalid \`prisma.auditoria.create()\` invocation: { data: { dni: "${DNI_DE_PRUEBA}" } }`,
    '    at falso (/repo/backend/src/falso.ts:10:5)',
    '    at otro (/repo/backend/src/otro.ts:20:7)',
  ].join('\n');
  return error;
}

describe('criterio 161: la causa de ErrorTransaccionAbortada nunca lleva el mensaje de Prisma ni los valores (P-36, P-42)', () => {
  it('criterio 161: con una causa con forma de error de Prisma, el texto completo del error (inspect a toda profundidad) no contiene el valor', async () => {
    const { ErrorTransaccionAbortada } = await cargarClaseAbortada();

    const error = new ErrorTransaccionAbortada({ cause: causaFalsaDePrisma() });

    expect(textoCompleto(error)).not.toContain(DNI_DE_PRUEBA);
    expect(textoCompleto(error)).not.toContain('invalid input syntax');
  });

  it('criterio 161: JSON.stringify de las propiedades propias del error y de su causa no contiene el valor', async () => {
    const { ErrorTransaccionAbortada } = await cargarClaseAbortada();

    const error = new ErrorTransaccionAbortada({ cause: causaFalsaDePrisma() });

    expect(propiasComoJson(error)).not.toContain(DNI_DE_PRUEBA);
    expect(propiasComoJson(error.cause)).not.toContain(DNI_DE_PRUEBA);
    expect(propiasComoJson(error.cause)).not.toContain('invalid input syntax');
  });

  it('criterio 161: error.cause es una CausaLimpia, sin cause ni meta, y codigoDeErrorDeBase(error.cause) sigue leyendo el SQLSTATE 22P02', async () => {
    const { ErrorTransaccionAbortada } = await cargarClaseAbortada();
    const { CausaLimpia } = await cargarRegistroDeErrores();
    const { codigoDeErrorDeBase } = await cargarFuncionalidad<{
      codigoDeErrorDeBase: (error: unknown) => string | null;
    }>('infraestructura/prisma/index.ts', ['codigoDeErrorDeBase']);

    const error = new ErrorTransaccionAbortada({ cause: causaFalsaDePrisma() });

    expect(error.cause).toBeInstanceOf(CausaLimpia);
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).cause, 'la causa limpia no tiene cause').toBeUndefined();
    expect((error.cause as { meta?: unknown }).meta, 'la causa limpia no tiene meta').toBeUndefined();
    expect(codigoDeErrorDeBase(error.cause)).toBe('22P02');
  });

  it('criterio 161: con una CausaLimpia como causa, error.cause es esa misma', async () => {
    const { ErrorTransaccionAbortada } = await cargarClaseAbortada();
    const { causaLimpia } = await cargarRegistroDeErrores();
    const limpia = causaLimpia(causaFalsaDePrisma(), 'configuracion.update', 'rechazo-tras-trabajo');

    const error = new ErrorTransaccionAbortada({ motivo: 'incompleta', cause: limpia });

    expect(error.cause).toBe(limpia);
    expect(textoCompleto(error)).toContain('configuracion.update');
  });

  it.each([
    ['un Error comun con el valor en el mensaje', () => new Error(`algo con DNI ${DNI_DE_PRUEBA}`)],
    ['una cadena', () => `texto con DNI ${DNI_DE_PRUEBA}`],
    ['un objeto', () => ({ dni: DNI_DE_PRUEBA, message: `DNI ${DNI_DE_PRUEBA}` })],
    ['un error de la base con SQLSTATE', () => Object.assign(new Error(`DNI ${DNI_DE_PRUEBA}`), { code: '22P02' })],
  ])('criterio 161: con %s como causa, el error no conserva el valor', async (_nombre, crear) => {
    const { ErrorTransaccionAbortada } = await cargarClaseAbortada();

    const error = new ErrorTransaccionAbortada({ cause: crear() });

    expect(textoCompleto(error)).not.toContain(DNI_DE_PRUEBA);
    expect(propiasComoJson(error.cause)).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 161: lo demas de P-36 no cambia: estado 500, ERROR_INTERNO, motivo y mensaje generico; sin causa, no hay cause', async () => {
    const { ErrorTransaccionAbortada } = await cargarClaseAbortada();

    const conCausa = new ErrorTransaccionAbortada({ motivo: 'incompleta', cause: causaFalsaDePrisma() });
    const sinCausa = new ErrorTransaccionAbortada();

    expect(conCausa).toMatchObject({
      name: 'ErrorTransaccionAbortada',
      estado: 500,
      codigo: 'ERROR_INTERNO',
      motivo: 'incompleta',
    });
    expect(sinCausa).toMatchObject({ estado: 500, codigo: 'ERROR_INTERNO', motivo: 'abortada' });
    expect(sinCausa.cause).toBeUndefined();
    expect(conCausa.message).not.toContain(DNI_DE_PRUEBA);
  });
});

describe('criterio 161: causaLimpia (P-42)', () => {
  it('criterio 161: un error de Prisma da una CausaLimpia con code = SQLSTATE y codigoPrisma, sin cause ni meta, y con el tipo en su mensaje', async () => {
    const { causaLimpia, CausaLimpia } = await cargarRegistroDeErrores();

    const limpia = causaLimpia(causaFalsaDePrisma());

    expect(limpia).toBeInstanceOf(CausaLimpia);
    expect(limpia.name).toBe('CausaLimpia');
    expect(limpia.code).toBe('22P02');
    expect(limpia.codigoPrisma).toBe('P2007');
    expect(limpia.cause).toBeUndefined();
    expect((limpia as { meta?: unknown }).meta).toBeUndefined();
    expect(textoCompleto(limpia)).not.toContain(DNI_DE_PRUEBA);
    expect(limpia.message).toContain('PrismaClientKnownRequestError');
    expect(limpia.message).toContain('P2007');
    expect(limpia.message).toContain('22P02');
  });

  it('criterio 161: con una operacion y una circunstancia, el mensaje y la propiedad operacion nombran la operacion', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();

    for (const circunstancia of ['sin-resultado', 'llamada-tardia', 'rechazo-tras-trabajo'] as const) {
      const limpia = causaLimpia(
        circunstancia === 'sin-resultado' ? undefined : errorFalsoDeUnicidad(),
        'configuracion.update',
        circunstancia,
      );

      expect(limpia.operacion, circunstancia).toBe('configuracion.update');
      expect(limpia.message, circunstancia).toContain('configuracion.update');
      expect(textoCompleto(limpia), circunstancia).not.toContain(DNI_DE_PRUEBA);
    }
  });

  it.each(['$queryRaw', '$executeRaw', 'configuracion.update', 'auditoriaPlataforma.create'])(
    'criterio 161: la operacion %s se conserva',
    async (operacion) => {
      const { causaLimpia } = await cargarRegistroDeErrores();

      expect(causaLimpia(undefined, operacion, 'sin-resultado').operacion).toBe(operacion);
    },
  );

  it.each([`DNI ${DNI_DE_PRUEBA}`, 'configuracion.update; DROP TABLE x', 'a b', '', '$queryRawX', 'configuracion.'])(
    'criterio 161: una operacion que no cumple el patron (%j) se descarta y no aparece en la causa',
    async (operacion) => {
      const { causaLimpia } = await cargarRegistroDeErrores();

      const limpia = causaLimpia(undefined, operacion, 'sin-resultado');

      expect(limpia.operacion).toBeUndefined();
      if (operacion !== '') expect(textoCompleto(limpia)).not.toContain(operacion);
    },
  );

  it('criterio 161: una CausaLimpia sin operacion ni circunstancia se devuelve tal cual; con operacion o circunstancia sigue siendo una CausaLimpia sin el valor', async () => {
    const { causaLimpia, CausaLimpia } = await cargarRegistroDeErrores();
    const original = causaLimpia(causaFalsaDePrisma());

    expect(causaLimpia(original)).toBe(original);
    const conOperacion = causaLimpia(original, 'configuracion.update', 'rechazo-tras-trabajo');
    expect(conOperacion).toBeInstanceOf(CausaLimpia);
    expect(textoCompleto(conOperacion)).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 161: un Error comun no lleva su mensaje a la causa limpia', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();

    const limpia = causaLimpia(new Error(`un mensaje con DNI ${DNI_DE_PRUEBA}`));

    expect(textoCompleto(limpia)).not.toContain(DNI_DE_PRUEBA);
  });
});

describe('criterio 162: esErrorDeBase (P-42)', () => {
  it('criterio 162: es verdadero para las cinco clases de Prisma', async () => {
    const { esErrorDeBase } = await cargarRegistroDeErrores();
    const errores = [
      new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 'prueba' }),
      new Prisma.PrismaClientUnknownRequestError('x', { clientVersion: 'prueba' }),
      new Prisma.PrismaClientValidationError('x', { clientVersion: 'prueba' }),
      new Prisma.PrismaClientInitializationError('x', 'prueba'),
      new Prisma.PrismaClientRustPanicError('x', 'prueba'),
    ];

    for (const error of errores) expect(esErrorDeBase(error), error.name).toBe(true);
  });

  it.each([
    ['un nombre que empieza por PrismaClient', () => Object.assign(new Error('x'), { name: 'PrismaClientOtraCosa' })],
    ['DriverAdapterError', () => Object.assign(new Error('x'), { name: 'DriverAdapterError' })],
    ['DatabaseError', () => Object.assign(new Error('x'), { name: 'DatabaseError' })],
    ['un SQLSTATE en code', () => Object.assign(new Error('x'), { code: '22P02' })],
    [
      'un SQLSTATE en meta.driverAdapterError.cause',
      () => Object.assign(new Error('x'), { meta: { driverAdapterError: { cause: { originalCode: '23505' } } } }),
    ],
    ['un codigo de Prisma en code', () => Object.assign(new Error('x'), { code: 'P2025' })],
  ])('criterio 162: es verdadero para %s', async (_nombre, crear) => {
    const { esErrorDeBase } = await cargarRegistroDeErrores();

    expect(esErrorDeBase(crear())).toBe(true);
  });

  it('criterio 162: una CausaLimpia tambien cuenta', async () => {
    const { esErrorDeBase, causaLimpia } = await cargarRegistroDeErrores();

    expect(esErrorDeBase(causaLimpia(causaFalsaDePrisma()))).toBe(true);
  });

  it.each([
    ['un Error comun', () => new Error('boom')],
    ['un error de red de Node', () => Object.assign(new Error('x'), { code: 'ECONNREFUSED' })],
    ['una cadena', () => 'DNI 44556677'],
    ['null', () => null],
    ['undefined', () => undefined],
    ['un numero', () => 42],
  ])('criterio 162: es falso para %s', async (_nombre, crear) => {
    const { esErrorDeBase } = await cargarRegistroDeErrores();

    expect(esErrorDeBase(crear())).toBe(false);
  });
});

describe('criterio 162: errorParaRegistro (P-42)', () => {
  it('criterio 162: un error de Prisma se convierte en un objeto plano con solo tipo, codigoPrisma, sqlstate, modelo y pila (marcos)', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();

    const resultado = comoObjeto(errorParaRegistro(causaFalsaDePrisma()), 'P2007');

    expect(Object.getPrototypeOf(resultado), 'objeto plano').toBe(Object.prototype);
    expect(resultado['tipo']).toBe('PrismaClientKnownRequestError');
    expect(resultado['codigoPrisma']).toBe('P2007');
    expect(resultado['sqlstate']).toBe('22P02');
    expect(resultado['modelo']).toBe('Auditoria');
    const claves = Object.keys(resultado);
    for (const permitida of claves) {
      expect(
        ['tipo', 'codigoPrisma', 'sqlstate', 'codigoDeSistema', 'modelo', 'pila'],
        `clave inesperada: ${permitida}`,
      ).toContain(permitida);
    }
    for (const prohibida of ['message', 'mensaje', 'meta', 'cause', 'causa', 'stack']) {
      expect(claves, `no debe llevar ${prohibida}`).not.toContain(prohibida);
    }
  });

  it('criterio 162: la pila lleva solo las lineas de marco (las que empiezan con espacios y "at ")', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();

    const resultado = comoObjeto(errorParaRegistro(causaFalsaDePrisma()), 'pila');

    const pila = typeof resultado['pila'] === 'string' ? resultado['pila'] : '';
    expect(pila).toContain('at falso');
    expect(pila).toContain('at otro');
    for (const linea of pila.split('\n').filter((l) => l.trim() !== '')) {
      expect(linea, 'cada linea de la pila es un marco').toMatch(/^\s+at\s/);
    }
  });

  it('criterio 162: un modelo que no es del esquema no sale', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const error = Object.assign(new Error('x'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      meta: { modelName: `Inventado ${DNI_DE_PRUEBA}` },
    });

    const resultado = comoObjeto(errorParaRegistro(error), 'modelo inventado');

    expect(resultado['modelo']).toBeUndefined();
    expect(textoCompleto(resultado)).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 162: un P2002 da el SQLSTATE 23505 y nada de los valores', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();

    const resultado = comoObjeto(errorParaRegistro(errorFalsoDeUnicidad()), 'P2002');

    expect(resultado).toMatchObject({
      tipo: 'PrismaClientKnownRequestError',
      codigoPrisma: 'P2002',
      sqlstate: '23505',
    });
    expect(textoCompleto(resultado)).not.toContain(DNI_DE_PRUEBA);
    expect(JSON.stringify(resultado)).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 162: el codigo de sistema de un error de conexion (ECONNREFUSED en la causa) se conserva y el mensaje no', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const error = Object.assign(new Error(`No se pudo conectar a postgresql://usuario:clave-r13@host/base`), {
      name: 'PrismaClientInitializationError',
      errorCode: 'P1001',
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
    });

    const resultado = comoObjeto(errorParaRegistro(error), 'inicializacion');

    expect(resultado['tipo']).toBe('PrismaClientInitializationError');
    expect(resultado['codigoDeSistema']).toBe('ECONNREFUSED');
    expect(textoCompleto(resultado)).not.toContain('clave-r13');
    expect(textoCompleto(resultado)).not.toContain('postgresql://');
  });

  it('criterio 162: un Error propio con un error de Prisma como cause da un objeto con su mensaje y la causa limpia', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const propio = new Error('No se pudo registrar la auditoria', { cause: causaFalsaDePrisma() });

    const resultado = comoObjeto(errorParaRegistro(propio), 'propio con causa');

    expect(resultado['tipo']).toBe('Error');
    expect(resultado['mensaje']).toBe('No se pudo registrar la auditoria');
    expect(typeof resultado['pila']).toBe('string');
    const causa = comoObjeto(resultado['causa'], 'causa del propio');
    expect(causa).toMatchObject({ tipo: 'PrismaClientKnownRequestError', codigoPrisma: 'P2007', sqlstate: '22P02' });
    expect(textoCompleto(resultado)).not.toContain(DNI_DE_PRUEBA);
    expect(JSON.stringify(resultado)).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 162: el error de la base puede estar varios niveles abajo en la cadena de causas', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const profundo = new Error('nivel 1', {
      cause: new Error('nivel 2', { cause: new Error('nivel 3', { cause: errorFalsoDeUnicidad() }) }),
    });

    const resultado = errorParaRegistro(profundo);

    expect(resultado).not.toBe(profundo);
    expect(textoCompleto(resultado)).not.toContain(DNI_DE_PRUEBA);
    expect(JSON.stringify(resultado)).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 162: un AggregateError con un error de la base en errors tampoco lo deja pasar', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const agregado = new AggregateError([new Error('otro'), errorFalsoDeUnicidad()], 'varios fallos');

    const resultado = errorParaRegistro(agregado);

    expect(resultado).not.toBe(agregado);
    expect(textoCompleto(resultado)).not.toContain(DNI_DE_PRUEBA);
    expect(JSON.stringify(resultado)).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 162: un Error comun sin causa de la base, una CausaLimpia y un ErrorTransaccionAbortada se devuelven tal cual (el mismo objeto)', async () => {
    const { errorParaRegistro, causaLimpia } = await cargarRegistroDeErrores();
    const { ErrorTransaccionAbortada } = await cargarClaseAbortada();
    const comun = new Error('boom');
    const conCausaComun = new Error('con causa comun', { cause: new Error('otra') });
    const limpia = causaLimpia(causaFalsaDePrisma(), 'configuracion.update', 'rechazo-tras-trabajo');
    const abortada = new ErrorTransaccionAbortada({ cause: causaFalsaDePrisma() });

    expect(errorParaRegistro(comun)).toBe(comun);
    expect(errorParaRegistro(conCausaComun)).toBe(conCausaComun);
    expect(errorParaRegistro(limpia)).toBe(limpia);
    expect(errorParaRegistro(abortada)).toBe(abortada);
  });

  it.each([
    ['una cadena con datos', `DNI ${DNI_DE_PRUEBA}`, 'string'],
    ['un objeto con datos', { dni: DNI_DE_PRUEBA }, 'object'],
    ['null', null, 'object'],
    ['undefined', undefined, 'undefined'],
    ['un numero', 42, 'number'],
  ])(
    'criterio 162: %s que no es un Error se convierte en { tipo: typeof valor } y nunca su valor',
    async (_nombre, valor, tipo) => {
      const { errorParaRegistro } = await cargarRegistroDeErrores();

      const resultado = errorParaRegistro(valor);

      expect(resultado).toEqual({ tipo });
    },
  );

  describe('ninguna de las funciones lanza con ninguna entrada', () => {
    /** Un objeto cuyos getters lanzan. */
    function conGettersQueLanzan(): Error {
      const error = new Error('x');
      for (const clave of ['name', 'message', 'stack', 'code', 'meta', 'cause', 'errors', 'originalCode']) {
        Object.defineProperty(error, clave, {
          get() {
            throw new Error(`getter ${clave} DNI ${DNI_DE_PRUEBA}`);
          },
          configurable: true,
        });
      }
      return error;
    }

    function conCiclo(): Error {
      const a = errorFalsoDeUnicidad();
      const b = new Error('b');
      (b as { cause?: unknown }).cause = a;
      (a as { cause?: unknown }).cause = b;
      return b;
    }

    function cadenaLarga(): Error {
      let actual: Error = errorFalsoDeUnicidad();
      for (let i = 0; i < 30; i++) actual = new Error(`nivel ${i}`, { cause: actual });
      return actual;
    }

    const ENTRADAS: readonly [string, () => unknown][] = [
      ['null', () => null],
      ['undefined', () => undefined],
      ['un objeto con getters que lanzan', conGettersQueLanzan],
      [
        'un objeto plano con getters que lanzan',
        () => ({
          get name(): string {
            throw new Error('x');
          },
          get code(): string {
            throw new Error('x');
          },
        }),
      ],
      ['un ciclo en la cadena de causas', conCiclo],
      ['una cadena de 30 causas', cadenaLarga],
      ['un Symbol', () => Symbol('x')],
      ['un BigInt', () => 10n],
    ];

    it.each(ENTRADAS)(
      'criterio 162: esErrorDeBase, causaLimpia y errorParaRegistro no lanzan con %s',
      async (_nombre, crear) => {
        const { esErrorDeBase, causaLimpia, errorParaRegistro } = await cargarRegistroDeErrores();

        expect(() => esErrorDeBase(crear())).not.toThrow();
        expect(() => causaLimpia(crear(), 'configuracion.update', 'rechazo-tras-trabajo')).not.toThrow();
        expect(() => errorParaRegistro(crear())).not.toThrow();
      },
    );

    it('criterio 162: un error de la base con getters que lanzan en meta y con un ciclo en cause sigue dando un objeto sin el valor', async () => {
      const { errorParaRegistro } = await cargarRegistroDeErrores();
      const error = Object.assign(new Error(`DNI ${DNI_DE_PRUEBA}`), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      });
      Object.defineProperty(error, 'meta', {
        get() {
          throw new Error(`meta DNI ${DNI_DE_PRUEBA}`);
        },
      });
      (error as { cause?: unknown }).cause = error;

      const resultado = errorParaRegistro(error);

      expect(textoCompleto(resultado)).not.toContain(DNI_DE_PRUEBA);
    });
  });
});
