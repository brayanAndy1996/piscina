// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { intentar, obtenerBaseDatosRonda3, Prisma, type BaseDatosRonda3 } from '../../utilidades/ronda3';

// Criterio 112 (ataque ronda 4, F6; ajusta el alcance del criterio 92), parte de integracion: en tiempo de ejecucion,
// `tx.cliente.$queryRaw` y `tx.cliente.$executeRaw` (precision P-26) aceptan solo (a) la forma de etiqueta, con un arreglo de
// cadenas con su `raw` (tambien arreglo de cadenas) de un elemento mas que los valores; o (b) un unico argumento que sea un
// fragmento del punto autorizado o un `Sql` creado por Prisma (`instanceof` de la clase de Prisma). Cualquier otro argumento,
// por ejemplo `{ text: 'SET ROLE postgres', values: [] }`, `{ sql: '...', values: [] }`, `{ strings: ['...'], values: [] }`, una
// cadena, o dos argumentos sin ser etiqueta, rechaza con `TypeError` sin enviar nada a la base. Dentro de `conAcademia`, cada
// objeto falso (uno de ellos con un INSERT en `configuraciones`) rechaza con `TypeError`, y aunque `trabajo` capture el error y
// termine bien, no queda ninguna fila (leido como dueno).

type Metodo = '$queryRaw' | '$executeRaw';
type Llamable = (...argumentos: unknown[]) => Promise<unknown>;

