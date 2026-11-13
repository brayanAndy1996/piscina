// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cargarErrorTransaccionAbortada } from '../../../test/utilidades/ronda10';
import { cargarFuncionalidad, textoDelError } from '../../../test/utilidades/ronda3';

// Criterios 153 y 154 (ataque ronda 11, F1; precision P-38), prueba unitaria de `envolver(tx)` (backend/src/infraestructura/prisma/envoltorio.ts)
// con una transaccion falsa: un objeto con `$queryRaw`, `$executeRaw` y un delegado `configuracion` cuyas operaciones devuelven un objeto con
// `then`. La prueba registra cuando se llama a ese `then`, que es cuando la consulta se entrega a Prisma. Las funciones del envoltorio exigen
// el contexto de `ejecutar` (P-32), asi que cada caso corre dentro de `ejecutar`.
//
// 153 (cola serial): cada funcion del envoltorio entrega su consulta solo cuando se asento (se resolvio o se rechazo) la anterior de la misma
// transaccion, en el orden de las llamadas; con la cola vacia se entrega durante la llamada; una llamada rechazada al llamar (argumento no
// admitido) no entra en la cola ni la detiene; `asentar()` espera tambien las consultas de la cola; tras `descartar()` las que seguian en la
// cola rechazan sin entregarse.
// 154 (operaciones incompletas): una operacion que recibe `undefined` de Prisma rechaza con `ErrorTransaccionAbortada` y deja la transaccion
// marcada (`exigirCompleta()` lanza `ErrorTransaccionAbortada` aunque `trabajo` haya atrapado el rechazo); `null`, `0`, `[]` y `{ count: 0 }` son
// resultados normales; una consulta que rechaza no marca nada; el error nombra la operacion y nunca sus argumentos ni parametros.

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
    // Evita un `unhandledRejection` si la prueba rechaza una consulta cuyo `then` nadie llego a llamar.
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
      findUnique: fabricar('configuracion.findUnique'),
      findMany: fabricar('configuracion.findMany'),
      updateMany: fabricar('configuracion.updateMany'),
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

/** Crea el envoltorio sobre una transaccion falsa y corre `prueba` dentro de `ejecutar`. */
async function conEnvoltorio(prueba: (caso: Caso) => Promise<void>): Promise<void> {
  const envolver = await cargarEnvolver();
  const { tx, entregadas, nombres } = crearTransaccionFalsa();
  const env = envolver(tx);
  await env.ejecutar(() => prueba({ env, cliente: env.cliente, entregadas, nombres }));
}

/** Exige que `envolver(tx)` devuelva la funcion de P-38; si falta, falla con "falta la funcionalidad". */
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

const LLAMADAS: readonly { nombre: string; llamar: (cliente: ClientePrueba) => Promise<unknown> }[] = [
  { nombre: '$queryRaw', llamar: (c) => c.$queryRaw`SELECT 1 AS uno` },
  { nombre: '$executeRaw', llamar: (c) => c.$executeRaw`UPDATE configuraciones SET valor = '{}'::jsonb` },
  {
    nombre: 'configuracion.update',
    llamar: (c) => (c.configuracion['update'] as (a: object) => Promise<unknown>)({ where: { clave: 'x' }, data: {} }),
  },
  {
    nombre: 'configuracion.create',
    llamar: (c) => (c.configuracion['create'] as (a: object) => Promise<unknown>)({ data: { clave: 'x' } }),
  },
  {
    nombre: 'configuracion.findUnique',
    llamar: (c) => (c.configuracion['findUnique'] as (a: object) => Promise<unknown>)({ where: { clave: 'x' } }),
  },
  {
    nombre: 'configuracion.updateMany',
    llamar: (c) => (c.configuracion['updateMany'] as (a: object) => Promise<unknown>)({ where: {}, data: {} }),
  },
];

const llamada = (nombre: string): ((cliente: ClientePrueba) => Promise<unknown>) => {
  const encontrada = LLAMADAS.find((l) => l.nombre === nombre);
  if (encontrada === undefined) throw new Error(`Llamada de prueba desconocida: ${nombre}`);
  return encontrada.llamar;
};

