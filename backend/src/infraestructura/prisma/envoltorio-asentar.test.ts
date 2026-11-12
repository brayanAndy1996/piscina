// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cargarErrorTransaccionAbortada } from '../../../test/utilidades/ronda10';
import { cargarFuncionalidad, textoDelError } from '../../../test/utilidades/ronda3';

// Criterio 156 (ataque ronda 12, F1; precision de P-38), prueba unitaria de `envolver(tx)` (backend/src/infraestructura/prisma/envoltorio.ts) con
// la transaccion falsa de P-38: un objeto con `$queryRaw`, `$executeRaw` y un delegado `configuracion` cuyas operaciones devuelven un objeto con
// `then`. La prueba registra cuando se llama a ese `then`, que es cuando la consulta se entrega a Prisma. Las funciones del envoltorio exigen el
// contexto de `ejecutar` (P-32): cada caso lo usa donde corresponde.
//
// Casos (i) a (vi) del criterio:
//   (i)   con una consulta entregada y sin asentar se llama a `asentar()`; desde la continuacion de esa consulta se llama a otra: se acepta, se
//         entrega cuando la primera se asienta y `asentar()` no termina hasta que se asienta la segunda;
//   (ii)  una llamada hecha dentro de un `then` encadenado a una promesa ya resuelta, con la cola vacia, tambien se acepta antes de que `asentar()`
//         termine;
//   (iii) despues de que `asentar()` termino, una llamada desde el contexto de `ejecutar` y otra desde fuera rechazan sin entregarse y
//         `exigirCompleta()` lanza `ErrorTransaccionAbortada`;
//   (iv)  con `asentar()` en curso, una llamada desde fuera de `ejecutar` rechaza sin entregarse y `exigirCompleta()` lanza;
//   (v)   antes de llamar a `asentar()`, una llamada desde fuera de `ejecutar` rechaza y `exigirCompleta()` no lanza (criterio 134 sin cambios);
//   (vi)  tras `descartar()` y `terminar()`, una llamada rechaza sin entregarse (como hoy).
// Ademas: varias consultas encadenadas una tras otra, una llamada rechazada por un argumento no admitido mientras `asentar()` corre no marca la
// transaccion, `asentar()` nunca rechaza y el error de `exigirCompleta()` nombra la operacion tardia y nunca sus argumentos ni parametros.

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

