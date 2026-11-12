// spec: 001-academias-aislamiento (pruebas protegidas)
import { inspect, types } from 'node:util';
import pino from 'pino';
import { expect } from 'vitest';
import { errorFalsoDeBase, objetosConTipo } from './ronda14';
import { CLAVES_DEL_NIVEL_SUPERIOR, escribirConPino, jsonSeguro } from './ronda15';

/**
 * Ayudas de las pruebas protegidas de la ronda 16 del ataque (criterios 167 y 168): el costo de la busqueda de errores de la base en el
 * grafo de un error es acotado sea cual sea el tamano de los valores (un `Buffer` de 5 MB bloqueaba el proceso 7 s), un error con un
 * binario en su grafo se registra convertido y sin el binario (R16-1), y `cause` y `errors` se leen siempre por su nombre (una `cause` que
 * es una funcion es falla cerrada y nunca se llama).
 */

/** Datos personales de mentira que viajan dentro del mensaje del error de la base: nunca deben aparecer en un registro. */
export const DNI_R16 = '44556677';
export const ALERGIA_R16 = 'penicilina-r16';
export const SINTAXIS_R16 = 'invalid input syntax';
export const PROHIBIDOS_R16 = [DNI_R16, ALERGIA_R16, SINTAXIS_R16] as const;

/** El mensaje del error falso de la base (`base16`), con la forma del que escribe PostgreSQL. */
export const MENSAJE_BASE_R16 = `invalid input syntax for type inet: "DNI ${DNI_R16} alergia ${ALERGIA_R16}"`;

export const NOMBRE_DE_PRISMA_R16 = 'PrismaClientKnownRequestError';

/** Limite de tiempo de una llamada a `errorParaRegistro` o `mensajeSeguro` con un valor grande (holgado: las reproducciones tardaban de 1,8 a 7,3 s). */
export const LIMITE_MS = 200;
/** Limite de `FiltroErrores.catch` con (t1), que incluye que pino escriba el registro. */
export const LIMITE_FILTRO_MS = 1000;
/** Tiempo maximo de una prueba con valores de varios MB: en rojo, el codigo anterior tardaba segundos por caso. */
export const TIEMPO_DE_PRUEBA_MS = 120_000;

/** Contenido reconocible del comprobante de (t1): nunca debe llegar a un registro. */
export const CONTENIDO_DEL_COMPROBANTE = 'COMPROBANTE-R16';

export const CINCO_MB = 5 * 1024 * 1024;

/** Las claves con las que las pruebas guardan binarios en un error: ninguna sale en el resultado. */
export const CLAVES_DE_BINARIOS = ['archivo', 'datos', 'crudo', 'vista', 'compartido'] as const;

/** Claves de un error o de una excepcion que nunca salen en el resultado, a ninguna profundidad. */
const CLAVES_PROHIBIDAS = [
  'message',
  'stack',
  'response',
  'options',
  'status',
  'meta',
  'cause',
  'errors',
  'detalle',
  'lista',
  'texto',
  'mapa',
  ...CLAVES_DE_BINARIOS,
];

/**
 * `base16`: un error falso con forma de error de Prisma (`name: 'PrismaClientKnownRequestError'`, `code: 'P2007'`, el mensaje de
 * `MENSAJE_BASE_R16`, `stack` con ese encabezado exacto y dos marcos, `meta` con la causa del adaptador).
 */
export function crearBase16(): Error & { code: string } {
  const base = errorFalsoDeBase({ message: MENSAJE_BASE_R16 });
  Object.assign(base, {
    meta: {
      modelName: 'Auditoria',
      driverAdapterError: { cause: { originalCode: '22P02', originalMessage: MENSAJE_BASE_R16 } },
    },
  });
  return base;
}

/** Un binario por la ranura interna del motor (nunca por `instanceof`, prototipo ni `Symbol.toStringTag`). */
export const esBinario = (valor: unknown): boolean =>
  typeof valor === 'object' && valor !== null && (ArrayBuffer.isView(valor) || types.isAnyArrayBuffer(valor));

/** Mide una sola llamada con `performance.now()`. */
export function medir<T>(llamada: () => T): { valor: T; ms: number } {
  const inicio = performance.now();
  const valor = llamada();
  return { valor, ms: performance.now() - inicio };
}

