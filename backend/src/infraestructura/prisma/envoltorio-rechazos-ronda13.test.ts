// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cargarErrorTransaccionAbortada } from '../../../test/utilidades/ronda10';
import { textoCompleto } from '../../../test/utilidades/ronda13';
import { cargarFuncionalidad, textoDelError } from '../../../test/utilidades/ronda3';

// Criterio 160 (ataque ronda 13, F1 (b); precision de P-38), prueba unitaria de `envolver(tx)` (backend/src/infraestructura/prisma/envoltorio.ts)
// con la transaccion falsa de P-38: un objeto con `$queryRaw`, `$executeRaw` y un delegado `configuracion` cuyas operaciones devuelven un objeto
// con `then` (la prueba registra cuando se llama a ese `then`, que es cuando la consulta se entrega a Prisma). Las funciones del envoltorio exigen
// el contexto de `ejecutar` (P-32): cada caso lo usa donde corresponde.
//
// Casos (i) a (vi) del criterio. Desde que se llama a `asentar()`, una operacion entregada que se asienta con un rechazo (cualquiera) marca la
// transaccion y rechaza con `ErrorTransaccionAbortada` (motivo `incompleta`) con la causa limpia, nunca con el error original:
//   (i)   con una operacion entregada y sin asentar se llama a `asentar()`; la consulta falsa rechaza con un `Error` con `code: 'P2025'` y un texto
//         centinela: la promesa rechaza con `ErrorTransaccionAbortada`, su texto completo (mensaje, `cause` y pila) no contiene el centinela y
//         `exigirCompleta()` lanza `ErrorTransaccionAbortada`;
//   (ii)  lo mismo cuando a la operacion se le encadeno un `.catch` antes de llamar a `asentar()` y la consulta rechaza despues (el `.catch` recibe
//         el `ErrorTransaccionAbortada`);
//   (iii) una operacion llamada desde la continuacion de otra, durante `asentar()`, cuya consulta rechaza: lo mismo;
//   (iv)  control: un rechazo antes de llamar a `asentar()` llega con su propio error y no marca (como en el criterio 154);
//   (v)   control: durante `asentar()`, una llamada con un argumento no admitido rechaza con `TypeError` y no marca (como en el 156);
//   (vi)  control: una operacion que resuelve durante `asentar()` resuelve con su valor y no marca.

interface ClientePrueba {
  $queryRaw(partes: TemplateStringsArray, ...valores: unknown[]): Promise<unknown>;
  $executeRaw(partes: TemplateStringsArray, ...valores: unknown[]): Promise<unknown>;
  readonly configuracion: Record<string, (argumentos?: object) => Promise<unknown>>;
}

interface EnvoltorioPrueba {
  readonly cliente: ClientePrueba;
  readonly terminar: () => void;
  readonly ejecutar: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly asentar: () => Promise<void>;
  readonly descartar: () => void;
  readonly exigirCompleta: () => void;
}

type Envolver = (tx: object) => EnvoltorioPrueba;

/** Una consulta falsa que la prueba resuelve o rechaza cuando quiere. */
interface Controlada {
  readonly nombre: string;
  resolver(valor: unknown): void;
  rechazar(error: unknown): void;
}

const nada = (): undefined => undefined;

const SENTINELA = 'SENTINELA-R13-DNI-44556677';

/** Un error con la forma del P2025 de Prisma ("el registro no existe"), con un texto centinela en el mensaje, en `meta` y en la pila. */
function errorP2025(): Error {
  const error = Object.assign(new Error(`Record to update not found. ${SENTINELA}`), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2025',
    meta: { modelName: 'Configuracion', cause: `No record was found for an update. ${SENTINELA}` },
  });
  error.stack = `PrismaClientKnownRequestError: Record to update not found. ${SENTINELA}\n    at falso (envoltorio-rechazos-ronda13.test.ts:1:1)`;
  return error;
}

async function cargarEnvolver(): Promise<Envolver> {
  const modulo = await cargarFuncionalidad<{ envolver: Envolver }>('infraestructura/prisma/envoltorio.ts', [
    'envolver',
  ]);
  return modulo.envolver;
}

