// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase, urlAppPruebas } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import {
  intentar,
  obtenerBaseDatosRonda3,
  textoDelError,
  urlConOpciones,
  type BaseDatosRonda3,
} from '../../utilidades/ronda3';
import { problemasDePromesa } from '../../utilidades/ronda4';

// Criterio 106 (ataque ronda 4, F1; complementa los criterios 21, 72 y 100): el envoltorio solo entrega promesas nativas que
// corren dentro de la transaccion. Dada la API de pruebas, dentro de `trabajo` de `conAcademia` y de `comoPlataforma`:
//   - todo lo que devuelven `tx.cliente.$queryRaw`, `$executeRaw` y cada operacion de cada delegado es una promesa nativa
//     (`Object.getPrototypeOf(p) === Promise.prototype`, `Reflect.ownKeys(p)` vacio, `p.requestTransaction` undefined, `then`,
//     `catch` y `finally` de `Promise.prototype`);
//   - la consulta se envia al llamar la funcion (no espera a un `then`) y corre en la conexion y la transaccion de `trabajo`,
//     con su contexto;
//   - una funcion del envoltorio guardada y llamada cuando `trabajo` ya termino (con exito o con error) rechaza sin enviar nada.
// Integracion con DATABASE_POOL_MAX=2 (para que haya otra conexion en el pool) y DATABASE_URL_APP con `options` contaminadas
// (`-c app.academia_id=<A> -c app.plataforma=si -c TimeZone=Pacific/Kiritimati`, codificadas).

type Consulta = (partes: TemplateStringsArray, ...valores: unknown[]) => Promise<unknown>;
type Operacion = (argumentos?: object) => unknown;
interface ClienteAmplio {
  $queryRaw: Consulta;
  $executeRaw: Consulta;
  [modelo: string]: Consulta | Record<string, Operacion>;
}

const OPCIONES_CONTAMINADAS = (academiaId: string): string =>
  `-c app.academia_id=${academiaId} -c app.plataforma=si -c TimeZone=Pacific/Kiritimati`;

interface Sonda {
  pid: number;
  academia: string;
  configuraciones: number;
  academias_en_auditoria: number;
}

