// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cargarErrorTransaccionAbortada } from '../../../test/utilidades/ronda10';
import { cargarFuncionalidad, Prisma } from '../../../test/utilidades/ronda3';

// Criterio 158 (ataque ronda 12, F2; P-39), prueba unitaria de `conPuntosDeGuardado(tx)`
// (backend/src/infraestructura/prisma/puntos-de-guardado.ts) con una transaccion falsa como la de P-38: `$queryRaw`, `$executeRaw` y un
// delegado `configuracion` cuyas operaciones devuelven un objeto con `then` (la prueba registra cuando se llama a ese `then`, que es cuando la
// sentencia se entrega). La prueba reconoce cada sentencia de la capa por el texto SQL del argumento (las partes de la plantilla unidas, o `.sql`
// si es un `Prisma.Sql`), sin espacios al principio: `SAVEPOINT `, `RELEASE SAVEPOINT ` y `ROLLBACK TO SAVEPOINT ` por su comienzo, y la
// comprobacion del estado como la sentencia de `$queryRaw` que sigue a una escritura rechazada. El nombre del punto cumple `^aq_[0-9a-f]{32}$`.
//
// Orden de sentencias que exige la capa, por cada operacion de escritura de un delegado (`create`, `createMany`, `createManyAndReturn`,
// `update`, `updateMany`, `updateManyAndReturn`, `upsert`, `delete`, `deleteMany`):
//   - la escritura resuelve: crear el punto, la escritura y liberarlo; resuelve con el valor de la escritura;
//   - la escritura rechaza con un error sin SQLSTATE y la comprobacion del estado resuelve: crear el punto, la escritura, la comprobacion,
//     volver al punto y liberarlo; rechaza con el mismo error y `exigirSana()` no lanza;
//   - la comprobacion rechaza con `25P02`: no se vuelve al punto; `exigirSana()` lanza `ErrorTransaccionAbortada`;
//   - crear el punto rechaza: la escritura no se entrega y la operacion rechaza con ese error;
//   - liberar, volver al punto o la comprobacion rechazan con otro error: `exigirSana()` lanza;
//   - las lecturas, `$queryRaw` y `$executeRaw` se entregan solas, sin sentencias de la capa;
//   - ninguna sentencia de la capa sale antes de que se asiente la anterior;
//   - el nombre del punto es el mismo dentro de una capa y distinto entre dos capas.

type Evento = string;

/** Como responde la transaccion falsa a una sentencia: bien, mal, o se queda pendiente hasta que la prueba la resuelva. */
type RespuestaFija = { ok: unknown } | { error: unknown } | 'pendiente';
/** Una respuesta fija, o una que depende de cuantas sentencias del mismo tipo se entregaron antes (0 la primera). */
type Respuesta = RespuestaFija | ((anteriores: number) => RespuestaFija);

interface Entrega {
  readonly evento: Evento;
  readonly texto: string;
  readonly argumentos: unknown[];
  resolver(valor: unknown): void;
  rechazar(error: unknown): void;
}

interface TransaccionFalsa {
  readonly tx: object;
  readonly entregas: Entrega[];
  readonly eventos: () => Evento[];
}

interface CapaPrueba {
  readonly tx: {
    readonly $queryRaw: (...argumentos: unknown[]) => PromiseLike<unknown>;
    readonly $executeRaw: (...argumentos: unknown[]) => PromiseLike<unknown>;
    readonly configuracion: Record<string, (...argumentos: unknown[]) => PromiseLike<unknown>>;
  };
  readonly exigirSana: () => void;
}
type ConPuntosDeGuardado = (tx: object) => CapaPrueba;

const nada = (): undefined => undefined;

const ESCRITURAS = [
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
] as const;
const LECTURAS = ['findUnique', 'findFirst', 'findMany', 'count', 'aggregate'] as const;

const FILA = { clave: 'resultado-de-la-escritura' };

async function cargarCapa(): Promise<ConPuntosDeGuardado> {
  const modulo = await cargarFuncionalidad<{ conPuntosDeGuardado: ConPuntosDeGuardado }>(
    'infraestructura/prisma/puntos-de-guardado.ts',
    ['conPuntosDeGuardado'],
  );
  return modulo.conPuntosDeGuardado;
}

