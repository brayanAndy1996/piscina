// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterios 83 y 84 (ataque ronda 2, F2, O4 y O5): ampliacion de la regla del SQL de sesion del criterio 73.
//  - 83: antes de aplicar las reglas, cada texto SQL se normaliza (sin comentarios; E'..', U&'..', N'..' y cadenas de
//    dolar como '..'; concatenaciones de literales unidas; sin comillas dobles en los identificadores; sin espacios
//    alrededor del punto; sin distinguir mayusculas). Con el texto normalizado, `npm run lint` falla fuera de
//    backend/src/infraestructura/prisma/ si hay SET/RESET de contexto (app.*, ROLE, SESSION AUTHORIZATION, ALL) o una
//    llamada a set_config con tercer argumento distinto de `true` o primer argumento que no es un literal simple 'app.*';
//    y fuera de prisma/ y de cli/ cualquier llamada a set_config.
//  - 84: fuera de backend/src/infraestructura/prisma/, tambien falla si el texto normalizado contiene ALTER
//    ROLE/USER/DATABASE/SYSTEM; como sentencia (al inicio o despues de `;`) COMMIT, END, ROLLBACK, ABORT, SAVEPOINT,
//    RELEASE, BEGIN, START TRANSACTION, y cualquier SET o RESET; CREATE [GLOBAL|LOCAL] TEMP[ORARY], INTO TEMP[ORARY],
//    DISCARD, UPDATE pg_settings, LISTEN, UNLISTEN, NOTIFY y pg_notify(.
//  - Un comentario eslint-disable (de linea, de bloque o de archivo, con o sin nombres de regla) no evita que el lint
//    falle por estas reglas ni por las del criterio 73.
// Se prueba con el eslint.config.mjs real, por su efecto observable (un error de ESLint), sin fijar el nombre de la regla
// y sin informacion de tipos (los archivos de los ejemplos no estan en disco).
//
// ADAPTADO A LA RONDA 3 DEL ATAQUE (criterios 92 y 96):
//  - 92: las reglas del SQL de sesion solo se aplican al texto de las plantillas etiquetadas con $queryRaw, $executeRaw,
//    Prisma.sql o sql. Los mismos textos SQL se siguen probando (deben fallar) dentro de esas plantillas; como cadena o plantilla
//    sin etiqueta pasan a probarse como ejemplos que pasan.
//  - 96: con eslint.config.mjs un comentario eslint-disable vuelve a apagar la regla que nombra; que ningun comentario evita el
//    fallo se comprueba con el paso protegido (eslint.protegido.config.mjs, sin comentarios en linea).
// Cada cambio de sentido lleva un comentario con el criterio que lo justifica.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { obtenerEslintProtegido } from './ayuda-lint-ronda3.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const eslint = new ESLint({
  cwd: raiz,
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

/** Mensajes de error de ESLint (severidad 2) que produce el codigo en el archivo indicado. */
async function errores(codigo, archivo) {
  const [resultado] = await eslint.lintText(codigo, { filePath: path.join(raiz, archivo) });
  const fatales = resultado.messages.filter((mensaje) => mensaje.fatal);
  expect(fatales, `error al analizar ${archivo}`).toEqual([]);
  return resultado.messages.filter((mensaje) => mensaje.severity === 2);
}

const MODULO = 'backend/src/modulos/ejemplo/ejemplo.service.ts';
const PRISMA = 'backend/src/infraestructura/prisma/base-datos.ts';
const CLI = 'backend/src/cli/superadmin.ts';

/**
 * Ejemplos de SQL en las formas de texto que la regla analiza (criterio 92): plantillas etiquetadas con $queryRaw,
 * $executeRaw, Prisma.sql y sql, con un ${} que la regla sustituye por un marcador.
 */
