// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 107 (ataque ronda 4, F2; amplia la excepcion de cli/ del criterio 98), parte de la regla de lint: en backend/src/cli/,
// la regla del criterio 83 admite ademas exactamente `set_config('DateStyle', 'ISO, MDY', true)`,
// `set_config('IntervalStyle', 'postgres', true)`, `set_config('extra_float_digits', '1', true)` y
// `set_config('bytea_output', 'hex', true)` (sin distinguir mayusculas, como en el criterio 98); cualquier otro valor o un tercer
// argumento distinto de `true` sigue fallando, y fuera de cli/ y de infraestructura/prisma/ sigue prohibida toda llamada a
// `set_config`. Se prueba con las dos configuraciones, como el criterio 98.
import { describe, expect, it } from 'vitest';
import { CLI, CONFIGURACIONES, MODULO, PRISMA, errores } from './ayuda-lint-ronda4.mjs';

const comoPlantilla = (sql) => `export const f = (cliente, valor) => cliente.$queryRaw\`${sql}\`;`;

const CONTEXTO_COMPLETO =
  "SELECT set_config('app.plataforma', 'si', true), set_config('app.academia_id', '', true), set_config('TimeZone', 'UTC', true), set_config('DateStyle', 'ISO, MDY', true), set_config('IntervalStyle', 'postgres', true), set_config('extra_float_digits', '1', true), set_config('bytea_output', 'hex', true)";

