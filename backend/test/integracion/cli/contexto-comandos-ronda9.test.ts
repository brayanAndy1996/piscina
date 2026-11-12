// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearClienteDelDueno, enPlataforma } from '../../../src/cli/conexion';
import { limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, leerAcademias } from '../../utilidades/datos';
import { urlConOpciones } from '../../utilidades/ronda3';

// Criterios 146 y 147 (ataque ronda 9), parte de los comandos y la semilla: `enPlataforma` (backend/src/cli/conexion.ts) tambien fija, local a la
// transaccion y en su primera sentencia, `client_encoding = 'UTF8'` (146) y `synchronous_commit = 'on'`, `array_nulls = 'on'` y
// `transform_null_equals = 'off'` (147).
//   - 146: con `crearClienteDelDueno(<URL del duenio de pruebas>, { max: 1 })`, un `enPlataforma` que deja `client_encoding` en `LATIN1` con
//     `set_config(..., false)` y otro que escribe `Ñandú` en una fila de prueba (aqui, una academia de prueba con ese nombre): dentro del segundo,
//     `current_setting('client_encoding')` es `UTF8`, y leido como duenio con una conexion nueva, el texto es exactamente `Ñandú`.
//   - 147: con `crearClienteDelDueno` y `max: 1`, la via (a) en un `enPlataforma` anterior (`set_config(..., false)` de los tres) y, aparte, con la URL
//     del duenio con `options` `-c synchronous_commit=off -c array_nulls=off -c transform_null_equals=on` (via b), dentro de `enPlataforma`:
//     `current_setting` de los tres da `on`, `on` y `off`, `SELECT ('{a,NULL}'::text[])[2] IS NULL AS es_nulo` devuelve `true` y
//     `SELECT count(*)::int AS n FROM (VALUES (NULL::int)) AS v(x) WHERE x = NULL` devuelve 0.
// La regla de lint de cli/ para las cuatro llamadas esta en `eslint/regla-sql-sesion-ronda9.test.mjs`. La via (b) no aplica a `client_encoding`
// (`pg` envia `client_encoding=UTF8` al abrir la conexion y eso manda sobre `options`).

const NOMBRE = 'Ñandú';
const OPCIONES = '-c synchronous_commit=off -c array_nulls=off -c transform_null_equals=on';
const ESPERADOS = { synchronous_commit: 'on', array_nulls: 'on', transform_null_equals: 'off' };

type Cliente = ReturnType<typeof crearClienteDelDueno>;

