import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { nombreDelDelegado, OPERACIONES } from './envoltorio';
import { ErrorTransaccionAbortada } from './errores';
import { codigoDeErrorDeBase } from './errores-base';

/**
 * Capa de puntos de guardado (spec 001, criterio 158, P-39). INTERNA a esta carpeta: va entre la transacción de Prisma y el
 * envoltorio (`envolver(capa.tx)`).
 *
 * Dentro de una transacción interactiva, Prisma no usa `SAVEPOINT` en las operaciones de varias sentencias: una escritura con
 * relaciones anidadas que falla a medio camino con un error que no es de la base (P2025, P2018, P2014) dejaba escrito lo ya
 * ejecutado, y si `trabajo` atrapaba el error se confirmaba un cambio a medias. Por eso cada escritura de un delegado corre entre
 * `SAVEPOINT` y `RELEASE`; si rechaza y la transacción sigue sana, se vuelve al punto (se deshace todo lo que esa operación
 * escribió) y rechaza con su mismo error. Si la transacción quedó abortada (error de la base) no se vuelve al punto: `ROLLBACK TO`
 * también saca a la transacción del estado abortado y el criterio 149 dejaría de ver el error atrapado.
 *
 * Las lecturas y el crudo (`$queryRaw`, `$executeRaw`) pasan tal cual: una sentencia sola es atómica. Nada se envía hasta que se
 * llama a `then` de lo que devuelve una escritura (el envoltorio lo hace al entregar, uno a la vez), y cada sentencia de la capa
 * espera a que se asiente la anterior: nunca hay dos pendientes en la transacción.
 */

const ESCRITURAS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

const PATRON_NOMBRE = /^aq_[0-9a-f]{32}$/;

type Delegado = Record<string, (...argumentos: unknown[]) => unknown>;

export interface CapaDePuntosDeGuardado {
  /** La transacción de Prisma con las escrituras de los delegados dentro de un punto de guardado. */
  readonly tx: Prisma.TransactionClient;
  /** Lanza `ErrorTransaccionAbortada` si alguna sentencia de la capa falló o dejó la transacción abortada. */
  readonly exigirSana: () => void;
}

export function conPuntosDeGuardado(tx: Prisma.TransactionClient): CapaDePuntosDeGuardado {
  // Nombre aleatorio por capa (una transacción). Se genera aquí y se valida: es un identificador, no un parámetro, y nunca sale
  // de una entrada.
  const nombre = `aq_${randomUUID().replaceAll('-', '')}`;
  if (!PATRON_NOMBRE.test(nombre)) throw new Error('Nombre de punto de guardado inválido.');
  const punto = Prisma.raw(nombre);
  // Primera causa de una falla de la capa, para `exigirSana()`.
  let fallo: unknown = null;
  const marcar = (causa: unknown): void => {
    fallo ??= causa ?? new Error('Falló una sentencia del punto de guardado.');
  };

  /** La secuencia de una escritura: crear el punto, escribir y liberarlo (o volver al punto y liberarlo si la escritura rechaza). */
  const conPunto = async (escribir: () => PromiseLike<unknown>): Promise<unknown> => {
    try {
      await tx.$executeRaw`SAVEPOINT ${punto}`;
    } catch (error) {
      // Por ejemplo, la transacción ya estaba abortada (25P02): la escritura no se entrega.
      marcar(error);
      throw error;
    }
    let valor: unknown;
    try {
      valor = await escribir();
    } catch (errorDeEscritura) {
      let abortada = false;
      try {
        await tx.$queryRaw`SELECT 1 AS sana`;
      } catch (errorDeComprobacion) {
        abortada = true;
        marcar(codigoDeErrorDeBase(errorDeComprobacion) === '25P02' ? errorDeEscritura : errorDeComprobacion);
      }
      if (!abortada) {
        try {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT ${punto}`;
          await tx.$executeRaw`RELEASE SAVEPOINT ${punto}`;
        } catch (error) {
          marcar(error);
        }
      }
      throw errorDeEscritura;
    }
    try {
      await tx.$executeRaw`RELEASE SAVEPOINT ${punto}`;
    } catch (error) {
      marcar(error);
      throw error;
    }
    return valor;
  };

  const delegados = tx as unknown as Record<string, Delegado | undefined>;
  const capa: Record<string, unknown> = {
    $queryRaw: (...argumentos: unknown[]): unknown => (tx.$queryRaw as (...a: unknown[]) => unknown)(...argumentos),
    $executeRaw: (...argumentos: unknown[]): unknown => (tx.$executeRaw as (...a: unknown[]) => unknown)(...argumentos),
  };
  for (const modelo of Object.values(Prisma.ModelName)) {
    const nombreDelModelo = nombreDelDelegado(modelo);
    const delegado: Delegado = {};
    for (const operacion of OPERACIONES) {
      // El delegado real se busca al llamar: la capa no depende de que la transacción tenga todos los modelos.
      const real = (): { funcion: (...a: unknown[]) => unknown; delegado: Delegado } => {
        const original = delegados[nombreDelModelo];
        const funcion = original?.[operacion];
        if (original === undefined || typeof funcion !== 'function') {
          throw new TypeError(`La operación ${nombreDelModelo}.${operacion} no existe.`);
        }
        return { funcion, delegado: original };
      };
      if (!ESCRITURAS.has(operacion)) {
        delegado[operacion] = (...argumentos: unknown[]): unknown => {
          const { funcion, delegado: original } = real();
          return funcion.apply(original, argumentos);
        };
        continue;
      }
      delegado[operacion] = (...argumentos: unknown[]): PromiseLike<unknown> => {
        let secuencia: Promise<unknown> | undefined;
        // Nada sale hasta que se llama a `then`; una segunda llamada reutiliza la misma secuencia (no repite la escritura).
        const iniciar = (): Promise<unknown> =>
          (secuencia ??= conPunto(() => {
            const { funcion, delegado: original } = real();
            return funcion.apply(original, argumentos) as PromiseLike<unknown>;
          }));
        return {
          then: (alResolver, alRechazar) => iniciar().then(alResolver, alRechazar),
        };
      };
    }
    capa[nombreDelModelo] = delegado;
  }

  return {
    tx: capa as unknown as Prisma.TransactionClient,
    exigirSana: (): void => {
      if (fallo !== null) throw new ErrorTransaccionAbortada({ cause: fallo });
    },
  };
}