/** Texto SQL del argumento: las partes de la plantilla unidas con sus valores en bruto (`Prisma.raw`), `.sql` de un `Prisma.Sql` o el texto. */
function textoDe(argumentos: unknown[]): string {
  const [primero, ...valores] = argumentos;
  if (typeof primero === 'string') return primero;
  if (Array.isArray(primero)) {
    return (primero as string[])
      .map((parte, i) => parte + (i < valores.length ? representar(valores[i]) : ''))
      .join('');
  }
  return representar(primero);
}

function representar(valor: unknown): string {
  if (valor instanceof Prisma.Sql) return valor.sql;
  const sql = (valor as { sql?: unknown } | null)?.sql;
  return typeof sql === 'string' ? sql : '?';
}

function clasificarCruda(via: '$queryRaw' | '$executeRaw', texto: string): Evento {
  const limpio = texto.trimStart();
  if (limpio.startsWith('SAVEPOINT ')) return 'crear';
  if (limpio.startsWith('RELEASE SAVEPOINT ')) return 'liberar';
  if (limpio.startsWith('ROLLBACK TO SAVEPOINT ')) return 'volver';
  if (limpio.includes('usuario')) return `usuario:${via}`;
  return via === '$queryRaw' ? 'comprobacion' : 'otra-sentencia';
}

/**
 * La transaccion falsa. `respuestas` dice como contesta a cada tipo de evento (por defecto, bien): `crear`, `escritura`, `liberar`, `volver`,
 * `comprobacion`. Una sentencia con respuesta `'pendiente'` queda sin asentar hasta que la prueba llame a su `resolver` o `rechazar`.
 */
function crearTransaccionFalsa(respuestas: Record<string, Respuesta> = {}): TransaccionFalsa {
  const entregas: Entrega[] = [];

  const fabricar = (clasificar: (argumentos: unknown[]) => { evento: Evento; texto: string }, porDefecto: unknown) => {
    return (...argumentos: unknown[]) => {
      let resolver: (valor: unknown) => void = nada;
      let rechazar: (error: unknown) => void = nada;
      const promesa = new Promise<unknown>((alResolver, alRechazar) => {
        resolver = alResolver;
        rechazar = alRechazar;
      });
      promesa.catch(nada);
      const objeto = {
        then: (alResolver?: (valor: unknown) => unknown, alRechazar?: (error: unknown) => unknown) => {
          const { evento, texto } = clasificar(argumentos);
          const clave = evento.startsWith('escritura') ? 'escritura' : evento;
          const anteriores = entregas.filter(
            (e) => (e.evento.startsWith('escritura') ? 'escritura' : e.evento) === clave,
          ).length;
          entregas.push({ evento, texto, argumentos, resolver, rechazar });
          const configurada = respuestas[clave];
          const respuesta = typeof configurada === 'function' ? configurada(anteriores) : configurada;
          if (respuesta === undefined) resolver(porDefecto);
          else if (respuesta !== 'pendiente') {
            if ('error' in respuesta) rechazar(respuesta.error);
            else resolver(respuesta.ok);
          }
          return promesa.then(alResolver, alRechazar);
        },
        catch: (alRechazar?: (error: unknown) => unknown) => objeto.then(undefined, alRechazar),
        finally: (alTerminar?: () => void) =>
          objeto.then(
            (valor) => {
              alTerminar?.();
              return valor;
            },
            (error: unknown) => {
              alTerminar?.();
              throw error;
            },
          ),
      };
      return objeto;
    };
  };

  const cruda = (via: '$queryRaw' | '$executeRaw') =>
    fabricar(
      (argumentos) => {
        const texto = textoDe(argumentos);
        return { evento: clasificarCruda(via, texto), texto };
      },
      via === '$queryRaw' ? [{ sana: 1 }] : 1,
    );

  const delegado: Record<string, unknown> = {};
  for (const operacion of ESCRITURAS) {
    delegado[operacion] = fabricar(() => ({ evento: `escritura:configuracion.${operacion}`, texto: '' }), FILA);
  }
  for (const operacion of LECTURAS) {
    delegado[operacion] = fabricar(() => ({ evento: `lectura:configuracion.${operacion}`, texto: '' }), [FILA]);
  }

  const tx = {
    $queryRaw: cruda('$queryRaw'),
    $executeRaw: cruda('$executeRaw'),
    $queryRawUnsafe: cruda('$queryRaw'),
    $executeRawUnsafe: cruda('$executeRaw'),
    configuracion: delegado,
  };
  return { tx, entregas, eventos: () => entregas.map((e) => e.evento) };
}