describe('criterio 153: cola serial del envoltorio (P-38, transaccion falsa)', () => {
  it.each(LLAMADAS.map((l) => [l.nombre] as const))(
    'criterio 153: con la cola vacia, %s se entrega durante la llamada, sin esperar un then de quien llama',
    async (nombre) => {
      await conEnvoltorio(async ({ cliente, nombres, entregadas }) => {
        const promesa = llamada(nombre)(cliente);

        expect(nombres(), 'entregada en el mismo momento de la llamada').toEqual([nombre]);
        entregadas[0]?.resolver([{ r: 1 }]);
        expect(await promesa).toEqual([{ r: 1 }]);
      });
    },
  );

  it('criterio 153: con tres llamadas seguidas, la segunda consulta se entrega solo despues de que se asento la primera, y la tercera despues de la segunda', async () => {
    await conEnvoltorio(async ({ cliente, nombres, entregadas }) => {
      const p1 = llamada('$queryRaw')(cliente);
      const p2 = llamada('configuracion.update')(cliente);
      const p3 = llamada('$executeRaw')(cliente);
      const estado1 = seguir(p1);
      const estado2 = seguir(p2);
      const estado3 = seguir(p3);

      expect(nombres(), 'solo la primera, durante las llamadas').toEqual(['$queryRaw']);
      await vaciar();
      expect(nombres(), 'la segunda y la tercera esperan en la cola mientras la primera no se asienta').toEqual([
        '$queryRaw',
      ]);

      entregadas[0]?.resolver([{ uno: 1 }]);
      await vaciar();
      expect(nombres(), 'asentada la primera, se entrega la segunda y la tercera sigue esperando').toEqual([
        '$queryRaw',
        'configuracion.update',
      ]);
      expect(estado1()).toMatchObject({ asentada: true, resolvio: true, valor: [{ uno: 1 }] });
      expect(estado2().asentada).toBe(false);

      entregadas[1]?.resolver({ clave: 'x' });
      await vaciar();
      expect(nombres(), 'asentada la segunda, se entrega la tercera').toEqual([
        '$queryRaw',
        'configuracion.update',
        '$executeRaw',
      ]);
      expect(estado2()).toMatchObject({ asentada: true, resolvio: true, valor: { clave: 'x' } });
      expect(estado3().asentada).toBe(false);

      entregadas[2]?.resolver(3);
      expect(await p3).toBe(3);
    });
  });

  it('criterio 153: una consulta de la cola que se rechaza no cambia el resultado de las demas: la siguiente se entrega y cada una recibe lo suyo', async () => {
    await conEnvoltorio(async ({ cliente, nombres, entregadas }) => {
      const errorDeLaPrimera = new Error('falla de la primera (como un P2025)');
      const p1 = llamada('configuracion.update')(cliente);
      const p2 = llamada('$queryRaw')(cliente);
      const estado1 = seguir(p1);
      const estado2 = seguir(p2);

      entregadas[0]?.rechazar(errorDeLaPrimera);
      await vaciar();

      expect(nombres(), 'rechazada la primera, la segunda se entrega').toEqual(['configuracion.update', '$queryRaw']);
      expect(estado1()).toMatchObject({ asentada: true, resolvio: false, error: errorDeLaPrimera });
      entregadas[1]?.resolver([{ uno: 1 }]);
      expect(await p2).toEqual([{ uno: 1 }]);
      expect(estado2()).toMatchObject({ resolvio: true });
    });
  });

  it('criterio 153: una llamada rechazada por un argumento no admitido no entra en la cola ni la detiene', async () => {
    await conEnvoltorio(async ({ cliente, nombres, entregadas }) => {
      const p1 = llamada('$queryRaw')(cliente);
      const mala = llamar(() => (cliente.$queryRaw as unknown as (sql: string) => Promise<unknown>)('SELECT 1'));
      const estadoMala = seguir(mala);
      const p3 = llamada('$executeRaw')(cliente);

      await vaciar();
      expect(estadoMala(), 'el argumento no admitido rechaza con TypeError al llamar').toMatchObject({
        asentada: true,
        resolvio: false,
      });
      expect(estadoMala().error).toBeInstanceOf(TypeError);
      expect(nombres(), 'la rechazada no se entrega y la tercera espera a la primera').toEqual(['$queryRaw']);

      entregadas[0]?.resolver([{ uno: 1 }]);
      await vaciar();
      expect(nombres(), 'la tercera se entrega en cuanto se asienta la primera, sin esperar a la rechazada').toEqual([
        '$queryRaw',
        '$executeRaw',
      ]);
      entregadas[1]?.resolver(1);
      expect(await p3).toBe(1);
      expect(await p1).toEqual([{ uno: 1 }]);
    });
  });

  it('criterio 153: tras descartar(), las consultas que seguian en la cola rechazan sin entregarse; la ya entregada sigue su curso', async () => {
    await conEnvoltorio(async ({ env, cliente, nombres, entregadas }) => {
      const p1 = llamada('$queryRaw')(cliente);
      const p2 = llamada('configuracion.create')(cliente);
      const p3 = llamada('$executeRaw')(cliente);
      const estado1 = seguir(p1);
      const estado2 = seguir(p2);
      const estado3 = seguir(p3);

      exigirFuncion(env, 'descartar')();
      env.terminar();
      await vaciar();
      expect(nombres(), 'solo la primera se habia entregado').toEqual(['$queryRaw']);

      entregadas[0]?.resolver([{ uno: 1 }]);
      await vaciar();

      expect(nombres(), 'ninguna de la cola se entrega despues de descartar').toEqual(['$queryRaw']);
      expect(estado1()).toMatchObject({ asentada: true, resolvio: true, valor: [{ uno: 1 }] });
      expect(estado2()).toMatchObject({ asentada: true, resolvio: false });
      expect(estado2().error).toBeInstanceOf(Error);
      expect(estado3()).toMatchObject({ asentada: true, resolvio: false });
      expect(estado3().error).toBeInstanceOf(Error);
    });
  });

  it('criterio 153: tras descartar() y terminar(), una llamada nueva rechaza sin entregarse', async () => {
    await conEnvoltorio(async ({ env, cliente, nombres }) => {
      exigirFuncion(env, 'descartar')();
      env.terminar();

      const tarde = seguir(llamar(() => llamada('$queryRaw')(cliente)));
      await vaciar();

      expect(tarde()).toMatchObject({ asentada: true, resolvio: false });
      expect(nombres()).toEqual([]);
    });
  });

  it('criterio 153: asentar() espera tambien las consultas que siguen en la cola', async () => {
    await conEnvoltorio(async ({ env, cliente, nombres, entregadas }) => {
      llamada('$queryRaw')(cliente).catch(nada);
      llamada('$executeRaw')(cliente).catch(nada);
      env.terminar();
      const asentar = exigirFuncion(env, 'asentar');
      const alFinal = seguir(Promise.resolve(asentar()).then(() => 'asentado'));

      await vaciar();
      expect(alFinal().asentada, 'con la primera pendiente').toBe(false);

      entregadas[0]?.resolver([{ uno: 1 }]);
      await vaciar();
      expect(nombres(), 'la segunda, de la cola, ya se entrego').toEqual(['$queryRaw', '$executeRaw']);
      expect(alFinal().asentada, 'la segunda sigue pendiente: asentar() no termina').toBe(false);

      entregadas[1]?.resolver(1);
      await vaciar();
      expect(alFinal()).toMatchObject({ asentada: true, resolvio: true, valor: 'asentado' });
    });
  });
});

