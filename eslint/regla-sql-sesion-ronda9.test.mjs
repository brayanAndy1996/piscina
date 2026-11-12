// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterios 146 y 147 (ataque ronda 9; AMPLIAN la excepcion de cli/ de los criterios 98, 107, 121 y 122), parte de la regla de lint: en
// backend/src/cli/, la regla del criterio 83 admite ademas exactamente `set_config('client_encoding', 'UTF8', true)` (146),
// `set_config('synchronous_commit', 'on', true)`, `set_config('array_nulls', 'on', true)` y `set_config('transform_null_equals', 'off', true)`
// (147), con o sin `pg_catalog.` y sin distinguir mayusculas en el nombre de la variable (como en el criterio 98). Otro valor
// (`'LATIN1'`, `'SQL_ASCII'` y `'utf8'` para el primero; `'off'`, `'local'` y `'remote_apply'` para `synchronous_commit`; `'off'` para `array_nulls`;
// `'on'` para `transform_null_equals`) o un tercer argumento distinto de `true` sigue fallando, y fuera de cli/ y de infraestructura/prisma/ sigue
// prohibida toda llamada a `set_config`. Se prueba con las dos configuraciones, como el criterio 92 (`regla-sql-sesion-ronda5.test.mjs`).
//
// Nota: la especificacion (criterio 146) dice que `'utf8'` en minusculas "sigue fallando", mientras que la comparacion de los valores de los
// criterios 98, 107, 121 y 122 no distingue mayusculas (`set_config('bytea_output', 'HEX', true)` y `set_config('TimeZone', 'utc', true)` pasan hoy
// en cli/). Ese caso esta aparte, en su propia prueba, para que se vea que es una decision de la especificacion.
import { describe, expect, it } from 'vitest';
import { CLI, CONFIGURACIONES, MODULO, PRISMA, errores } from './ayuda-lint-ronda4.mjs';

const comoPlantilla = (sql) => `export const f = (cliente, valor) => cliente.$queryRaw\`${sql}\`;`;

const PRIMERA_SENTENCIA =
  "SELECT pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true), pg_catalog.set_config('standard_conforming_strings', 'on', true), pg_catalog.set_config('app.plataforma', ${p}, true), pg_catalog.set_config('app.academia_id', ${id}, true), pg_catalog.set_config('TimeZone', 'UTC', true), pg_catalog.set_config('DateStyle', 'ISO, MDY', true), pg_catalog.set_config('IntervalStyle', 'postgres', true), pg_catalog.set_config('extra_float_digits', '1', true), pg_catalog.set_config('bytea_output', 'hex', true), pg_catalog.set_config('client_encoding', 'UTF8', true), pg_catalog.set_config('synchronous_commit', 'on', true), pg_catalog.set_config('array_nulls', 'on', true), pg_catalog.set_config('transform_null_equals', 'off', true)";