describe('criterio 106: el envoltorio solo entrega promesas nativas que corren dentro de la transaccion', () => {
  let app: NestExpressApplication | undefined;
  let baseDatos: BaseDatosRonda3;
  let datos: DatosDeAislamiento;

  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
    app = await crearAppDePruebas({
      nivelRegistro: 'silent',
      variables: {
        DATABASE_POOL_MAX: '2',
        DATABASE_URL_APP: urlConOpciones(urlAppPruebas(), OPCIONES_CONTAMINADAS(datos.A.id)),
      },
    });
    baseDatos = await obtenerBaseDatosRonda3(app);
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const cliente = (tx: { cliente: unknown }): ClienteAmplio => tx.cliente as ClienteAmplio;
  const sonda = (c: ClienteAmplio) => c.$queryRaw`SELECT pg_backend_pid()::int AS pid,
    current_setting('app.academia_id') AS academia,
    (SELECT count(*)::int FROM configuraciones) AS configuraciones,
    (SELECT count(DISTINCT academia_id)::int FROM auditoria) AS academias_en_auditoria`;

  /** Cantidad de filas de `configuraciones` de B cuya clave empieza por `p106_`, leida como dueno con `pg`. */
  async function filasDeLaPrueba(clave = 'p106_%'): Promise<string[]> {
    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT clave FROM configuraciones WHERE academia_id = $1::uuid AND clave LIKE $2 ORDER BY clave',
      [datos.B.id, clave],
      { academiaId: datos.B.id },
    );
    return rows.map((fila: { clave: string }) => fila.clave);
  }

  it('criterio 106 (premisa): la URL de la app deja la conexion con el contexto de A y la zona de Kiritimati', async () => {
    const url = urlConOpciones(urlAppPruebas(), OPCIONES_CONTAMINADAS(datos.A.id));
    const conexion = new pg.Client({ connectionString: url });
    await conexion.connect();
    try {
      const { rows } = await conexion.query(
        `SELECT current_setting('app.academia_id', true) AS academia, current_setting('app.plataforma', true) AS plataforma,
                current_setting('TimeZone') AS zona`,
      );

      expect(rows[0]).toEqual({ academia: datos.A.id, plataforma: 'si', zona: 'Pacific/Kiritimati' });
    } finally {
      await conexion.end();
    }
  });

  describe('criterio 106: todo lo que devuelve el envoltorio es una promesa nativa', () => {
    it('criterio 106: en conAcademia, $queryRaw, $executeRaw y cada operacion de cada delegado devuelven una Promise nativa', async () => {
      const fallas: string[] = [];
      const B = datos.B.id;
      const clave = (nombre: string) => ({ academiaId_clave: { academiaId: B, clave: nombre } });
      const nueva = (nombre: string) => ({ academiaId: B, clave: nombre, valor: {} });

      await baseDatos.conAcademia(B, async (tx) => {
        const c = cliente(tx);
        const configuracion = c['configuracion'] as Record<string, Operacion>;
        const academia = c['academia'] as Record<string, Operacion>;
        const operaciones: [string, () => unknown][] = [
          ['$queryRaw', () => c.$queryRaw`SELECT 1 AS n`],
          ['$executeRaw', () => c.$executeRaw`UPDATE configuraciones SET valor = valor WHERE false`],
          ['configuracion.findMany', () => configuracion['findMany']?.()],
          ['configuracion.findFirst', () => configuracion['findFirst']?.({})],
          ['configuracion.findFirstOrThrow', () => configuracion['findFirstOrThrow']?.({})],
          ['configuracion.findUnique', () => configuracion['findUnique']?.({ where: clave('clave_b_1') })],
          [
            'configuracion.findUniqueOrThrow',
            () => configuracion['findUniqueOrThrow']?.({ where: clave('clave_b_1') }),
          ],
          ['configuracion.count', () => configuracion['count']?.()],
          ['configuracion.aggregate', () => configuracion['aggregate']?.({ _count: true })],
          ['configuracion.groupBy', () => configuracion['groupBy']?.({ by: ['academiaId'], _count: true })],
          ['configuracion.create', () => configuracion['create']?.({ data: nueva('p106_create') })],
          ['configuracion.createMany', () => configuracion['createMany']?.({ data: [nueva('p106_many')] })],
          [
            'configuracion.createManyAndReturn',
            () => configuracion['createManyAndReturn']?.({ data: [nueva('p106_devuelta')] }),
          ],
          [
            'configuracion.update',
            () => configuracion['update']?.({ where: clave('clave_b_1'), data: { valor: { actualizado: true } } }),
          ],
          [
            'configuracion.updateMany',
            () => configuracion['updateMany']?.({ where: { clave: 'clave_b_2' }, data: { valor: { varios: true } } }),
          ],
          [
            'configuracion.updateManyAndReturn',
            () =>
              configuracion['updateManyAndReturn']?.({
                where: { clave: 'clave_b_3' },
                data: { valor: { devueltos: true } },
              }),
          ],
          [
            'configuracion.upsert',
            () =>
              configuracion['upsert']?.({
                where: clave('p106_upsert'),
                create: nueva('p106_upsert'),
                update: { valor: { otra: true } },
              }),
          ],
          // `delete` y `deleteMany` no estan aqui: aquagestion_app no tiene DELETE sobre `configuraciones` (criterios 19 y 102),
          // asi que fallarian con 42501 y abortarian la transaccion de todas las demas. Se prueban aparte, cada una en su propia
          // transaccion (siguiente prueba).
          ['academia.findMany', () => academia['findMany']?.()],
          ['academia.findUnique', () => academia['findUnique']?.({ where: { id: B } })],
        ];

        for (const [nombre, lanzar] of operaciones) {
          const promesa = lanzar();
          const problemas = problemasDePromesa(promesa);
          if (problemas.length > 0) fallas.push(`${nombre}: ${problemas.slice(0, 2).join('; ')}`);
          try {
            await (promesa as Promise<unknown>);
          } catch (error) {
            fallas.push(`${nombre}: lanzo ${error instanceof Error ? error.message.slice(0, 120) : 'un error'}`);
          }
        }
      });

      expect(fallas).toEqual([]);
    });

    it.each([
      ['configuracion.delete', 'delete'],
      ['configuracion.deleteMany', 'deleteMany'],
    ])(
      'criterio 106: %s existe y devuelve una Promise nativa; la base la rechaza con 42501 (sin DELETE, criterios 19 y 102) en su propia transaccion',
      async (_nombre, operacion) => {
        const B = datos.B.id;
        const argumentos =
          operacion === 'delete'
            ? { where: { academiaId_clave: { academiaId: B, clave: 'clave_b_1' } } }
            : { where: { clave: 'clave_b_1' } };
        let tipo: string | undefined;
        let problemas: string[] = [];
        let rechazo: unknown;

        // Siempre se lanza al final: aunque la base dejara borrar, la transaccion se revierte y no arrastra a otras pruebas.
        const final = await intentar(() =>
          baseDatos.conAcademia(B, async (tx) => {
            const configuracion = cliente(tx)['configuracion'] as Record<string, Operacion>;
            tipo = typeof configuracion[operacion];
            if (tipo !== 'function') return;
            const promesa = configuracion[operacion]?.(argumentos);
            problemas = problemasDePromesa(promesa);
            rechazo = await intentar(async () => {
              await (promesa as Promise<unknown>);
            });
            throw new Error('fin de la prueba: revertir');
          }),
        );

        expect(tipo, `configuracion.${operacion} no existe en el envoltorio`).toBe('function');
        expect(problemas).toEqual([]);
        expect(rechazo, `${operacion} debia rechazar: aquagestion_app no tiene DELETE`).toBeInstanceOf(Error);
        expect(textoDelError(rechazo)).toMatch(/42501|permission denied/i);
        expect((final as Error).message).toBe('fin de la prueba: revertir');
        const { rows } = await ejecutarComo(
          'propietario',
          "SELECT count(*)::int AS n FROM configuraciones WHERE clave = 'clave_b_1' AND academia_id = $1::uuid",
          [B],
          { academiaId: B },
        );
        expect(rows).toEqual([{ n: 1 }]);
      },
    );

    it('criterio 106: en comoPlataforma, $queryRaw, $executeRaw y las operaciones de lectura de los delegados devuelven una Promise nativa', async () => {
      const fallas: string[] = [];

      await baseDatos.comoPlataforma(async (tx) => {
        const c = cliente(tx);
        const academia = c['academia'] as Record<string, Operacion>;
        const configuracion = c['configuracion'] as Record<string, Operacion>;
        const operaciones: [string, () => unknown][] = [
          ['$queryRaw', () => c.$queryRaw`SELECT 1 AS n`],
          ['$executeRaw', () => c.$executeRaw`UPDATE configuraciones SET valor = valor WHERE false`],
          ['academia.findMany', () => academia['findMany']?.()],
          ['academia.findFirst', () => academia['findFirst']?.({})],
          ['academia.findUnique', () => academia['findUnique']?.({ where: { id: datos.A.id } })],
          ['academia.count', () => academia['count']?.()],
          ['academia.aggregate', () => academia['aggregate']?.({ _count: true })],
          ['academia.groupBy', () => academia['groupBy']?.({ by: ['estado'], _count: true })],
          ['configuracion.findMany', () => configuracion['findMany']?.()],
        ];
        for (const [nombre, lanzar] of operaciones) {
          const promesa = lanzar();
          const problemas = problemasDePromesa(promesa);
          if (problemas.length > 0) fallas.push(`${nombre}: ${problemas.slice(0, 2).join('; ')}`);
          await (promesa as Promise<unknown>);
        }
      });

      expect(fallas).toEqual([]);
    });

    it('criterio 106: p.requestTransaction no existe (el camino del ataque, requestTransaction({ kind: "batch" })) en ninguna forma', async () => {
      const tipos = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const c = cliente(tx);
        const configuracion = c['configuracion'] as Record<string, Operacion>;
        const formas = [
          c.$queryRaw`SELECT 1 AS n`,
          c.$executeRaw`UPDATE configuraciones SET valor = valor WHERE false`,
          configuracion['findMany']?.(),
          configuracion['count']?.(),
        ] as Record<string, unknown>[];
        const resultado = formas.map((promesa) => typeof promesa['requestTransaction']);
        await Promise.all(formas as unknown as Promise<unknown>[]);
        return resultado;
      });

      expect(tipos).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
    });

    it('criterio 106: la API fluida de relaciones (findUnique(...).relacion()) no existe en lo que devuelve un delegado', async () => {
      const resultado = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const configuracion = cliente(tx)['configuracion'] as Record<string, Operacion>;
        const promesa = configuracion['findUnique']?.({
          where: { academiaId_clave: { academiaId: datos.B.id, clave: 'clave_b_1' } },
        }) as Record<string, unknown>;
        const tipo = typeof promesa['academia'];
        await (promesa as unknown as Promise<unknown>);
        return tipo;
      });

      expect(resultado).toBe('undefined');
    });
  });

  describe('criterio 106: la consulta se envia al llamar y corre en la conexion y la transaccion de trabajo', () => {
    it('criterio 106: una escritura lanzada sin await ya se envio: la lectura siguiente la ve (no espera a un then)', async () => {
      const B = datos.B.id;

      const vistas = await baseDatos.conAcademia(B, async (tx) => {
        const c = cliente(tx);
        const insercion = c.$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor)
          VALUES (${B}::uuid, 'p106_sin_then', '{}'::jsonb)`;
        const filas =
          (await c.$queryRaw`SELECT count(*)::int AS n FROM configuraciones WHERE clave = 'p106_sin_then'`) as {
            n: number;
          }[];
        await insercion;
        return filas[0]?.n;
      });

      expect(vistas).toBe(1);
    });

    it('criterio 106: $queryRaw, $executeRaw, un delegado de lectura y otro de escritura ven el mismo pg_backend_pid y app.academia_id = B', async () => {
      const B = datos.B.id;

      const visto = await baseDatos.conAcademia(B, async (tx) => {
        const c = cliente(tx);
        const configuracion = c['configuracion'] as Record<string, Operacion>;
        const [primera] = (await sonda(c)) as Sonda[];
        const [porQueryRaw] = (await sonda(c)) as Sonda[];
        const escrita = await c.$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor)
          VALUES (${B}::uuid, 'p106_pid', jsonb_build_object('pid', pg_backend_pid(), 'academia', current_setting('app.academia_id')))`;
        const leidas = (await configuracion['findMany']?.()) as { academiaId: string; clave: string }[];
        await configuracion['create']?.({ data: { academiaId: B, clave: 'p106_delegado', valor: {} } });
        const [trasLaEscritura] = (await sonda(c)) as Sonda[];
        const delegado = (await configuracion['findMany']?.({ where: { clave: 'p106_delegado' } })) as unknown[];
        return { primera, porQueryRaw, escrita, leidas, trasLaEscritura, delegado: delegado.length };
      });

      expect(visto.escrita).toBe(1);
      expect(visto.porQueryRaw?.pid).toBe(visto.primera?.pid);
      expect(visto.trasLaEscritura?.pid).toBe(visto.primera?.pid);
      expect(visto.primera?.academia).toBe(B);
      expect(visto.porQueryRaw?.academia).toBe(B);
      // El delegado de lectura solo ve filas de B (RLS) y el de escritura quedo en la misma transaccion.
      expect(visto.leidas.length).toBe(datos.filas.configuracionesB + 1);
      expect(new Set(visto.leidas.map((fila) => fila.academiaId))).toEqual(new Set([B]));
      expect(visto.delegado).toBe(1);
      expect(visto.trasLaEscritura?.configuraciones).toBe(datos.filas.configuracionesB + 2);
      // La fila que guardo el $executeRaw (leida despues, como dueno) trae el pid y el contexto de la transaccion.
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT valor->>'pid' AS pid, valor->>'academia' AS academia FROM configuraciones WHERE clave = 'p106_pid'`,
        [],
        { academiaId: B },
      );
      expect(rows).toEqual([{ pid: String(visto.primera?.pid), academia: B }]);
    });

    it('criterio 106: 20 consultas lanzadas a la vez con Promise.all ven el mismo pid, app.academia_id = B y solo filas de B', async () => {
      const B = datos.B.id;

      const resultado = await baseDatos.conAcademia(B, async (tx) => {
        const c = cliente(tx);
        const configuracion = c['configuracion'] as Record<string, Operacion>;
        const [inicial] = (await sonda(c)) as Sonda[];
        const promesas = Array.from({ length: 20 }, () => sonda(c));
        const problemas = promesas.flatMap((promesa, i) =>
          problemasDePromesa(promesa)
            .slice(0, 1)
            .map((p) => `${i}: ${p}`),
        );
        const distintas = await Promise.all([
          ...promesas,
          configuracion['findMany']?.(),
          configuracion['count']?.(),
          c.$executeRaw`UPDATE configuraciones SET valor = valor WHERE false`,
        ]);
        return { inicial, problemas, distintas };
      });

      expect(resultado.problemas).toEqual([]);
      const sondas = resultado.distintas.slice(0, 20).map((filas) => (filas as Sonda[])[0]);
      expect(sondas).toHaveLength(20);
      for (const [i, fila] of sondas.entries()) {
        expect(fila?.pid, `consulta ${i}: pid`).toBe(resultado.inicial?.pid);
        expect(fila?.academia, `consulta ${i}: app.academia_id`).toBe(B);
        expect(fila?.configuraciones, `consulta ${i}: filas de configuraciones`).toBe(datos.filas.configuracionesB);
        expect(fila?.academias_en_auditoria, `consulta ${i}: academias en auditoria`).toBe(1);
      }
      const delegados = resultado.distintas.slice(20) as [{ academiaId: string }[], number, number];
      expect(new Set(delegados[0].map((fila) => fila.academiaId))).toEqual(new Set([B]));
      expect(delegados[1]).toBe(datos.filas.configuracionesB);
      expect(delegados[2]).toBe(0);
    });

    it('criterio 106: en comoPlataforma, 20 consultas a la vez ven el mismo pid, app.plataforma = si y app.academia_id vacio', async () => {
      const resultado = await baseDatos.comoPlataforma(async (tx) => {
        const c = cliente(tx);
        const leer = () =>
          c.$queryRaw`SELECT pg_backend_pid()::int AS pid, current_setting('app.plataforma') AS plataforma,
            current_setting('app.academia_id') AS academia, (SELECT count(*)::int FROM auditoria) AS auditoria`;
        const [inicial] = (await leer()) as { pid: number }[];
        const todas = await Promise.all(Array.from({ length: 20 }, leer));
        return { inicial, todas: todas.map((filas) => (filas as Record<string, unknown>[])[0]) };
      });

      for (const [i, fila] of resultado.todas.entries()) {
        expect(fila, `consulta ${i}`).toEqual({
          pid: resultado.inicial?.pid,
          plataforma: 'si',
          academia: '',
          auditoria: 0,
        });
      }
    });
  });

  describe('criterio 106: si trabajo falla, no queda ninguna escritura de ninguna forma', () => {
    it('criterio 106: trabajo escribe por $executeRaw, $queryRaw y los delegados y luego lanza: ninguna de esas filas queda', async () => {
      const B = datos.B.id;

      const error = await intentar(() =>
        baseDatos.conAcademia(B, async (tx) => {
          const c = cliente(tx);
          const configuracion = c['configuracion'] as Record<string, Operacion>;
          await c.$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${B}::uuid, 'p106_ejecutar', '{}'::jsonb)`;
          await c.$queryRaw`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${B}::uuid, 'p106_consultar', '{}'::jsonb) RETURNING clave`;
          await configuracion['create']?.({ data: { academiaId: B, clave: 'p106_delegado', valor: {} } });
          await configuracion['createMany']?.({ data: [{ academiaId: B, clave: 'p106_varias', valor: {} }] });
          await configuracion['upsert']?.({
            where: { academiaId_clave: { academiaId: B, clave: 'p106_upsert' } },
            create: { academiaId: B, clave: 'p106_upsert', valor: {} },
            update: {},
          });
          throw new Error('falla a proposito');
        }),
      );

      expect(error).toBeInstanceOf(Error);
      expect(await filasDeLaPrueba()).toEqual([]);
    });
  });

  describe('criterio 106: una funcion guardada y llamada despues de que trabajo termino rechaza sin enviar nada', () => {
    it('criterio 106: en comoPlataforma, un $queryRaw guardado y llamado despues rechaza y no devuelve filas (superadmins)', async () => {
      let guardada: Consulta | undefined;
      await baseDatos.comoPlataforma((tx) => {
        guardada = cliente(tx).$queryRaw;
        return Promise.resolve();
      });

      let filas: unknown;
      const error = await intentar(async () => {
        filas = await (guardada as Consulta)`SELECT clave_hash FROM superadmins`;
      });

      expect(error, 'la llamada despues de terminar trabajo debia rechazar').toBeInstanceOf(Error);
      expect(filas).toBeUndefined();
    });

    it('criterio 106: en comoPlataforma, un $queryRaw guardado y llamado despues rechaza con una lectura de la auditoria de A', async () => {
      let guardada: Consulta | undefined;
      await baseDatos.comoPlataforma((tx) => {
        guardada = cliente(tx).$queryRaw;
        return Promise.resolve();
      });
      const A = datos.A.id;

      let filas: unknown;
      const error = await intentar(async () => {
        filas = await (guardada as Consulta)`SELECT id FROM auditoria WHERE academia_id = ${A}::uuid`;
      });

      expect(error, 'la llamada despues de terminar trabajo debia rechazar').toBeInstanceOf(Error);
      expect(filas).toBeUndefined();
    });

    it('criterio 106: en comoPlataforma, un $executeRaw guardado y llamado despues no escribe nada', async () => {
      let guardada: Consulta | undefined;
      await baseDatos.comoPlataforma((tx) => {
        guardada = cliente(tx).$executeRaw;
        return Promise.resolve();
      });

      const error = await intentar(async () => {
        await (guardada as Consulta)`INSERT INTO auditoria_plataforma (id, fecha_hora, actor_tipo, accion, entidad)
          VALUES (gen_random_uuid(), now(), 'SISTEMA', 'P106_TARDE', 'prueba')`;
      });

      expect(error, 'la llamada despues de terminar trabajo debia rechazar').toBeInstanceOf(Error);
      const { rows } = await ejecutarComo(
        'propietario',
        "SELECT count(*)::int AS n FROM auditoria_plataforma WHERE accion = 'P106_TARDE'",
        [],
        { plataforma: true },
      );
      expect(rows).toEqual([{ n: 0 }]);
    });

    it('criterio 106: lo mismo cuando trabajo termino con un error', async () => {
      let guardada: Consulta | undefined;
      const fallo = await intentar(() =>
        baseDatos.comoPlataforma((tx) => {
          guardada = cliente(tx).$executeRaw;
          return Promise.reject(new Error('trabajo fallido'));
        }),
      );
      expect(fallo).toBeInstanceOf(Error);

      const error = await intentar(async () => {
        await (guardada as Consulta)`INSERT INTO auditoria_plataforma (id, fecha_hora, actor_tipo, accion, entidad)
          VALUES (gen_random_uuid(), now(), 'SISTEMA', 'P106_TARDE_ERROR', 'prueba')`;
      });

      expect(error, 'la llamada despues de terminar trabajo debia rechazar').toBeInstanceOf(Error);
      const { rows } = await ejecutarComo(
        'propietario',
        "SELECT count(*)::int AS n FROM auditoria_plataforma WHERE accion = 'P106_TARDE_ERROR'",
        [],
        { plataforma: true },
      );
      expect(rows).toEqual([{ n: 0 }]);
    });

    it('criterio 106: en conAcademia, un delegado guardado y llamado despues rechaza y no crea la fila (ni en B ni en A)', async () => {
      let crear: Operacion | undefined;
      let leerTodo: Operacion | undefined;
      await baseDatos.conAcademia(datos.B.id, (tx) => {
        const configuracion = cliente(tx)['configuracion'] as Record<string, Operacion>;
        crear = configuracion['create'];
        leerTodo = configuracion['findMany'];
        return Promise.resolve();
      });

      const errorDeEscritura = await intentar(async () => {
        await (crear as Operacion)({ data: { academiaId: datos.A.id, clave: 'p106_tarde_a', valor: {} } });
      });
      const errorDeEscrituraEnB = await intentar(async () => {
        await (crear as Operacion)({ data: { academiaId: datos.B.id, clave: 'p106_tarde_b', valor: {} } });
      });
      let leidas: unknown;
      const errorDeLectura = await intentar(async () => {
        leidas = await (leerTodo as Operacion)();
      });

      expect(errorDeEscritura, 'create despues de terminar debia rechazar').toBeInstanceOf(Error);
      expect(errorDeEscrituraEnB, 'create despues de terminar debia rechazar').toBeInstanceOf(Error);
      expect(errorDeLectura, 'findMany despues de terminar debia rechazar').toBeInstanceOf(Error);
      expect(leidas).toBeUndefined();
      expect(await filasDeLaPrueba('p106_tarde%')).toEqual([]);
      const { rows } = await ejecutarComo(
        'propietario',
        "SELECT count(*)::int AS n FROM configuraciones WHERE clave = 'p106_tarde_a'",
        [],
        { academiaId: datos.A.id },
      );
      expect(rows).toEqual([{ n: 0 }]);
    });
  });
});