/** Deja correr las continuaciones pendientes (microtareas y un turno del bucle de eventos). */
const vaciar = (): Promise<void> => new Promise((resolver) => setTimeout(resolver, 5));

interface Destino {
  readonly valor?: unknown;
  readonly error?: unknown;
  readonly asentada: boolean;
  readonly resolvio: boolean;
}

/** Sigue una promesa (o un objeto con `then`): dice si se asento y con que, sin dejar rechazos sin atrapar. */
function seguir(pendiente: PromiseLike<unknown>): () => Destino {
  let estado: Destino = { asentada: false, resolvio: false };
  Promise.resolve(pendiente).then(
    (valor) => {
      estado = { asentada: true, resolvio: true, valor };
    },
    (error: unknown) => {
      estado = { asentada: true, resolvio: false, error };
    },
  );
  return () => estado;
}

/** Llama a la escritura `operacion` de la capa con `argumentos` y devuelve lo que devuelve (un objeto con `then`). */
function escribir(capa: CapaPrueba, operacion: string, ...argumentos: unknown[]): PromiseLike<unknown> {
  const funcion = capa.tx.configuracion[operacion];
  if (typeof funcion !== 'function') {
    throw new Error(`Falta la funcionalidad de la 001: la capa no expone configuracion.${operacion} (P-39).`);
  }
  return funcion(...argumentos);
}

/** Error de la base con un SQLSTATE (`codigoDeErrorDeBase` lo reconoce en un `Error` con `code` de cinco caracteres). */
const errorDeBase = (codigo: string, mensaje = 'error de la base'): Error =>
  Object.assign(new Error(mensaje), { code: codigo });

/** Un error de Prisma que no es de la base (como el P2025 de una escritura anidada que no encuentra la hija). */
const errorSinSqlstate = (): Error =>
  new Prisma.PrismaClientKnownRequestError('registro anidado no encontrado', {
    code: 'P2025',
    clientVersion: 'prueba',
  });

const evento = (operacion: string): string => `escritura:configuracion.${operacion}`;

const NOMBRE_DEL_PUNTO = /aq_[0-9a-f]{32}/;
const nombreDe = (texto: string): string | undefined => NOMBRE_DEL_PUNTO.exec(texto)?.[0];

