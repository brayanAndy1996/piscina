// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { conClienteComo, limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { obtenerAuditoria, uuidInexistente, type AuditoriaServicePrueba } from '../../utilidades/modulos';
import { esperarTransaccionAbortada, resultadoDe } from '../../utilidades/ronda10';
import {
  accionDe,
  claveDe,
  contarAuditoriaDeAcademia,
  contarAuditoriaDePlataforma,
  esperarConexionSana,
  ignorarP2025,
  leerAcademiasPorPrefijo,
  leerMotivoDeAcademia,
  leerValorDeConfiguracion,
  nada,
  nombreCortoDe,
  siguienteNumero,
  type DelegadosRonda11,
} from '../../utilidades/ronda11';
import { obtenerBaseDatosRonda3, type BaseDatosRonda3, type ClienteRonda3 } from '../../utilidades/ronda3';
import { cargarPuntoAutorizado } from '../../utilidades/ronda4';

// Criterio 153 (ataque ronda 11, F1; amplia los criterios 21, 26, 30 y 149): dentro de una transaccion interactiva, Prisma agrupa en un lote
// las consultas enviadas en el mismo turno (`Promise.all`, `map` con funciones `async`, `Promise.allSettled`) y, ante el primer error que no
// es de la base (un P2025 de `update` sobre una fila que no existe), deja de ejecutar el resto: sus promesas resolvian con `undefined` sin que
// la consulta llegara a la base, la transaccion seguia viva y `conAcademia` o `comoPlataforma` confirmaban y devolvian exito sin esas
// escrituras ni su auditoria. Ahora el envoltorio entrega las consultas a Prisma de una en una (cola serial): cada una recibe su propio
// resultado o su propio error.
//
// Los casos corren en `conAcademia(A, ...)` (filas de `configuraciones`; el registro con `registrarEnAcademia`) y en `comoPlataforma`
// (academias; el registro con `registrarEnPlataforma`). Lo escrito se lee como duenio con una conexion nueva. Casos:
//   1  una lista de `update` en la que una clave no existe (al principio, en medio y al final), con `Promise.all` y `map` con funciones
//      `async` que atrapan el P2025 (try/catch y `.then(ok, err)`), y despues el registro de auditoria: resuelve y todo queda escrito;
//   2  `Promise.allSettled([update inexistente, create, registro])`: el primero `rejected` con P2025, los otros `fulfilled`;
//   3  lo mismo mezclando un `update` inexistente, un `update` existente, un `create` y el registro, con `Promise.all` (P2025 atrapado
//      en su funcion) y con `Promise.allSettled`;
//   4  20 consultas `$queryRaw` a la vez: cada una con su indice, el mismo `pg_backend_pid()` y marcas de tiempo crecientes;
//   5  un error de la base en medio de `Promise.allSettled`: 22012 en el segundo, 25P02 en el tercero y la llamada rechaza con
//      `ErrorTransaccionAbortada` sin dejar nada;
//   6  control: un P2025 suelto atrapado con try/catch sigue confirmando todo lo demas;
//   7  `trabajo` que lanza con consultas sin `await` (en la cola): rechaza con ese error y no queda nada; ademas, las consultas que
//      seguian en la cola no se envian (sonda con el estado del generador de numeros aleatorios de la sesion, que no se revierte).
// Despues de cada caso, con `DATABASE_POOL_MAX=1`, un `conAcademia(B, ...)` en la misma conexion resuelve, lee su contexto y no ve nada.

type Contexto = 'conAcademia' | 'comoPlataforma';

const VALOR = 'valor-reconocible-r11';
const CONTEXTOS: readonly Contexto[] = ['conAcademia', 'comoPlataforma'];