function enFormasAnalizadas(sql) {
  return [
    ['$queryRaw etiquetada', `export const leer = (cliente, id) => cliente.$queryRaw\`${sql} \${id}\`;`],
    ['$executeRaw etiquetada', `export const leer = (cliente, id) => cliente.$executeRaw\`${sql} \${id}\`;`],
    ['Prisma.sql etiquetada', `export const leer = (id) => Prisma.sql\`${sql} \${id}\`;`],
    ['sql etiquetada', `export const leer = (id) => sql\`${sql} \${id}\`;`],
  ];
}

/** (criterio 92) Formas que la regla ya NO analiza: cadena y plantilla sin etiqueta (con y sin ${}). */
function enFormasNoAnalizadas(sql) {
  return [
    ['cadena', `export const consulta = ${JSON.stringify(sql)};`],
    ['plantilla sin ${}', `export const consulta = \`${sql}\`;`],
    ['plantilla con ${}', `export const consulta = (id) => \`${sql} \${id}\`;`],
  ];
}

/** Todas las formas (para los ejemplos que deben pasar en cualquiera de ellas). */
function enTodasLasFormas(sql) {
  return [...enFormasAnalizadas(sql), ...enFormasNoAnalizadas(sql)];
}

/** Un SQL como plantilla etiquetada con $queryRaw, sin interpolaciones (para prisma/, cli/ y las pruebas). */
const comoPlantilla = (sql) => `export const consulta = (cliente) => cliente.$queryRaw\`${sql}\`;`;

/** Rechazado en un modulo normal y en cli/, y libre en prisma/ (asi el error es de la regla y no del ejemplo). */
async function esRechazadoFueraDePrisma(sql) {
  expect(await errores(comoPlantilla(sql), PRISMA), `el ejemplo tiene otros errores de lint: ${sql}`).toEqual([]);
  for (const [forma, codigo] of enFormasAnalizadas(sql)) {
    expect((await errores(codigo, MODULO)).length, `el lint no rechazo (${forma}): ${sql}`).toBeGreaterThan(0);
  }
  expect((await errores(comoPlantilla(sql), CLI)).length, `el lint no rechazo en cli/: ${sql}`).toBeGreaterThan(0);
}

/** Rechazado en un modulo normal y en cli/ por sus reglas de set_config; libre en prisma/. Misma comprobacion. */
const esRechazadoEnModuloYCli = esRechazadoFueraDePrisma;

/** Rechazado en un modulo normal, pero permitido en cli/ y en prisma/ (por ejemplo un set_config(..., true) valido). */
async function esRechazadoSoloEnModulo(sql) {
  expect(await errores(comoPlantilla(sql), PRISMA), `prisma/: ${sql}`).toEqual([]);
  expect(await errores(comoPlantilla(sql), CLI), `cli/ debia permitirlo: ${sql}`).toEqual([]);
  for (const [forma, codigo] of enFormasAnalizadas(sql)) {
    expect((await errores(codigo, MODULO)).length, `el lint no rechazo (${forma}): ${sql}`).toBeGreaterThan(0);
  }
}

