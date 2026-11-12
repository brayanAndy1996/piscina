import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '../../generated/prisma/client';
import { ErrorTransaccionAbortada } from './errores';
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
 * nunca sale de aquí. La consulta pasa por una cola serial por transacción (criterio 153): se entrega a Prisma (se llama a `then`)
 * cuando se asentó la anterior y, con la cola vacía, durante la llamada, sin esperar a quien llama; corre en la conexión y en la
 * transacción de `trabajo`. Cuando `trabajo` lanza, `terminar()` apaga el envoltorio; si termina bien, `asentar()` lo apaga al final (156): una función
 * guardada y llamada después rechaza sin tocar la base. Una operación que vuelve con `undefined` rechaza y marca la transacción (154).
 *
 Criterio 134 (P-32): un servicio de Nest es una sola instancia para todas las peticiones, y guardar `tx` en un campo
 * (`this.tx = tx`) dejaría que otra petición use la transacción de otra academia mientras sigue abierta. Por eso cada
 * transacción corre su `trabajo` dentro de un contexto asíncrono propio (`AsyncLocalStorage.run` con una marca única) y cada
 * función del envoltorio comprueba, al llamarse y antes de enviar nada, que el contexto actual es el de su transacción. Lo que
 * `trabajo` inicia (`Promise.all`, funciones `async`, temporizadores, eventos) hereda el contexto; una llamada desde otra
 * petición, otra transacción (también una anidada) o fuera de toda transacción rechaza con un `Error`.
 */

/** Almacén privado del módulo: la marca de la transacción cuyo `trabajo` está corriendo. */
const almacen = new AsyncLocalStorage<object>();

/** Operaciones de los modelos que se exponen. */
export const OPERACIONES = [
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
  /** Apaga el envoltorio en el acto (camino del error): toda llamada posterior rechaza sin enviar nada a la base. */
  readonly terminar: () => void;
  /** Ejecuta `fn` en el contexto asíncrono de esta transacción: solo desde ahí responde el envoltorio (criterio 134). */
  readonly ejecutar: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * Espera a que se asienten (se resuelvan o rechacen) todas las consultas que `trabajo` envió por el envoltorio, también las que
   * lanzó sin `await` (criterios 149 y 156). El envoltorio sigue aceptando las llamadas de su contexto mientras espera: cede un turno
   * (`setImmediate`), vuelve a mirar y solo se apaga cuando la cola sigue vacía. Desde que se llama, una llamada rechazada (envoltorio
   * apagado u otro contexto) marca la transacción y `exigirCompleta()` lo detecta. Nunca rechaza.
   */
  readonly asentar: () => Promise<void>;
  /**
   * Criterio 153 (P-38): `trabajo` lanzó. Las consultas que seguían en la cola rechazan sin entregarse a Prisma. Se llama junto
   * con `terminar()`, en el camino del error.
   */
  readonly descartar: () => void;
  /**
   * Criterio 154 (P-38): lanza `ErrorTransaccionAbortada` (`motivo: 'incompleta'`) si alguna operación volvió con `undefined`,
   * aunque `trabajo` haya atrapado el rechazo, o si una llamada llegó tarde (criterio 156; solo el nombre de la operación). Se llama
   * después de `asentar()`, antes y después de comprobar la marca y antes del `COMMIT`.
   */
  readonly exigirCompleta: () => void;
}