describe.each(CONFIGURACIONES)('criterio 107 (regla) con %s', (_configuracion, obtener) => {
  describe('criterio 107: set_config del formato de la sesion solo se admite, exacto, en backend/src/cli/', () => {
    it.each([
      ['DateStyle', "SELECT set_config('DateStyle', 'ISO, MDY', true)"],
      ['IntervalStyle', "SELECT set_config('IntervalStyle', 'postgres', true)"],
      ['extra_float_digits', "SELECT set_config('extra_float_digits', '1', true)"],
      ['bytea_output', "SELECT set_config('bytea_output', 'hex', true)"],
      ['DateStyle en minusculas', "SELECT set_config('datestyle', 'iso, mdy', true)"],
      ['DateStyle en mayusculas', "SELECT set_config('DATESTYLE', 'ISO, MDY', true)"],
      ['IntervalStyle en mayusculas', "SELECT set_config('INTERVALSTYLE', 'POSTGRES', true)"],
      ['bytea_output en mayusculas', "SELECT set_config('BYTEA_OUTPUT', 'HEX', true)"],
      ['EXTRA_FLOAT_DIGITS en mayusculas', "SELECT set_config('EXTRA_FLOAT_DIGITS', '1', true)"],
      ['TRUE en mayusculas', "SELECT set_config('DateStyle', 'ISO, MDY', TRUE)"],
      ['SET_CONFIG en mayusculas', "SELECT SET_CONFIG('DateStyle', 'ISO, MDY', true)"],
      ['con espacios alrededor de las comas', "SELECT set_config( 'DateStyle' ,  'ISO, MDY' , true )"],
      [
        'la sentencia completa de enPlataforma y BaseDatos (cuatro parametros mas el contexto y TimeZone)',
        CONTEXTO_COMPLETO,
      ],
      [
        'los cuatro parametros con el contexto interpolado',
        "SELECT set_config('app.plataforma', ${plataforma}, true), set_config('app.academia_id', ${academia}, true), set_config('TimeZone', 'UTC', true), set_config('DateStyle', 'ISO, MDY', true), set_config('IntervalStyle', 'postgres', true), set_config('extra_float_digits', '1', true), set_config('bytea_output', 'hex', true)",
      ],
    ])('criterio 107: %s pasa el lint en cli/ y en prisma/, y falla en un modulo', async (_nombre, sql) => {
      const eslint = obtener();
      expect(await errores(eslint, comoPlantilla(sql), CLI), `cli/: ${sql}`).toEqual([]);
      expect(await errores(eslint, comoPlantilla(sql), PRISMA), `prisma/: ${sql}`).toEqual([]);
      expect((await errores(eslint, comoPlantilla(sql), MODULO)).length, `modulo: ${sql}`).toBeGreaterThan(0);
    });

    it.each([
      ['DateStyle con otro valor (ISO, DMY)', "SELECT set_config('DateStyle', 'ISO, DMY', true)"],
      ['DateStyle con German', "SELECT set_config('DateStyle', 'German', true)"],
      ['DateStyle con SQL, DMY', "SELECT set_config('DateStyle', 'SQL, DMY', true)"],
      ['DateStyle con ISO solamente', "SELECT set_config('DateStyle', 'ISO', true)"],
      ['IntervalStyle con iso_8601', "SELECT set_config('IntervalStyle', 'iso_8601', true)"],
      ['IntervalStyle con sql_standard', "SELECT set_config('IntervalStyle', 'sql_standard', true)"],
      ['extra_float_digits con -15', "SELECT set_config('extra_float_digits', '-15', true)"],
      ['extra_float_digits con 3', "SELECT set_config('extra_float_digits', '3', true)"],
      ['bytea_output con escape', "SELECT set_config('bytea_output', 'escape', true)"],
      ['DateStyle con false', "SELECT set_config('DateStyle', 'ISO, MDY', false)"],
      ['IntervalStyle con false', "SELECT set_config('IntervalStyle', 'postgres', false)"],
      ['extra_float_digits con false', "SELECT set_config('extra_float_digits', '1', false)"],
      ['bytea_output con false', "SELECT set_config('bytea_output', 'hex', false)"],
      ['DateStyle con un tercer argumento interpolado', "SELECT set_config('DateStyle', 'ISO, MDY', ${local})"],
      ['DateStyle con un valor interpolado', "SELECT set_config('DateStyle', ${valor}, true)"],
      ['DateStyle con un parametro', "SELECT set_config('DateStyle', $1, true)"],
      ['bytea_output con un valor interpolado', "SELECT set_config('bytea_output', ${valor}, true)"],
      ['DateStyle sin tercer argumento', "SELECT set_config('DateStyle', 'ISO, MDY')"],
      ['DateStyle con un cuarto argumento', "SELECT set_config('DateStyle', 'ISO, MDY', true, false)"],
      ['otra variable de formato (lc_time)', "SELECT set_config('lc_time', 'C', true)"],
      ['otra variable (standard_conforming_strings)', "SELECT set_config('standard_conforming_strings', 'on', true)"],
      ['otra variable (search_path)', "SELECT set_config('search_path', 'public', true)"],
      ['otra variable (statement_timeout)', "SELECT set_config('statement_timeout', '0', true)"],
      ['el nombre armado con una columna', "SELECT set_config(nombre, 'hex', true) FROM ajustes"],
      ['el nombre armado con una concatenacion', "SELECT set_config('bytea_' || 'output', 'hex', true)"],
      ['el nombre con un espacio de mas', "SELECT set_config('bytea_output ', 'hex', true)"],
      ['el valor con un espacio de mas', "SELECT set_config('bytea_output', ' hex', true)"],
      ['el valor con un espacio de menos en DateStyle', "SELECT set_config('DateStyle', 'ISO,MDY', true)"],
    ])('criterio 107: %s sigue fallando el lint en cli/', async (_nombre, sql) => {
      expect((await errores(obtener(), comoPlantilla(sql), CLI)).length, sql).toBeGreaterThan(0);
    });

    it('criterio 107: una sentencia con uno de los cuatro parametros permitidos y otro con un valor no permitido falla en cli/', async () => {
      const sql = "SELECT set_config('DateStyle', 'ISO, MDY', true), set_config('bytea_output', 'escape', true)";

      expect((await errores(obtener(), comoPlantilla(sql), CLI)).length).toBeGreaterThan(0);
    });
  });

  describe('criterio 107: fuera de cli/ y de infraestructura/prisma/ sigue prohibida toda llamada a set_config', () => {
    it.each([
      ['DateStyle', "SELECT set_config('DateStyle', 'ISO, MDY', true)"],
      ['IntervalStyle', "SELECT set_config('IntervalStyle', 'postgres', true)"],
      ['extra_float_digits', "SELECT set_config('extra_float_digits', '1', true)"],
      ['bytea_output', "SELECT set_config('bytea_output', 'hex', true)"],
      ['la sentencia completa', CONTEXTO_COMPLETO],
    ])('criterio 107: %s falla el lint en un modulo, en main.ts y en comun/', async (_nombre, sql) => {
      for (const archivo of [MODULO, 'backend/src/main.ts', 'backend/src/comun/ejemplo.ts']) {
        expect((await errores(obtener(), comoPlantilla(sql), archivo)).length, `${archivo}: ${sql}`).toBeGreaterThan(0);
      }
    });
  });
});