describe('criterio 158: capa de puntos de guardado (P-39, transaccion falsa)', () => {
  describe('criterio 158: la escritura resuelve', () => {
    it.each(ESCRITURAS)(
      'criterio 158: %s produce, en orden, crear el punto, la escritura y liberarlo, y resuelve con el valor de la escritura',
      async (operacion) => {
        const conPuntos = await cargarCapa();
        const falsa = crearTransaccionFalsa({ escritura: { ok: FILA } });
        const capa = conPuntos(falsa.tx);
        const argumentos = { where: { clave: 'x' }, data: { valor: {} } };

        const valor = await escribir(capa, operacion, argumentos);

        expect(valor, 'el valor de la escritura, sin cambios').toBe(FILA);
        expect(falsa.eventos()).toEqual(['crear', evento(operacion), 'liberar']);
        expect(falsa.entregas[1]?.argumentos[0], 'los argumentos se pasan tal cual').toBe(argumentos);
        expect(() => capa.exigirSana(), 'una escritura que resuelve no marca nada').not.toThrow();
      },
    );

    it('criterio 158: una escritura que resuelve con null, 0 o un arreglo vacio devuelve ese mismo valor', async () => {
      for (const valorDeLaEscritura of [null, 0, [], { count: 0 }]) {
        const conPuntos = await cargarCapa();
        const falsa = crearTransaccionFalsa({ escritura: { ok: valorDeLaEscritura } });
        const capa = conPuntos(falsa.tx);

        const valor = await escribir(capa, 'updateMany', { where: {}, data: {} });

        expect(valor).toBe(valorDeLaEscritura);
        expect(falsa.eventos()).toEqual(['crear', evento('updateMany'), 'liberar']);
      }
    });

    it('criterio 158: la capa no envia nada hasta que se llama al then de la operacion (el envoltorio lo llama al entregar)', async () => {
      const conPuntos = await cargarCapa();
      const falsa = crearTransaccionFalsa();
      const capa = conPuntos(falsa.tx);

      const operacion = escribir(capa, 'update', { where: {}, data: {} });
      await vaciar();
      expect(falsa.eventos(), 'sin llamar al then, no sale ninguna sentencia').toEqual([]);

      await operacion;
      expect(falsa.eventos()).toEqual(['crear', evento('update'), 'liberar']);
    });
  });

  describe('criterio 158: la escritura rechaza y la transaccion sigue sana', () => {
    it.each(ESCRITURAS)(
      'criterio 158: %s con un error sin SQLSTATE produce crear, la escritura, la comprobacion, volver al punto y liberarlo, y rechaza con el mismo error',
      async (operacion) => {
        const conPuntos = await cargarCapa();
        const error = errorSinSqlstate();
        const falsa = crearTransaccionFalsa({ escritura: { error } });
        const capa = conPuntos(falsa.tx);

        const destino = seguir(escribir(capa, operacion, { where: {}, data: {} }));
        await vaciar();

        expect(falsa.eventos()).toEqual(['crear', evento(operacion), 'comprobacion', 'volver', 'liberar']);
        expect(destino()).toMatchObject({ asentada: true, resolvio: false });
        expect(destino().error, 'el mismo error de la escritura').toBe(error);
        expect(() => capa.exigirSana(), 'la transaccion sigue sana').not.toThrow();
      },
    );

    it('criterio 158: tras deshacer una escritura, la capa sigue sirviendo: la siguiente escritura vuelve a crear su punto y resuelve', async () => {
      const conPuntos = await cargarCapa();
      const error = errorSinSqlstate();
      const falsa = crearTransaccionFalsa({ escritura: (anteriores) => (anteriores === 0 ? { error } : { ok: FILA }) });
      const capa = conPuntos(falsa.tx);

      const primera = seguir(escribir(capa, 'update', { where: {}, data: {} }));
      await vaciar();
      const segunda = await escribir(capa, 'create', { data: {} });

      expect(primera().error).toBe(error);
      expect(segunda).toBe(FILA);
      expect(falsa.eventos()).toEqual([
        'crear',
        evento('update'),
        'comprobacion',
        'volver',
        'liberar',
        'crear',
        evento('create'),
        'liberar',
      ]);
      expect(() => capa.exigirSana()).not.toThrow();
    });
  });

  describe('criterio 158: la escritura rechaza y la transaccion quedo abortada', () => {
    it('criterio 158: si la comprobacion rechaza con 25P02, no se vuelve al punto, la operacion rechaza con el error de la escritura y exigirSana() lanza ErrorTransaccionAbortada', async () => {
      const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
      const conPuntos = await cargarCapa();
      const errorDeLaEscritura = errorDeBase('23505', 'duplicate key value');
      const falsa = crearTransaccionFalsa({
        escritura: { error: errorDeLaEscritura },
        comprobacion: { error: errorDeBase('25P02', 'current transaction is aborted') },
      });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(escribir(capa, 'create', { data: {} }));
      await vaciar();

      expect(falsa.eventos(), 'sin volver al punto ni liberarlo').toEqual(['crear', evento('create'), 'comprobacion']);
      expect(destino()).toMatchObject({ asentada: true, resolvio: false });
      expect(destino().error, 'el error de la escritura, como hoy').toBe(errorDeLaEscritura);
      expect(() => capa.exigirSana()).toThrow(ErrorTransaccionAbortada);
    });

    it('criterio 158: si crear el punto rechaza con 25P02 (la transaccion ya estaba abortada), la escritura no se entrega y la operacion rechaza con ese error', async () => {
      const conPuntos = await cargarCapa();
      const abortada = errorDeBase('25P02', 'current transaction is aborted');
      const falsa = crearTransaccionFalsa({ crear: { error: abortada } });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(escribir(capa, 'create', { data: {} }));
      await vaciar();

      expect(falsa.eventos(), 'solo se intento crear el punto').toEqual(['crear']);
      expect(destino()).toMatchObject({ asentada: true, resolvio: false });
      expect(destino().error, 'el error de crear el punto (25P02)').toBe(abortada);
    });
  });

  describe('criterio 158: otra sentencia de la capa falla', () => {
    it('criterio 158: si crear el punto rechaza con otro error, la escritura no se entrega, la operacion rechaza con ese error y exigirSana() lanza ErrorTransaccionAbortada', async () => {
      const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
      const conPuntos = await cargarCapa();
      const error = new Error('conexion perdida al crear el punto');
      const falsa = crearTransaccionFalsa({ crear: { error } });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(escribir(capa, 'update', { where: {}, data: {} }));
      await vaciar();

      expect(falsa.eventos()).toEqual(['crear']);
      expect(destino()).toMatchObject({ asentada: true, resolvio: false });
      expect(destino().error).toBe(error);
      expect(() => capa.exigirSana()).toThrow(ErrorTransaccionAbortada);
    });

    it('criterio 158: si liberar el punto rechaza tras una escritura que resolvio, la operacion rechaza y exigirSana() lanza ErrorTransaccionAbortada', async () => {
      const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
      const conPuntos = await cargarCapa();
      const falsa = crearTransaccionFalsa({ liberar: { error: new Error('fallo al liberar') } });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(escribir(capa, 'update', { where: {}, data: {} }));
      await vaciar();

      expect(falsa.eventos()).toEqual(['crear', evento('update'), 'liberar']);
      expect(destino()).toMatchObject({ asentada: true, resolvio: false });
      expect(() => capa.exigirSana()).toThrow(ErrorTransaccionAbortada);
    });

    it('criterio 158: si volver al punto rechaza, la operacion rechaza y exigirSana() lanza ErrorTransaccionAbortada', async () => {
      const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
      const conPuntos = await cargarCapa();
      const falsa = crearTransaccionFalsa({
        escritura: { error: errorSinSqlstate() },
        volver: { error: new Error('fallo al volver al punto') },
      });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(escribir(capa, 'update', { where: {}, data: {} }));
      await vaciar();

      expect(falsa.eventos().slice(0, 4)).toEqual(['crear', evento('update'), 'comprobacion', 'volver']);
      expect(destino()).toMatchObject({ asentada: true, resolvio: false });
      expect(() => capa.exigirSana()).toThrow(ErrorTransaccionAbortada);
    });

    it('criterio 158: si liberar el punto rechaza despues de volver a el, la operacion rechaza y exigirSana() lanza ErrorTransaccionAbortada', async () => {
      const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
      const conPuntos = await cargarCapa();
      const falsa = crearTransaccionFalsa({
        escritura: { error: errorSinSqlstate() },
        liberar: { error: new Error('fallo al liberar') },
      });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(escribir(capa, 'update', { where: {}, data: {} }));
      await vaciar();

      expect(falsa.eventos()).toEqual(['crear', evento('update'), 'comprobacion', 'volver', 'liberar']);
      expect(destino()).toMatchObject({ asentada: true, resolvio: false });
      expect(() => capa.exigirSana()).toThrow(ErrorTransaccionAbortada);
    });

    it('criterio 158: si la comprobacion rechaza con otro error (no 25P02), la operacion rechaza y exigirSana() lanza ErrorTransaccionAbortada', async () => {
      const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
      const conPuntos = await cargarCapa();
      const falsa = crearTransaccionFalsa({
        escritura: { error: errorSinSqlstate() },
        comprobacion: { error: new Error('conexion perdida en la comprobacion') },
      });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(escribir(capa, 'update', { where: {}, data: {} }));
      await vaciar();

      expect(falsa.eventos().slice(0, 3)).toEqual(['crear', evento('update'), 'comprobacion']);
      expect(destino()).toMatchObject({ asentada: true, resolvio: false });
      expect(() => capa.exigirSana()).toThrow(ErrorTransaccionAbortada);
    });
  });

  describe('criterio 158: lo que no cambia', () => {
    it.each(LECTURAS)(
      'criterio 158: la lectura %s se entrega sola, sin sentencias de la capa, con su valor',
      async (operacion) => {
        const conPuntos = await cargarCapa();
        const lectura = [{ clave: 'leida' }];
        const falsa = crearTransaccionFalsa({ [`lectura:configuracion.${operacion}`]: { ok: lectura } });
        const capa = conPuntos(falsa.tx);

        const valor = await capa.tx.configuracion[operacion]?.({ where: {} });

        expect(valor).toBe(lectura);
        expect(falsa.eventos()).toEqual([`lectura:configuracion.${operacion}`]);
        expect(() => capa.exigirSana()).not.toThrow();
      },
    );

    it('criterio 158: $queryRaw y $executeRaw se entregan solos, sin sentencias de la capa, y devuelven su valor', async () => {
      const conPuntos = await cargarCapa();
      const filas = [{ usuario: 1 }];
      const falsa = crearTransaccionFalsa({
        'usuario:$queryRaw': { ok: filas },
        'usuario:$executeRaw': { ok: 7 },
      });
      const capa = conPuntos(falsa.tx);

      const consulta = await capa.tx.$queryRaw(
        Object.assign(['SELECT 1 AS usuario'], { raw: ['SELECT 1 AS usuario'] }),
      );
      const ejecucion = await capa.tx.$executeRaw(
        Object.assign(['UPDATE t SET usuario = 1'], { raw: ['UPDATE t SET usuario = 1'] }),
      );

      expect(consulta).toBe(filas);
      expect(ejecucion).toBe(7);
      expect(falsa.eventos()).toEqual(['usuario:$queryRaw', 'usuario:$executeRaw']);
      expect(() => capa.exigirSana()).not.toThrow();
    });

    it('criterio 158: una $queryRaw que rechaza no marca nada ni agrega sentencias: una sentencia cruda es atomica', async () => {
      const conPuntos = await cargarCapa();
      const error = errorDeBase('22012', 'division by zero');
      const falsa = crearTransaccionFalsa({ 'usuario:$queryRaw': { error } });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(
        capa.tx.$queryRaw(Object.assign(['SELECT 1/0 AS usuario'], { raw: ['SELECT 1/0 AS usuario'] })),
      );
      await vaciar();

      expect(destino().error).toBe(error);
      expect(falsa.eventos(), 'ni punto de guardado ni comprobacion').toEqual(['usuario:$queryRaw']);
      expect(() => capa.exigirSana()).not.toThrow();
    });

    it('criterio 158: sin ninguna escritura, exigirSana() no lanza', async () => {
      const conPuntos = await cargarCapa();
      const capa = conPuntos(crearTransaccionFalsa().tx);

      expect(() => capa.exigirSana()).not.toThrow();
    });
  });

  describe('criterio 158: ninguna sentencia de la capa sale antes de que se asiente la anterior', () => {
    it('criterio 158: en una escritura que resuelve, la escritura espera a crear el punto y liberarlo espera a la escritura', async () => {
      const conPuntos = await cargarCapa();
      const falsa = crearTransaccionFalsa({ crear: 'pendiente', escritura: 'pendiente', liberar: 'pendiente' });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(escribir(capa, 'update', { where: {}, data: {} }));
      await vaciar();
      expect(falsa.eventos(), 'solo crear el punto').toEqual(['crear']);

      falsa.entregas[0]?.resolver(0);
      await vaciar();
      expect(falsa.eventos(), 'asentado crear el punto, sale la escritura').toEqual(['crear', evento('update')]);

      falsa.entregas[1]?.resolver(FILA);
      await vaciar();
      expect(falsa.eventos(), 'asentada la escritura, sale liberar el punto').toEqual([
        'crear',
        evento('update'),
        'liberar',
      ]);
      expect(destino().asentada, 'la operacion no termina hasta liberar el punto').toBe(false);

      falsa.entregas[2]?.resolver(0);
      await vaciar();
      expect(destino()).toMatchObject({ asentada: true, resolvio: true, valor: FILA });
    });

    it('criterio 158: en una escritura que rechaza, la comprobacion espera a la escritura, volver al punto a la comprobacion y liberar a volver', async () => {
      const conPuntos = await cargarCapa();
      const error = errorSinSqlstate();
      const falsa = crearTransaccionFalsa({
        crear: 'pendiente',
        escritura: 'pendiente',
        comprobacion: 'pendiente',
        volver: 'pendiente',
        liberar: 'pendiente',
      });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(escribir(capa, 'update', { where: {}, data: {} }));
      await vaciar();
      falsa.entregas[0]?.resolver(0);
      await vaciar();
      expect(falsa.eventos()).toEqual(['crear', evento('update')]);

      falsa.entregas[1]?.rechazar(error);
      await vaciar();
      expect(falsa.eventos(), 'rechazada la escritura, sale la comprobacion').toEqual([
        'crear',
        evento('update'),
        'comprobacion',
      ]);

      falsa.entregas[2]?.resolver([{ sana: 1 }]);
      await vaciar();
      expect(falsa.eventos(), 'asentada la comprobacion, se vuelve al punto').toEqual([
        'crear',
        evento('update'),
        'comprobacion',
        'volver',
      ]);

      falsa.entregas[3]?.resolver(0);
      await vaciar();
      expect(falsa.eventos(), 'asentada la vuelta, se libera el punto').toEqual([
        'crear',
        evento('update'),
        'comprobacion',
        'volver',
        'liberar',
      ]);
      expect(destino().asentada, 'la operacion no termina hasta liberar el punto').toBe(false);

      falsa.entregas[4]?.resolver(0);
      await vaciar();
      expect(destino()).toMatchObject({ asentada: true, resolvio: false });
      expect(destino().error).toBe(error);
    });
  });

  describe('criterio 158: nombre del punto de guardado', () => {
    it('criterio 158: el nombre cumple ^aq_[0-9a-f]{32}$ y es el mismo en crear, volver y liberar dentro de una operacion', async () => {
      const conPuntos = await cargarCapa();
      const falsa = crearTransaccionFalsa({ escritura: { error: errorSinSqlstate() } });
      const capa = conPuntos(falsa.tx);

      const destino = seguir(escribir(capa, 'update', { where: {}, data: {} }));
      await vaciar();
      expect(destino().asentada).toBe(true);

      const nombres = falsa.entregas
        .filter((e) => ['crear', 'volver', 'liberar'].includes(e.evento))
        .map((e) => nombreDe(e.texto));
      expect(nombres, 'las tres sentencias nombran el punto').toHaveLength(3);
      for (const nombre of nombres) expect(nombre, 'formato del nombre').toMatch(/^aq_[0-9a-f]{32}$/);
      expect(new Set(nombres).size, 'el mismo punto en las tres').toBe(1);
    });

    it('criterio 158: dentro de una capa el nombre es el mismo en todas las escrituras', async () => {
      const conPuntos = await cargarCapa();
      const falsa = crearTransaccionFalsa();
      const capa = conPuntos(falsa.tx);

      await escribir(capa, 'create', { data: {} });
      await escribir(capa, 'update', { where: {}, data: {} });

      const nombres = falsa.entregas
        .filter((e) => ['crear', 'liberar'].includes(e.evento))
        .map((e) => nombreDe(e.texto));
      expect(nombres).toHaveLength(4);
      expect(new Set(nombres).size, 'un solo nombre por capa').toBe(1);
    });

    it('criterio 158: dos capas (dos transacciones) usan nombres distintos', async () => {
      const conPuntos = await cargarCapa();
      const nombresDeCapas: (string | undefined)[] = [];
      for (let i = 0; i < 5; i++) {
        const falsa = crearTransaccionFalsa();
        await escribir(conPuntos(falsa.tx), 'create', { data: {} });
        nombresDeCapas.push(nombreDe(falsa.entregas[0]?.texto ?? ''));
      }

      for (const nombre of nombresDeCapas) expect(nombre).toMatch(/^aq_[0-9a-f]{32}$/);
      expect(new Set(nombresDeCapas).size, 'cada capa tiene su propio nombre').toBe(5);
    });
  });
});
