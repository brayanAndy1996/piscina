// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 93 (ataque ronda 3, F1 y F4; complementa el criterio 83): la normalizacion del texto SQL decodifica tambien
// `U&"..." UESCAPE 'x'` y `U&'...' UESCAPE 'x'` con el caracter de escape `x` en lugar de `\` (`x0041`, `x+000041` y `xx` para
// el propio caracter), sin distinguir mayusculas en `UESCAPE` y con espacios, saltos de linea o comentarios SQL entre la
// cadena, `UESCAPE` y su literal. Asi fallan `SELECT U&"set!005fconfig" UESCAPE '!'('app.plataforma', 'si', false)`,
// `SELECT U&"pg#005fterminate#005fbackend" UESCAPE '#'(1)` y `SET U&"app!002eplataforma" /* x */ uescape '!' TO 'si'`. Un
// `UESCAPE` cuyo literal no es un solo caracter valido para PostgreSQL (vacio, de mas de un caracter, un digito hexadecimal,
// `+`, `'`, `"` o un espacio) hace fallar el lint.
// Se prueba `normalizarSql` / `analizarSql` (eslint/regla-sql-sesion.mjs) y el lint con las dos configuraciones.
import { describe, expect, it } from 'vitest';
import { CONFIGURACIONES, MODULO, errores, esRechazadoFueraDePrisma, pasaElLint } from './ayuda-lint-ronda3.mjs';
import { analizarSql, normalizarSql } from './regla-sql-sesion.mjs';

describe('criterio 93: normalizarSql decodifica U&"..." y U&\'...\' con UESCAPE', () => {
  // La forma exacta de los espacios del texto normalizado no se fija: se compara con una expresion regular.
  it.each([
    ['identificador con escape !', `SELECT U&"set!005fconfig" UESCAPE '!'`, /^select set_config\s*$/],
    ['cadena con escape !', `SELECT U&'a!0062c' UESCAPE '!'`, /^select 'abc'\s*$/],
    ['escape de seis digitos (x+)', `SELECT U&'#+000041#+000042' UESCAPE '#'`, /^select 'ab'\s*$/],
    [
      'escape de seis digitos (x+) en un identificador',
      `SELECT U&"set#+00005fconfig" UESCAPE '#'`,
      /^select set_config\s*$/,
    ],
    ['el escape duplicado es el propio caracter', `SELECT U&'a##b' UESCAPE '#'`, /^select 'a#b'\s*$/],
    ['el escape ! duplicado es el propio caracter', `SELECT U&'a!!b' UESCAPE '!'`, /^select 'a!b'\s*$/],
    ['UESCAPE en minusculas', `SELECT U&'a!0062c' uescape '!'`, /^select 'abc'\s*$/],
    ['UESCAPE con mayusculas y minusculas mezcladas', `SELECT U&'a!0062c' UeScApE '!'`, /^select 'abc'\s*$/],
    [
      'espacios de mas entre la cadena, UESCAPE y su literal',
      `SELECT U&'a!0062c'   UESCAPE    '!'`,
      /^select 'abc'\s*$/,
    ],
    ['saltos de linea entre la cadena, UESCAPE y su literal', `SELECT U&'a!0062c'\nUESCAPE\n'!'`, /^select 'abc'\s*$/],
    ['comentario de bloque entre la cadena y UESCAPE', `SELECT U&'a!0062c' /* x */ UESCAPE '!'`, /^select 'abc'\s*$/],
    ['comentario de linea entre UESCAPE y su literal', `SELECT U&'a!0062c' UESCAPE -- x\n'!'`, /^select 'abc'\s*$/],
    ['comentarios en ambos huecos', `SELECT U&'a!0062c' /* uno */ UESCAPE /* dos */ '!'`, /^select 'abc'\s*$/],
  ])('%s', (_nombre, entrada, esperado) => {
    const normalizado = normalizarSql(entrada);

    expect(normalizado).not.toMatch(/uescape/);
    expect(normalizado).not.toMatch(/u&/);
    expect(normalizado).toMatch(esperado);
  });

  it('criterio 93: sin UESCAPE, el escape sigue siendo la barra invertida (criterio 83)', () => {
    expect(normalizarSql(String.raw`SELECT U&'\0061pp'`)).toBe("select 'app'");
  });

  it('criterio 93: con UESCAPE de otro caracter, la barra invertida pierde su valor de escape', () => {
    const normalizado = normalizarSql(String.raw`SELECT U&'a\0062c' UESCAPE '!'`);

    expect(normalizado).toContain('\\0062');
  });

  it('criterio 93: la palabra uescape dentro de un literal de datos no se toma por la clausula', () => {
    expect(normalizarSql("SELECT 'uescape' AS palabra")).toBe("select 'uescape' as palabra");
  });
});

