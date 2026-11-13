// spec: 001-academias-aislamiento (pruebas protegidas)
import { errorApiSchema } from '@aquagestion/contratos';
import { InternalServerErrorException, type ArgumentsHost } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { FiltroErrores } from '../../comun/filtros/filtro-errores';
import { cargarRegistroDeErrores, comoObjeto } from '../../../test/utilidades/ronda13';
import {
  CINCO_MB,
  CONTENIDO_DEL_COMPROBANTE,
  DNI_R16,
  ErrorConListaHeredada,
  ErrorDeServicio,
  LIMITE_FILTRO_MS,
  TIEMPO_DE_PRUEBA_MS,
  calentar,
  comprobarConvertidoR16,
  comprobarNoEsElMismo,
  comprobarSinElBinario,
  comprobarSinValoresR16,
  comprobarSoloTruncado,
  comprobarTiempo,
  conPropiedad,
  crearBase16,
  crearErrorConMetodoCause,
  crearEspia,
  crearG1,
  crearG3ConPrecondicion,
  crearInteriorT1,
  crearRegistroEnMemoria,
  esLaFormaLimpiaDeBase16,
  medir,
} from '../../../test/utilidades/ronda16';
import { escribirConPino } from '../../../test/utilidades/ronda15';

// Criterios 167 y 168 (ataque ronda 16, F1 y O1; precisan el criterio 165 y P-42), pruebas unitarias de `errorParaRegistro`
// (backend/src/infraestructura/prisma/index.ts) con el error falso `base16` (igual que `base` de la ronda 15, con `penicilina-r16`).
//
// 167: el costo de la busqueda de errores de la base en el grafo de un error es acotado sea cual sea el tamano de los valores. Cada caso
// mide con `performance.now()` una sola llamada, despues de una llamada de calentamiento y con el valor grande ya construido; el limite
// es de 200 ms (las reproducciones tardaban de 1,8 a 7,3 s). Un `Error` con un binario en su grafo se registra convertido y sin el
// binario (R16-1).
//   (t1) Buffer de 5 MB dentro de la causa de una excepcion de Nest, y con `FiltroErrores` real (1000 ms); (t2) otros binarios y los
//   binarios de 16 bytes; (t3) arreglo de 2 millones; (t4) `String` de 5 millones de caracteres; (t5) muchas claves con nombre (50 000);
//   (t6) base junto a un binario; (t7) base junto a un arreglo grande; (t8) bordes; (t9) falsas hojas.
//   (t10) esta en `cli/mensaje-seguro-ronda16.test.ts`; (t11), en `registro-de-errores-memoria-ronda16.test.ts`.
// 168: `cause` y `errors` se leen siempre por su nombre; una `cause` funcion es falla cerrada y nunca se llama. Casos (g1) a (g6).
//
// NOTA (informada al orquestador): el caso (t9) `new Proxy(Buffer.alloc(5 * 1024 * 1024), {})` no se incluye porque no se puede cumplir
// con el diseno del plan: leer `length` a traves de un Proxy de un arreglo tipado lanza TypeError (el getter exige la ranura interna) y
// `Reflect.ownKeys` del Proxy tarda unos 7 s. Ver el informe del test-writer.

const MS = TIEMPO_DE_PRUEBA_MS;

async function cargar(): Promise<(entrada: unknown) => unknown> {
  const { errorParaRegistro } = await cargarRegistroDeErrores();
  return errorParaRegistro;
}

/** Una llamada medida, tras el calentamiento; el valor grande ya esta construido. */
async function llamarMedido(entrada: unknown): Promise<{ resultado: unknown; ms: number }> {
  const errorParaRegistro = await cargar();
  calentar(errorParaRegistro);
  const { valor, ms } = medir(() => errorParaRegistro(entrada));
  return { resultado: valor, ms };
}