/** La transaccion falsa: `entregadas` crece cada vez que Prisma recibiria una consulta (se llama a su `then`). */
function crearTransaccionFalsa(): { tx: object; entregadas: Controlada[]; nombres: () => string[] } {
  const entregadas: Controlada[] = [];
  const fabricar = (nombre: string) => () => {
    let resolver: (valor: unknown) => void = nada;
    let rechazar: (error: unknown) => void = nada;
    const promesa = new Promise<unknown>((alResolver, alRechazar) => {
      resolver = alResolver;
      rechazar = alRechazar;
    });
    promesa.catch(nada);
    const controlada: Controlada = { nombre, resolver, rechazar };
    return {
      then: (alResolver?: (valor: unknown) => unknown, alRechazar?: (error: unknown) => unknown) => {
        entregadas.push(controlada);
        return promesa.then(alResolver, alRechazar);
      },
    };
  };
  const tx = {
    $queryRaw: fabricar('$queryRaw'),
    $executeRaw: fabricar('$executeRaw'),
    configuracion: {
      update: fabricar('configuracion.update'),
      create: fabricar('configuracion.create'),
      findMany: fabricar('configuracion.findMany'),
    },
  };
  return { tx, entregadas, nombres: () => entregadas.map((c) => c.nombre) };
}

interface Caso {
  readonly env: EnvoltorioPrueba;
  readonly cliente: ClientePrueba;
  readonly entregadas: Controlada[];
  readonly nombres: () => string[];
}

/** Crea el envoltorio sobre una transaccion falsa. La prueba decide cuando entrar a `ejecutar`. */
async function crearCaso(): Promise<Caso> {
  const envolver = await cargarEnvolver();
  const { tx, entregadas, nombres } = crearTransaccionFalsa();
  const env = envolver(tx);
  return { env, cliente: env.cliente, entregadas, nombres };
}

/** Exige que `envolver(tx)` devuelva la funcion indicada; si falta, falla con "falta la funcionalidad". */
function exigirFuncion(env: EnvoltorioPrueba, nombre: 'descartar' | 'exigirCompleta' | 'asentar'): () => unknown {
  const funcion = (env as unknown as Record<string, unknown>)[nombre];
  if (typeof funcion !== 'function') {
    throw new Error(`Falta la funcionalidad de la 001: envolver(tx) no devuelve ${nombre} (P-38).`);
  }
  return funcion as () => unknown;
}

/** Deja correr las continuaciones pendientes (microtareas y un turno del bucle de eventos). */
const vaciar = (): Promise<void> => new Promise((resolver) => setTimeout(resolver, 5));

/** Llama a `fn` y devuelve su promesa; si lanza sincronamente, devuelve una promesa rechazada. */
function llamar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return fn();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

const actualizar = (cliente: ClientePrueba): Promise<unknown> =>
  (cliente.configuracion['update'] as (argumentos: object) => Promise<unknown>)({
    where: { clave: 'x' },
    data: { valor: 'datos-del-argumento' },
  });

interface Destino {
  readonly valor?: unknown;
  readonly error?: unknown;
  readonly asentada: boolean;
  readonly resolvio: boolean;
}

/** Sigue una promesa: dice si se asento y con que (sin dejar rechazos sin atrapar). */
function seguir(promesa: Promise<unknown>): () => Destino {
  let estado: Destino = { asentada: false, resolvio: false };
  promesa.then(
    (valor) => {
      estado = { asentada: true, resolvio: true, valor };
    },
    (error: unknown) => {
      estado = { asentada: true, resolvio: false, error };
    },
  );
  return () => estado;
}

/** Comprueba que el error es un `ErrorTransaccionAbortada` de motivo `incompleta`, con la operacion nombrada y sin el centinela. */
async function comprobarRechazoLimpio(error: unknown, operacion: string, contexto: string): Promise<void> {
  const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
  expect(error, `${contexto}: debia ser ErrorTransaccionAbortada y no el error original`).toBeInstanceOf(
    ErrorTransaccionAbortada,
  );
  expect((error as { motivo?: unknown }).motivo, `${contexto}: motivo`).toBe('incompleta');
  expect(textoCompleto(error), `${contexto}: texto completo sin el centinela`).not.toContain(SENTINELA);
  expect(textoCompleto(error), `${contexto}: texto completo sin el valor del argumento`).not.toContain(
    'datos-del-argumento',
  );
  expect(textoDelError(error), `${contexto}: nombra la operacion`).toContain(operacion);
}