describe.each(CONFIGURACIONES)('criterios 146 y 147 (regla) con %s', (_configuracion, obtener) => {
  describe('criterios 146 y 147: set_config de client_encoding, synchronous_commit, array_nulls y transform_null_equals solo se admite, exacto, en backend/src/cli/', () => {
    it.each([
      ['client_encoding (criterio 146)', "SELECT set_config('client_encoding', 'UTF8', true)"],
      ['client_encoding con pg_catalog.', "SELECT pg_catalog.set_config('client_encoding', 'UTF8', true)"],
      ['client_encoding con el nombre en mayusculas', "SELECT set_config('CLIENT_ENCODING', 'UTF8', true)"],
      ['client_encoding con el nombre mezclado', "SELECT set_config('Client_Encoding', 'UTF8', true)"],
      ['client_encoding con TRUE', "SELECT set_config('client_encoding', 'UTF8', TRUE)"],
      ['client_encoding con SET_CONFIG en mayusculas', "SELECT SET_CONFIG('client_encoding', 'UTF8', true)"],
      ['client_encoding con PG_CATALOG.SET_CONFIG', "SELECT PG_CATALOG.SET_CONFIG('client_encoding', 'UTF8', true)"],
      [
        'client_encoding con espacios alrededor de las comas',
        "SELECT set_config( 'client_encoding' ,  'UTF8' , true )",
      ],
      ['synchronous_commit (criterio 147)', "SELECT set_config('synchronous_commit', 'on', true)"],
      ['synchronous_commit con pg_catalog.', "SELECT pg_catalog.set_config('synchronous_commit', 'on', true)"],
      ['synchronous_commit con el nombre en mayusculas', "SELECT set_config('SYNCHRONOUS_COMMIT', 'on', true)"],
      ['array_nulls (criterio 147)', "SELECT set_config('array_nulls', 'on', true)"],
      ['array_nulls con pg_catalog.', "SELECT pg_catalog.set_config('array_nulls', 'on', true)"],
      ['array_nulls con el nombre en mayusculas', "SELECT set_config('ARRAY_NULLS', 'on', true)"],
      ['transform_null_equals (criterio 147)', "SELECT set_config('transform_null_equals', 'off', true)"],
      ['transform_null_equals con pg_catalog.', "SELECT pg_catalog.set_config('transform_null_equals', 'off', true)"],
      ['transform_null_equals con el nombre en mayusculas', "SELECT set_config('TRANSFORM_NULL_EQUALS', 'off', TRUE)"],
      [
        'las cuatro llamadas nuevas juntas, con pg_catalog.',
        "SELECT pg_catalog.set_config('client_encoding', 'UTF8', true), pg_catalog.set_config('synchronous_commit', 'on', true), pg_catalog.set_config('array_nulls', 'on', true), pg_catalog.set_config('transform_null_equals', 'off', true)",
      ],
      [
        'la primera sentencia completa de enPlataforma y BaseDatos con las cuatro llamadas nuevas (plan, seccion 21)',
        PRIMERA_SENTENCIA,
      ],
    ])('criterios 146 y 147: %s pasa el lint en cli/ y en prisma/, y falla en un modulo', async (_nombre, sql) => {
      const eslint = obtener();
      expect(await errores(eslint, comoPlantilla(sql), CLI), `cli/: ${sql}`).toEqual([]);
      expect(await errores(eslint, comoPlantilla(sql), PRISMA), `prisma/: ${sql}`).toEqual([]);
      expect((await errores(eslint, comoPlantilla(sql), MODULO)).length, `modulo: ${sql}`).toBeGreaterThan(0);
    });

    it.each([
      ['client_encoding con LATIN1', "SELECT set_config('client_encoding', 'LATIN1', true)"],
      ['client_encoding con SQL_ASCII', "SELECT set_config('client_encoding', 'SQL_ASCII', true)"],
      ['client_encoding con UTF-8', "SELECT set_config('client_encoding', 'UTF-8', true)"],
      ['client_encoding con WIN1252', "SELECT set_config('client_encoding', 'WIN1252', true)"],
      ['client_encoding con LATIN1 y pg_catalog.', "SELECT pg_catalog.set_config('client_encoding', 'LATIN1', true)"],
      ['client_encoding con UTF8 y false', "SELECT set_config('client_encoding', 'UTF8', false)"],
      [
        'client_encoding con UTF8, pg_catalog. y false',
        "SELECT pg_catalog.set_config('client_encoding', 'UTF8', false)",
      ],
      ['client_encoding con un valor interpolado', "SELECT set_config('client_encoding', ${codificacion}, true)"],
      ['client_encoding con un parametro', "SELECT set_config('client_encoding', $1, true)"],
      ['client_encoding con un tercer argumento interpolado', "SELECT set_config('client_encoding', 'UTF8', ${local})"],
      ['client_encoding con true escrito como 1', "SELECT set_config('client_encoding', 'UTF8', 1)"],
      ['client_encoding sin tercer argumento', "SELECT set_config('client_encoding', 'UTF8')"],
      ['client_encoding con un cuarto argumento', "SELECT set_config('client_encoding', 'UTF8', true, false)"],
      ['client_encoding con un espacio de mas en el valor', "SELECT set_config('client_encoding', ' UTF8', true)"],
      ['client_encoding con un espacio de mas en el nombre', "SELECT set_config('client_encoding ', 'UTF8', true)"],
      [
        'el nombre client_encoding armado con una concatenacion',
        "SELECT set_config('client_' || 'encoding', 'UTF8', true)",
      ],
      ['synchronous_commit en off', "SELECT set_config('synchronous_commit', 'off', true)"],
      ['synchronous_commit en local', "SELECT set_config('synchronous_commit', 'local', true)"],
      ['synchronous_commit en remote_apply', "SELECT set_config('synchronous_commit', 'remote_apply', true)"],
      ['synchronous_commit en remote_write', "SELECT set_config('synchronous_commit', 'remote_write', true)"],
      ['synchronous_commit en off con pg_catalog.', "SELECT pg_catalog.set_config('synchronous_commit', 'off', true)"],
      ['synchronous_commit en on y false', "SELECT set_config('synchronous_commit', 'on', false)"],
      [
        'synchronous_commit en on, pg_catalog. y false',
        "SELECT pg_catalog.set_config('synchronous_commit', 'on', false)",
      ],
      ['synchronous_commit con un valor interpolado', "SELECT set_config('synchronous_commit', ${valor}, true)"],
      ['synchronous_commit sin tercer argumento', "SELECT set_config('synchronous_commit', 'on')"],
      ['synchronous_commit con un cuarto argumento', "SELECT set_config('synchronous_commit', 'on', true, false)"],
      ['array_nulls en off', "SELECT set_config('array_nulls', 'off', true)"],
      ['array_nulls en off con pg_catalog.', "SELECT pg_catalog.set_config('array_nulls', 'off', true)"],
      ['array_nulls en on y false', "SELECT set_config('array_nulls', 'on', false)"],
      ['array_nulls en on, pg_catalog. y false', "SELECT pg_catalog.set_config('array_nulls', 'on', false)"],
      ['array_nulls con un valor interpolado', "SELECT set_config('array_nulls', ${valor}, true)"],
      ['array_nulls con true escrito como 1', "SELECT set_config('array_nulls', 'on', 1)"],
      ['transform_null_equals en on', "SELECT set_config('transform_null_equals', 'on', true)"],
      [
        'transform_null_equals en on con pg_catalog.',
        "SELECT pg_catalog.set_config('transform_null_equals', 'on', true)",
      ],
      ['transform_null_equals en off y false', "SELECT set_config('transform_null_equals', 'off', false)"],
      [
        'transform_null_equals en off, pg_catalog. y false',
        "SELECT pg_catalog.set_config('transform_null_equals', 'off', false)",
      ],
      ['transform_null_equals con un parametro', "SELECT set_config('transform_null_equals', $1, true)"],
      ['transform_null_equals sin tercer argumento', "SELECT set_config('transform_null_equals', 'off')"],
      [
        'la primera sentencia con client_encoding en LATIN1',
        PRIMERA_SENTENCIA.replace("'client_encoding', 'UTF8'", "'client_encoding', 'LATIN1'"),
      ],
      [
        'la primera sentencia con synchronous_commit en off',
        PRIMERA_SENTENCIA.replace("'synchronous_commit', 'on'", "'synchronous_commit', 'off'"),
      ],
      [
        'la primera sentencia con array_nulls en off',
        PRIMERA_SENTENCIA.replace("'array_nulls', 'on'", "'array_nulls', 'off'"),
      ],
      [
        'la primera sentencia con transform_null_equals en on',
        PRIMERA_SENTENCIA.replace("'transform_null_equals', 'off'", "'transform_null_equals', 'on'"),
      ],
      [
        'la primera sentencia con client_encoding y false',
        PRIMERA_SENTENCIA.replace("'client_encoding', 'UTF8', true", "'client_encoding', 'UTF8', false"),
      ],
    ])('criterios 146 y 147: %s sigue fallando el lint en cli/', async (_nombre, sql) => {
      expect((await errores(obtener(), comoPlantilla(sql), CLI)).length, sql).toBeGreaterThan(0);
    });

    it("criterio 146 (decision de la especificacion): client_encoding con 'utf8' en minusculas sigue fallando el lint en cli/", async () => {
      const sql = "SELECT set_config('client_encoding', 'utf8', true)";

      expect((await errores(obtener(), comoPlantilla(sql), CLI)).length, sql).toBeGreaterThan(0);
    });

    it('criterios 146 y 147: una sentencia con una llamada permitida y otra con un valor no permitido falla en cli/', async () => {
      const sql =
        "SELECT set_config('client_encoding', 'UTF8', true), set_config('synchronous_commit', 'off', true), set_config('array_nulls', 'on', true)";

      expect((await errores(obtener(), comoPlantilla(sql), CLI)).length).toBeGreaterThan(0);
    });

    it('criterios 146 y 147: una sentencia con las cuatro llamadas permitidas y otro parametro no permitido falla en cli/', async () => {
      const sql =
        "SELECT set_config('client_encoding', 'UTF8', true), set_config('synchronous_commit', 'on', true), set_config('array_nulls', 'on', true), set_config('transform_null_equals', 'off', true), set_config('statement_timeout', '0', true)";

      expect((await errores(obtener(), comoPlantilla(sql), CLI)).length).toBeGreaterThan(0);
    });
  });

  describe('criterios 146 y 147: fuera de cli/ y de infraestructura/prisma/ sigue prohibida toda llamada a set_config', () => {
    it.each([
      ['client_encoding', "SELECT set_config('client_encoding', 'UTF8', true)"],
      ['client_encoding con pg_catalog.', "SELECT pg_catalog.set_config('client_encoding', 'UTF8', true)"],
      ['synchronous_commit', "SELECT set_config('synchronous_commit', 'on', true)"],
      ['array_nulls', "SELECT set_config('array_nulls', 'on', true)"],
      ['transform_null_equals', "SELECT set_config('transform_null_equals', 'off', true)"],
      ['la primera sentencia completa', PRIMERA_SENTENCIA],
    ])('criterios 146 y 147: %s falla el lint en un modulo, en main.ts y en comun/', async (_nombre, sql) => {
      for (const archivo of [MODULO, 'backend/src/main.ts', 'backend/src/comun/ejemplo.ts']) {
        expect((await errores(obtener(), comoPlantilla(sql), archivo)).length, `${archivo}: ${sql}`).toBeGreaterThan(0);
      }
    });
  });

  describe('criterios 146 y 147: SET y RESET de esos parametros siguen prohibidos en cli/ (criterio 84)', () => {
    it.each([
      ['SET LOCAL client_encoding', "SET LOCAL client_encoding = 'UTF8'"],
      ['SET client_encoding TO', "SET client_encoding TO 'UTF8'"],
      ['SET LOCAL synchronous_commit', 'SET LOCAL synchronous_commit = on'],
      ['SET LOCAL array_nulls', 'SET LOCAL array_nulls = on'],
      ['SET LOCAL transform_null_equals', 'SET LOCAL transform_null_equals = off'],
      ['RESET client_encoding', 'RESET client_encoding'],
    ])('criterios 146 y 147: %s falla el lint en cli/', async (_nombre, sql) => {
      expect((await errores(obtener(), comoPlantilla(sql), CLI)).length, sql).toBeGreaterThan(0);
    });
  });
});