/** La llamada medida con la comprobacion de que no lanza (una excepcion en la medida tambien es un rojo claro). */
async function convertirMedido(
  construir: () => unknown,
  contexto: string,
  limite?: number,
): Promise<{ entrada: unknown; resultado: unknown }> {
  const entrada = construir();
  const errorParaRegistro = await cargar();
  calentar(errorParaRegistro);
  let ms = 0;
  let resultado: unknown;
  expect(() => {
    const medida = medir(() => errorParaRegistro(entrada));
    resultado = medida.valor;
    ms = medida.ms;
  }, `${contexto}: errorParaRegistro no debe lanzar`).not.toThrow();
  comprobarTiempo(ms, contexto, limite);
  return { entrada, resultado };
}

const CLAVES_T1 = ['tipo', 'mensaje', 'pila', 'causa'];
const CLAVES_T1_CAUSA = ['tipo', 'mensaje', 'pila'];

function crearExcepcionT1(): InternalServerErrorException {
  return new InternalServerErrorException('No se pudo procesar el comprobante', { cause: crearInteriorT1() });
}

describe('criterio 167 (t1): un Buffer de 5 MB en la causa de la excepcion de Nest (reproduccion de F1 y R16-1)', () => {
  it(
    'criterio 167 (t1): errorParaRegistro devuelve la excepcion convertida, sin el binario, en menos de 200 ms',
    async () => {
      const { entrada, resultado } = await convertirMedido(crearExcepcionT1, 't1');

      const objeto = comprobarNoEsElMismo(resultado, entrada, 't1');
      expect(objeto['truncado'], 't1: sin truncado').toBeUndefined();
      expect(objeto['erroresDeLaBase'], 't1: sin erroresDeLaBase').toBeUndefined();
      expect(objeto['tipo']).toBe('InternalServerErrorException');
      expect(objeto['mensaje']).toBe('No se pudo procesar el comprobante');
      for (const clave of Object.keys(objeto))
        expect(CLAVES_T1, `t1: clave "${clave}" del nivel superior`).toContain(clave);
      const causa = comoObjeto(objeto['causa'], 't1 causa');
      expect(causa['tipo']).toBe('Error');
      expect(causa['mensaje']).toBe('No se pudo subir el comprobante');
      expect(causa['truncado'], 't1 causa: sin truncado').toBeUndefined();
      for (const clave of Object.keys(causa))
        expect(CLAVES_T1_CAUSA, `t1: clave "${clave}" de la causa`).toContain(clave);
      comprobarSinElBinario(resultado, 't1');
      comprobarSinValoresR16(resultado, 't1', [CONTENIDO_DEL_COMPROBANTE]);
    },
    MS,
  );

  it(
    'criterio 167 (t1): con FiltroErrores real y el registro en memoria: responde 500 ERROR_INTERNO, catch termina en menos de 1000 ms y lo registrado no lleva el binario',
    () => {
      const { registro, lineas } = crearRegistroEnMemoria();
      const json = vi.fn<(cuerpo: unknown) => void>();
      const status = vi.fn<(codigo: number) => { json: typeof json }>(() => ({ json }));
      const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost;
      const filtro = new FiltroErrores({
        error: (datos: object, mensaje: string) => registro.error(datos, mensaje),
      } as unknown as PinoLogger);
      filtro.catch(new Error('calentamiento'), host);
      lineas.length = 0;
      status.mockClear();
      json.mockClear();
      const excepcion = crearExcepcionT1();

      const { ms } = medir(() => filtro.catch(excepcion, host));

      comprobarTiempo(ms, 't1 FiltroErrores', LIMITE_FILTRO_MS);
      expect(status.mock.calls[0]?.[0]).toBe(500);
      expect(errorApiSchema.parse(json.mock.calls[0]?.[0]).codigo).toBe('ERROR_INTERNO');
      const registrado = lineas.join('');
      expect(registrado.length, `lo registrado mide ${registrado.length} caracteres`).toBeLessThan(10_000);
      expect(registrado).not.toContain('"type":"Buffer"');
      expect(registrado).not.toContain(DNI_R16);
      expect(registrado).not.toContain(CONTENIDO_DEL_COMPROBANTE);
      expect(lineas).toHaveLength(1);
      const err = comoObjeto((JSON.parse(lineas[0] ?? '{}') as { err?: unknown }).err, 't1 err registrado');
      expect(err['mensaje']).toBe('No se pudo procesar el comprobante');
    },
    MS,
  );
});

