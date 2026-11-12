// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { conClienteComo, limpiarBase, urlAppPruebas } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { obtenerBaseDatosRonda3, urlConOpciones, type BaseDatosRonda3 } from '../../utilidades/ronda3';

// Criterio 147 (ataque ronda 9, O2; AMPLIA los criterios 107 y 122 y la excepcion de cli/ de los criterios 107 y 121; decision del orquestador sobre
// `synchronous_commit` y del especificador sobre los demas): `synchronous_commit` en `off` (o `local`) hace que PostgreSQL responda a la
// confirmacion antes de escribirla en el disco o en el servidor de replica sincrono; `array_nulls` en `off` hace que el elemento NULL de un arreglo
// escrito como texto se guarde como la cadena 'NULL'; `transform_null_equals` en `on` convierte `x = NULL` en `x IS NULL` (un UPDATE o DELETE con esa
// condicion tocaria filas); y los tres pueden llegar por `options` en la URL (que el criterio 143 permite), por la conexion, por la base, por
// `ALTER ROLE ALL` o por el servidor. Por eso toda transaccion de `BaseDatos` (con la de la comprobacion del rol) y de `enPlataforma` fija, local a
// la transaccion y en la misma primera sentencia, `synchronous_commit = 'on'`, `array_nulls = 'on'` y `transform_null_equals = 'off'`; dentro de
// `trabajo`, `current_setting` de cada uno da exactamente `on`, `on` y `off`.
//
// Prueba de integracion (como la del criterio 107), con la API de pruebas en `DATABASE_POOL_MAX=1` y una API nueva por via:
//   (a) un `trabajo` anterior en la misma conexion con `set_config('synchronous_commit', 'off', false)`, `set_config('array_nulls', 'off', false)` y
//       `set_config('transform_null_equals', 'on', false)`, confirmado;
//   (b) `DATABASE_URL_APP` con `options` `-c synchronous_commit=off -c array_nulls=off -c transform_null_equals=on` (codificado).
// En cada via, dentro de `trabajo` (`conAcademia` y `comoPlataforma`): `current_setting` de los tres da `on`, `on` y `off`;
// `SELECT ('{a,NULL}'::text[])[2] IS NULL AS es_nulo` devuelve `true`; y
// `SELECT count(*)::int AS n FROM (VALUES (NULL::int)) AS v(x) WHERE x = NULL` devuelve 0.
// La parte de los comandos (`enPlataforma`) esta en `backend/test/integracion/cli/contexto-comandos-ronda9.test.ts`.

const OPCIONES = '-c synchronous_commit=off -c array_nulls=off -c transform_null_equals=on';
const ESPERADOS = { synchronous_commit: 'on', array_nulls: 'on', transform_null_equals: 'off' };

interface Resultado {
  readonly parametros: { synchronous_commit: string; array_nulls: string; transform_null_equals: string };
  readonly esNulo: boolean;
  readonly filasConIgualANulo: number;
}

describe('criterio 147: premisas de la contaminacion (solo PostgreSQL)', () => {
  const LEER = `SELECT current_setting('synchronous_commit') AS synchronous_commit, current_setting('array_nulls') AS array_nulls,
    current_setting('transform_null_equals') AS transform_null_equals,
    ('{a,NULL}'::text[])[2] IS NULL AS es_nulo,
    (SELECT count(*)::int FROM (VALUES (NULL::int)) AS v(x) WHERE x = NULL) AS filas`;

  it('criterio 147 (premisa): set_config(..., false) deja los tres parametros contaminados: el elemento NULL no es nulo y x = NULL cuenta la fila', async () => {
    const visto = await conClienteComo('app', async (cliente) => {
      await cliente.query(
        `SELECT set_config('synchronous_commit', 'off', false), set_config('array_nulls', 'off', false),
                set_config('transform_null_equals', 'on', false)`,
      );
      return (await cliente.query(LEER)).rows[0] as Record<string, unknown>;
    });

    expect(visto).toEqual({
      synchronous_commit: 'off',
      array_nulls: 'off',
      transform_null_equals: 'on',
      es_nulo: false,
      filas: 1,
    });
  });

  it('criterio 147 (premisa): ?options=-c synchronous_commit=off -c array_nulls=off -c transform_null_equals=on deja esos valores en la sesion', async () => {
    const cliente = new pg.Client({ connectionString: urlConOpciones(urlAppPruebas(), OPCIONES) });
    await cliente.connect();
    try {
      const visto = (await cliente.query(LEER)).rows[0] as Record<string, unknown>;

      expect(visto).toEqual({
        synchronous_commit: 'off',
        array_nulls: 'off',
        transform_null_equals: 'on',
        es_nulo: false,
        filas: 1,
      });
    } finally {
      await cliente.end();
    }
  });
});

interface Via {
  readonly clave: 'sesion' | 'url';
  readonly titulo: string;
  readonly preparar: () => Promise<{ app: NestExpressApplication; base: BaseDatosRonda3 }>;
}

