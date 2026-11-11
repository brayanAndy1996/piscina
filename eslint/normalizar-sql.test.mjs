// Pruebas de `normalizarSql` y `analizarSql` (spec 001, criterios 83 y 84, plan sección 14). La regla de lint completa se
// prueba, con el eslint.config.mjs real, en regla-sql-sesion-ronda2.test.mjs; aquí se prueba la función de normalización.
import { describe, expect, it } from 'vitest';
import { analizarSql, normalizarSql } from './regla-sql-sesion.mjs';

describe('normalizarSql (criterio 83)', () => {
  it.each([
    ['quita comentarios de línea y de bloque', 'SELECT 1 -- nada\n/* otro */ FROM t', 'select 1 from t'],
    ['une las concatenaciones de literales', "SELECT 'ap' || 'p.plataforma'", "select 'app.plataforma'"],
    ['une tres literales', "SELECT 'a' || 'b' || 'c'", "select 'abc'"],
    ['convierte E, N y U& en cadenas simples', "SELECT E'a', N'b', U&'c'", "select 'a', 'b', 'c'"],
    ['decodifica los escapes de E', String.raw`SELECT E'\x61pp'`, "select 'app'"],
    ['decodifica los escapes de U&', String.raw`SELECT U&'\0061pp'`, "select 'app'"],
    ['convierte las cadenas de dólar', 'SELECT $$app.x$$, $etiqueta$y$etiqueta$', "select 'app.x', 'y'"],
    ['no toma $1 por una cadena de dólar', 'SELECT $1, $2', 'select $1, $2'],
    ['quita las comillas dobles de los identificadores', 'SET "app"."plataforma" = 1', 'set app.plataforma = 1'],
    ['quita U&"…"', 'SET U&"app.x" = 1', 'set app.x = 1'],
    ['quita los espacios alrededor del punto', "SET app\n .\n plataforma = 'si'", "set app.plataforma = 'si'"],
    ['no distingue mayúsculas', "Set Local APP.Plataforma = 'SI'", "set local app.plataforma = 'si'"],
    ['duplica la comilla simple dentro del literal', "SELECT 'it''s'", "select 'it''s'"],
  ])('%s', (_nombre, entrada, esperado) => {
    expect(normalizarSql(entrada)).toBe(esperado);
  });

  it('no cambia el contenido de un literal por los espacios alrededor de un punto', () => {
    expect(normalizarSql("SELECT 'a . b'")).toBe("select 'a . b'");
  });
});

describe('analizarSql (criterios 83 y 84)', () => {
  it.each([
    ["set_config('app.x', 'y', false)", "SELECT set_config('app.x', 'y', false)"],
    ['set_config con otro nombre', "SELECT set_config('search_path', 'public', true)"],
    ['DO con un COMMIT dentro', 'DO $$ BEGIN COMMIT; END $$'],
    ['SET LOCAL ROLE', 'SET LOCAL ROLE postgres'],
    ['RESET de una variable', 'RESET search_path'],
    ['COMMIT tras un punto y coma', 'SELECT 1; COMMIT'],
  ])('rechaza %s', (_nombre, sql) => {
    expect(analizarSql(sql).sesion).toBe(true);
  });

  it.each([
    ['un texto con reset en lenguaje natural', 'reset de la clave del usuario'],
    ['un literal de datos commit', "SELECT * FROM t WHERE a = 'commit'"],
    ['CASE ... END', 'SELECT CASE WHEN a THEN 1 ELSE 0 END FROM t'],
    ['UPDATE ... SET', 'UPDATE t SET a = 1'],
    ['set_config válido', "SELECT set_config('app.academia_id', $1, true)"],
  ])('no rechaza %s por sesión', (_nombre, sql) => {
    expect(analizarSql(sql).sesion).toBe(false);
  });

  it('informa de cualquier llamada a set_config, válida o no', () => {
    expect(analizarSql("SELECT set_config('app.x', 'y', true)").setConfig).toBe(true);
    expect(analizarSql('SELECT current_setting($1)').setConfig).toBe(false);
  });
});