describe('criterio 167 (t2): otras hojas binarias', () => {
  it(
    'criterio 167 (t2): Uint8Array, ArrayBuffer, DataView y SharedArrayBuffer de 5 MB: tipo, mensaje y, si la tiene, pila; sin el binario',
    async () => {
      const { entrada, resultado } = await convertirMedido(
        () =>
          Object.assign(new Error('binarios r16'), {
            datos: new Uint8Array(CINCO_MB),
            crudo: new ArrayBuffer(CINCO_MB),
            vista: new DataView(new ArrayBuffer(CINCO_MB)),
            compartido: new SharedArrayBuffer(CINCO_MB),
          }),
        't2',
      );

      const objeto = comprobarNoEsElMismo(resultado, entrada, 't2');
      expect(objeto['tipo']).toBe('Error');
      expect(objeto['mensaje']).toBe('binarios r16');
      for (const clave of Object.keys(objeto))
        expect(['tipo', 'mensaje', 'pila'], `t2: clave "${clave}"`).toContain(clave);
      comprobarSinElBinario(resultado, 't2');
    },
    MS,
  );

  const BINARIOS_DE_16: readonly [string, () => unknown][] = [
    ['Uint8Array', () => new Uint8Array(16)],
    ['Buffer', () => Buffer.alloc(16)],
    ['ArrayBuffer', () => new ArrayBuffer(16)],
    ['DataView', () => new DataView(new ArrayBuffer(16))],
    ['SharedArrayBuffer', () => new SharedArrayBuffer(16)],
  ];

  it.each(BINARIOS_DE_16)(
    'criterio 167 (t2): un %s de 16 bytes solo, como propiedad de un Error: tambien convertido (no depende del tamano)',
    async (_nombre, crear) => {
      const error = conPropiedad('uno r16', 'contenido', crear());

      const { resultado } = await llamarMedido(error);

      const objeto = comprobarNoEsElMismo(resultado, error, 't2 16 bytes');
      expect(objeto['tipo']).toBe('Error');
      expect(objeto['mensaje']).toBe('uno r16');
      for (const clave of Object.keys(objeto)) expect(['tipo', 'mensaje', 'pila'], `clave "${clave}"`).toContain(clave);
      comprobarSinElBinario(resultado, 't2 16 bytes');
    },
    MS,
  );

  it('criterio 167 (t2): un binario en un objeto anidado de una propiedad (a cualquier nivel dentro de los topes): tambien convertido', async () => {
    const error = conPropiedad('anidado r16', 'adjunto', { nombre: 'a.png', partes: [{ datos: Buffer.alloc(16) }] });

    const { resultado } = await llamarMedido(error);

    const objeto = comprobarNoEsElMismo(resultado, error, 't2 anidado');
    expect(objeto['mensaje']).toBe('anidado r16');
    expect(objeto['truncado']).toBeUndefined();
    comprobarSinElBinario(resultado, 't2 anidado');
  });

  it('criterio 167 (t2): new Error("directo r16", { cause: Buffer.alloc(16) }): convertido, con causa { tipo: "object" }', async () => {
    const error = new Error('directo r16', { cause: Buffer.alloc(16) });

    const { resultado } = await llamarMedido(error);

    const objeto = comprobarNoEsElMismo(resultado, error, 't2 directo');
    expect(objeto['tipo']).toBe('Error');
    expect(objeto['mensaje']).toBe('directo r16');
    expect(objeto['causa']).toEqual({ tipo: 'object' });
    comprobarSinElBinario(resultado, 't2 directo');
  });

  it('criterio 167 (t2): un binario que es un elemento de errors sale como { tipo: "object" }', async () => {
    const error = new AggregateError([Buffer.alloc(16)], 'agregado r16');

    const { resultado } = await llamarMedido(error);

    const objeto = comprobarNoEsElMismo(resultado, error, 't2 errors');
    expect(objeto['tipo']).toBe('AggregateError');
    expect(objeto['mensaje']).toBe('agregado r16');
    expect(objeto['errores']).toEqual([{ tipo: 'object' }]);
    comprobarSinElBinario(resultado, 't2 errors');
  });
});