/** Lo que `trabajo` puede hacer en cada contexto (las mismas operaciones, sobre `configuraciones` o sobre `academias`). */
interface Operaciones {
  readonly cliente: ClienteRonda3;
  /** `update` por identificador (clave o id de academia) que marca la fila con `marca`; rechaza con P2025 si no existe. */
  actualizar(id: string, marca: string): Promise<unknown>;
  /** `create` de una fila nueva `prueba_r11_<n><sufijo>` (o de la academia `prueba-r11-<n><sufijo>`). */
  crear(n: number, sufijo: string): Promise<unknown>;
  /** Registro de auditoria `PRUEBA_R11_<n>`. */
  auditar(n: number): Promise<void>;
}

interface Escenario {
  readonly contexto: Contexto;
  /** Dos identificadores que existen. */
  readonly existentes: readonly [string, string];
  /** Un identificador que no existe. */
  readonly inexistente: string;
  correr<T>(trabajo: (operaciones: Operaciones) => Promise<T>): Promise<T>;
  /** Marca que dejo `actualizar` en la fila (leida como duenio), o `undefined` si no la tiene. */
  leerMarca(id: string): Promise<string | undefined>;
  /** Si existe la fila (o academia) `prueba_r11_<n><sufijo>`. */
  existeCreada(n: number, sufijo: string): Promise<boolean>;
  /** Registros de auditoria `PRUEBA_R11_<n>`. */
  auditorias(n: number): Promise<number>;
}

let app: NestExpressApplication;
let base: BaseDatosRonda3;
let auditoria: AuditoriaServicePrueba;
let datos: DatosDeAislamiento;

const delegadosDe = (cliente: ClienteRonda3): DelegadosRonda11 => cliente as unknown as DelegadosRonda11;

function escenarioDe(contexto: Contexto): Escenario {
  if (contexto === 'conAcademia') {
    const academiaId = datos.A.id;
    return {
      contexto,
      existentes: ['clave_a_1', 'clave_a_2'],
      inexistente: 'clave_inexistente_r11',
      correr: (trabajo) =>
        base.conAcademia(academiaId, (tx) =>
          trabajo({
            cliente: tx.cliente,
            actualizar: (clave, marca) =>
              delegadosDe(tx.cliente).configuracion.update({
                where: { academiaId_clave: { academiaId: tx.academiaId, clave } },
                data: { valor: { marca } },
              }),
            crear: (n, sufijo) =>
              delegadosDe(tx.cliente).configuracion.create({
                data: { academiaId: tx.academiaId, clave: claveDe(n, sufijo), valor: { marca: 'nueva' } },
              }),
            auditar: (n) =>
              auditoria.registrarEnAcademia(tx, {
                actorTipo: 'SISTEMA',
                actorId: null,
                accion: accionDe(n),
                entidad: 'prueba',
                entidadId: null,
              }),
          }),
        ),
      leerMarca: async (clave) => {
        const valor = (await leerValorDeConfiguracion(academiaId, clave)) as { marca?: string } | undefined;
        return valor?.marca;
      },
      existeCreada: async (n, sufijo) => (await leerValorDeConfiguracion(academiaId, claveDe(n, sufijo))) !== undefined,
      auditorias: (n) => contarAuditoriaDeAcademia(academiaId, accionDe(n)),
    };
  }
  return {
    contexto,
    existentes: [datos.A.id, datos.B.id],
    inexistente: uuidInexistente(),
    correr: (trabajo) =>
      base.comoPlataforma((tx) =>
        trabajo({
          cliente: tx.cliente,
          actualizar: (id, marca) =>
            delegadosDe(tx.cliente).academia.update({ where: { id }, data: { motivoSuspension: marca } }),
          crear: (n, sufijo) =>
            delegadosDe(tx.cliente).academia.create({
              data: { nombre: `Academia R11 ${n}${sufijo}`, nombreCorto: nombreCortoDe(n, sufijo) },
            }),
          auditar: (n) =>
            auditoria.registrarEnPlataforma(tx, {
              actorTipo: 'SISTEMA',
              actorId: null,
              accion: accionDe(n),
              entidad: 'prueba',
              entidadId: null,
            }),
        }),
      ),
    leerMarca: async (id) => {
      return (await leerMotivoDeAcademia(id)) ?? undefined;
    },
    existeCreada: async (n, sufijo) => (await leerAcademiasPorPrefijo(nombreCortoDe(n, sufijo))).length > 0,
    auditorias: (n) => contarAuditoriaDePlataforma(accionDe(n)),
  };
}