describe('criterios 146 y 147: enPlataforma fija client_encoding y los parametros de integridad en los comandos y la semilla', () => {
  let cliente: Cliente | undefined;

  beforeEach(async () => {
    await limpiarBase();
    await crearDatosDeAislamiento();
  });
  afterEach(async () => {
    await cliente?.$disconnect();
    cliente = undefined;
  });

  /** Dentro de `enPlataforma`: los tres parametros, el elemento NULL de un arreglo y `x = NULL`. */
  async function leerIntegridad(c: Cliente) {
    return enPlataforma(c, async (tx) => {
      const parametros = (
        await tx.$queryRaw<
          { synchronous_commit: string; array_nulls: string; transform_null_equals: string }[]
        >`SELECT current_setting('synchronous_commit') AS synchronous_commit, current_setting('array_nulls') AS array_nulls,
          current_setting('transform_null_equals') AS transform_null_equals`
      )[0];
      const arreglo = await tx.$queryRaw<{ es_nulo: boolean }[]>`SELECT ('{a,NULL}'::text[])[2] IS NULL AS es_nulo`;
      const igual = await tx.$queryRaw<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM (VALUES (NULL::int)) AS v(x) WHERE x = NULL`;
      return { parametros, esNulo: arreglo[0]?.es_nulo, filas: Number(igual[0]?.n) };
    });
  }

  it('criterio 146: dentro de enPlataforma, current_setting(client_encoding) es UTF8 aunque un enPlataforma anterior lo dejo en LATIN1 en la misma conexion', async () => {
    cliente = crearClienteDelDueno(urlPropietarioPruebas(), { max: 1 });
    await enPlataforma(cliente, async (tx) => {
      await tx.$queryRaw`SELECT set_config('client_encoding', 'LATIN1', false)`;
    });

    const valor = await enPlataforma(cliente, async (tx) => {
      const filas = await tx.$queryRaw<{ valor: string }[]>`SELECT current_setting('client_encoding') AS valor`;
      return filas[0]?.valor;
    });

    expect(valor).toBe('UTF8');
  });

  it('criterio 146: un enPlataforma escribe una academia de prueba llamada Ñandú, despues de uno que dejo LATIN1, y leida con otra conexion el texto es exactamente Ñandú', async () => {
    cliente = crearClienteDelDueno(urlPropietarioPruebas(), { max: 1 });
    await enPlataforma(cliente, async (tx) => {
      await tx.$queryRaw`SELECT set_config('client_encoding', 'LATIN1', false)`;
    });

    const dentro = await enPlataforma(cliente, async (tx) => {
      await tx.$queryRaw`
        INSERT INTO academias (id, nombre, nombre_corto, estado, creada_en, actualizada_en)
        VALUES (gen_random_uuid(), ${NOMBRE}, 'nandu-comando-r9', 'ACTIVA', now(), now())`;
      const filas = await tx.$queryRaw<{ valor: string }[]>`SELECT current_setting('client_encoding') AS valor`;
      return filas[0]?.valor;
    });

    expect(dentro, 'current_setting(client_encoding) dentro del segundo enPlataforma').toBe('UTF8');
    const academia = (await leerAcademias()).find((fila) => fila.nombre_corto === 'nandu-comando-r9');
    expect(academia?.nombre).toBe(NOMBRE);
  });

  it('criterio 147 (via a): despues de un enPlataforma que deja los tres parametros contaminados, el siguiente da on, on y off, el elemento NULL es nulo y x = NULL no cuenta filas', async () => {
    cliente = crearClienteDelDueno(urlPropietarioPruebas(), { max: 1 });
    await enPlataforma(cliente, async (tx) => {
      await tx.$queryRaw`SELECT set_config('synchronous_commit', 'off', false), set_config('array_nulls', 'off', false),
        set_config('transform_null_equals', 'on', false)`;
    });

    const visto = await leerIntegridad(cliente);

    expect(visto.parametros).toEqual(ESPERADOS);
    expect(visto.esNulo, "('{a,NULL}'::text[])[2] IS NULL").toBe(true);
    expect(visto.filas, 'WHERE x = NULL').toBe(0);
  });

  it('criterio 147 (via b): con la URL del duenio con options synchronous_commit=off, array_nulls=off y transform_null_equals=on, dentro de enPlataforma da on, on y off, el elemento NULL es nulo y x = NULL no cuenta filas', async () => {
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), OPCIONES), { max: 1 });
    const antes = await cliente.$queryRaw<
      { synchronous_commit: string; array_nulls: string; transform_null_equals: string }[]
    >`SELECT current_setting('synchronous_commit') AS synchronous_commit, current_setting('array_nulls') AS array_nulls,
      current_setting('transform_null_equals') AS transform_null_equals`;
    expect(antes[0], 'premisa: la URL contaminada deja los valores en la sesion').toEqual({
      synchronous_commit: 'off',
      array_nulls: 'off',
      transform_null_equals: 'on',
    });

    const visto = await leerIntegridad(cliente);

    expect(visto.parametros).toEqual(ESPERADOS);
    expect(visto.esNulo, "('{a,NULL}'::text[])[2] IS NULL").toBe(true);
    expect(visto.filas, 'WHERE x = NULL').toBe(0);
  });
});
