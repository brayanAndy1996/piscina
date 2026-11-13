// spec: 001-academias-aislamiento (pruebas protegidas)
import { inspect } from 'node:util';
import pino from 'pino';
import { expect } from 'vitest';
import { errorFalsoDeBase, objetosConTipo } from './ronda14';

/**
 * Ayudas de las pruebas protegidas de la ronda 15 del ataque (criterios 165 y 166): un error de la base escondido en cualquier propiedad
 * de otro error (por ejemplo, la excepcion de Nest `new InternalServerErrorException(error)`) no llega al registro, y el `tipo` de un error
 * de la base sale de una lista cerrada.
 */

/** Datos personales de mentira que viajan dentro del mensaje del error de la base: nunca deben aparecer en un registro. */
export const DNI_R15 = '44556677';
export const ALERGIA_R15 = 'penicilina-r15';
export const SINTAXIS_R15 = 'invalid input syntax';
export const PROHIBIDOS_R15 = [DNI_R15, ALERGIA_R15, SINTAXIS_R15] as const;

/** El mensaje del error falso de la base (`base`), con la forma del que escribe PostgreSQL. */
export const MENSAJE_BASE_R15 = `invalid input syntax for type inet: "DNI ${DNI_R15} alergia ${ALERGIA_R15}"`;

export const NOMBRE_DE_PRISMA_R15 = 'PrismaClientKnownRequestError';

/**
 * `base`: un error falso con forma de error de Prisma (`name: 'PrismaClientKnownRequestError'`, `code: 'P2007'`, el mensaje de
 * `MENSAJE_BASE_R15`, `stack` con ese encabezado exacto y dos marcos, `meta` con la causa del adaptador).
 */
export function crearBase(): Error & { code: string } {
  const base = errorFalsoDeBase({ message: MENSAJE_BASE_R15 });
  Object.assign(base, {
    meta: {
      modelName: 'Auditoria',
      driverAdapterError: { cause: { originalCode: '22P02', originalMessage: MENSAJE_BASE_R15 } },
    },
  });
  return base;
}

/** Las claves que puede tener el objeto de nivel superior de un error convertido (precision de P-42, ronda 15). */
export const CLAVES_DEL_NIVEL_SUPERIOR = [
  'tipo',
  'mensaje',
  'pila',
  'causa',
  'errores',
  'erroresDeLaBase',
  'truncado',
] as const;

/** Claves de una excepcion o de un error de la base que nunca salen en el resultado, a ninguna profundidad. */
const CLAVES_PROHIBIDAS = ['message', 'stack', 'response', 'options', 'status', 'meta', 'cause', 'errors', 'detalle'];

/** Lo que escribe un `pino` con un destino en memoria y sus serializadores por defecto al registrar `{ err: valor }` en nivel `error`. */
export function escribirConPino(valor: unknown): string {
  const trozos: string[] = [];
  const registro = pino(
    { level: 'error' },
    {
      write: (linea: string) => {
        trozos.push(linea);
      },
    },
  );
  registro.error({ err: valor }, 'prueba r15');
  return trozos.join('');
}

/** `JSON.stringify` que no lanza con ciclos (un resultado que sea el error mismo con un ciclo no debe ocultar el motivo del rojo). */
export function jsonSeguro(valor: unknown): string {
  try {
    return JSON.stringify(valor) ?? '';
  } catch {
    return '[no serializable]';
  }
}

/** Ninguna de las tres formas de ver un resultado contiene los valores: `util.inspect` con `showHidden`, `JSON.stringify` y pino. */
export function comprobarSinValoresR15(resultado: unknown, contexto: string): void {
  const formas: [string, () => string][] = [
    ['inspect', () => inspect(resultado, { depth: null, showHidden: true })],
    ['JSON.stringify', () => jsonSeguro(resultado)],
    ['pino', () => escribirConPino(resultado)],
  ];
  for (const [forma, leer] of formas) {
    let texto: string;
    try {
      texto = leer();
    } catch (error) {
      expect.fail(
        `${contexto}: ${forma} lanza al serializar el resultado (no es un objeto plano y limpio): ${String(error)}`,
      );
    }
    for (const prohibido of PROHIBIDOS_R15) {
      expect(texto, `${contexto}: ${forma} no debe contener "${prohibido}"`).not.toContain(prohibido);
    }
  }
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
 * Las comprobaciones comunes de un error convertido (criterio 165): no lanza al mirarlo, no contiene los valores, no es el mismo objeto
 * que se recibio, el objeto de nivel superior solo tiene las claves permitidas, no sale ninguna propiedad del error original a ninguna
 * profundidad y, si se indica `bases`, hay exactamente ese numero de objetos de la forma limpia de `base`. Devuelve el objeto.
 */
export function comprobarConvertido(
  resultado: unknown,
  entrada: unknown,
  contexto: string,
  bases?: number,
): Record<string, unknown> {
  comprobarSinValoresR15(resultado, contexto);
  // Comparacion booleana: si fallara, vitest no intenta imprimir el error recibido (puede tener un Proxy o getters hostiles).
  expect(resultado === entrada, `${contexto}: debia ser un objeto nuevo, no el error recibido`).toBe(false);
  expect(typeof resultado, `${contexto}: debia ser un objeto`).toBe('object');
  expect(resultado, `${contexto}: no debia ser null`).not.toBeNull();
  const objeto = resultado as Record<string, unknown>;
  for (const clave of Object.keys(objeto)) {
    expect(CLAVES_DEL_NIVEL_SUPERIOR, `${contexto}: clave inesperada "${clave}" en el nivel superior`).toContain(clave);
  }
  expect(claveProhibidaEn(resultado), `${contexto}: clave del error original en el resultado`).toBeUndefined();
  if (bases !== undefined) {
    const encontradas = objetosConTipo(resultado, NOMBRE_DE_PRISMA_R15);
    expect(encontradas, `${contexto}: objetos con tipo ${NOMBRE_DE_PRISMA_R15}`).toHaveLength(bases);
    for (const encontrada of encontradas) expect(encontrada['codigoPrisma'], `${contexto}: codigoPrisma`).toBe('P2007');
  }
  return objeto;
}

/** `pila` solo con lineas de marco (cada una empieza con espacios y `at `), al menos una. */
export function soloMarcos(pila: unknown, contexto: string): void {
  expect(typeof pila, `${contexto}: pila debia ser una cadena`).toBe('string');
  const lineas = String(pila).split('\n');
  expect(lineas.length, `${contexto}: pila no debia estar vacia`).toBeGreaterThan(0);
  for (const linea of lineas) expect(linea, `${contexto}: linea de la pila`).toMatch(/^\s+at\s/);
}
