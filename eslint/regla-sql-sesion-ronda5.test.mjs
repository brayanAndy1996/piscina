// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterios 121 y 122 (ataque ronda 5; amplian la excepcion de cli/ de los criterios 98 y 107), parte de la regla de lint: en
// backend/src/cli/, la regla del criterio 83 admite ademas exactamente `set_config('search_path', 'pg_catalog, public, pg_temp',
// true)` (121) y `set_config('standard_conforming_strings', 'on', true)` (122), sin distinguir mayusculas como en el criterio 98,
// y todas las llamadas que admite en cli/ (criterios 90, 98, 107, 121 y 122) pasan tambien con `pg_catalog.` delante; cualquier otro
// valor o un tercer argumento distinto de `true` sigue fallando, y fuera de cli/ y de infraestructura/prisma/ sigue prohibida toda
// llamada a `set_config`. Se prueba con las dos configuraciones, como el criterio 98 (`regla-sql-formato-cli.test.mjs`).
//
// Nota para la ronda 5: el ejemplo "otra variable (standard_conforming_strings)" de `regla-sql-formato-cli.test.mjs` esperaba que
// `set_config('standard_conforming_strings', 'on', true)` fallara en cli/; con el criterio 122 pasa. Lo adapta el test-writer en
// ese archivo (el mismo texto con 'on' se prueba aqui como ejemplo que pasa).
import { describe, expect, it } from 'vitest';
import { CLI, CONFIGURACIONES, MODULO, PRISMA, errores } from './ayuda-lint-ronda4.mjs';

const comoPlantilla = (sql) => `export const f = (cliente, valor) => cliente.$queryRaw\`${sql}\`;`;

const PRIMERA_SENTENCIA =
  "SELECT pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true), pg_catalog.set_config('standard_conforming_strings', 'on', true), pg_catalog.set_config('app.plataforma', ${p}, true), pg_catalog.set_config('app.academia_id', ${id}, true), pg_catalog.set_config('TimeZone', 'UTC', true), pg_catalog.set_config('DateStyle', 'ISO, MDY', true), pg_catalog.set_config('IntervalStyle', 'postgres', true), pg_catalog.set_config('extra_float_digits', '1', true), pg_catalog.set_config('bytea_output', 'hex', true)";