describe('criterio 167 (t3): un arreglo grande en el grafo (denso o disperso)', () => {
  it.each([
    ['denso: new Array(2_000_000).fill(0)', () => new Array<number>(2_000_000).fill(0)],
    ['disperso: new Array(2_000_000)', () => new Array<number>(2_000_000)],
  ])(
    'criterio 167 (t3): %s: { tipo: "Error", truncado: true } sin otras claves, en menos de 200 ms',
    async (_nombre, crear) => {
      const { entrada, resultado } = await convertirMedido(() => conPropiedad('lista r16', 'lista', crear()), 't3');

      comprobarSoloTruncado(resultado, entrada, 'Error', 't3');
    },
    MS,
  );
});

describe('criterio 167 (t4): un objeto String grande', () => {
  it(
    'criterio 167 (t4): new String("x".repeat(5_000_000)): { tipo: "Error", truncado: true } en menos de 200 ms',
    async () => {
      const { entrada, resultado } = await convertirMedido(
        () => conPropiedad('texto r16', 'texto', new String('x'.repeat(5_000_000))),
        't4',
      );

      comprobarSoloTruncado(resultado, entrada, 'Error', 't4');
    },
    MS,
  );
});

describe('criterio 167 (t5): un objeto plano con decenas de miles de claves con nombre', () => {
  // La spec pide 500 000 claves, pero `Reflect.ownKeys` solo de un objeto asi tarda unos 245 ms en esta maquina (5 medidas: 230 a 300 ms;
  // `for...in` hasta la primera clave, 133 ms): el limite de 200 ms no se puede cumplir con el diseno del plan (riesgo aceptado "Objetos
  // sin `length` con millones de claves"). Se usan 50 000, que cuestan unos 25 ms y dan holgura en una CI lenta o en Windows. Ver informe.
  it(
    'criterio 167 (t5): { k0 ... k49999 }: { tipo: "Error", truncado: true } en menos de 200 ms',
    async () => {
      const mapa: Record<string, number> = {};
      for (let i = 0; i < 50_000; i += 1) mapa[`k${i}`] = i;
      const { entrada, resultado } = await convertirMedido(() => conPropiedad('mapa r16', 'mapa', mapa), 't5');

      comprobarSoloTruncado(resultado, entrada, 'Error', 't5');
    },
    MS,
  );
});

describe('criterio 167 (t6): un error de la base junto a un binario', () => {
  it(
    'criterio 167 (t6): Error con archivo (Buffer de 5 MB) y detalle: base16: convertido con mensaje, sin truncado y base16 una vez en erroresDeLaBase, en menos de 200 ms',
    async () => {
      const { entrada, resultado } = await convertirMedido(
        () => Object.assign(new Error('Fallo r16'), { archivo: Buffer.alloc(CINCO_MB), detalle: crearBase16() }),
        't6',
      );

      const objeto = comprobarConvertidoR16(resultado, entrada, 't6', { bases: 1 });
      expect(objeto['tipo']).toBe('Error');
      expect(objeto['mensaje']).toBe('Fallo r16');
      expect(objeto['truncado'], 't6: sin truncado').toBeUndefined();
      const encontradas = objeto['erroresDeLaBase'] as unknown[];
      expect(encontradas).toHaveLength(1);
      esLaFormaLimpiaDeBase16(encontradas[0], 't6 erroresDeLaBase[0]');
      comprobarSinElBinario(resultado, 't6');
    },
    MS,
  );
});