/** Atrapa solo el P2025 con `.then(ok, err)` (la otra forma de la reproduccion 1). */
const conThenIgnorandoP2025 = (consulta: Promise<unknown>): Promise<void> =>
  consulta.then(
    () => undefined,
    (error: unknown) => {
      if ((error as { code?: unknown } | null)?.code !== 'P2025') throw error;
    },
  );

beforeAll(async () => {
  app = await crearAppDePruebas({ nivelRegistro: 'silent', variables: { DATABASE_POOL_MAX: '1' } });
  base = await obtenerBaseDatosRonda3(app);
  auditoria = await obtenerAuditoria(app);
});
beforeEach(async () => {
  await limpiarBase();
  datos = await crearDatosDeAislamiento();
});
afterAll(async () => {
  await app?.close();
});

describe.each(CONTEXTOS)('criterio 153: %s envia las consultas de una en una', (contexto) => {
  describe('criterio 153, caso 1: lista de update en la que una clave no existe', () => {
    const ORDENES = [
      { orden: 'la inexistente al principio', ubicar: (e: string[], x: string) => [x, ...e] },
      { orden: 'la inexistente en medio', ubicar: (e: string[], x: string) => [e[0] as string, x, e[1] as string] },
      { orden: 'la inexistente al final', ubicar: (e: string[], x: string) => [...e, x] },
    ];
    const FORMAS = [
      {
        forma: 'map con funciones async y try/catch',
        ignorar: async (consulta: Promise<unknown>) => ignorarP2025(consulta),
      },
      { forma: 'consulta.then(ok, err)', ignorar: (consulta: Promise<unknown>) => conThenIgnorandoP2025(consulta) },
    ];

    for (const { orden, ubicar } of ORDENES) {
      for (const { forma, ignorar } of FORMAS) {
        it(`criterio 153 (caso 1): ${contexto}, Promise.all con ${forma}, ${orden}: resuelve y las filas existentes y la auditoria quedan escritas`, async () => {
          const escenario = escenarioDe(contexto);
          const n = siguienteNumero();
          const marca = `marca-${n}`;
          const lista = ubicar([...escenario.existentes], escenario.inexistente);

          const resultado = await resultadoDe(() =>
            escenario.correr(async (op) => {
              await Promise.all(lista.map((id) => ignorar(op.actualizar(id, marca))));
              await op.auditar(n);
              return VALOR;
            }),
          );

          expect(resultado, 'debia resolver').toEqual({ resolvio: true, valor: VALOR });
          expect(await escenario.leerMarca(escenario.existentes[0]), 'primera fila existente').toBe(marca);
          expect(await escenario.leerMarca(escenario.existentes[1]), 'segunda fila existente').toBe(marca);
          expect(await escenario.auditorias(n), 'registro de auditoria').toBe(1);
          await esperarConexionSana(base, datos.B.id, `${contexto}, caso 1, ${forma}, ${orden}`);
        });
      }
    }

    it(`criterio 153 (caso 1): ${contexto}, la funcion async de cada elemento recibe su propio resultado: la lista de resultados tiene un valor por elemento`, async () => {
      const escenario = escenarioDe(contexto);
      const n = siguienteNumero();
      const [uno, dos] = escenario.existentes;

      const resultado = await resultadoDe(() =>
        escenario.correr(async (op) => {
          const salida = await Promise.all(
            [escenario.inexistente, uno, dos].map(async (id) => {
              try {
                return await op.actualizar(id, `marca-${n}`);
              } catch (error) {
                if ((error as { code?: unknown } | null)?.code !== 'P2025') throw error;
                return 'ignorado';
              }
            }),
          );
          return salida;
        }),
      );

      expect(resultado.resolvio, 'debia resolver').toBe(true);
      const salida = resultado.valor as unknown[];
      expect(salida[0]).toBe('ignorado');
      expect(salida[1], 'el update existente devuelve la fila, no undefined').toBeDefined();
      expect(salida[2], 'el update existente devuelve la fila, no undefined').toBeDefined();
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 1, resultados`);
    });
  });

  describe('criterio 153, caso 2: allSettled con un update inexistente, una escritura y la auditoria', () => {
    it(`criterio 153 (caso 2): ${contexto}, el primero queda rejected con P2025, los otros fulfilled; resuelve y la fila y el registro existen`, async () => {
      const escenario = escenarioDe(contexto);
      const n = siguienteNumero();
      let asentadas: PromiseSettledResult<unknown>[] = [];

      const resultado = await resultadoDe(() =>
        escenario.correr(async (op) => {
          asentadas = await Promise.allSettled([
            op.actualizar(escenario.inexistente, `marca-${n}`),
            op.crear(n, ''),
            op.auditar(n),
          ]);
          return VALOR;
        }),
      );

      expect(resultado, 'debia resolver').toEqual({ resolvio: true, valor: VALOR });
      expect(asentadas).toHaveLength(3);
      expect(asentadas[0]?.status, 'update inexistente').toBe('rejected');
      expect((asentadas[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'P2025' });
      expect(asentadas[1]?.status, 'create').toBe('fulfilled');
      expect((asentadas[1] as PromiseFulfilledResult<unknown>).value, 'el create devuelve la fila').not.toBeUndefined();
      expect(asentadas[2]?.status, 'registro de auditoria').toBe('fulfilled');
      expect(await escenario.existeCreada(n, ''), 'la fila nueva').toBe(true);
      expect(await escenario.auditorias(n), 'registro de auditoria').toBe(1);
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 2`);
    });
  });

  describe('criterio 153, caso 3: update inexistente, update existente, create y auditoria a la vez', () => {
    it(`criterio 153 (caso 3): ${contexto}, Promise.all con el P2025 atrapado en su funcion: resuelve y queda todo`, async () => {
      const escenario = escenarioDe(contexto);
      const n = siguienteNumero();
      const marca = `marca-${n}`;

      const resultado = await resultadoDe(() =>
        escenario.correr(async (op) => {
          await Promise.all([
            ignorarP2025(op.actualizar(escenario.inexistente, marca)),
            op.actualizar(escenario.existentes[1], marca),
            op.crear(n, ''),
            op.auditar(n),
          ]);
          return VALOR;
        }),
      );

      expect(resultado, 'debia resolver').toEqual({ resolvio: true, valor: VALOR });
      expect(await escenario.leerMarca(escenario.existentes[1]), 'el update existente').toBe(marca);
      expect(await escenario.existeCreada(n, ''), 'la fila o academia nueva').toBe(true);
      expect(await escenario.auditorias(n), 'registro de auditoria').toBe(1);
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 3, Promise.all`);
    });

    it(`criterio 153 (caso 3): ${contexto}, Promise.allSettled: el inexistente rejected con P2025 y los demas fulfilled con un valor; queda todo`, async () => {
      const escenario = escenarioDe(contexto);
      const n = siguienteNumero();
      const marca = `marca-${n}`;
      let asentadas: PromiseSettledResult<unknown>[] = [];

      const resultado = await resultadoDe(() =>
        escenario.correr(async (op) => {
          asentadas = await Promise.allSettled([
            op.actualizar(escenario.inexistente, marca),
            op.actualizar(escenario.existentes[1], marca),
            op.crear(n, ''),
            op.auditar(n),
          ]);
          return VALOR;
        }),
      );

      expect(resultado, 'debia resolver').toEqual({ resolvio: true, valor: VALOR });
      expect(asentadas.map((a) => a.status)).toEqual(['rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
      expect((asentadas[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'P2025' });
      expect(
        (asentadas[1] as PromiseFulfilledResult<unknown>).value,
        'el update existente devuelve la fila',
      ).not.toBeUndefined();
      expect((asentadas[2] as PromiseFulfilledResult<unknown>).value, 'el create devuelve la fila').not.toBeUndefined();
      expect(await escenario.leerMarca(escenario.existentes[1]), 'el update existente').toBe(marca);
      expect(await escenario.existeCreada(n, ''), 'la fila o academia nueva').toBe(true);
      expect(await escenario.auditorias(n), 'registro de auditoria').toBe(1);
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 3, allSettled`);
    });
  });

  describe('criterio 153, caso 4: cada consulta con lo suyo y en orden', () => {
    it(`criterio 153 (caso 4): ${contexto}, 20 consultas $queryRaw con Promise.all devuelven cada una su indice, el mismo pg_backend_pid() y marcas crecientes en el orden de las llamadas`, async () => {
      const escenario = escenarioDe(contexto);

      const resultado = await resultadoDe(() =>
        escenario.correr(async (op) => {
          const consultas = Array.from(
            { length: 20 },
            (_, indice) =>
              op.cliente.$queryRaw<
                { indice: number; pid: number; marca: string }[]
              >`SELECT ${indice}::int AS indice, pg_catalog.pg_backend_pid() AS pid,
                  (extract(epoch FROM pg_catalog.clock_timestamp()) * 1000000)::bigint::text AS marca`,
          );
          const filas = await Promise.all(consultas);
          const propio = await op.cliente.$queryRaw<{ pid: number }[]>`SELECT pg_catalog.pg_backend_pid() AS pid`;
          return { filas: filas.map((f) => f[0]), pidDeLaTransaccion: propio[0]?.pid };
        }),
      );

      expect(resultado.resolvio, 'debia resolver').toBe(true);
      const { filas, pidDeLaTransaccion } = resultado.valor as {
        filas: ({ indice: number; pid: number; marca: string } | undefined)[];
        pidDeLaTransaccion: number | undefined;
      };
      expect(filas).toHaveLength(20);
      expect(filas.map((f) => f?.indice)).toEqual(Array.from({ length: 20 }, (_, i) => i));
      expect(new Set(filas.map((f) => f?.pid)).size, 'todas en la misma conexion').toBe(1);
      expect(filas[0]?.pid).toBe(pidDeLaTransaccion);
      const marcas = filas.map((f) => BigInt(f?.marca ?? '0'));
      for (let i = 1; i < marcas.length; i++) {
        expect(marcas[i] as bigint, `la consulta ${i} corre despues de la ${i - 1}`).toBeGreaterThan(
          marcas[i - 1] as bigint,
        );
      }
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 4`);
    });
  });

  describe('criterio 153, caso 5: un error de la base en medio', () => {
    it(`criterio 153 (caso 5): ${contexto}, allSettled([create, SELECT 1/0, create]) atrapado: fulfilled, rejected 22012, rejected 25P02; la llamada rechaza con ErrorTransaccionAbortada y no queda nada`, async () => {
      const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
      const escenario = escenarioDe(contexto);
      const n = siguienteNumero();
      let asentadas: PromiseSettledResult<unknown>[] = [];

      const resultado = await resultadoDe(() =>
        escenario.correr(async (op) => {
          asentadas = await Promise.allSettled([
            op.crear(n, '-a'),
            op.cliente.$queryRaw`SELECT 1/0`,
            op.crear(n, '-b'),
          ]);
          return VALOR;
        }),
      );

      expect(asentadas.map((a) => a.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
      expect(codigoDeErrorDeBase((asentadas[1] as PromiseRejectedResult).reason), 'SELECT 1/0').toBe('22012');
      expect(codigoDeErrorDeBase((asentadas[2] as PromiseRejectedResult).reason), 'la siguiente a un error').toBe(
        '25P02',
      );
      await esperarTransaccionAbortada(resultado, `${contexto}, caso 5`);
      expect(await escenario.existeCreada(n, '-a'), 'la primera fila no queda').toBe(false);
      expect(await escenario.existeCreada(n, '-b'), 'la tercera fila no queda').toBe(false);
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 5`);
    });
  });

  describe('criterio 153, caso 6 (control): un P2025 suelto atrapado sigue confirmando', () => {
    it(`criterio 153 (caso 6, control): ${contexto}, try { await update inexistente } catch {}, una escritura y el registro: resuelve y quedan las dos filas`, async () => {
      const escenario = escenarioDe(contexto);
      const n = siguienteNumero();

      const resultado = await resultadoDe(() =>
        escenario.correr(async (op) => {
          try {
            await op.actualizar(escenario.inexistente, `marca-${n}`);
          } catch {
            // Atrapado a proposito: un P2025 no aborta la transaccion en PostgreSQL.
          }
          await op.crear(n, '');
          await op.auditar(n);
          return VALOR;
        }),
      );

      expect(resultado, 'debia resolver').toEqual({ resolvio: true, valor: VALOR });
      expect(await escenario.existeCreada(n, ''), 'la fila o academia nueva').toBe(true);
      expect(await escenario.auditorias(n), 'registro de auditoria').toBe(1);
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 6`);
    });
  });

  describe('criterio 153, caso 7: trabajo que lanza con consultas en la cola', () => {
    it(`criterio 153 (caso 7): ${contexto}, tres create sin await y un error propio: rechaza con ese error y no queda nada`, async () => {
      const escenario = escenarioDe(contexto);
      const n = siguienteNumero();
      const errorPropio = new Error('error propio de la ronda 11');

      const resultado = await resultadoDe(() =>
        escenario.correr((op) => {
          void op.crear(n, '-1').catch(nada);
          void op.crear(n, '-2').catch(nada);
          void op.crear(n, '-3').catch(nada);
          // Equivale a lanzar: `trabajo` rechaza con su propio error mientras las consultas siguen en la cola.
          return Promise.reject(errorPropio);
        }),
      );

      expect(resultado.resolvio, 'debia rechazar').toBe(false);
      expect(resultado.error, 'rechaza con el error de trabajo (criterio 22)').toBe(errorPropio);
      for (const sufijo of ['-1', '-2', '-3']) {
        expect(await escenario.existeCreada(n, sufijo), `la fila ${sufijo} no queda`).toBe(false);
      }
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 7`);
    });

    it(`criterio 153 (caso 7): ${contexto}, las consultas que seguian en la cola cuando trabajo lanzo no se envian a la base`, async () => {
      // Sonda: `setseed` fija el generador de numeros aleatorios de la sesion y su estado no se revierte con la transaccion. Con
      // `DATABASE_POOL_MAX=1` la transaccion siguiente usa la misma conexion: si alguna de las dos `random()` de la cola se hubiera
      // enviado, el primer `random()` de la transaccion siguiente no seria el primero de la secuencia de esa semilla.
      const SEMILLA = 0.25;
      const esperado = await conClienteComo('propietario', async (cliente) => {
        await cliente.query('SELECT setseed($1::float8)', [SEMILLA]);
        const { rows } = await cliente.query('SELECT random() AS r');
        return (rows[0] as { r: number }).r;
      });
      const escenario = escenarioDe(contexto);
      const errorPropio = new Error('error propio de la ronda 11 (sonda)');

      const resultado = await resultadoDe(() =>
        escenario.correr(async (op) => {
          await op.cliente.$executeRaw`SELECT pg_catalog.setseed(${SEMILLA}::float8)`;
          void op.cliente.$queryRaw`SELECT 1 AS uno FROM pg_catalog.pg_sleep(0.2)`.catch(nada);
          void op.cliente.$queryRaw`SELECT pg_catalog.random() AS r`.catch(nada);
          void op.cliente.$queryRaw`SELECT pg_catalog.random() AS r`.catch(nada);
          throw errorPropio;
        }),
      );

      expect(resultado.error, 'rechaza con el error de trabajo (criterio 22)').toBe(errorPropio);
      const siguiente = await base.conAcademia(datos.B.id, async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ r: number }[]>`SELECT pg_catalog.random() AS r`;
        return filas[0]?.r;
      });
      expect(
        siguiente,
        'ninguna consulta de la cola se envio: el generador sigue en el primer valor de la semilla',
      ).toBeCloseTo(esperado, 12);
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 7, sonda`);
    });
  });
});