/** `exigirCompleta()` lanza `ErrorTransaccionAbortada` (motivo `incompleta`) sin el centinela. */
async function comprobarMarca(env: EnvoltorioPrueba, contexto: string): Promise<void> {
  const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
  const exigir = exigirFuncion(env, 'exigirCompleta');
  expect(exigir, `${contexto}: exigirCompleta() debia lanzar`).toThrow(ErrorTransaccionAbortada);
  let lanzado: unknown;
  try {
    exigir();
  } catch (error) {
    lanzado = error;
  }
  expect((lanzado as { motivo?: unknown }).motivo, `${contexto}: motivo de exigirCompleta()`).toBe('incompleta');
  expect(textoCompleto(lanzado), `${contexto}: exigirCompleta() sin el centinela`).not.toContain(SENTINELA);
}

/** Lo que rechaza una consulta falsa durante `asentar()` (criterio 160: cualquiera marca). */
const RECHAZOS: readonly { readonly nombre: string; readonly crear: () => unknown }[] = [
  { nombre: 'un P2025 de Prisma', crear: errorP2025 },
  {
    nombre: 'un error de la base (23505)',
    crear: () => Object.assign(new Error(`duplicate key ${SENTINELA}`), { code: '23505' }),
  },
  { nombre: 'un Error cualquiera', crear: () => new Error(`falla cualquiera ${SENTINELA}`) },
  { nombre: 'undefined', crear: () => undefined },
];

