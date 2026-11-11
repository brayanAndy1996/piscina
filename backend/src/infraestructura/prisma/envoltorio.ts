import { Prisma } from '../../generated/prisma/client';
import type { ClienteTransaccion } from './tipos';

/**
 * Envoltorio de la transacción que reciben los módulos (spec 001, criterio 100). INTERNO a esta carpeta.
 *
 * `trabajo` no recibe el cliente de Prisma de la transacción sino un objeto armado aquí que solo tiene `$queryRaw`,
 * `$executeRaw` y un delegado por cada modelo con una lista fija de operaciones. Todo son funciones flecha sobre un objeto
 * literal congelado: sin prototipo propio (`Function.prototype` y `Object.prototype`), sin claves que empiecen por `_` y sin
 * ninguna referencia que lleve de vuelta al cliente (`$parent`, `_originalClient`, `$transaction`…). Las funciones solo
 * existen mientras dura la transacción: cada una llama al cliente de esa transacción, que ningún objeto expone.
 */

/** Operaciones de los modelos que se exponen. */
const OPERACIONES = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
] as const;

type FuncionDeDelegado = (...argumentos: unknown[]) => unknown;
type Delegado = Record<(typeof OPERACIONES)[number], FuncionDeDelegado>;

/** `Academia` -> `academia`: el nombre del delegado en el cliente de Prisma. */
const nombreDelDelegado = (modelo: string): string => `${modelo.charAt(0).toLowerCase()}${modelo.slice(1)}`;

export function envolver(tx: Prisma.TransactionClient): ClienteTransaccion {
  const delegados = tx as unknown as Record<string, Record<string, FuncionDeDelegado>>;
  const envoltorio: Record<string, unknown> = {
    $queryRaw: (...argumentos: Parameters<Prisma.TransactionClient['$queryRaw']>) => tx.$queryRaw(...argumentos),
    $executeRaw: (...argumentos: Parameters<Prisma.TransactionClient['$executeRaw']>) => tx.$executeRaw(...argumentos),
  };
  for (const modelo of Object.values(Prisma.ModelName)) {
    const nombre = nombreDelDelegado(modelo);
    const delegado: Partial<Delegado> = {};
    for (const operacion of OPERACIONES) {
      delegado[operacion] = (...argumentos: unknown[]) => {
        const real = delegados[nombre];
        const funcion = real?.[operacion];
        if (typeof funcion !== 'function') throw new TypeError(`La operación ${nombre}.${operacion} no existe.`);
        return funcion.apply(real, argumentos);
      };
    }
    envoltorio[nombre] = Object.freeze(delegado);
  }
  return Object.freeze(envoltorio) as unknown as ClienteTransaccion;
}