/** El limite de tiempo, comprobado con `expect.soft` para que el rojo informe tambien lo demas que falle en el mismo caso. */
export function comprobarTiempo(ms: number, contexto: string, limite = LIMITE_MS): void {
  expect.soft(ms, `${contexto}: la llamada tardo ${Math.round(ms)} ms (limite ${limite} ms)`).toBeLessThan(limite);
}

/** La llamada de calentamiento de cada caso (compila y calienta el camino de `errorParaRegistro`). */
export function calentar(errorParaRegistro: (error: unknown) => unknown): void {
  errorParaRegistro(new Error('calentamiento'));
}

/** Los textos con los que se ve un resultado: `util.inspect` (depth null, showHidden), `JSON.stringify` y lo que escribe pino. */
export function formasDeVer(resultado: unknown): [string, () => string][] {
  return [
    ['inspect', () => inspect(resultado, { depth: null, showHidden: true })],
    ['JSON.stringify', () => jsonSeguro(resultado)],
    ['pino', () => escribirConPino(resultado)],
  ];
}

/** Ninguna de las tres formas de ver el resultado contiene los valores (ni los `extras`). */
export function comprobarSinValoresR16(resultado: unknown, contexto: string, extras: readonly string[] = []): void {
  for (const [forma, leer] of formasDeVer(resultado)) {
    let texto: string;
    try {
      texto = leer();
    } catch (error) {
      expect.fail(
        `${contexto}: ${forma} lanza al serializar el resultado (no es un objeto plano y limpio): ${String(error)}`,
      );
    }
    for (const prohibido of [...PROHIBIDOS_R16, ...extras]) {
      expect(texto, `${contexto}: ${forma} no debe contener "${prohibido}"`).not.toContain(prohibido);
    }
  }
}

function binarioEn(valor: unknown, vistos = new Set<unknown>(), ruta = 'resultado'): string | undefined {
  if (typeof valor !== 'object' || valor === null) return undefined;
  if (esBinario(valor)) return ruta;
  if (vistos.has(valor)) return undefined;
  vistos.add(valor);
  for (const clave of Reflect.ownKeys(valor)) {
    const dentro = binarioEn((valor as Record<PropertyKey, unknown>)[clave], vistos, `${ruta}.${String(clave)}`);
    if (dentro !== undefined) return dentro;
  }
  return undefined;
}

function claveProhibidaEn(valor: unknown, vistos = new Set<unknown>(), ruta = 'resultado'): string | undefined {
  if (typeof valor !== 'object' || valor === null || vistos.has(valor)) return undefined;
  vistos.add(valor);
  for (const [clave, hijo] of Object.entries(valor)) {
    if (CLAVES_PROHIBIDAS.includes(clave)) return `${ruta}.${clave}`;
    const dentro = claveProhibidaEn(hijo, vistos, `${ruta}.${clave}`);
    if (dentro !== undefined) return dentro;
  }
  return undefined;
}

/**
 * R16-1, "sin el binario": ningun valor del resultado, a ninguna profundidad, es un binario; ninguna clave se llama `archivo`, `datos`,
 * `crudo`, `vista` ni `compartido`; y `JSON.stringify(resultado)` y la linea que escribe pino miden menos de 10 000 caracteres y no
 * contienen `"type":"Buffer"`.
 */
export function comprobarSinElBinario(resultado: unknown, contexto: string): void {
  expect(binarioEn(resultado), `${contexto}: el resultado lleva un binario`).toBeUndefined();
  expect(
    claveProhibidaEn(resultado),
    `${contexto}: clave "archivo", "datos", "crudo", "vista", "compartido" o de un error original en el resultado`,
  ).toBeUndefined();
  const json = jsonSeguro(resultado);
  const linea = escribirConPino(resultado);
  expect(json.length, `${contexto}: JSON.stringify mide ${json.length} caracteres`).toBeLessThan(10_000);
  expect(linea.length, `${contexto}: la linea de pino mide ${linea.length} caracteres`).toBeLessThan(10_000);
  expect(json, `${contexto}: JSON.stringify no debe contener "type":"Buffer"`).not.toContain('"type":"Buffer"');
  expect(linea, `${contexto}: pino no debe escribir "type":"Buffer"`).not.toContain('"type":"Buffer"');
}