export function envolver(tx: Prisma.TransactionClient): EnvoltorioDeTransaccion {
  let activa = true;
  const marca: object = Object.freeze({});
  // Nombre de la primera operación que volvió con `undefined` (criterio 154) o que llegó tarde (criterio 156). Solo el nombre: nunca argumentos ni parámetros.
  let incompleta: string | null = null;
  // Desde que se llama a `asentar()` (criterio 156): una llamada rechazada (envoltorio apagado u otro contexto) marca la transacción.
  let cerrando = false;
  const marcarTardia = (operacion: string): void => {
    if (cerrando) incompleta ??= `${operacion} (llegó después de que el envoltorio se apagó)`;
  };
  const exigirActiva = (operacion: string): void => {
    if (!activa) {
      marcarTardia(operacion);
      throw new Error('La transacción ya terminó.');
    }
    if (almacen.getStore() !== marca) {
      marcarTardia(operacion);
      throw new Error(
        'Esta transacción pertenece a otra operación: úsala solo dentro de su trabajo y pásala como parámetro, no la guardes.',
      );
    }
  };
  // Las consultas encoladas o enviadas y todavía sin asentar. Se guarda una promesa derivada, nunca la que recibe `trabajo` (106).
  const pendientes = new Set<Promise<void>>();
  // Asentamiento de la última consulta encolada (criterio 153): la siguiente se entrega cuando este se cumple.
  let ultima: Promise<void> | null = null;
  let descartada = false;
  /**
   * Cola serial por transacción (criterio 153): Prisma agrupa en un lote las consultas que salen en el mismo turno y, ante el
   * primer error que no es de la base, deja sin ejecutar las siguientes (sus promesas resuelven con `undefined`). Por eso cada
   * consulta se entrega a Prisma (se llama a `crear().then`) solo cuando se asentó la anterior; con la cola vacía, durante la
   * llamada (criterio 106). Cada promesa recibe su propio resultado o error y un rechazo no detiene la cola.
   */
  const enviarSeguida = <T>(crear: () => PromiseLike<T>, operacion: string): Promise<T> => {
    const anterior = ultima;
    const promesa = new Promise<T>((resolver, rechazar) => {
      const entregar = (): void => {
        if (descartada) {
          rechazar(new Error('La transacción ya terminó.'));
          return;
        }
        try {
          crear().then((valor) => {
            // Criterio 154: ninguna operación expuesta devuelve `undefined` en Prisma 7; si lo hace, la consulta no se ejecutó.
            if (valor === undefined) {
              incompleta ??= operacion;
              rechazar(
                new ErrorTransaccionAbortada({
                  motivo: 'incompleta',
                  cause: new Error(`Operación sin resultado: ${operacion}`),
                }),
              );
              return;
            }
            resolver(valor);
          }, rechazar);
        } catch (error) {
          rechazar(error instanceof Error ? error : new Error(String(error)));
        }
      };
      if (anterior === null) entregar();
      else void anterior.then(entregar);
    });
    const asentada: Promise<void> = promesa.then(nada, nada).then(() => {
      pendientes.delete(asentada);
      if (ultima === asentada) ultima = null;
    });
    pendientes.add(asentada);
    ultima = asentada;
    return promesa;
  };
  const delegados = tx as unknown as Record<string, Record<string, FuncionDeDelegado>>;

  const crudo =
    (metodo: MetodoCrudo) =>
    (...argumentos: unknown[]): Promise<unknown> =>
      siempreUnaPromesa(() => {
        exigirActiva(metodo);
        const [primero, ...valores] = argumentos;
        // Forma de etiqueta: los fragmentos del punto autorizado se cambian por su Sql; los demás valores van como parámetros.
        if (sonPartesDePlantilla(primero, valores.length)) {
          const convertidos = valores.map((valor) => aSql(valor) ?? valor);
          return enviarSeguida(() => tx[metodo](primero, ...convertidos), metodo);
        }
        // Forma de llamada: exactamente un fragmento o un Sql de Prisma.
        if (argumentos.length === 1) {
          const fragmento = aSql(primero);
          if (fragmento) return enviarSeguida(() => tx[metodo](fragmento), metodo);
          if (primero instanceof Prisma.Sql) return enviarSeguida(() => tx[metodo](primero), metodo);
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
          exigirActiva(`${nombre}.${operacion}`);
          const real = delegados[nombre];
          const funcion = real?.[operacion];
          if (typeof funcion !== 'function') throw new TypeError(`La operación ${nombre}.${operacion} no existe.`);
          return enviarSeguida(() => funcion.apply(real, argumentos) as PromiseLike<unknown>, `${nombre}.${operacion}`);
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
      // Criterio 156: el envoltorio sigue aceptando las llamadas de su contexto mientras esto no termina; las que rechaza marcan.
      cerrando = true;
      for (;;) {
        // Una consulta que termina quita su promesa del conjunto: se repite hasta que no quede ninguna.
        while (pendientes.size > 0) await Promise.allSettled([...pendientes]);
        // Deja correr las continuaciones encadenadas (microtareas): si alguna encoló una consulta, se vuelve a esperar.
        await new Promise<void>((seguir) => setImmediate(seguir));
        if (pendientes.size === 0) {
          // Mismo paso síncrono que la comprobación: no entra nada entre medio.
          activa = false;
          return;
        }
      }
    },
    descartar: () => {
      descartada = true;
    },
    exigirCompleta: () => {
      if (incompleta !== null) {
        throw new ErrorTransaccionAbortada({
          motivo: 'incompleta',
          cause: new Error(`Operación sin resultado: ${incompleta}`),
        });
      }
    },
  });
}
