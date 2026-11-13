// spec: 001-academias-aislamiento (pruebas protegidas)
import { inspect } from 'node:util';
import { expect } from 'vitest';

/**
 * Ayudas de las pruebas protegidas de la ronda 14 del ataque (criterio 163): la `pila` que se registra de un error de la base empieza
 * despues del encabezado `nombre: mensaje`. Un mensaje con una linea que empieza con espacios y `at ` pasaba como marco y el valor
 * salia en el registro.
 */

/** Datos personales de mentira que viajan dentro del mensaje: nunca deben aparecer en un registro. */
export const DNI_R14 = '44556677';
export const ALERGIA_R14 = 'penicilina-r14';
export const PROHIBIDOS_R14 = [DNI_R14, ALERGIA_R14] as const;

/** El mensaje de los errores falsos: una linea del mensaje tiene la forma de un marco de la pila. */
export const MENSAJE_CON_MARCO = `valor inválido\n    at DNI ${DNI_R14} alergia ${ALERGIA_R14}`;

export const MARCO_F = '    at f (/repo/backend/src/f.ts:1:1)';
export const MARCO_G = '    at g (/repo/backend/src/g.ts:2:2)';

export const NOMBRE_DE_PRISMA = 'PrismaClientKnownRequestError';

/** Marca para una propiedad cuyo getter lanza. */
export const LANZA = Symbol('lanza');

/** El encabezado que escribe V8 al principio de `stack`: `nombre: mensaje`, o `nombre` solo con el mensaje vacio. */
export const encabezadoDe = (nombre: string, mensaje: string): string =>
  mensaje === '' ? nombre : `${nombre}: ${mensaje}`;

type Valor = unknown;

function definir(error: Error, clave: string, valor: Valor): void {
  if (valor === LANZA) {
    Object.defineProperty(error, clave, {
      get() {
        throw new Error(`getter ${clave} DNI ${DNI_R14} alergia ${ALERGIA_R14}`);
      },
      configurable: true,
    });
  } else {
    Object.defineProperty(error, clave, { value: valor, writable: true, configurable: true, enumerable: false });
  }
}

/**
 * Un error falso con la forma de un error de Prisma (`name`, `code: 'P2007'`) y el `message`, el `stack` y el `name` que se indiquen
 * (cualquier valor, o `LANZA` para un getter que lanza). Sin `stack`, es el encabezado exacto seguido de dos marcos.
 */
export function errorFalsoDeBase(
  opciones: { message?: Valor; stack?: Valor; name?: Valor; code?: string } = {},
): Error & { code: string } {
  const message = 'message' in opciones ? opciones.message : MENSAJE_CON_MARCO;
  const name = 'name' in opciones ? opciones.name : NOMBRE_DE_PRISMA;
  const stack =
    'stack' in opciones ? opciones.stack : `${encabezadoDe(String(name), String(message))}\n${MARCO_F}\n${MARCO_G}`;
  const error = new Error() as Error & { code: string };
  definir(error, 'message', message);
  definir(error, 'name', name);
  definir(error, 'stack', stack);
  error.code = opciones.code ?? 'P2007';
  return error;
}

/** `util.inspect` a toda profundidad (tambien lo no enumerable) y `JSON.stringify`: ninguno contiene los valores. */
export function comprobarSinValores(resultado: unknown, contexto: string): void {
  const textos: [string, string][] = [
    ['inspect', inspect(resultado, { depth: null, showHidden: true })],
    ['JSON.stringify', JSON.stringify(resultado) ?? ''],
  ];
  for (const [forma, texto] of textos) {
    for (const prohibido of PROHIBIDOS_R14) {
      expect(texto, `${contexto}: ${forma} no debe contener "${prohibido}"`).not.toContain(prohibido);
    }
  }
}

/** Todos los objetos (a cualquier profundidad, tambien dentro de arreglos) cuyo `tipo` es el indicado. */
export function objetosConTipo(valor: unknown, tipo: string, vistos = new Set<unknown>()): Record<string, unknown>[] {
  if (typeof valor !== 'object' || valor === null || vistos.has(valor)) return [];
  vistos.add(valor);
  const encontrados: Record<string, unknown>[] = [];
  const registro = valor as Record<string, unknown>;
  if (registro['tipo'] === tipo) encontrados.push(registro);
  for (const hijo of Object.values(registro)) encontrados.push(...objetosConTipo(hijo, tipo, vistos));
  return encontrados;
}

/** Una linea de la pila de un error que empieza con espacios y `at ` y contiene el valor: la huella del ataque. */
export function lineaDeMarcoConValor(pila: unknown): string | undefined {
  if (typeof pila !== 'string') return undefined;
  return pila.split('\n').find((linea) => /^\s+at\s/.test(linea) && linea.includes(DNI_R14));
}