describe('criterio 93: analizarSql ve la llamada que el UESCAPE escondia', () => {
  it.each([
    ['set_config con false', `SELECT U&"set!005fconfig" UESCAPE '!'('app.plataforma', 'si', false)`],
    ['set_config con U&"" y x+', `SELECT U&"set#+00005fconfig" UESCAPE '#'('app.plataforma', 'si', true)`],
  ])('criterio 93: %s se reconoce como una llamada a set_config', (_nombre, sql) => {
    expect(analizarSql(sql).setConfig).toBe(true);
  });

  it('criterio 93: set_config(false) con UESCAPE se reconoce como cambio de sesion', () => {
    const sql = `SELECT U&"set!005fconfig" UESCAPE '!'('app.plataforma', 'si', false)`;

    expect(analizarSql(sql).sesion).toBe(true);
  });

  it("criterio 93: SET U&\"app!002eplataforma\" /* x */ uescape '!' TO 'si' se reconoce como cambio de sesion", () => {
    const sql = `SET U&"app!002eplataforma" /* x */ uescape '!' TO 'si'`;

    expect(analizarSql(sql).sesion).toBe(true);
  });
});

describe.each(CONFIGURACIONES)('criterio 93 con %s', (_configuracion, obtener) => {
  const comoPlantilla = (sql) => `export const f = (cliente) => cliente.$queryRaw\`${sql}\`;`;

  it.each([
    ['set_config escrito con U&"" y UESCAPE', `SELECT U&"set!005fconfig" UESCAPE '!'('app.plataforma', 'si', false)`],
    ['pg_terminate_backend escrito con U&"" y UESCAPE', `SELECT U&"pg#005fterminate#005fbackend" UESCAPE '#'(1)`],
    ['SET de app.plataforma escrito con U&"" y UESCAPE', `SET U&"app!002eplataforma" /* x */ uescape '!' TO 'si'`],
    ['SET ROLE escrito con U&"" y UESCAPE', `SET U&"r!006fle" UESCAPE '!' TO postgres`],
    ['UESCAPE separado por saltos de linea', `SET U&"app!002eplataforma"\nUESCAPE\n'!' TO 'si'`],
    ['UESCAPE en mayusculas con x+ (seis digitos)', `SELECT U&"set#+00005fconfig" UESCAPE '#'('app.x', 'y', false)`],
  ])('criterio 93: %s falla el lint', async (_nombre, sql) => {
    await esRechazadoFueraDePrisma(obtener(), comoPlantilla(sql));
  });

  it.each([
    ['vacio', "''"],
    ['de mas de un caracter', "'ab'"],
    ['de mas de un caracter simbolico', "'!!'"],
    ['un digito hexadecimal', "'0'"],
    ['una letra hexadecimal en minuscula', "'a'"],
    ['una letra hexadecimal en mayuscula', "'F'"],
    ['el signo +', "'+'"],
    ['la comilla simple', "''''"],
    ['la comilla doble', `'"'`],
    ['un espacio', "' '"],
  ])('criterio 93: un UESCAPE %s falla el lint', async (_nombre, literal) => {
    await esRechazadoFueraDePrisma(obtener(), comoPlantilla(`SELECT U&'abc' UESCAPE ${literal}`));
  });

  it.each([
    ['el signo de exclamacion', "'!'"],
    ['la almohadilla', "'#'"],
    ['una letra que no es hexadecimal', "'x'"],
    ['una letra g', "'g'"],
    ['un signo de dolar', "'$'"],
  ])('criterio 93: un UESCAPE valido (%s) con SQL inocuo pasa el lint', async (_nombre, literal) => {
    await pasaElLint(obtener(), comoPlantilla(`SELECT U&'ab!0063' UESCAPE ${literal}`), [MODULO]);
  });

  it('criterio 93: un identificador U&"" con UESCAPE y SQL inocuo pasa el lint', async () => {
    const codigo = comoPlantilla(`SELECT U&"nombre!005fcorto" UESCAPE '!' FROM academias`);

    expect(await errores(obtener(), codigo, MODULO)).toEqual([]);
  });
});