/** Las comprobaciones comunes de que el resultado no es el mismo objeto: comparacion booleana (vitest no imprime un error con un `Proxy`). */
export function comprobarNoEsElMismo(resultado: unknown, entrada: unknown, contexto: string): Record<string, unknown> {
  expect(resultado === entrada, `${contexto}: debia ser un objeto nuevo, no el error recibido`).toBe(false);
  expect(typeof resultado, `${contexto}: debia ser un objeto`).toBe('object');
  expect(resultado, `${contexto}: no debia ser null`).not.toBeNull();
  return resultado as Record<string, unknown>;
}

/**
 * Las comprobaciones comunes de un error convertido (criterios 165, 167 y 168): no es el mismo objeto, el objeto de nivel superior solo
 * tiene las claves permitidas, no sale ninguna propiedad del error original a ninguna profundidad, no contiene los valores y, si se
 * indica `bases`, hay exactamente ese numero de objetos con la forma limpia de `base16`. Devuelve el objeto.
 */
export function comprobarConvertidoR16(
  resultado: unknown,
  entrada: unknown,
  contexto: string,
  opciones: { bases?: number; extras?: readonly string[] } = {},
): Record<string, unknown> {
  const objeto = comprobarNoEsElMismo(resultado, entrada, contexto);
  for (const clave of Object.keys(objeto)) {
    expect(CLAVES_DEL_NIVEL_SUPERIOR, `${contexto}: clave inesperada "${clave}" en el nivel superior`).toContain(clave);
  }
  expect(claveProhibidaEn(resultado), `${contexto}: clave del error original en el resultado`).toBeUndefined();
  comprobarSinValoresR16(resultado, contexto, opciones.extras);
  if (opciones.bases !== undefined) {
    const encontradas = objetosConTipo(resultado, NOMBRE_DE_PRISMA_R16);
    expect(encontradas, `${contexto}: objetos con tipo ${NOMBRE_DE_PRISMA_R16}`).toHaveLength(opciones.bases);
    for (const encontrada of encontradas) expect(encontrada['codigoPrisma'], `${contexto}: codigoPrisma`).toBe('P2007');
  }
  return objeto;
}

/** La falla cerrada: exactamente `{ tipo, truncado: true }` y nada mas. */
export function comprobarSoloTruncado(resultado: unknown, entrada: unknown, tipo: string, contexto: string): void {
  const objeto = comprobarNoEsElMismo(resultado, entrada, contexto);
  expect(Object.keys(objeto).sort(), `${contexto}: claves`).toEqual(['tipo', 'truncado']);
  expect(objeto['tipo'], `${contexto}: tipo`).toBe(tipo);
  expect(objeto['truncado'], `${contexto}: truncado`).toBe(true);
}

/** `limpia` es la forma limpia de `base16`: tipo, codigoPrisma y los dos marcos de la pila. */
export function esLaFormaLimpiaDeBase16(limpia: unknown, contexto: string): void {
  expect(typeof limpia, `${contexto}: debia ser un objeto`).toBe('object');
  expect(limpia, `${contexto}: no debia ser null`).not.toBeNull();
  const objeto = limpia as Record<string, unknown>;
  expect(objeto['tipo'], `${contexto}: tipo`).toBe(NOMBRE_DE_PRISMA_R16);
  expect(objeto['codigoPrisma'], `${contexto}: codigoPrisma`).toBe('P2007');
  expect(typeof objeto['pila'], `${contexto}: pila`).toBe('string');
}

/** El `Error` interior de (t1): un error de almacenamiento que guarda el comprobante (5 MB) en una propiedad. */
export function crearInteriorT1(): Error {
  return Object.assign(new Error('No se pudo subir el comprobante'), {
    archivo: Buffer.alloc(CINCO_MB, `${CONTENIDO_DEL_COMPROBANTE} DNI ${DNI_R16} `),
  });
}

/** (t3): un `Error` con un arreglo denso de 2 millones de elementos. */
export function crearErrorT3(): Error {
  return Object.assign(new Error('lista r16'), { lista: new Array<number>(2_000_000).fill(0) });
}

/** Un `Error` con una propiedad cualquiera. */
export function conPropiedad(mensaje: string, nombre: string, valor: unknown): Error {
  return Object.assign(new Error(mensaje), { [nombre]: valor });
}