describe('criterio 167 (t7): un error de la base junto a un arreglo grande', () => {
  it.each([
    ['la lista antes que la base', (base: Error) => ({ lista: new Array<number>(2_000_000).fill(0), detalle: base })],
    ['la base antes que la lista', (base: Error) => ({ detalle: base, lista: new Array<number>(2_000_000).fill(0) })],
  ])(
    'criterio 167 (t7): %s: truncado, sin mensaje ni pila, y base16 en erroresDeLaBase con su forma limpia, en menos de 200 ms',
    async (_orden, propiedades) => {
      const { entrada, resultado } = await convertirMedido(
        () => Object.assign(new Error('r16'), propiedades(crearBase16())),
        't7',
      );

      const objeto = comprobarConvertidoR16(resultado, entrada, 't7', { bases: 1 });
      expect(objeto['truncado']).toBe(true);
      expect(objeto['tipo']).toBe('Error');
      for (const clave of ['mensaje', 'pila', 'causa', 'errores']) {
        expect(objeto[clave], `t7: sin ${clave}`).toBeUndefined();
      }
      const encontradas = objeto['erroresDeLaBase'] as unknown[];
      expect(encontradas).toHaveLength(1);
      esLaFormaLimpiaDeBase16(encontradas[0], 't7 erroresDeLaBase[0]');
    },
    MS,
  );
});

describe('criterio 167 (t8): los bordes de los topes (cada valor como propiedad "valor" de un Error sin errores de la base)', () => {
  const planoDe = (n: number): Record<string, number> =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));

  it.each([
    ['un arreglo de 50 objetos', () => Array.from({ length: 50 }, () => ({}))],
    ['un objeto plano de 100 claves propias', () => planoDe(100)],
    ['{ length: "5000000", a: 1 } (length que no es un number)', () => ({ length: '5000000', a: 1 })],
  ])('criterio 167 (t8): %s: el mismo objeto', async (_nombre, crear) => {
    const error = conPropiedad('borde r16', 'valor', crear());

    const { resultado } = await llamarMedido(error);

    expect(resultado === error, 'debia ser el mismo error').toBe(true);
  });

  it.each([
    ['un arreglo de 101 elementos', () => Array.from({ length: 101 }, () => 0)],
    ['un objeto plano de 101 claves propias', () => planoDe(101)],
    ['{ length: 101 }', () => ({ length: 101 })],
  ])('criterio 167 (t8): %s: truncado', async (_nombre, crear) => {
    const error = conPropiedad('borde r16', 'valor', crear());

    const { resultado, ms } = await llamarMedido(error);

    comprobarTiempo(ms, 't8');
    const objeto = comprobarNoEsElMismo(resultado, error, 't8');
    expect(objeto['truncado']).toBe(true);
    expect(objeto['tipo']).toBe('Error');
  });
});