describe.each(CONFIGURACIONES)('criterios 121 y 122 (regla) con %s', (_configuracion, obtener) => {
  describe('criterios 121 y 122: set_config de search_path y standard_conforming_strings solo se admite, exacto, en backend/src/cli/', () => {
    it.each([
      ['search_path (criterio 121)', "SELECT set_config('search_path', 'pg_catalog, public, pg_temp', true)"],
      [
        'search_path con pg_catalog.',
        "SELECT pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true)",
      ],
      [
        'search_path en minusculas y mayusculas',
        "SELECT set_config('SEARCH_PATH', 'PG_CATALOG, PUBLIC, PG_TEMP', true)",
      ],
      ['search_path con TRUE', "SELECT set_config('search_path', 'pg_catalog, public, pg_temp', TRUE)"],
      [
        'search_path con SET_CONFIG en mayusculas',
        "SELECT SET_CONFIG('search_path', 'pg_catalog, public, pg_temp', true)",
      ],
      [
        'search_path con PG_CATALOG.SET_CONFIG',
        "SELECT PG_CATALOG.SET_CONFIG('search_path', 'pg_catalog, public, pg_temp', true)",
      ],
      [
        'search_path con espacios alrededor de las comas',
        "SELECT set_config( 'search_path' ,  'pg_catalog, public, pg_temp' , true )",
      ],
      ['standard_conforming_strings (criterio 122)', "SELECT set_config('standard_conforming_strings', 'on', true)"],
      [
        'standard_conforming_strings con pg_catalog.',
        "SELECT pg_catalog.set_config('standard_conforming_strings', 'on', true)",
      ],
      ['standard_conforming_strings en mayusculas', "SELECT set_config('STANDARD_CONFORMING_STRINGS', 'ON', TRUE)"],
      ['TimeZone con pg_catalog. (criterio 98)', "SELECT pg_catalog.set_config('TimeZone', 'UTC', true)"],
      ['DateStyle con pg_catalog. (criterio 107)', "SELECT pg_catalog.set_config('DateStyle', 'ISO, MDY', true)"],
      [
        'IntervalStyle con pg_catalog. (criterio 107)',
        "SELECT pg_catalog.set_config('IntervalStyle', 'postgres', true)",
      ],
      [
        'extra_float_digits con pg_catalog. (criterio 107)',
        "SELECT pg_catalog.set_config('extra_float_digits', '1', true)",
      ],
      ['bytea_output con pg_catalog. (criterio 107)', "SELECT pg_catalog.set_config('bytea_output', 'hex', true)"],
      [
        'app.plataforma con pg_catalog. (criterio 90)',
        "SELECT pg_catalog.set_config('app.plataforma', ${plataforma}, true)",
      ],
      ['app.academia_id con pg_catalog. (criterio 90)', "SELECT pg_catalog.set_config('app.academia_id', '', true)"],
      [
        'la primera sentencia completa de enPlataforma y BaseDatos, con pg_catalog.set_config en cada llamada (plan, seccion 17)',
        PRIMERA_SENTENCIA,
      ],
    ])('criterios 121 y 122: %s pasa el lint en cli/ y en prisma/, y falla en un modulo', async (_nombre, sql) => {
      const eslint = obtener();
      expect(await errores(eslint, comoPlantilla(sql), CLI), `cli/: ${sql}`).toEqual([]);
      expect(await errores(eslint, comoPlantilla(sql), PRISMA), `prisma/: ${sql}`).toEqual([]);
      expect((await errores(eslint, comoPlantilla(sql), MODULO)).length, `modulo: ${sql}`).toBeGreaterThan(0);
    });

    it.each([
      [
        'search_path con un valor que no es el fijo (trampa, public)',
        "SELECT set_config('search_path', 'trampa, public', true)",
      ],
      ['search_path = public', "SELECT set_config('search_path', 'public', true)"],
      ['search_path sin pg_temp', "SELECT set_config('search_path', 'pg_catalog, public', true)"],
      ['search_path con pg_temp primero', "SELECT set_config('search_path', 'pg_temp, pg_catalog, public', true)"],
      [
        'search_path sin espacios despues de las comas',
        "SELECT set_config('search_path', 'pg_catalog,public,pg_temp', true)",
      ],
      [
        'search_path con "$user" delante',
        "SELECT set_config('search_path', '\"$user\", pg_catalog, public, pg_temp', true)",
      ],
      [
        'search_path con false (ejemplo de la especificacion)',
        "SELECT set_config('search_path', 'pg_catalog, public, pg_temp', false)",
      ],
      ['search_path con un valor interpolado', "SELECT set_config('search_path', ${ruta}, true)"],
      ['search_path con un parametro', "SELECT set_config('search_path', $1, true)"],
      [
        'search_path con un tercer argumento interpolado',
        "SELECT set_config('search_path', 'pg_catalog, public, pg_temp', ${local})",
      ],
      ['search_path sin tercer argumento', "SELECT set_config('search_path', 'pg_catalog, public, pg_temp')"],
      [
        'search_path con un cuarto argumento',
        "SELECT set_config('search_path', 'pg_catalog, public, pg_temp', true, false)",
      ],
      [
        'search_path con pg_catalog. y otro valor',
        "SELECT pg_catalog.set_config('search_path', 'trampa, public', true)",
      ],
      [
        'search_path con pg_catalog. y false',
        "SELECT pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', false)",
      ],
      ['standard_conforming_strings en off', "SELECT set_config('standard_conforming_strings', 'off', true)"],
      [
        'standard_conforming_strings en off con pg_catalog.',
        "SELECT pg_catalog.set_config('standard_conforming_strings', 'off', true)",
      ],
      ['standard_conforming_strings con false', "SELECT set_config('standard_conforming_strings', 'on', false)"],
      [
        'standard_conforming_strings con pg_catalog. y false',
        "SELECT pg_catalog.set_config('standard_conforming_strings', 'on', false)",
      ],
      [
        'standard_conforming_strings con un valor interpolado',
        "SELECT set_config('standard_conforming_strings', ${valor}, true)",
      ],
      ['standard_conforming_strings con un parametro', "SELECT set_config('standard_conforming_strings', $1, true)"],
      [
        'standard_conforming_strings con true escrito como 1',
        "SELECT set_config('standard_conforming_strings', 'on', 1)",
      ],
      ['standard_conforming_strings sin tercer argumento', "SELECT set_config('standard_conforming_strings', 'on')"],
      [
        'standard_conforming_strings con un cuarto argumento',
        "SELECT set_config('standard_conforming_strings', 'on', true, false)",
      ],
      [
        'standard_conforming_strings con otro valor (true)',
        "SELECT set_config('standard_conforming_strings', 'true', true)",
      ],
      ['TimeZone con pg_catalog. y otra zona', "SELECT pg_catalog.set_config('TimeZone', 'America/Lima', true)"],
      ['DateStyle con pg_catalog. y otro valor', "SELECT pg_catalog.set_config('DateStyle', 'German', true)"],
      ['bytea_output con pg_catalog. y false', "SELECT pg_catalog.set_config('bytea_output', 'hex', false)"],
      [
        'otra variable con pg_catalog. (statement_timeout)',
        "SELECT pg_catalog.set_config('statement_timeout', '0', true)",
      ],
      ['otra variable con pg_catalog. (lc_time)', "SELECT pg_catalog.set_config('lc_time', 'C', true)"],
      [
        'la primera sentencia con un solo valor cambiado (standard_conforming_strings en off)',
        PRIMERA_SENTENCIA.replace("'standard_conforming_strings', 'on'", "'standard_conforming_strings', 'off'"),
      ],
      [
        'la primera sentencia con el search_path cambiado',
        PRIMERA_SENTENCIA.replace("'pg_catalog, public, pg_temp'", "'trampa, pg_catalog, public'"),
      ],
    ])('criterios 121 y 122: %s sigue fallando el lint en cli/', async (_nombre, sql) => {
      expect((await errores(obtener(), comoPlantilla(sql), CLI)).length, sql).toBeGreaterThan(0);
    });

    it('criterio 121: una sentencia con el search_path permitido y otro parametro no permitido falla en cli/', async () => {
      const sql =
        "SELECT set_config('search_path', 'pg_catalog, public, pg_temp', true), set_config('statement_timeout', '0', true)";

      expect((await errores(obtener(), comoPlantilla(sql), CLI)).length).toBeGreaterThan(0);
    });
  });

  describe('criterios 121 y 122: fuera de cli/ y de infraestructura/prisma/ sigue prohibida toda llamada a set_config', () => {
    it.each([
      ['search_path', "SELECT set_config('search_path', 'pg_catalog, public, pg_temp', true)"],
      [
        'search_path con pg_catalog.',
        "SELECT pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true)",
      ],
      ['standard_conforming_strings', "SELECT set_config('standard_conforming_strings', 'on', true)"],
      [
        'standard_conforming_strings con pg_catalog.',
        "SELECT pg_catalog.set_config('standard_conforming_strings', 'on', true)",
      ],
      ['la primera sentencia completa', PRIMERA_SENTENCIA],
    ])('criterios 121 y 122: %s falla el lint en un modulo, en main.ts y en comun/', async (_nombre, sql) => {
      for (const archivo of [MODULO, 'backend/src/main.ts', 'backend/src/comun/ejemplo.ts']) {
        expect((await errores(obtener(), comoPlantilla(sql), archivo)).length, `${archivo}: ${sql}`).toBeGreaterThan(0);
      }
    });
  });

  describe('criterios 121 y 122: SET y RESET de esos parametros siguen prohibidos en cli/ (criterio 84)', () => {
    it.each([
      ['SET search_path', 'SET search_path = pg_catalog, public, pg_temp'],
      ['SET LOCAL search_path', 'SET LOCAL search_path TO pg_catalog, public, pg_temp'],
      ['SET LOCAL standard_conforming_strings', 'SET LOCAL standard_conforming_strings = on'],
      ['RESET search_path', 'RESET search_path'],
    ])('criterios 121 y 122: %s falla el lint en cli/', async (_nombre, sql) => {
      expect((await errores(obtener(), comoPlantilla(sql), CLI)).length, sql).toBeGreaterThan(0);
    });
  });
});