describe('criterio 154: una operacion que vuelve con undefined hace fallar la transaccion (P-38, transaccion falsa)', () => {
  it.each(LLAMADAS.map((l) => [l.nombre] as const))(
    'criterio 154: %s que recibe undefined de Prisma rechaza con ErrorTransaccionAbortada y exigirCompleta() lanza ErrorTransaccionAbortada aunque el rechazo se haya atrapado',
    async (nombre) => {
      const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
      await conEnvoltorio(async ({ env, cliente, entregadas }) => {
        const promesa = llamada(nombre)(cliente);
        const estado = seguir(promesa);

        entregadas[0]?.resolver(undefined);
        await vaciar();

        expect(estado(), 'nunca resuelve con undefined').toMatchObject({ asentada: true, resolvio: false });
        expect(estado().error).toBeInstanceOf(ErrorTransaccionAbortada);
        expect(exigirFuncion(env, 'exigirCompleta')).toThrow(ErrorTransaccionAbortada);
      });
    },
  );

  it('criterio 154: sin ninguna operacion incompleta, exigirCompleta() no hace nada', async () => {
    await conEnvoltorio(async ({ env, cliente, entregadas }) => {
      const promesa = llamada('$queryRaw')(cliente);
      entregadas[0]?.resolver([{ uno: 1 }]);
      await promesa;

      expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
    });
  });

  it.each([
    ['null', null],
    ['0', 0],
    ['un arreglo vacio', []],
    ['{ count: 0 }', { count: 0 }],
  ])(
    'criterio 154: %s es un resultado normal en todas las operaciones: la promesa resuelve con ese valor y exigirCompleta() no lanza',
    async (_nombre, valor) => {
      for (const { nombre, llamar: hacer } of LLAMADAS) {
        await conEnvoltorio(async ({ env, cliente, entregadas }) => {
          const promesa = hacer(cliente);

          entregadas[0]?.resolver(valor);

          await expect(promesa, nombre).resolves.toEqual(valor);
          expect(exigirFuncion(env, 'exigirCompleta'), nombre).not.toThrow();
        });
      }
    },
  );

  it('criterio 154: una consulta falsa que rechaza no marca nada: su promesa rechaza con su propio error y exigirCompleta() no lanza', async () => {
    const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
    await conEnvoltorio(async ({ env, cliente, entregadas }) => {
      const errorDeLaBase = new Error('error de la base');
      const estado = seguir(llamada('$queryRaw')(cliente));

      entregadas[0]?.rechazar(errorDeLaBase);
      await vaciar();

      expect(estado()).toMatchObject({ asentada: true, resolvio: false, error: errorDeLaBase });
      expect(estado().error).not.toBeInstanceOf(ErrorTransaccionAbortada);
      expect(exigirFuncion(env, 'exigirCompleta')).not.toThrow();
    });
  });

  it('criterio 154: despues de una operacion incompleta, la cola sigue: la siguiente consulta se entrega y recibe lo suyo, y la transaccion sigue marcada', async () => {
    const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
    await conEnvoltorio(async ({ env, cliente, nombres, entregadas }) => {
      const p1 = seguir(llamada('configuracion.update')(cliente));
      const p2 = llamada('$queryRaw')(cliente);

      entregadas[0]?.resolver(undefined);
      await vaciar();
      expect(nombres()).toEqual(['configuracion.update', '$queryRaw']);
      entregadas[1]?.resolver([{ uno: 1 }]);

      expect(await p2).toEqual([{ uno: 1 }]);
      expect(p1().error).toBeInstanceOf(ErrorTransaccionAbortada);
      expect(exigirFuncion(env, 'exigirCompleta')).toThrow(ErrorTransaccionAbortada);
    });
  });

  it('criterio 154: el error de exigirCompleta() nombra la operacion y nunca sus argumentos ni parametros', async () => {
    const SENTINELA_ARGUMENTO = 'SENTINELA-R11-ARGUMENTO';
    const SENTINELA_PARAMETRO = 'SENTINELA-R11-PARAMETRO';
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
      await conEnvoltorio(async ({ env, cliente, entregadas }) => {
        const promesa = caso.llamar(cliente);
        promesa.catch(nada);
        entregadas[0]?.resolver(undefined);
        await vaciar();

        const exigirCompleta = exigirFuncion(env, 'exigirCompleta');
        let error: unknown;
        try {
          exigirCompleta();
        } catch (lanzado) {
          error = lanzado;
        }

        expect(error, caso.nombre).toBeInstanceOf(Error);
        const texto = textoDelError(error);
        expect(texto, `${caso.nombre}: nombra la operacion`).toContain(caso.nombre);
        expect(texto, `${caso.nombre}: sin argumentos`).not.toContain(SENTINELA_ARGUMENTO);
        expect(texto, `${caso.nombre}: sin parametros`).not.toContain(SENTINELA_PARAMETRO);
      });
    }
  });
});