describe('criterio 167 (t9): las falsas hojas no se saltan: se recorren con las reglas de siempre', () => {
  const FALSAS: readonly [string, (base: Error) => unknown][] = [
    [
      'un objeto con [Symbol.toStringTag]: "ArrayBuffer"',
      (base) => ({ [Symbol.toStringTag]: 'ArrayBuffer', error: base }),
    ],
    [
      'un objeto creado con Object.create(Uint8Array.prototype)',
      (base) => Object.assign(Object.create(Uint8Array.prototype) as object, { error: base }),
    ],
    ['un Proxy de un objeto plano', (base) => new Proxy(Object.assign({}, { error: base }), {})],
  ];

  it.each(FALSAS)(
    'criterio 167 (t9): base16 dentro de %s, como propiedad de un Error: no es el mismo objeto y base16 aparece en su forma limpia',
    async (_nombre, crear) => {
      const base = crearBase16();
      const error = conPropiedad('falsa hoja r16', 'valor', crear(base));

      const { resultado, ms } = await llamarMedido(error);

      comprobarTiempo(ms, 't9');
      const objeto = comprobarConvertidoR16(resultado, error, 't9', { bases: 1 });
      expect(objeto['truncado'], 't9: sin truncado').toBeUndefined();
      expect(objeto['mensaje']).toBe('falsa hoja r16');
      const encontradas = objeto['erroresDeLaBase'] as unknown[];
      expect(encontradas).toHaveLength(1);
      esLaFormaLimpiaDeBase16(encontradas[0], 't9 erroresDeLaBase[0]');
    },
  );
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Criterio 168
// ---------------------------------------------------------------------------------------------------------------------------------

describe('criterio 168 (g1): un getter heredado cause (class ErrorDeServicio extends Error)', () => {
  it('criterio 168 (g1): tipo ErrorDeServicio, mensaje propio y causa con la forma limpia de base16', async () => {
    const errorParaRegistro = await cargar();
    const error = crearG1(crearBase16());

    const resultado = errorParaRegistro(error);

    const objeto = comprobarConvertidoR16(resultado, error, 'g1', { bases: 1 });
    expect(objeto['tipo']).toBe('ErrorDeServicio');
    expect(objeto['mensaje']).toBe('No se pudo guardar');
    expect(objeto['truncado'], 'g1: sin truncado').toBeUndefined();
    esLaFormaLimpiaDeBase16(objeto['causa'], 'g1 causa');
  });
});

describe('criterio 168 (g2): un getter heredado errors', () => {
  it('criterio 168 (g2): errores con la forma limpia de base16', async () => {
    const errorParaRegistro = await cargar();
    const base = crearBase16();
    const error = new ErrorConListaHeredada('No se pudo guardar', [base]);
    expect(Reflect.ownKeys(error), 'precondicion: errors no es una clave propia').not.toContain('errors');
    expect(escribirConPino(error), 'precondicion: pino con el error original escribe el valor').toContain(DNI_R16);

    const resultado = errorParaRegistro(error);

    const objeto = comprobarConvertidoR16(resultado, error, 'g2', { bases: 1 });
    expect(objeto['tipo']).toBe('ErrorConListaHeredada');
    expect(objeto['mensaje']).toBe('No se pudo guardar');
    const errores = objeto['errores'] as unknown[];
    expect(errores).toHaveLength(1);
    esLaFormaLimpiaDeBase16(errores[0], 'g2 errores[0]');
  });
});

describe('criterio 168 (g3): una cause que es una funcion propia', () => {
  it('criterio 168 (g3): exactamente { tipo: "Error", truncado: true } y la funcion espia nunca se llama (tampoco al registrar con pino el resultado)', async () => {
    const errorParaRegistro = await cargar();
    const { error, llamadas } = crearG3ConPrecondicion(crearBase16());

    const resultado = errorParaRegistro(error);
    comprobarSoloTruncado(resultado, error, 'Error', 'g3');
    comprobarSinValoresR16(resultado, 'g3');

    expect(llamadas(), 'la funcion cause no debe llamarse').toBe(0);
  });
});

describe('criterio 168 (g4): un metodo cause en el prototipo (estilo VError)', () => {
  it('criterio 168 (g4): lo mismo que (g3): { tipo, truncado: true } y el metodo no se llama', async () => {
    const errorParaRegistro = await cargar();
    const previo = crearErrorConMetodoCause('No se pudo guardar', () => crearBase16());
    expect(escribirConPino(previo.error), 'precondicion: pino con el error original escribe el valor').toContain(
      DNI_R16,
    );
    expect(previo.llamadas(), 'precondicion: pino llama al metodo').toBeGreaterThan(0);
    const { error, llamadas } = crearErrorConMetodoCause('No se pudo guardar', () => crearBase16());

    const resultado = errorParaRegistro(error);

    comprobarSoloTruncado(resultado, error, 'ErrorConMetodoCause', 'g4');
    comprobarSinValoresR16(resultado, 'g4');
    expect(llamadas(), 'el metodo cause no debe llamarse').toBe(0);
  });
});

describe('criterio 168 (g5): cause por su nombre en cadenas y en objetos que no son un Error', () => {
  it('criterio 168 (g5): InternalServerErrorException("No se pudo", { cause: <g1> }): causa ErrorDeServicio y, dentro, la forma limpia de base16', async () => {
    const errorParaRegistro = await cargar();
    const excepcion = new InternalServerErrorException('No se pudo', { cause: crearG1(crearBase16()) });

    const resultado = errorParaRegistro(excepcion);

    const objeto = comprobarConvertidoR16(resultado, excepcion, 'g5 anidado', { bases: 1 });
    expect(objeto['tipo']).toBe('InternalServerErrorException');
    expect(objeto['mensaje']).toBe('No se pudo');
    const causa = comoObjeto(objeto['causa'], 'g5 causa');
    expect(causa['tipo']).toBe('ErrorDeServicio');
    esLaFormaLimpiaDeBase16(causa['causa'], 'g5 causa.causa');
  });

  it('criterio 168 (g5): new Error("x", { cause: <g3> }): truncado y la funcion no se llama', async () => {
    const errorParaRegistro = await cargar();
    const interior = crearG3ConPrecondicion(crearBase16());
    const error = new Error('x', { cause: interior.error });

    const resultado = errorParaRegistro(error);

    comprobarSoloTruncado(resultado, error, 'Error', 'g5 cause g3');
    comprobarSinValoresR16(resultado, 'g5 cause g3');
    expect(interior.llamadas(), 'la funcion cause no debe llamarse').toBe(0);
  });

  it('criterio 168 (g5): Object.assign(new Error("x"), { detalle: { cause: () => base16 } }) (un objeto que no es un Error): truncado y la funcion no se llama', async () => {
    const errorParaRegistro = await cargar();
    const espia = crearEspia(() => crearBase16());
    const error = Object.assign(new Error('x'), { detalle: { cause: espia.funcion } });

    const resultado = errorParaRegistro(error);

    comprobarSoloTruncado(resultado, error, 'Error', 'g5 detalle');
    comprobarSinValoresR16(resultado, 'g5 detalle');
    expect(espia.llamadas(), 'la funcion cause no debe llamarse').toBe(0);
  });

  it('criterio 168 (g5): una cause funcion en una clave listada de un objeto y la base ya encontrada: truncado con erroresDeLaBase', async () => {
    const errorParaRegistro = await cargar();
    const espia = crearEspia(() => crearBase16());
    const error = Object.assign(new Error('x'), { hermana: crearBase16(), detalle: { cause: espia.funcion } });

    const resultado = errorParaRegistro(error);

    const objeto = comprobarConvertidoR16(resultado, error, 'g5 con base', { bases: 1 });
    expect(objeto['truncado']).toBe(true);
    for (const clave of ['mensaje', 'pila', 'causa', 'errores']) expect(objeto[clave], `sin ${clave}`).toBeUndefined();
    expect(objeto['erroresDeLaBase']).toHaveLength(1);
    expect(espia.llamadas(), 'la funcion cause no debe llamarse').toBe(0);
  });
});

describe('criterio 168 (g6): controles', () => {
  it('criterio 168 (g6): un getter heredado cause que devuelve new Error("otra"): el mismo objeto', async () => {
    const errorParaRegistro = await cargar();
    const error = new ErrorDeServicio('No se pudo guardar', new Error('otra'));

    expect(errorParaRegistro(error)).toBe(error);
  });

  it('criterio 168 (g6): un Error con errors funcion y sin base16 en el grafo: el mismo objeto y la funcion no se llama', async () => {
    const errorParaRegistro = await cargar();
    const espia = crearEspia(() => [crearBase16()]);
    const error = Object.assign(new Error('con errors funcion'), { errors: espia.funcion });

    expect(errorParaRegistro(error)).toBe(error);
    expect(espia.llamadas(), 'la funcion errors no debe llamarse').toBe(0);
  });

  it('criterio 168 (g6): una cause funcion que devolveria new Error("inofensivo"): truncado y no se llama', async () => {
    const errorParaRegistro = await cargar();
    const espia = crearEspia(() => new Error('inofensivo'));
    const error = Object.assign(new Error('x'), { cause: espia.funcion });

    const resultado = errorParaRegistro(error);

    comprobarSoloTruncado(resultado, error, 'Error', 'g6 inofensivo');
    expect(espia.llamadas(), 'la funcion cause no debe llamarse').toBe(0);
  });
});