async function crearApi(url?: string): Promise<{ app: NestExpressApplication; base: BaseDatosRonda3 }> {
  const app = await crearAppDePruebas({
    nivelRegistro: 'silent',
    variables: { DATABASE_POOL_MAX: '1', ...(url ? { DATABASE_URL_APP: url } : {}) },
  });
  return { app, base: await obtenerBaseDatosRonda3(app) };
}

const VIAS: Via[] = [
  {
    clave: 'sesion',
    titulo:
      "(a) un trabajo anterior ejecuta set_config(..., false) con synchronous_commit 'off', array_nulls 'off' y transform_null_equals 'on' y confirma",
    async preparar() {
      const api = await crearApi();
      await api.base.comoPlataforma(async (tx) => {
        await tx.cliente.$queryRaw`SELECT set_config('synchronous_commit', 'off', false),
          set_config('array_nulls', 'off', false), set_config('transform_null_equals', 'on', false)`;
      });
      return api;
    },
  },
  {
    clave: 'url',
    titulo:
      '(b) DATABASE_URL_APP lleva ?options=-c synchronous_commit=off -c array_nulls=off -c transform_null_equals=on (codificado)',
    preparar: () => crearApi(urlConOpciones(urlAppPruebas(), OPCIONES)),
  },
];

describe.each(VIAS)('criterio 147: conexion contaminada $titulo', (via) => {
  let datos: DatosDeAislamiento;
  let api: { app: NestExpressApplication; base: BaseDatosRonda3 } | undefined;

  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
    api = await via.preparar();
  });
  afterEach(async () => {
    await api?.app.close().catch(() => undefined);
    api = undefined;
  });

  it('criterio 147: dentro de conAcademia, current_setting da on, on y off; el elemento NULL de un arreglo es nulo; y x = NULL no cuenta ninguna fila', async () => {
    const resultado = await (api as NonNullable<typeof api>).base.conAcademia(
      datos.B.id,
      async (tx): Promise<Resultado> => {
        const parametros = (
          await tx.cliente.$queryRaw<
            Resultado['parametros'][]
          >`SELECT current_setting('synchronous_commit') AS synchronous_commit,
          current_setting('array_nulls') AS array_nulls, current_setting('transform_null_equals') AS transform_null_equals`
        )[0] as Resultado['parametros'];
        const arreglo = await tx.cliente.$queryRaw<
          { es_nulo: boolean }[]
        >`SELECT ('{a,NULL}'::text[])[2] IS NULL AS es_nulo`;
        const igual = await tx.cliente.$queryRaw<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM (VALUES (NULL::int)) AS v(x) WHERE x = NULL`;
        return { parametros, esNulo: arreglo[0]?.es_nulo as boolean, filasConIgualANulo: Number(igual[0]?.n) };
      },
    );

    expect(resultado.parametros).toEqual(ESPERADOS);
    expect(resultado.esNulo, "('{a,NULL}'::text[])[2] IS NULL").toBe(true);
    expect(resultado.filasConIgualANulo, 'WHERE x = NULL').toBe(0);
  });

  it('criterio 147: dentro de comoPlataforma, current_setting da on, on y off; el elemento NULL de un arreglo es nulo; y x = NULL no cuenta ninguna fila', async () => {
    const resultado = await (api as NonNullable<typeof api>).base.comoPlataforma(async (tx): Promise<Resultado> => {
      const parametros = (
        await tx.cliente.$queryRaw<
          Resultado['parametros'][]
        >`SELECT current_setting('synchronous_commit') AS synchronous_commit,
          current_setting('array_nulls') AS array_nulls, current_setting('transform_null_equals') AS transform_null_equals`
      )[0] as Resultado['parametros'];
      const arreglo = await tx.cliente.$queryRaw<
        { es_nulo: boolean }[]
      >`SELECT ('{a,NULL}'::text[])[2] IS NULL AS es_nulo`;
      const igual = await tx.cliente.$queryRaw<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM (VALUES (NULL::int)) AS v(x) WHERE x = NULL`;
      return { parametros, esNulo: arreglo[0]?.es_nulo as boolean, filasConIgualANulo: Number(igual[0]?.n) };
    });

    expect(resultado.parametros).toEqual(ESPERADOS);
    expect(resultado.esNulo, "('{a,NULL}'::text[])[2] IS NULL").toBe(true);
    expect(resultado.filasConIgualANulo, 'WHERE x = NULL').toBe(0);
  });

  it('criterio 147: resolverAcademia responde bien con la conexion contaminada y la operacion siguiente ve on, on y off', async () => {
    const resuelta = await (api as NonNullable<typeof api>).base.resolverAcademia(datos.A.nombreCorto);

    expect(resuelta?.id).toBe(datos.A.id);
    // Una transaccion siguiente (otra operacion de la misma conexion) tambien ve los valores fijados.
    const parametros = await (api as NonNullable<typeof api>).base.comoPlataforma(async (tx) => {
      const filas = await tx.cliente.$queryRaw<
        { valor: string }[]
      >`SELECT current_setting('synchronous_commit') || '|' || current_setting('array_nulls') || '|' || current_setting('transform_null_equals') AS valor`;
      return filas[0]?.valor;
    });
    expect(parametros).toBe('on|on|off');
  });
});