describe('criterio 156: el envoltorio acepta las consultas encadenadas hasta que asentar() termina (P-38, transaccion falsa)', () => {
  it('criterio 156 (i): con una consulta entregada y sin asentar, la llamada hecha desde su continuacion se acepta, se entrega cuando la primera se asienta y asentar() no termina hasta que se asienta la segunda', async () => {
    const { env, cliente, nombres, entregadas } = await crearCaso();

    await env.ejecutar(async () => {
      const primera = cliente.$queryRaw`SELECT 1 AS uno`;
      primera.then(() => cliente.$executeRaw`UPDATE configuraciones SET valor = '{}'::jsonb`).catch(nada);
      const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));
      expect(nombres(), 'solo la primera, durante la llamada').toEqual(['$queryRaw']);

      entregadas[0]?.resolver([{ uno: 1 }]);
      await vaciar();

      expect(nombres(), 'la llamada de la continuacion se acepto y se entrego al asentarse la primera').toEqual([
        '$queryRaw',
        '$executeRaw',
      ]);
      expect(fin().asentada, 'asentar() sigue esperando la consulta encadenada').toBe(false);

      entregadas[1]?.resolver(1);
      await vaciar();
      expect(fin()).toMatchObject({ asentada: true, resolvio: true });
      expect(exigirFuncion(env, 'exigirCompleta'), 'nada llego tarde').not.toThrow();
    });
  });

  it('criterio 156 (i, cadena larga): tres consultas encadenadas una tras otra: asentar() termina solo despues de la tercera', async () => {
    const { env, cliente, nombres, entregadas } = await crearCaso();

    await env.ejecutar(async () => {
      void cliente.$queryRaw`SELECT 1 AS uno`
        .then(() => cliente.$queryRaw`SELECT 2 AS dos`)
        .then(() => cliente.$executeRaw`UPDATE configuraciones SET valor = '{}'::jsonb`)
        .catch(nada);
      const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));

      for (const [indice, esperadas] of [
        [0, ['$queryRaw', '$queryRaw']],
        [1, ['$queryRaw', '$queryRaw', '$executeRaw']],
      ] as const) {
        entregadas[indice]?.resolver([{ r: indice }]);
        await vaciar();
        expect(nombres(), `tras asentarse la consulta ${indice + 1}`).toEqual([...esperadas]);
        expect(fin().asentada, `asentar() sigue esperando tras la consulta ${indice + 1}`).toBe(false);
      }

      entregadas[2]?.resolver(1);
      await vaciar();
      expect(fin()).toMatchObject({ asentada: true, resolvio: true });
      expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
    });
  });

  it('criterio 156 (ii): con la cola vacia, una llamada hecha dentro de un then encadenado a una promesa ya resuelta se acepta antes de que asentar() termine', async () => {
    const { env, cliente, nombres, entregadas } = await crearCaso();

    await env.ejecutar(async () => {
      const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));
      void Promise.resolve()
        .then(() => undefined)
        .then(() => undefined)
        .then(() => cliente.$queryRaw`SELECT 2 AS dos`)
        .catch(nada);

      await vaciar();

      expect(nombres(), 'la llamada de la continuacion se acepto y se entrego').toEqual(['$queryRaw']);
      expect(fin().asentada, 'asentar() espera la consulta que llego mientras corria').toBe(false);

      entregadas[0]?.resolver([{ dos: 2 }]);
      await vaciar();
      expect(fin()).toMatchObject({ asentada: true, resolvio: true });
      expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
    });
  });

  it('criterio 156 (iii): despues de que asentar() termino, una llamada desde el contexto de ejecutar y otra desde fuera rechazan sin entregarse y exigirCompleta() lanza ErrorTransaccionAbortada', async () => {
    const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
    const { env, cliente, nombres } = await crearCaso();
    let abrir: () => void = nada;
    const puerta = new Promise<void>((resolver) => {
      abrir = resolver;
    });
    const dentro = env.ejecutar(async () => {
      await puerta;
      return seguir(llamar(() => cliente.$queryRaw`SELECT 3 AS tres`));
    });

    await exigirFuncion(env, 'asentar')();
    const fuera = seguir(llamar(() => cliente.$executeRaw`UPDATE configuraciones SET valor = '{}'::jsonb`));
    abrir();
    const estadoDentro = await dentro;
    await vaciar();

    expect(nombres(), 'ninguna de las dos llamadas se entrego').toEqual([]);
    expect(estadoDentro(), 'desde el contexto de ejecutar').toMatchObject({ asentada: true, resolvio: false });
    expect(estadoDentro().error).toBeInstanceOf(Error);
    expect(fuera(), 'desde fuera de ejecutar').toMatchObject({ asentada: true, resolvio: false });
    expect(fuera().error).toBeInstanceOf(Error);
    expect(exigirFuncion(env, 'exigirCompleta')).toThrow(ErrorTransaccionAbortada);
  });

  it('criterio 156 (iii, solo el contexto de ejecutar): una llamada tardia desde el contexto de ejecutar basta para que exigirCompleta() lance', async () => {
    const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
    const { env, cliente, nombres } = await crearCaso();
    let abrir: () => void = nada;
    const puerta = new Promise<void>((resolver) => {
      abrir = resolver;
    });
    const dentro = env.ejecutar(async () => {
      await puerta;
      return seguir(
        llamar(() => cliente.configuracion['update']?.({ where: { clave: 'x' }, data: {} }) as Promise<unknown>),
      );
    });

    await exigirFuncion(env, 'asentar')();
    abrir();
    const estadoDentro = await dentro;
    await vaciar();

    expect(nombres()).toEqual([]);
    expect(estadoDentro()).toMatchObject({ asentada: true, resolvio: false });
    expect(exigirFuncion(env, 'exigirCompleta')).toThrow(ErrorTransaccionAbortada);
  });

  it('criterio 156 (iii, solo desde fuera): una llamada tardia desde fuera de ejecutar basta para que exigirCompleta() lance', async () => {
    const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
    const { env, cliente, nombres } = await crearCaso();

    await exigirFuncion(env, 'asentar')();
    const fuera = seguir(llamar(() => cliente.$queryRaw`SELECT 3 AS tres`));
    await vaciar();

    expect(nombres()).toEqual([]);
    expect(fuera()).toMatchObject({ asentada: true, resolvio: false });
    expect(exigirFuncion(env, 'exigirCompleta')).toThrow(ErrorTransaccionAbortada);
  });

  it('criterio 156 (iv): con asentar() en curso, una llamada desde fuera de ejecutar rechaza sin entregarse y exigirCompleta() lanza ErrorTransaccionAbortada; asentar() no rechaza', async () => {
    const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
    const { env, cliente, nombres, entregadas } = await crearCaso();
    await env.ejecutar(() => {
      cliente.$queryRaw`SELECT 1 AS uno`.catch(nada);
      return Promise.resolve();
    });

    const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));
    await vaciar();
    expect(fin().asentada, 'la consulta entregada mantiene asentar() en curso').toBe(false);
    const fuera = seguir(llamar(() => cliente.$executeRaw`UPDATE configuraciones SET valor = '{}'::jsonb`));
    await vaciar();

    expect(fuera(), 'desde fuera de ejecutar').toMatchObject({ asentada: true, resolvio: false });
    expect(fuera().error).toBeInstanceOf(Error);
    expect(nombres(), 'la llamada de otro contexto no se entrego').toEqual(['$queryRaw']);
    expect(exigirFuncion(env, 'exigirCompleta')).toThrow(ErrorTransaccionAbortada);

    entregadas[0]?.resolver([{ uno: 1 }]);
    await vaciar();
    expect(fin(), 'asentar() nunca rechaza').toMatchObject({ asentada: true, resolvio: true });
  });

  it('criterio 156 (v): antes de llamar a asentar(), una llamada desde fuera de ejecutar rechaza y exigirCompleta() no lanza (criterio 134 sin cambios)', async () => {
    const { env, cliente, nombres } = await crearCaso();

    const fuera = seguir(llamar(() => cliente.$queryRaw`SELECT 1 AS uno`));
    await vaciar();

    expect(fuera()).toMatchObject({ asentada: true, resolvio: false });
    expect(fuera().error).toBeInstanceOf(Error);
    expect(nombres(), 'no se entrego').toEqual([]);
    expect(
      exigirFuncion(env, 'exigirCompleta'),
      'antes de asentar(), la llamada rechazada no marca nada',
    ).not.toThrow();
  });

  it('criterio 156 (v, durante trabajo): mientras trabajo corre, una llamada desde fuera de ejecutar rechaza sin marcar la transaccion', async () => {
    const { env, cliente, nombres } = await crearCaso();
    let abrir: () => void = nada;
    const puerta = new Promise<void>((resolver) => {
      abrir = resolver;
    });
    const dentro = env.ejecutar(async () => {
      await puerta;
    });

    const fuera = seguir(llamar(() => cliente.$queryRaw`SELECT 1 AS uno`));
    await vaciar();

    expect(fuera()).toMatchObject({ asentada: true, resolvio: false });
    expect(nombres()).toEqual([]);
    expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
    abrir();
    await dentro;
    expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
  });

  it('criterio 156 (vi): tras descartar() y terminar(), una llamada rechaza sin entregarse, como hoy, y no marca la transaccion', async () => {
    const { env, cliente, nombres } = await crearCaso();

    await env.ejecutar(async () => {
      exigirFuncion(env, 'descartar')();
      env.terminar();

      const tarde = seguir(llamar(() => cliente.$queryRaw`SELECT 1 AS uno`));
      await vaciar();

      expect(tarde()).toMatchObject({ asentada: true, resolvio: false });
      expect(tarde().error).toBeInstanceOf(Error);
      expect(nombres()).toEqual([]);
      expect(exigirFuncion(env, 'exigirCompleta'), 'sin asentar(), la llamada rechazada no marca nada').not.toThrow();
    });
  });

  it('criterio 156: con asentar() en curso, una llamada rechazada por un argumento no admitido no marca la transaccion', async () => {
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
    });
  });

  it('criterio 156: sin ninguna llamada tardia, exigirCompleta() no lanza despues de asentar()', async () => {
    const { env, cliente, entregadas } = await crearCaso();

    await env.ejecutar(() => {
      cliente.$queryRaw`SELECT 1 AS uno`.catch(nada);
      return Promise.resolve();
    });
    const fin = seguir(Promise.resolve(exigirFuncion(env, 'asentar')()));
    entregadas[0]?.resolver([{ uno: 1 }]);
    await vaciar();

    expect(fin()).toMatchObject({ asentada: true, resolvio: true });
    expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
  });

  it('criterio 156: el error de exigirCompleta() nombra la operacion de la llamada tardia y nunca sus argumentos ni parametros', async () => {
    const SENTINELA_ARGUMENTO = 'SENTINELA-R12-ARGUMENTO';
    const SENTINELA_PARAMETRO = 'SENTINELA-R12-PARAMETRO';
    const casos = [
      {
        nombre: 'configuracion.update',
        llamar: (c: ClientePrueba) =>
          (c.configuracion['update'] as (a: object) => Promise<unknown>)({
            where: { clave: SENTINELA_ARGUMENTO },
            data: { valor: SENTINELA_ARGUMENTO },
          }),
      },
      {
        nombre: '$executeRaw',
        llamar: (c: ClientePrueba) =>
          c.$executeRaw`UPDATE configuraciones SET clave = ${SENTINELA_PARAMETRO} WHERE clave = ${SENTINELA_PARAMETRO}`,
      },
    ];
    for (const caso of casos) {
      const { env, cliente } = await crearCaso();
      await exigirFuncion(env, 'asentar')();
      caso.llamar(cliente).catch(nada);
      await vaciar();

      let error: unknown;
      try {
        exigirFuncion(env, 'exigirCompleta')();
      } catch (lanzado) {
        error = lanzado;
      }

      expect(error, caso.nombre).toBeInstanceOf(Error);
      const texto = textoDelError(error);
      expect(texto, `${caso.nombre}: nombra la operacion`).toContain(caso.nombre);
      expect(texto, `${caso.nombre}: sin argumentos`).not.toContain(SENTINELA_ARGUMENTO);
      expect(texto, `${caso.nombre}: sin parametros`).not.toContain(SENTINELA_PARAMETRO);
    }
  });
});