/** Una funcion espia: cuenta sus llamadas y devuelve lo indicado. */
export function crearEspia(devuelve: () => unknown): { funcion: () => unknown; llamadas: () => number } {
  let cuenta = 0;
  return {
    funcion: () => {
      cuenta += 1;
      return devuelve();
    },
    llamadas: () => cuenta,
  };
}

/** Un registro `pino` con destino en memoria (nivel `error`). */
export function crearRegistroEnMemoria(): { registro: pino.Logger; lineas: string[] } {
  const lineas: string[] = [];
  const registro = pino(
    { level: 'error' },
    {
      write: (linea: string) => {
        lineas.push(linea);
      },
    },
  );
  return { registro, lineas };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Errores del criterio 168: `cause` y `errors` por su nombre.
// ---------------------------------------------------------------------------------------------------------------------------------

const origenes = new WeakMap<object, unknown>();

/**
 * (g1) `class ErrorDeServicio extends Error`: asigna `this.name`, guarda el origen aparte (un `WeakMap` hace el papel del campo privado) y
 * define `cause` como getter en su prototipo (no enumerable). Sin `cause` propia: `Reflect.ownKeys` no la lista.
 */
export class ErrorDeServicio extends Error {
  constructor(mensaje: string, origen: unknown) {
    super(mensaje);
    this.name = 'ErrorDeServicio';
    origenes.set(this, origen);
  }
}
Object.defineProperty(ErrorDeServicio.prototype, 'cause', {
  get(this: object): unknown {
    return origenes.get(this);
  },
  enumerable: false,
  configurable: true,
});

const listas = new WeakMap<object, unknown[]>();

/** (g2) lo mismo con un getter `errors` en el prototipo. */
export class ErrorConListaHeredada extends Error {
  constructor(mensaje: string, lista: unknown[]) {
    super(mensaje);
    this.name = 'ErrorConListaHeredada';
    listas.set(this, lista);
  }
}
Object.defineProperty(ErrorConListaHeredada.prototype, 'errors', {
  get(this: object): unknown {
    return listas.get(this);
  },
  enumerable: false,
  configurable: true,
});

/** (g4) un metodo `cause` en el prototipo (estilo VError); cuenta sus llamadas y devuelve lo que se le pida. */
export function crearErrorConMetodoCause(
  mensaje: string,
  devuelve: () => unknown,
): { error: Error; llamadas: () => number } {
  let cuenta = 0;
  class ErrorConMetodoCause extends Error {
    constructor(texto: string) {
      super(texto);
      this.name = 'ErrorConMetodoCause';
    }
  }
  Object.defineProperty(ErrorConMetodoCause.prototype, 'cause', {
    value: function causa(): unknown {
      cuenta += 1;
      return devuelve();
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return { error: new ErrorConMetodoCause(mensaje), llamadas: () => cuenta };
}

/** (g3) `Object.assign(new Error(mensaje), { cause: espia })`, con la funcion que devuelve `base16`. */
export function crearG3(base: Error): { error: Error; llamadas: () => number } {
  const espia = crearEspia(() => base);
  return {
    error: Object.assign(new Error('No se pudo guardar'), { cause: espia.funcion }),
    llamadas: espia.llamadas,
  };
}

/** (g1) con su comprobacion previa de que el ataque se reproduce: `cause` no es propia, devuelve `base`, y pino escribe el valor. */
export function crearG1(base: Error): ErrorDeServicio {
  const error = new ErrorDeServicio('No se pudo guardar', base);
  expect(Reflect.ownKeys(error), 'precondicion: cause no es una clave propia').not.toContain('cause');
  expect(error.cause === base, 'precondicion: error.cause es base').toBe(true);
  expect(escribirConPino(error), 'precondicion: pino con el error original escribe el valor').toContain(DNI_R16);
  return error;
}

/** (g3) con su comprobacion previa (el conteo de llamadas se reinicia creando otro con el mismo cuerpo). */
export function crearG3ConPrecondicion(base: Error): { error: Error; llamadas: () => number } {
  const previo = crearG3(base);
  expect(escribirConPino(previo.error), 'precondicion: pino con el error original escribe el valor').toContain(DNI_R16);
  expect(previo.llamadas(), 'precondicion: pino llama a la funcion cause').toBeGreaterThan(0);
  return crearG3(base);
}
