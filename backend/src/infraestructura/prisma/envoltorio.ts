import { Prisma } from '../../generated/prisma/client';
import { aSql, sonPartesDePlantilla } from './sql-seguro';
import type { ClienteTransaccion } from './tipos';

/**
 * Envoltorio de la transacción que reciben los módulos (spec 001, criterios 100, 106 y 112). INTERNO a esta carpeta.
 *
 * `trabajo` no recibe el cliente de Prisma de la transacción sino un objeto armado aquí que solo tiene `$queryRaw`,
 * `$executeRaw` y un delegado por cada modelo con una lista fija de operaciones. Todo son funciones flecha sobre un objeto
 * literal congelado: sin prototipo propio (`Function.prototype` y `Object.prototype`), sin claves que empiecen por `_` y sin
 * ninguna referencia que lleve de vuelta al cliente (`$parent`, `_originalClient`, `$transaction`…).
 *
 * Cada función es `async` y devuelve una `Promise` nativa: la `PrismaPromise` (con `requestTransaction`, que permite
 * reubicar la consulta en otra conexión) nunca sale de aquí. La consulta se envía al llamar a la función (se llama a `then`
 * en ese momento, sin esperar a quien llama) y corre en la conexión y en la transacción de `trabajo`. Cuando `trabajo` termina,
 * con éxito o con error, `terminar()` apaga el envoltorio: una función guardada y llamada después rechaza sin tocar la base.
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
type MetodoCrudo = '$queryRaw' | '$executeRaw';

const MENSAJE_CONSULTA_NO_VALIDA = 'Consulta no válida: usa una plantilla etiquetada o sql del punto autorizado.';

/** `Academia` -> `academia`: el nombre del delegado en el cliente de Prisma. */
const nombreDelDelegado = (modelo: string): string => `${modelo.charAt(0).toLowerCase()}${modelo.slice(1)}`;

/**
 * Dispara la consulta ahora (llama a `then` de inmediato) y devuelve una promesa nativa. La `PrismaPromise` es perezosa: sin
 * esto, la consulta saldría cuando quien llama la espere, y no se sabría en qué orden ni en qué momento.
 */
function enviar<T>(consulta: PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    consulta.then(resolver, rechazar);
  });
}

export interface EnvoltorioDeTransaccion {
  /** Lo que recibe `trabajo`: congelado y activo hasta que se llama a `terminar`. */
  readonly cliente: ClienteTransaccion;
  /** Apaga el envoltorio: toda llamada posterior rechaza sin enviar nada a la base. */
  readonly terminar: () => void;
}

export function envolver(tx: Prisma.TransactionClient): EnvoltorioDeTransaccion {
  let activa = true;
  const exigirActiva = (): void => {
    if (!activa) throw new Error('La transacción ya terminó.');
  };
  const delegados = tx as unknown as Record<string, Record<string, FuncionDeDelegado>>;

  const crudo = (metodo: MetodoCrudo) => async (...argumentos: unknown[]) => {
    exigirActiva();
    const [primero, ...valores] = argumentos;
    // Forma de etiqueta: los fragmentos del punto autorizado se cambian por su Sql; los demás valores van como parámetros.
    if (sonPartesDePlantilla(primero, valores.length)) {
      const convertidos = valores.map((valor) => aSql(valor) ?? valor);
      return enviar(tx[metodo](primero, ...convertidos));
    }
    // Forma de llamada: exactamente un fragmento o un Sql de Prisma.
    if (argumentos.length === 1) {
      const fragmento = aSql(primero);
      if (fragmento) return enviar(tx[metodo](fragmento));
      if (primero instanceof Prisma.Sql) return enviar(tx[metodo](primero));
    }
    throw new TypeError(MENSAJE_CONSULTA_NO_VALIDA);
  };

  const envoltorio: Record<string, unknown> = {
    $queryRaw: crudo('$queryRaw'),
    $executeRaw: crudo('$executeRaw'),
  };
  for (const modelo of Object.values(Prisma.ModelName)) {
    const nombre = nombreDelDelegado(modelo);
    const delegado: Partial<Delegado> = {};
    for (const operacion of OPERACIONES) {
      delegado[operacion] = async (...argumentos: unknown[]) => {
        exigirActiva();
        const real = delegados[nombre];
        const funcion = real?.[operacion];
        if (typeof funcion !== 'function') throw new TypeError(`La operación ${nombre}.${operacion} no existe.`);
        return enviar(funcion.apply(real, argumentos) as PromiseLike<unknown>);
      };
    }
    envoltorio[nombre] = Object.freeze(delegado);
  }
  return Object.freeze({
    cliente: Object.freeze(envoltorio) as unknown as ClienteTransaccion,
    terminar: () => {
      activa = false;
    },
  });
}