/** No produce ningun error en un modulo normal (en ninguna de las formas) ni en cli/. */
async function pasaElLint(sql) {
  for (const [forma, codigo] of enTodasLasFormas(sql)) {
    expect(await errores(codigo, MODULO), `forma ${forma}: ${sql}`).toEqual([]);
  }
  expect(await errores(comoPlantilla(sql), CLI), `cli/: ${sql}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterio 92 (alcance ajustado): lo que ya no se analiza
// ---------------------------------------------------------------------------------------------------------------------

describe('criterio 92: los textos de los criterios 83 y 84 fuera de una plantilla etiquetada ya no son SQL para el lint', () => {
  // Cambio de sentido: en la ronda 2 estos mismos textos, como cadena o plantilla sin etiqueta, hacian fallar el lint.
  it.each([
    ['SET con el nombre entre comillas dobles', `SET "app.plataforma" TO 'si'`],
    ['SET LOCAL ROLE', 'SET LOCAL ROLE postgres'],
    ['RESET SESSION AUTHORIZATION', 'RESET SESSION AUTHORIZATION'],
    ['set_config con false', "SELECT set_config('app.plataforma', 'si', false)"],
    ['set_config con un primer argumento que no es app.*', "SELECT set_config('search_path', 'public', true)"],
    ['ALTER ROLE', 'ALTER ROLE aquagestion_app SUPERUSER'],
    ['COMMIT', 'COMMIT'],
    ['END', 'END'],
    ['ROLLBACK', 'ROLLBACK'],
    ['SET search_path', 'SET search_path = public'],
    ['CREATE TEMP', 'CREATE TEMP TABLE t (a int)'],
    ['DISCARD ALL', 'DISCARD ALL'],
    ['LISTEN', 'LISTEN canal'],
    ['pg_notify(', "SELECT pg_notify('canal', 'hola')"],
  ])('criterio 92: %s como cadena o plantilla sin etiqueta pasa el lint', async (_descripcion, sql) => {
    for (const [forma, codigo] of enFormasNoAnalizadas(sql)) {
      expect(await errores(codigo, MODULO), `forma ${forma}: ${sql}`).toEqual([]);
      expect(await errores(codigo, CLI), `cli/, forma ${forma}: ${sql}`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criterio 83
// ---------------------------------------------------------------------------------------------------------------------

describe('criterio 83: SET y RESET de contexto en formas equivalentes (fuera de infraestructura/prisma)', () => {
  it.each([
    ['SET con el nombre entre comillas dobles', `SET "app.plataforma" TO 'si'`],
    ['SET LOCAL con app y plataforma entre comillas dobles por separado', `SET LOCAL "app"."plataforma" = 'si'`],
    ['SET con espacios alrededor del punto', `SET app . plataforma = 'si'`],
    ['SET con saltos de linea alrededor del punto', "SET app\n.\nplataforma = 'si'"],
    ['SET con un comentario en medio', "SET /* nada */ app.plataforma = 'si'"],
    ['SET con mayusculas y minusculas mezcladas', "Set Local APP.Plataforma = 'si'"],
    ['SET con un identificador U&"..."', `SET U&"app.plataforma" = 'si'`],
    ['RESET con comillas dobles', 'RESET "app.academia_id"'],
    ['RESET con las comillas dobles por separado', 'RESET "app"."academia_id"'],
    ['SET LOCAL ROLE', 'SET LOCAL ROLE postgres'],
    ['SET LOCAL con ROLE entre comillas dobles', 'SET LOCAL "role" TO postgres'],
    ['SET LOCAL SESSION AUTHORIZATION', 'SET LOCAL SESSION AUTHORIZATION postgres'],
    ['RESET SESSION AUTHORIZATION', 'RESET SESSION AUTHORIZATION'],
    ['RESET ROLE con comillas dobles', 'RESET "role"'],
  ])('criterio 83: %s falla el lint', async (_descripcion, sql) => {
    await esRechazadoFueraDePrisma(sql);
  });
});

describe('criterio 83: set_config con tercer argumento distinto de true (tambien en cli/)', () => {
  it.each([
    ['false', "SELECT set_config('app.plataforma', 'si', false)"],
    ["'false' como texto", "SELECT set_config('app.plataforma', 'si', 'false')"],
    ["'f'", "SELECT set_config('app.plataforma', 'si', 'f')"],
    ["'off'", "SELECT set_config('app.plataforma', 'si', 'off')"],
    ["'0'", "SELECT set_config('app.plataforma', 'si', '0')"],
    ['false::boolean', "SELECT set_config('app.plataforma', 'si', false::boolean)"],
    ['CAST(false AS boolean)', "SELECT set_config('app.plataforma', 'si', CAST(false AS boolean))"],
    ['un parametro $1', "SELECT set_config('app.plataforma', 'si', $1)"],
    [
      'TRUE seguido de otra cosa (no es exactamente true)',
      "SELECT set_config('app.plataforma', 'si', true::text::boolean)",
    ],
    ['pg_catalog.set_config con false', "SELECT pg_catalog.set_config('app.plataforma', 'si', false)"],
    ['"set_config" entre comillas con false', `SELECT "set_config"('app.plataforma', 'si', false)`],
    ['"pg_catalog"."set_config" con false', `SELECT "pg_catalog"."set_config"('app.plataforma', 'si', false)`],
    ['set_config con espacio antes del parentesis y false', "SELECT set_config ('app.plataforma', 'si', false)"],
    ["falso escrito como E'false'", "SELECT set_config('app.plataforma', 'si', E'false')"],
    ['falso escrito entre dolares', "SELECT set_config('app.plataforma', 'si', $$false$$)"],
  ])('criterio 83: %s falla el lint', async (_descripcion, sql) => {
    await esRechazadoEnModuloYCli(sql);
  });

  // (criterio 92) Antes era una plantilla sin etiqueta; ahora el mismo SQL va en una plantilla etiquetada con Prisma.sql.
  it('criterio 83: un ${…} de plantilla como tercer argumento falla el lint (fuera de prisma/)', async () => {
    const codigo = "export const f = (valor) => Prisma.sql`SELECT set_config('app.plataforma', 'si', ${valor})`;";

    expect(await errores(codigo, PRISMA)).toEqual([]);
    expect((await errores(codigo, MODULO)).length).toBeGreaterThan(0);
    expect((await errores(codigo, CLI)).length, 'cli/').toBeGreaterThan(0);
  });

  it('criterio 83: un ${…} de plantilla como tercer argumento falla tambien en una plantilla etiquetada', async () => {
    const codigo =
      "export const f = (cliente, valor) => cliente.$queryRaw`SELECT set_config('app.plataforma', 'si', ${valor})`;";

    expect(await errores(codigo, PRISMA)).toEqual([]);
    expect((await errores(codigo, CLI)).length, 'cli/').toBeGreaterThan(0);
  });
});

describe('criterio 83: set_config con un primer argumento que no es un literal simple app.* (tambien en cli/)', () => {
  it.each([
    ['un parametro $1', "SELECT set_config($1, 'si', true)"],
    ['concat(...)', "SELECT set_config(concat('app.', 'plataforma'), 'si', true)"],
    ['format(...)', "SELECT set_config(format('app.%s', 'plataforma'), 'si', true)"],
    ['una columna', 'SELECT set_config(nombre, valor, true) FROM ajustes'],
    ["'search_path'", "SELECT set_config('search_path', 'public', true)"],
    ["'role'", "SELECT set_config('role', 'postgres', true)"],
    ["'session_authorization'", "SELECT set_config('session_authorization', 'postgres', true)"],
    ['un nombre que contiene app. pero no empieza por el', "SELECT set_config('x.app.plataforma', 'si', true)"],
    [
      "'search_path' con la concatenacion 'sear' || 'ch_path'",
      "SELECT set_config('sear' || 'ch_path', 'public', true)",
    ],
    ["E'search_path'", "SELECT set_config(E'search_path', 'public', true)"],
    ['search_path entre dolares', "SELECT set_config($$search_path$$, 'public', true)"],
    ['role entre dolares con etiqueta', "SELECT set_config($x$role$x$, 'postgres', true)"],
    ["U&'search_path'", "SELECT set_config(U&'search_path', 'public', true)"],
    ["N'role'", "SELECT set_config(N'role', 'postgres', true)"],
  ])('criterio 83: %s falla el lint', async (_descripcion, sql) => {
    await esRechazadoEnModuloYCli(sql);
  });

  // (criterio 92) Antes era una plantilla sin etiqueta; ahora el mismo SQL va en una plantilla etiquetada con Prisma.sql.
  it('criterio 83: un ${…} de plantilla como primer argumento falla el lint (fuera de prisma/)', async () => {
    const codigo = "export const f = (nombre) => Prisma.sql`SELECT set_config(${nombre}, 'si', true)`;";

    expect(await errores(codigo, PRISMA)).toEqual([]);
    expect((await errores(codigo, MODULO)).length).toBeGreaterThan(0);
    expect((await errores(codigo, CLI)).length, 'cli/').toBeGreaterThan(0);
  });
});

describe('criterio 83: set_config valido (app.* literal y true) solo se permite en cli/ y en prisma/', () => {
  it.each([
    ['la forma simple', "SELECT set_config('app.plataforma', 'si', true)"],
    [
      'los dos valores de contexto en una consulta',
      "SELECT set_config('app.academia_id', '', true), set_config('app.plataforma', 'si', true)",
    ],
    ['el valor como parametro', "SELECT set_config('app.academia_id', $1, true)"],
    ['pg_catalog.set_config', "SELECT pg_catalog.set_config('app.plataforma', 'si', true)"],
    ['"set_config" entre comillas dobles', `SELECT "set_config"('app.plataforma', 'si', true)`],
    ['espacios antes del parentesis', "SELECT set_config ('app.plataforma', 'si', true)"],
    ["el nombre como E'app.plataforma'", "SELECT set_config(E'app.plataforma', 'si', true)"],
    ['el nombre y el valor entre dolares', 'SELECT set_config($$app.plataforma$$, $$si$$, true)'],
    ["el nombre como concatenacion 'ap' || 'p.plataforma'", "SELECT set_config('ap' || 'p.plataforma', 'si', true)"],
    ['TRUE y APP. en mayusculas', "SELECT SET_CONFIG('APP.plataforma', 'si', TRUE)"],
  ])('criterio 83: %s pasa en cli/ y en prisma/ pero falla en un modulo', async (_descripcion, sql) => {
    await esRechazadoSoloEnModulo(sql);
  });
});

describe('criterio 83: lo que sigue pasando', () => {
  it.each([
    ['current_setting de app', "SELECT current_setting('app.academia_id', true)"],
    ['un UPDATE con SET de columna', 'UPDATE superadmins SET intentos_fallidos = 0 WHERE id = $1'],
    ['set_config de otra configuracion con true en un comentario', "SELECT 1 /* set_config('app.x', 'y', false) */"],
    ['un SET en un comentario de linea', 'SELECT 1 -- SET ROLE postgres\n'],
  ])('criterio 83: %s pasa el lint en un modulo y en cli/', async (_descripcion, sql) => {
    await pasaElLint(sql);
  });

  it("criterio 83: SELECT set_config('app.plataforma', 'si', true) pasa en cli/", async () => {
    expect(await errores(comoPlantilla("SELECT set_config('app.plataforma', 'si', true)"), CLI)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criterio 84
// ---------------------------------------------------------------------------------------------------------------------

describe('criterio 84: ALTER ROLE, USER, DATABASE y SYSTEM', () => {
  it.each([
    ['ALTER ROLE', 'ALTER ROLE aquagestion_app SUPERUSER'],
    ['ALTER USER', 'ALTER USER aquagestion_app BYPASSRLS'],
    ['ALTER DATABASE', 'ALTER DATABASE aquagestion CONNECTION LIMIT 5'],
    ['ALTER SYSTEM', "ALTER SYSTEM SET log_statement = 'all'"],
    ['alter role en minusculas', 'alter role aquagestion_app createdb'],
    ['ALTER ROLE con comillas dobles', 'ALTER ROLE "aquagestion_app" SUPERUSER'],
    ['ALTER ROLE despues de otra sentencia', 'SELECT 1; ALTER ROLE aquagestion_app SUPERUSER'],
  ])('criterio 84: %s falla el lint', async (_descripcion, sql) => {
    await esRechazadoFueraDePrisma(sql);
  });
});

describe('criterio 84: sentencias de transaccion', () => {
  it.each([
    ['COMMIT', 'COMMIT'],
    ['commit en minusculas', 'commit'],
    ['COMMIT despues de otra sentencia', 'SELECT 1; COMMIT'],
    ['COMMIT en otra linea', 'SELECT 1;\nCOMMIT'],
    ['END', 'END'],
    ['ROLLBACK', 'ROLLBACK'],
    ['ROLLBACK TO', 'ROLLBACK TO SAVEPOINT s1'],
    ['ROLLBACK TO sin SAVEPOINT', 'ROLLBACK TO s1'],
    ['ABORT', 'ABORT'],
    ['SAVEPOINT', 'SAVEPOINT s1'],
    ['RELEASE', 'RELEASE s1'],
    ['RELEASE SAVEPOINT', 'RELEASE SAVEPOINT s1'],
    ['BEGIN', 'BEGIN'],
    ['BEGIN despues de otra sentencia', 'SELECT 1; BEGIN'],
    ['START TRANSACTION', 'START TRANSACTION'],
    ['START TRANSACTION con modo', 'START TRANSACTION ISOLATION LEVEL SERIALIZABLE'],
    ['COMMIT con espacios y punto y coma al final', '  COMMIT ;'],
  ])('criterio 84: %s falla el lint', async (_descripcion, sql) => {
    await esRechazadoFueraDePrisma(sql);
  });
});

describe('criterio 84: cualquier SET o RESET como sentencia', () => {
  it.each([
    ['SET search_path', 'SET search_path = public'],
    ['SET LOCAL search_path', 'SET LOCAL search_path TO pg_temp'],
    ['SET work_mem', "SET work_mem = '64MB'"],
    ['SET TRANSACTION', 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'],
    ['SET LOCAL de otra variable', "SET LOCAL statement_timeout = '5s'"],
    ['SET TIME ZONE', "SET TIME ZONE 'UTC'"],
    ['RESET de otra variable', 'RESET search_path'],
    ['RESET TRANSACTION', 'RESET transaction_isolation'],
    ['SET despues de otra sentencia', 'SELECT 1; SET LOCAL search_path TO public'],
    ['RESET despues de otra sentencia', 'SELECT 1; RESET search_path'],
  ])('criterio 84: %s falla el lint', async (_descripcion, sql) => {
    await esRechazadoFueraDePrisma(sql);
  });
});

describe('criterio 84: tablas temporales', () => {
  it.each([
    ['CREATE TEMP', 'CREATE TEMP TABLE t (a int)'],
    ['CREATE TEMPORARY', 'CREATE TEMPORARY TABLE superadmins (id uuid)'],
    ['CREATE GLOBAL TEMP', 'CREATE GLOBAL TEMP TABLE t (a int)'],
    ['CREATE GLOBAL TEMPORARY', 'CREATE GLOBAL TEMPORARY TABLE t (a int)'],
    ['CREATE LOCAL TEMP', 'CREATE LOCAL TEMP TABLE t (a int)'],
    ['CREATE LOCAL TEMPORARY', 'CREATE LOCAL TEMPORARY TABLE t (a int)'],
    ['INTO TEMP', 'SELECT 1 AS a INTO TEMP t'],
    ['INTO TEMPORARY', 'SELECT 1 AS a INTO TEMPORARY t'],
    ['create temp en minusculas', 'create temp table t (a int)'],
    ['CREATE TEMP con saltos de linea', 'CREATE\n  TEMP TABLE t (a int)'],
    ['CREATE TEMP en medio de un texto', 'SELECT 1; CREATE TEMP TABLE t (a int)'],
  ])('criterio 84: %s falla el lint', async (_descripcion, sql) => {
    await esRechazadoFueraDePrisma(sql);
  });
});

describe('criterio 84: DISCARD, pg_settings y notificaciones', () => {
  it.each([
    ['DISCARD ALL', 'DISCARD ALL'],
    ['DISCARD TEMP', 'DISCARD TEMP'],
    ['UPDATE pg_settings', "UPDATE pg_settings SET setting = 'x' WHERE name = 'search_path'"],
    ['UPDATE pg_catalog.pg_settings', "UPDATE pg_catalog.pg_settings SET setting = 'x' WHERE name = 'role'"],
    ['LISTEN', 'LISTEN canal'],
    ['UNLISTEN', 'UNLISTEN *'],
    ['NOTIFY', 'NOTIFY canal'],
    ['NOTIFY con mensaje', "NOTIFY canal, 'hola'"],
    ['pg_notify(', "SELECT pg_notify('canal', 'hola')"],
    ['pg_catalog.pg_notify(', "SELECT pg_catalog.pg_notify('canal', 'hola')"],
  ])('criterio 84: %s falla el lint', async (_descripcion, sql) => {
    await esRechazadoFueraDePrisma(sql);
  });
});

describe('criterio 84: lo que sigue pasando', () => {
  it.each([
    ['CASE ... END dentro de una consulta', 'SELECT CASE WHEN a THEN 1 ELSE 0 END FROM t'],
    ['UPDATE ... SET de columnas', "UPDATE academias SET estado = 'ACTIVA' WHERE id = $1"],
    ['un literal de datos commit', "SELECT * FROM auditoria WHERE accion = 'commit'"],
    ['un literal de datos rollback en un INSERT', "INSERT INTO auditoria (accion) VALUES ('rollback')"],
    ['un literal de datos begin', "SELECT 1 FROM t WHERE estado = 'begin'"],
    ['current_setting', "SELECT current_setting('app.academia_id', true)"],
    ['UPDATE de superadmins', 'UPDATE superadmins SET intentos_fallidos = 0 WHERE id = $1'],
    ['una consulta con la palabra temp en un nombre de columna', 'SELECT temporada FROM clases WHERE id = $1'],
    ['un comentario con COMMIT', 'SELECT 1 -- COMMIT\n'],
  ])('criterio 84: %s pasa el lint en un modulo y en cli/', async (_descripcion, sql) => {
    await pasaElLint(sql);
  });
});

describe('criterio 83 y 84: las reglas no se aplican en infraestructura/prisma/ ni en las pruebas', () => {
  it.each([
    ['SET LOCAL ROLE', 'SET LOCAL ROLE postgres'],
    ['COMMIT', 'COMMIT'],
    ['CREATE TEMP', 'CREATE TEMP TABLE t (a int)'],
    ['ALTER ROLE', 'ALTER ROLE x SUPERUSER'],
    ['set_config con false', "SELECT set_config('search_path', 'x', false)"],
  ])('criterio 84: %s no falla dentro de backend/src/infraestructura/prisma/', async (_descripcion, sql) => {
    expect(await errores(comoPlantilla(sql), PRISMA)).toEqual([]);
  });

  it.each([
    ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
    ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
    ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
  ])('criterio 84: los mismos textos no fallan en %s', async (_nombre, archivo) => {
    for (const sql of ['SET LOCAL ROLE postgres', 'COMMIT', 'CREATE TEMP TABLE t (a int)', 'ALTER ROLE x SUPERUSER']) {
      expect(await errores(comoPlantilla(sql), archivo), sql).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// eslint-disable y las reglas de los criterios 73, 83 y 84 (criterio 96, ataque ronda 3)
// ---------------------------------------------------------------------------------------------------------------------

// (criterio 96) Antes, estas pruebas comprobaban con eslint.config.mjs que NINGUN comentario eslint-disable evitaba el fallo
// (linterOptions.noInlineConfig). Eso cambio: con la configuracion principal el comentario vuelve a apagar la regla que
// nombra; que no se puede apagar con comentarios se comprueba con el paso protegido (eslint.protegido.config.mjs con
// allowInlineConfig: false, que es lo que hace `--no-inline-config`). Los ejemplos son los mismos, ahora como plantillas
// etiquetadas con $queryRaw (criterio 92).
describe('criterios 73, 83 y 84: un comentario eslint-disable no evita el fallo en el paso protegido (criterio 96)', () => {
  const EJEMPLOS = [
    ['criterio 73: SET ROLE', 'SET ROLE postgres'],
    ["criterio 73: set_config('app.…', …, false)", "SELECT set_config('app.plataforma', 'si', false)"],
    ['criterio 83: SET entre comillas dobles', `SET LOCAL "app"."plataforma" = 'si'`],
    ["criterio 83: set_config con primer argumento 'search_path'", "SELECT set_config('search_path', 'public', true)"],
    ['criterio 84: COMMIT', 'COMMIT'],
    ['criterio 84: CREATE TEMP TABLE', 'CREATE TEMP TABLE t (a int)'],
    ['criterio 84: ALTER ROLE', 'ALTER ROLE aquagestion_app SUPERUSER'],
  ];

  /** Errores de ESLint (severidad 2) del paso protegido para el codigo en el archivo indicado. */
  async function erroresProtegidos(codigo, archivo) {
    const [resultado] = await obtenerEslintProtegido().lintText(codigo, { filePath: path.join(raiz, archivo) });
    const fatales = resultado.messages.filter((mensaje) => mensaje.fatal);
    expect(fatales, `error al analizar ${archivo}`).toEqual([]);
    return resultado.messages.filter((mensaje) => mensaje.severity === 2);
  }

  /** Identificadores de las reglas que fallan con el ejemplo sin ningun comentario. */
  async function reglasQueFallan(codigo) {
    const mensajes = await erroresProtegidos(codigo, MODULO);
    expect(mensajes.length, `el ejemplo sin comentarios debia fallar: ${codigo}`).toBeGreaterThan(0);
    return [...new Set(mensajes.map((mensaje) => mensaje.ruleId).filter(Boolean))];
  }

  it.each(EJEMPLOS)('%s: sigue fallando con cualquier forma de eslint-disable', async (_nombre, sql) => {
    const linea = comoPlantilla(sql);
    const reglas = await reglasQueFallan(linea);
    const lista = reglas.join(', ');
    const variantes = [
      ['eslint-disable-next-line sin nombres', `// eslint-disable-next-line\n${linea}`],
      ['eslint-disable-next-line con los nombres', `// eslint-disable-next-line ${lista}\n${linea}`],
      ['eslint-disable-line sin nombres', `${linea} // eslint-disable-line`],
      ['eslint-disable-line con los nombres', `${linea} // eslint-disable-line ${lista}`],
      ['eslint-disable de bloque, de archivo, sin nombres', `/* eslint-disable */\n${linea}`],
      ['eslint-disable de bloque, de archivo, con los nombres', `/* eslint-disable ${lista} */\n${linea}`],
      ['eslint-disable-next-line de bloque', `/* eslint-disable-next-line */\n${linea}`],
      [
        '/* eslint regla: off */ con los nombres',
        `/* eslint ${reglas.map((r) => `${r}: "off"`).join(', ')} */\n${linea}`,
      ],
    ];

    for (const [forma, codigo] of variantes) {
      const restantes = (await erroresProtegidos(codigo, MODULO)).filter((mensaje) => reglas.includes(mensaje.ruleId));
      expect(restantes.length, `${forma}: el comentario apago la regla en: ${codigo}`).toBeGreaterThan(0);
    }
  });
});

describe('criterio 96: con eslint.config.mjs un comentario eslint-disable vuelve a apagar la regla que nombra', () => {
  // Cambio de sentido respecto de la ronda 2 (P-15): antes, con eslint.config.mjs, el comentario no tenia efecto.
  it('criterio 96: // eslint-disable-next-line con el nombre de la regla del SQL de sesion apaga ese error', async () => {
    const linea = comoPlantilla('SET ROLE postgres');
    const reglas = [...new Set((await errores(linea, MODULO)).map((mensaje) => mensaje.ruleId).filter(Boolean))];
    expect(reglas.length, 'el ejemplo sin comentarios debia fallar').toBeGreaterThan(0);

    const conComentario = `// eslint-disable-next-line ${reglas.join(', ')}\n${linea}`;
    const restantes = (await errores(conComentario, MODULO)).filter((mensaje) => reglas.includes(mensaje.ruleId));

    expect(restantes).toEqual([]);
  });
});