describe('criterio 160: desde asentar(), el rechazo de una operacion entregada marca la transaccion (P-38, transaccion falsa)', () => {
  describe('(i) una operacion entregada y sin asentar; se llama a asentar() y la consulta rechaza', () => {
    for (const { nombre, crear } of RECHAZOS) {
      it(`criterio 160 (i): la consulta falsa rechaza con ${nombre}: la promesa rechaza con ErrorTransaccionAbortada (no con el error original) y exigirCompleta() lanza`, async () => {
        const { env, cliente, nombres, entregadas } = await crearCaso();

        await env.ejecutar(async () => {
          const operacion = seguir(llamar(() => actualizar(cliente)));
          await vaciar();
          expect(nombres(), 'la operacion se entrego antes de asentar()').toEqual(['configuracion.update']);
          const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));
          await vaciar();
          expect(fin().asentada, 'asentar() espera la operacion entregada').toBe(false);

          entregadas[0]?.rechazar(crear());
          await vaciar();

          expect(operacion(), nombre).toMatchObject({ asentada: true, resolvio: false });
          await comprobarRechazoLimpio(operacion().error, 'configuracion.update', `(i), ${nombre}`);
          await comprobarMarca(env, `(i), ${nombre}`);
          expect(fin(), 'asentar() nunca rechaza').toMatchObject({ asentada: true, resolvio: true });
        });
      });
    }

    it('criterio 160 (i): con una consulta cruda ($queryRaw) tambien rechaza con ErrorTransaccionAbortada que nombra la operacion', async () => {
      const { env, cliente, entregadas } = await crearCaso();

      await env.ejecutar(async () => {
        const operacion = seguir(llamar(() => cliente.$queryRaw`SELECT ${SENTINELA}::text`));
        await vaciar();
        void exigirFuncion(env, 'asentar')();

        entregadas[0]?.rechazar(errorP2025());
        await vaciar();

        expect(operacion()).toMatchObject({ asentada: true, resolvio: false });
        await comprobarRechazoLimpio(operacion().error, '$queryRaw', '(i), $queryRaw');
        await comprobarMarca(env, '(i), $queryRaw');
      });
    });
  });

  describe('(ii) a la operacion se le encadeno un .catch antes de asentar() y la consulta rechaza despues', () => {
    it('criterio 160 (ii): el .catch recibe el ErrorTransaccionAbortada, no el error original, y exigirCompleta() lanza', async () => {
      const { env, cliente, entregadas } = await crearCaso();

      await env.ejecutar(async () => {
        const recibidos: unknown[] = [];
        const atrapada = seguir(
          actualizar(cliente).catch((error: unknown) => {
            recibidos.push(error);
            return 'atrapado';
          }),
        );
        await vaciar();
        const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));

        entregadas[0]?.rechazar(errorP2025());
        await vaciar();

        expect(recibidos, 'el .catch corrio una vez').toHaveLength(1);
        await comprobarRechazoLimpio(recibidos[0], 'configuracion.update', '(ii) .catch');
        expect(atrapada(), 'quien atrapa recibe lo que devuelve su .catch').toMatchObject({
          asentada: true,
          resolvio: true,
          valor: 'atrapado',
        });
        await comprobarMarca(env, '(ii) .catch');
        expect(fin()).toMatchObject({ asentada: true, resolvio: true });
      });
    });

    it('criterio 160 (ii): con .then(ok, err) encadenado, el manejador de rechazo recibe el ErrorTransaccionAbortada y exigirCompleta() lanza', async () => {
      const { env, cliente, entregadas } = await crearCaso();

      await env.ejecutar(async () => {
        const recibidos: unknown[] = [];
        actualizar(cliente).then(
          () => 'ok',
          (error: unknown) => {
            recibidos.push(error);
            return 'atrapado';
          },
        );
        await vaciar();
        void exigirFuncion(env, 'asentar')();

        entregadas[0]?.rechazar(errorP2025());
        await vaciar();

        expect(recibidos).toHaveLength(1);
        await comprobarRechazoLimpio(recibidos[0], 'configuracion.update', '(ii) then(ok, err)');
        await comprobarMarca(env, '(ii) then(ok, err)');
      });
    });
  });

  describe('(iii) una operacion llamada desde la continuacion de otra, durante asentar(), cuya consulta rechaza', () => {
    it('criterio 160 (iii): la segunda rechaza con ErrorTransaccionAbortada y exigirCompleta() lanza', async () => {
      const { env, cliente, nombres, entregadas } = await crearCaso();

      await env.ejecutar(async () => {
        const primera = cliente.$queryRaw`SELECT 1 AS uno`;
        const segunda = seguir(primera.then(() => actualizar(cliente)));
        const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));

        entregadas[0]?.resolver([{ uno: 1 }]);
        await vaciar();
        expect(nombres(), 'la segunda se acepto y se entrego durante asentar()').toEqual([
          '$queryRaw',
          'configuracion.update',
        ]);
        expect(fin().asentada, 'asentar() espera la segunda').toBe(false);

        entregadas[1]?.rechazar(errorP2025());
        await vaciar();

        expect(segunda()).toMatchObject({ asentada: true, resolvio: false });
        await comprobarRechazoLimpio(segunda().error, 'configuracion.update', '(iii)');
        await comprobarMarca(env, '(iii)');
        expect(fin(), 'asentar() nunca rechaza').toMatchObject({ asentada: true, resolvio: true });
      });
    });

    it('criterio 160 (iii): con un .catch en la continuacion, el .catch recibe el ErrorTransaccionAbortada y exigirCompleta() lanza', async () => {
      const { env, cliente, entregadas } = await crearCaso();

      await env.ejecutar(async () => {
        const recibidos: unknown[] = [];
        cliente.$queryRaw`SELECT 1 AS uno`
          .then(() => actualizar(cliente))
          .catch((error: unknown) => {
            recibidos.push(error);
          });
        void exigirFuncion(env, 'asentar')();

        entregadas[0]?.resolver([{ uno: 1 }]);
        await vaciar();
        entregadas[1]?.rechazar(errorP2025());
        await vaciar();

        expect(recibidos).toHaveLength(1);
        await comprobarRechazoLimpio(recibidos[0], 'configuracion.update', '(iii) .catch');
        await comprobarMarca(env, '(iii) .catch');
      });
    });
  });

  describe('(iv) control: un rechazo antes de llamar a asentar() llega con su propio error y no marca', () => {
    it('criterio 160 (iv): la promesa rechaza con el error original, exigirCompleta() no lanza ni antes ni despues de asentar()', async () => {
      const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
      const { env, cliente, entregadas } = await crearCaso();

      await env.ejecutar(async () => {
        const original = errorP2025();
        const operacion = seguir(llamar(() => actualizar(cliente)));
        await vaciar();

        entregadas[0]?.rechazar(original);
        await vaciar();

        expect(operacion(), 'rechaza con su propio error').toMatchObject({
          asentada: true,
          resolvio: false,
          error: original,
        });
        expect(operacion().error).not.toBeInstanceOf(ErrorTransaccionAbortada);
        expect(exigirFuncion(env, 'exigirCompleta'), 'antes de asentar()').not.toThrow();

        await exigirFuncion(env, 'asentar')();
        expect(
          exigirFuncion(env, 'exigirCompleta'),
          'despues de asentar(): lo que se asento antes no marca',
        ).not.toThrow();
      });
    });

    it('criterio 160 (iv): un rechazo que trabajo atrapa con .catch y espera, antes de asentar(), tampoco marca', async () => {
      const { env, cliente, entregadas } = await crearCaso();

      await env.ejecutar(async () => {
        const atrapada = seguir(actualizar(cliente).catch(() => 'atrapado'));
        await vaciar();
        entregadas[0]?.rechazar(errorP2025());
        await vaciar();
        expect(atrapada()).toMatchObject({ asentada: true, resolvio: true, valor: 'atrapado' });

        await exigirFuncion(env, 'asentar')();
        expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
      });
    });
  });

  describe('(v) control: una llamada con un argumento no admitido durante asentar() rechaza con TypeError y no marca', () => {
    it('criterio 160 (v): rechaza con TypeError, no se entrega y exigirCompleta() no lanza', async () => {
      const { env, cliente, nombres, entregadas } = await crearCaso();

      await env.ejecutar(async () => {
        cliente.$queryRaw`SELECT 1 AS uno`.catch(nada);
        const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));
        const mala = seguir(
          llamar(() => (cliente.$queryRaw as unknown as (sql: string) => Promise<unknown>)('SELECT 1')),
        );
        await vaciar();

        expect(mala()).toMatchObject({ asentada: true, resolvio: false });
        expect(mala().error, 'el argumento no admitido rechaza con TypeError').toBeInstanceOf(TypeError);
        expect(nombres()).toEqual(['$queryRaw']);
        expect(exigirFuncion(env, 'exigirCompleta'), 'un argumento no admitido no marca').not.toThrow();

        entregadas[0]?.resolver([{ uno: 1 }]);
        await vaciar();
        expect(fin()).toMatchObject({ asentada: true, resolvio: true });
        expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
      });
    });
  });

  describe('(vi) control: una operacion que resuelve durante asentar() resuelve con su valor y no marca', () => {
    it.each([
      ['un objeto', { clave: 'x' }],
      ['null', null],
      ['0', 0],
    ])(
      'criterio 160 (vi): resolver con %s: la promesa resuelve con ese valor y exigirCompleta() no lanza',
      async (_nombre, valor) => {
        const { env, cliente, entregadas } = await crearCaso();

        await env.ejecutar(async () => {
          const operacion = seguir(llamar(() => actualizar(cliente)));
          await vaciar();
          const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));

          entregadas[0]?.resolver(valor);
          await vaciar();

          expect(operacion()).toMatchObject({ asentada: true, resolvio: true, valor });
          expect(fin()).toMatchObject({ asentada: true, resolvio: true });
          expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
        });
      },
    );

    it('criterio 160 (vi): una cadena que solo espera consultas del envoltorio y no falla queda toda sin marca', async () => {
      const { env, cliente, nombres, entregadas } = await crearCaso();

      await env.ejecutar(async () => {
        const cadena = seguir(
          cliente.$queryRaw`SELECT 1 AS uno`
            .then(() => cliente.$executeRaw`UPDATE configuraciones SET valor = '{}'::jsonb`)
            .then(() => 'fin-de-la-cadena'),
        );
        const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));

        entregadas[0]?.resolver([{ uno: 1 }]);
        await vaciar();
        entregadas[1]?.resolver(1);
        await vaciar();

        expect(nombres()).toEqual(['$queryRaw', '$executeRaw']);
        expect(cadena()).toMatchObject({ asentada: true, resolvio: true, valor: 'fin-de-la-cadena' });
        expect(fin()).toMatchObject({ asentada: true, resolvio: true });
        expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
      });
    });
  });

  it('criterio 160: el camino del error no cambia: tras descartar() y terminar(), una operacion entregada que rechaza no marca la transaccion', async () => {
    const { env, cliente, entregadas } = await crearCaso();

    await env.ejecutar(async () => {
      const operacion = seguir(llamar(() => actualizar(cliente)));
      await vaciar();
      exigirFuncion(env, 'descartar')();
      env.terminar();

      entregadas[0]?.rechazar(errorP2025());
      await vaciar();

      expect(operacion()).toMatchObject({ asentada: true, resolvio: false });
      expect(exigirFuncion(env, 'exigirCompleta'), 'sin asentar(), el rechazo no marca').not.toThrow();
    });
  });
});
