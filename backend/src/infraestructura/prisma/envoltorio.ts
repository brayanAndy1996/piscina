import { AsyncLocalStorage } from 'node:async_hooks';
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
 * Cada función devuelve una `Promise` nativa (son flechas comunes, no `async`: su prototipo debe seguir siendo
 * `Function.prototype`): la `PrismaPromise` (con `requestTransaction`, que permite reubicar la consulta en otra conexión)
 * nunca sale de aquí. La consulta se envía al llamar a la función (se llama a `then`
 * en ese momento, sin esperar a quien llama) y corre en la conexión y en la transacción de `trabajo`. Cuando `trabajo` termina,
 * con éxito o con error, `terminar()` apaga el envoltorio: una función guardada y llamada después rechaza sin tocar la base.
 *
 * Criterio 134 (P-32): un servicio de Nest es una sola instancia para todas las peticiones, y guardar `tx` en un campo
 * (`this.tx = tx`) dejaría que otra petición use la transacción de otra academia mientras sigue abierta. Por eso cada
 * transacción corre su `trabajo` dentro de un contexto asíncrono propio (`AsyncLocalStorage.run` con una marca única) y cada
 * función del envoltorio comprueba, al llamarse y antes de enviar nada, que el contexto actual es el de su transacción. Lo que
 * `trabajo` inicia (`Promise.all`, funciones `async`, temporizadores, eventos) hereda el contexto; una llamada desde otra
 * petición, otra transacción (también una anidada) o fuera de toda transacción rechaza con un `Error`.
 */

/** Almacén privado del módulo: la marca de la transacción cuyo `trabajo` está corriendo. */
const almacen = new AsyncLocalStorage<object>();

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

const nada = (): void => undefined;

/**
 * Ejecuta `accion` ahora y devuelve siempre una promesa nativa: un error lanzado dentro (validación, envoltorio apagado) se
 * convierte en un rechazo. Las funciones del envoltorio son flechas comunes y no `async`: su prototipo es `Function.prototype`
 * (criterio 100) y lo que devuelven, `Promise.prototype` (criterio 106).
 */
function siempreUnaPromesa(accion: () => Promise<unknown>): Promise<unknown> {
  let promesa: Promise<unknown>;
  try {
    promesa = accion();
  } catch (error) {
    promesa = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  return sinMarcasDeContexto(promesa);
}

/**
 * Quita de la promesa las claves propias que `async_hooks` le pone al crearla mientras hay un `AsyncLocalStorage` activo
 * (`Symbol(async_id_symbol)`, `Symbol(trigger_async_id_symbol)` y `Symbol(kResourceStore)`): lo que devuelve el envoltorio es una
 * `Promise` nativa sin claves propias (criterio 106). No afecta al contexto de quien la espera: el contexto de una continuación sale
 * de la promesa que crea el `await` o el `then` de quien llama, no de esta (y Node vuelve a anotar su identificador si hace falta).
 */
function sinMarcasDeContexto<T>(promesa: Promise<T>): Promise<T> {
  for (const clave of Reflect.ownKeys(promesa)) Reflect.deleteProperty(promesa, clave);
  return promesa;
}

export interface EnvoltorioDeTransaccion {
  /** Lo que recibe `trabajo`: congelado y activo hasta que se llama a `terminar`. */
  readonly cliente: ClienteTransaccion;
  /** Apaga el envoltorio: toda llamada posterior rechaza sin enviar nada a la base. */
  readonly terminar: () => void;
  /** Ejecuta `fn` en el contexto asíncrono de esta transacción: solo desde ahí responde el envoltorio (criterio 134). */
  readonly ejecutar: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * Espera a que se asienten (se resuelvan o rechacen) todas las consultas que `trabajo` envió por el envoltorio, también las que
   * lanzó sin `await` (criterio 149). Se llama después de `terminar()`: ya no entran consultas nuevas. Nunca rechaza.
   */
  readonly asentar: () => Promise<void>;
}

export function envolver(tx: Prisma.TransactionClient): EnvoltorioDeTransaccion {
  let activa = true;
  const marca: object = Object.freeze({});
  const exigirActiva = (): void => {
    if (!activa) throw new Error('La transacción ya terminó.');
    if (almacen.getStore() !== marca) {
      throw new Error(
        'Esta transacción pertenece a otra operación: úsala solo dentro de su trabajo y pásala como parámetro, no la guardes.',
      );
    }
  };
  // Las consultas enviadas y todavía sin asentar. Se guarda una promesa derivada, nunca la que recibe `trabajo` (criterio 106).
  const pendientes = new Set<Promise<void>>();
  const enviarSeguida = <T>(consulta: PromiseLike<T>): Promise<T> => {
    const promesa = enviar(consulta);
    const asentada: Promise<void> = promesa.then(nada, nada).then(() => {
      pendientes.delete(asentada);
    });
    pendientes.add(asentada);
    return promesa;
  };
  const delegados = tx as unknown as Record<string, Record<string, FuncionDeDelegado>>;

  const crudo =
    (metodo: MetodoCrudo) =>
    (...argumentos: unknown[]): Promise<unknown> =>
      siempreUnaPromesa(() => {
        exigirActiva();
        const [primero, ...valores] = argumentos;
        // Forma de etiqueta: los fragmentos del punto autorizado se cambian por su Sql; los demás valores van como parámetros.
        if (sonPartesDePlantilla(primero, valores.length)) {
          const convertidos = valores.map((valor) => aSql(valor) ?? valor);
          return enviarSeguida(tx[metodo](primero, ...convertidos));
        }
        // Forma de llamada: exactamente un fragmento o un Sql de Prisma.
        if (argumentos.length === 1) {
          const fragmento = aSql(primero);
          if (fragmento) return enviarSeguida(tx[metodo](fragmento));
          if (primero instanceof Prisma.Sql) return enviarSeguida(tx[metodo](primero));
        }
        throw new TypeError(MENSAJE_CONSULTA_NO_VALIDA);
      });

  const envoltorio: Record<string, unknown> = {
    $queryRaw: crudo('$queryRaw'),
    $executeRaw: crudo('$executeRaw'),
  };
  for (const modelo of Object.values(Prisma.ModelName)) {
    const nombre = nombreDelDelegado(modelo);
    const delegado: Partial<Delegado> = {};
    for (const operacion of OPERACIONES) {
      delegado[operacion] = (...argumentos: unknown[]): Promise<unknown> =>
        siempreUnaPromesa(() => {
          exigirActiva();
          const real = delegados[nombre];
          const funcion = real?.[operacion];
          if (typeof funcion !== 'function') throw new TypeError(`La operación ${nombre}.${operacion} no existe.`);
          return enviarSeguida(funcion.apply(real, argumentos) as PromiseLike<unknown>);
        });
    }
    envoltorio[nombre] = Object.freeze(delegado);
  }
  return Object.freeze({
    cliente: Object.freeze(envoltorio) as unknown as ClienteTransaccion,
    terminar: () => {
      activa = false;
    },
    ejecutar: <T>(fn: () => Promise<T>): Promise<T> => almacen.run(marca, fn),
    asentar: async (): Promise<void> => {
      // Una consulta que termina quita su promesa del conjunto: se repite hasta que no quede ninguna.
      while (pendientes.size > 0) await Promise.allSettled([...pendientes]);
    },
  });
}