describe('criterio 112: $queryRaw y $executeRaw rechazan en ejecucion todo argumento que no sea una etiqueta o un fragmento', () => {
  let app: NestExpressApplication;
  let baseDatos: BaseDatosRonda3;
  let datos: DatosDeAislamiento;

  beforeAll(async () => {
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    baseDatos = await obtenerBaseDatosRonda3(app);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
  });

  const insercion = () =>
    `INSERT INTO configuraciones (academia_id, clave, valor) VALUES ('${datos.B.id}'::uuid, 'p112_objeto', '{}'::jsonb)`;

  /** Los argumentos que el envoltorio debe rechazar con TypeError: [descripcion, lo que se pasa como argumentos]. */
  const rechazados = (): [string, unknown[]][] => [
    ["{ text: 'SET ROLE postgres', values: [] }", [{ text: 'SET ROLE postgres', values: [] }]],
    ["{ sql: 'SET ROLE postgres', values: [] }", [{ sql: 'SET ROLE postgres', values: [] }]],
    ["{ strings: ['SET ROLE postgres'], values: [] }", [{ strings: ['SET ROLE postgres'], values: [] }]],
    ['{ text, sql y values } con un INSERT en configuraciones', [{ text: insercion(), sql: insercion(), values: [] }]],
    ['{ text } con un INSERT en configuraciones', [{ text: insercion(), values: [] }]],
    ['{ sql } con un INSERT en configuraciones', [{ sql: insercion(), values: [] }]],
    ['{ strings, values } con un INSERT en configuraciones', [{ strings: [insercion()], values: [] }]],
    ['una cadena con SET ROLE', ['SET ROLE postgres']],
    ['una cadena con un INSERT en configuraciones', [insercion()]],
    ['un arreglo de cadenas sin raw', [[insercion()]]],
    ['un arreglo con raw de otro largo', [Object.assign([insercion(), ''], { raw: [insercion()] })]],
    ['un arreglo cuyo raw no es un arreglo', [Object.assign([insercion()], { raw: insercion() })]],
    ['un arreglo con un elemento que no es cadena', [Object.assign([1], { raw: [insercion()] })]],
    ['un arreglo cuyo raw tiene un elemento que no es cadena', [Object.assign([insercion()], { raw: [1] })]],
    [
      'una etiqueta con mas partes que valores + 1',
      [Object.assign([insercion(), insercion()], { raw: ['a', 'b'] }), 1, 2],
    ],
    ['dos argumentos que no son etiqueta (Sql y Sql)', [Prisma.sql`SELECT 1`, Prisma.sql`SELECT 2`]],
    ['dos argumentos: un Sql y un valor', [Prisma.sql`SELECT 1`, 5]],
    ['null', [null]],
    ['undefined', [undefined]],
    ['un numero', [1]],
    ['sin argumentos', []],
    [
      'un objeto con prototipo nulo que imita un Sql',
      [Object.assign(Object.create(null) as object, { sql: insercion(), values: [] })],
    ],
    [
      'una clase propia que imita un Sql',
      [
        new (class FalsoSql {
          text = insercion();
          sql = insercion();
          values = [];
        })(),
      ],
    ],
  ];

  describe.each<Metodo>(['$queryRaw', '$executeRaw'])('%s', (metodo) => {
    it('criterio 112: cada argumento no admitido rechaza con TypeError, aunque trabajo capture el error y termine bien, y no queda ninguna fila', async () => {
      const resultados = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const llamar = (tx.cliente as unknown as Record<Metodo, Llamable>)[metodo].bind(tx.cliente);
        const vistos: Record<string, { tipo: string; mensaje: string }> = {};
        for (const [descripcion, argumentos] of rechazados()) {
          // `intentar` captura tanto el rechazo como un lanzamiento sincrono.
          const error = await intentar(async () => {
            await llamar(...argumentos);
          });
          vistos[descripcion] = {
            tipo: error instanceof TypeError ? 'TypeError' : error === undefined ? 'sin error' : 'otro error',
            mensaje: error instanceof Error ? error.message.slice(0, 80) : '',
          };
        }
        // Despues de todo, la transaccion sigue viva y con el rol de la app (nada la rompio ni cambio el rol).
        let rol: string | undefined;
        try {
          rol = (await tx.cliente.$queryRaw<{ rol: string }[]>`SELECT current_user::text AS rol`)[0]?.rol;
        } catch {
          rol = 'la transaccion quedo abortada';
        }
        return { vistos, rol };
      });

      const tipos = Object.fromEntries(Object.entries(resultados.vistos).map(([d, v]) => [d, v.tipo]));
      expect(tipos).toEqual(Object.fromEntries(rechazados().map(([d]) => [d, 'TypeError'])));
      expect(resultados.rol).toBe('aquagestion_app');
      const { rows } = await ejecutarComo(
        'propietario',
        "SELECT clave FROM configuraciones WHERE clave = 'p112_objeto'",
        [],
        { academiaId: datos.B.id },
      );
      expect(rows).toEqual([]);
    });

    it('criterio 112: un objeto falso con un INSERT en configuraciones rechaza con TypeError y no escribe nada (sin capturar el error)', async () => {
      const error = await intentar(() =>
        baseDatos.conAcademia(datos.B.id, async (tx) => {
          const llamar = (tx.cliente as unknown as Record<Metodo, Llamable>)[metodo].bind(tx.cliente);
          await llamar({ text: insercion(), sql: insercion(), values: [] });
        }),
      );

      expect(error).toBeInstanceOf(TypeError);
      const { rows } = await ejecutarComo(
        'propietario',
        "SELECT clave FROM configuraciones WHERE clave = 'p112_objeto'",
        [],
        { academiaId: datos.B.id },
      );
      expect(rows).toEqual([]);
    });

    it('criterio 112: el rechazo es inmediato: no envia nada a la base (un SET ROLE falso no cambia el rol de la transaccion)', async () => {
      const rol = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const llamar = (tx.cliente as unknown as Record<Metodo, Llamable>)[metodo].bind(tx.cliente);
        await intentar(async () => {
          await llamar({ text: 'SET ROLE postgres', values: [] });
        });
        return (await tx.cliente.$queryRaw<{ rol: string }[]>`SELECT current_user::text AS rol`)[0]?.rol;
      });

      expect(rol).toBe('aquagestion_app');
    });
  });

  describe('criterio 112: lo que sigue aceptando', () => {
    it('criterio 112: la forma de etiqueta, con y sin valores', async () => {
      const resultado = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const sinValores = await tx.cliente.$queryRaw<{ n: number }[]>`SELECT 1 AS n`;
        const conValores = await tx.cliente.$queryRaw<
          { n: number; t: string }[]
        >`SELECT ${5}::int AS n, ${'x'}::text AS t`;
        const escrita = await tx.cliente
          .$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${datos.B.id}::uuid, 'p112_etiqueta', '{}'::jsonb)`;
        return { sinValores, conValores, escrita };
      });

      expect(resultado.sinValores).toEqual([{ n: 1 }]);
      expect(resultado.conValores).toEqual([{ n: 5, t: 'x' }]);
      expect(resultado.escrita).toBe(1);
    });

    it('criterio 112: un unico argumento Sql creado por Prisma (instanceof de la clase de Prisma)', async () => {
      const resultado = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT ${7}::int AS n`);
        const escrita = await tx.cliente.$executeRaw(
          Prisma.sql`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${datos.B.id}::uuid, 'p112_sql', '{}'::jsonb)`,
        );
        return { filas, escrita };
      });

      expect(resultado).toEqual({ filas: [{ n: 7 }], escrita: 1 });
    });

    it('criterio 112: un valor que es un Sql de Prisma dentro de la forma de etiqueta se pasa tal cual', async () => {
      const filas = await baseDatos.conAcademia(
        datos.B.id,
        (tx) => tx.cliente.$queryRaw<{ n: number }[]>`SELECT ${Prisma.sql`${3}::int`} AS n`,
      );

      expect(filas).toEqual([{ n: 3 }]);
    });
  });
});
