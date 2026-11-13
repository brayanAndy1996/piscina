// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 109 (ataque ronda 4, F3; complementa los criterios 84 y 94): ninguna funcion que ejecute SQL dado como texto. Dado el
// texto normalizado de una plantilla analizada (criterio 92), fuera de backend/src/infraestructura/prisma/ (tambien en cli/),
// `npm run lint` falla si contiene una llamada, con o sin `pg_catalog.` u otro esquema delante, sin distinguir mayusculas, con o
// sin comillas dobles o `U&"..."` en el nombre (criterio 93) y con o sin espacios antes del parentesis, a una funcion que
// ejecuta o lee SQL o tablas a partir de un texto o un nombre:
//   - del nucleo de PostgreSQL 16: query_to_xml, query_to_xmlschema, query_to_xml_and_xmlschema, cursor_to_xml,
//     cursor_to_xmlschema, table_to_xml, table_to_xmlschema, table_to_xml_and_xmlschema, schema_to_xml, schema_to_xmlschema,
//     schema_to_xml_and_xmlschema, database_to_xml, database_to_xmlschema, database_to_xml_and_xmlschema, ts_stat y ts_rewrite
//     (todas sus formas);
//   - de extensiones: todo nombre que empiece por `dblink`, `crosstab...` y `connectby` (tablefunc), `pg_background...`, y
//     cualquier funcion del esquema `cron`;
//   - y toda llamada calificada con un esquema que no sea `pg_catalog` ni `public` (`otro.funcion(`); como el lint no distingue una
//     llamada de `INSERT INTO otro.tabla (...)`, esa forma tambien falla.
// Siguen pasando `SELECT xpath('/a', ${xml})`, `SELECT to_tsvector(${texto})`, `SELECT pg_catalog.now()`,
// `SELECT public.app_academia_actual()`, `SELECT a.query_to_xml FROM t a` (una columna, sin parentesis) y
// `SELECT count(t.id) FROM t`. Se prueba con las dos configuraciones, como en el criterio 92.
import { describe, expect, it } from 'vitest';
import { CONFIGURACIONES, CLI, MODULO, PRISMA, comoQueryRaw, errores } from './ayuda-lint-ronda4.mjs';

/** Un SQL en las cuatro formas de plantilla etiquetada que se analizan (criterio 92). */
function enFormasAnalizadas(sql) {
  return [
    ['$queryRaw etiquetada', `export const leer = (cliente, id) => cliente.$queryRaw\`${sql} \${id}\`;`],
    ['$executeRaw etiquetada', `export const leer = (cliente, id) => cliente.$executeRaw\`${sql} \${id}\`;`],
    ['Prisma.sql etiquetada', `export const leer = (id) => Prisma.sql\`${sql} \${id}\`;`],
    ['sql etiquetada', `export const leer = (id) => sql\`${sql} \${id}\`;`],
  ];
}

const NUCLEO = [
  'query_to_xml',
  'query_to_xmlschema',
  'query_to_xml_and_xmlschema',
  'cursor_to_xml',
  'cursor_to_xmlschema',
  'table_to_xml',
  'table_to_xmlschema',
  'table_to_xml_and_xmlschema',
  'schema_to_xml',
  'schema_to_xmlschema',
  'schema_to_xml_and_xmlschema',
  'database_to_xml',
  'database_to_xmlschema',
  'database_to_xml_and_xmlschema',
  'ts_stat',
  'ts_rewrite',
];

describe.each(CONFIGURACIONES)('criterio 109 con %s', (_configuracion, obtener) => {
  /** Rechazado en las cuatro formas, en un modulo y en cli/; limpio en prisma/. */
  async function esRechazado(sql) {
    const eslint = obtener();
    for (const [forma, codigo] of enFormasAnalizadas(sql)) {
      expect(await errores(eslint, codigo, PRISMA), `prisma/ no debia fallar (${forma}): ${sql}`).toEqual([]);
      for (const archivo of [MODULO, CLI]) {
        expect(
          (await errores(eslint, codigo, archivo)).length,
          `el lint no rechazo en ${archivo} (${forma}): ${sql}`,
        ).toBeGreaterThan(0);
      }
    }
  }

  /** Pasa el lint como `$queryRaw` etiquetada, en un modulo y en cli/. */
  async function pasa(sql) {
    const eslint = obtener();
    for (const archivo of [MODULO, CLI]) {
      expect(await errores(eslint, comoQueryRaw(sql), archivo), `el lint rechazo en ${archivo}: ${sql}`).toEqual([]);
    }
  }

  describe('criterio 109: funciones del nucleo de PostgreSQL 16 que ejecutan o leen SQL a partir de un texto', () => {
    it.each(NUCLEO)('criterio 109: %s(...) falla el lint', async (nombre) => {
      await esRechazado(`SELECT ${nombre}('SELECT 1', true, false, '')`);
    });

    it.each([
      [
        'query_to_xml con SQL de sesion dentro de la cadena (ejemplo de la especificacion)',
        "SELECT query_to_xml('SELECT set_config(''app.plataforma'', ''si'', false)', true, false, '')",
      ],
      [
        'pg_catalog.Query_To_Xml con espacio antes del parentesis y un valor (ejemplo de la especificacion)',
        "SELECT pg_catalog.Query_To_Xml (${q}, true, false, '')",
      ],
      [
        'query_to_xml entre comillas dobles (ejemplo de la especificacion)',
        "SELECT \"query_to_xml\"('SELECT 1', true, false, '')",
      ],
      ['ts_stat con una consulta (ejemplo de la especificacion)', "SELECT ts_stat('SELECT …')"],
      ['ts_stat en el FROM', "SELECT * FROM ts_stat('SELECT vector FROM docs')"],
      ['ts_stat con pesos', "SELECT * FROM ts_stat('SELECT vector FROM docs', 'ab')"],
      [
        'ts_rewrite de dos argumentos (ejecuta una consulta dada como texto)',
        "SELECT ts_rewrite('a & b'::tsquery, 'SELECT t, s FROM alias')",
      ],
      ['ts_rewrite de tres argumentos', "SELECT ts_rewrite('a & b'::tsquery, 'a'::tsquery, 'c'::tsquery)"],
      ['ts_rewrite de un tsquery y una consulta con valor interpolado', 'SELECT ts_rewrite(q, ${consulta}) FROM t'],
      ['query_to_xml en mayusculas', "SELECT QUERY_TO_XML('SELECT 1', true, false, '')"],
      ['query_to_xml con mayusculas mezcladas', "SELECT Query_To_Xml('SELECT 1', true, false, '')"],
      ['query_to_xml con pg_catalog.', "SELECT pg_catalog.query_to_xml('SELECT 1', true, false, '')"],
      ['query_to_xml con espacios antes del parentesis', "SELECT query_to_xml   ('SELECT 1', true, false, '')"],
      ['query_to_xml con un salto de linea antes del parentesis', "SELECT query_to_xml\n('SELECT 1', true, false, '')"],
      [
        'query_to_xml con un comentario antes del parentesis',
        "SELECT query_to_xml /* x */ ('SELECT 1', true, false, '')",
      ],
      [
        'pg_catalog con comillas dobles en el esquema y en el nombre',
        'SELECT "pg_catalog"."query_to_xml"(\'SELECT 1\', true, false, \'\')',
      ],
      ['U&"query_to_xml" (criterio 93)', "SELECT U&\"query_to_xml\"('SELECT 1', true, false, '')"],
      ['U&"..." con UESCAPE', "SELECT U&\"query!005fto_xml\" UESCAPE '!' ('SELECT 1', true, false, '')"],
      ['query_to_xml_and_xmlschema', "SELECT query_to_xml_and_xmlschema('SELECT 1', true, false, '')"],
      ['table_to_xml sobre una tabla de otra academia', "SELECT table_to_xml('auditoria'::regclass, true, false, '')"],
      ['database_to_xml', "SELECT database_to_xml(true, false, '')"],
      ['schema_to_xml', "SELECT schema_to_xml('public', true, false, '')"],
      ['cursor_to_xml', "SELECT cursor_to_xml('c'::refcursor, 100, true, false, '')"],
      ['la funcion dentro de otra llamada', "SELECT length(query_to_xml('SELECT 1', true, false, '')::text)"],
      ['la funcion despues de un punto y coma', "SELECT 1; SELECT query_to_xml('SELECT 1', true, false, '')"],
    ])('criterio 109: %s falla el lint', async (_nombre, sql) => {
      await esRechazado(sql);
    });
  });

  describe('criterio 109: funciones de extensiones que podrian instalarse', () => {
    it.each([
      ['dblink', "SELECT * FROM dblink('host=otro', 'SELECT 1') AS t(a int)"],
      ['dblink_exec (ejemplo de la especificacion)', "SELECT * FROM dblink_exec('…')"],
      ['dblink_exec', "SELECT dblink_exec('host=otro', 'DROP TABLE x')"],
      ['dblink_open', "SELECT dblink_open('c', 'SELECT 1')"],
      ['dblink_send_query', "SELECT dblink_send_query('conn', 'SELECT 1')"],
      ['dblink_connect', "SELECT dblink_connect('host=otro')"],
      ['dblink_get_result', "SELECT * FROM dblink_get_result('conn') AS t(a int)"],
      ['dblink_connect_u', "SELECT dblink_connect_u('host=otro')"],
      ['dblink en mayusculas', "SELECT DBLINK_EXEC('x')"],
      ['dblink con pg_catalog.', "SELECT pg_catalog.dblink_exec('x')"],
      ['dblink con public.', "SELECT public.dblink_exec('x')"],
      ['dblink con espacio antes del parentesis', "SELECT dblink_exec ('x')"],
      ['dblink entre comillas dobles', 'SELECT "dblink_exec"(\'x\')'],
      ['un nombre que empieza por dblink y sigue con otras letras', "SELECT dblinkxyz('x')"],
      ['crosstab', "SELECT * FROM crosstab('SELECT 1, 2, 3') AS t(a int, b int)"],
      ['crosstab2', "SELECT * FROM crosstab2('SELECT 1, 2, 3')"],
      ['crosstab3', "SELECT * FROM crosstab3('SELECT 1, 2, 3')"],
      ['crosstab4', "SELECT * FROM crosstab4('SELECT 1, 2, 3')"],
      ['crosstab con dos consultas', "SELECT * FROM crosstab('SELECT 1', 'SELECT 2') AS t(a int)"],
      ['crosstab con public.', "SELECT * FROM public.crosstab('SELECT 1') AS t(a int)"],
      ['connectby', "SELECT * FROM connectby('arbol', 'id', 'padre', 'raiz', 0) AS t(id int, padre int, nivel int)"],
      ['connectby en mayusculas', "SELECT * FROM CONNECTBY('arbol', 'id', 'padre', 'raiz', 0) AS t(id int)"],
      ['pg_background_launch', "SELECT pg_background_launch('SELECT 1')"],
      ['pg_background_result', 'SELECT * FROM pg_background_result(1) AS t(a int)'],
      ['pg_background_detach', 'SELECT pg_background_detach(1)'],
      ['pg_background con pg_catalog.', "SELECT pg_catalog.pg_background_launch('SELECT 1')"],
      ['cron.schedule (ejemplo de la especificacion)', "SELECT cron.schedule('…')"],
      ['cron.schedule con un trabajo', "SELECT cron.schedule('0 * * * *', 'DELETE FROM auditoria')"],
      ['cron.unschedule', 'SELECT cron.unschedule(1)'],
      ['cron.alter_job', 'SELECT cron.alter_job(1)'],
      ['cron.schedule_in_database', "SELECT cron.schedule_in_database('x', '* * * * *', 'SELECT 1', 'otra')"],
      ['cron.schedule en mayusculas', "SELECT CRON.SCHEDULE('x')"],
      ['cron.schedule entre comillas dobles', 'SELECT "cron"."schedule"(\'x\')'],
      ['cron.schedule con espacios alrededor del punto', "SELECT cron . schedule('x')"],
    ])('criterio 109: %s falla el lint', async (_nombre, sql) => {
      await esRechazado(sql);
    });
  });

  describe('criterio 109: toda llamada calificada con un esquema que no es pg_catalog ni public', () => {
    it.each([
      ['otro.funcion( (ejemplo de la especificacion)', 'SELECT otro.funcion(1)'],
      ['otro.funcion con un valor', 'SELECT otro.funcion(${id})'],
      ['otro esquema con mayusculas', 'SELECT Otro.Funcion(1)'],
      ['otro esquema entre comillas dobles', 'SELECT "otro"."funcion"(1)'],
      ['otro esquema con espacio antes del parentesis', 'SELECT otro.funcion (1)'],
      ['otro esquema con espacios alrededor del punto', 'SELECT otro . funcion(1)'],
      ['una extension nueva', 'SELECT pgcrypto.digest(1)'],
      ['information_schema', 'SELECT information_schema._pg_expandarray(ARRAY[1])'],
      ['un esquema temporal', 'SELECT pg_temp.mi_funcion(1)'],
      ['una funcion en el FROM', 'SELECT * FROM otro.generar(1)'],
      [
        'INSERT INTO otro.tabla (a) (ejemplo de la especificacion: esa forma tambien falla)',
        'INSERT INTO otro.tabla (a) VALUES (1)',
      ],
      ['INSERT INTO otro.tabla con varias columnas', 'INSERT INTO esquema_ajeno.registros (a, b) VALUES (1, 2)'],
      ['pg_catalog mal escrito', 'SELECT pg_catalogo.now()'],
      ['publico en lugar de public', 'SELECT publico.mi_funcion(1)'],
      ['public como prefijo de otro nombre', 'SELECT public_ajeno.mi_funcion(1)'],
    ])('criterio 109: %s falla el lint', async (_nombre, sql) => {
      await esRechazado(sql);
    });
  });

  describe('criterio 109: lo que sigue pasando', () => {
    it.each([
      ['xpath con un valor (ejemplo de la especificacion)', "SELECT xpath('/a', ${xml})"],
      ['to_tsvector con un valor (ejemplo de la especificacion)', 'SELECT to_tsvector(${texto})'],
      ['pg_catalog.now() (ejemplo de la especificacion)', 'SELECT pg_catalog.now()'],
      ['public.app_academia_actual() (ejemplo de la especificacion)', 'SELECT public.app_academia_actual()'],
      [
        'una columna que se llama como la funcion, sin parentesis (ejemplo de la especificacion)',
        'SELECT a.query_to_xml FROM t a',
      ],
      ['count(t.id) (ejemplo de la especificacion)', 'SELECT count(t.id) FROM t'],
      [
        'un alias de tabla con columnas dentro de funciones',
        "SELECT lower(a.nombre), coalesce(a.motivo, '') FROM academias a",
      ],
      ['una columna que empieza por dblink, sin parentesis', 'SELECT a.dblink_estado FROM t a'],
      ['una columna que empieza por crosstab, sin parentesis', 'SELECT a.crosstab_total FROM t a'],
      ['una columna llamada cron, sin parentesis', 'SELECT c.cron FROM t c'],
      ['public.tabla en el FROM', 'SELECT * FROM public.academias'],
      [
        'INSERT INTO public.tabla (a) (esquema permitido)',
        'INSERT INTO public.configuraciones (academia_id, clave) VALUES (${id}::uuid, ${clave})',
      ],
      ['pg_catalog.pg_tables en el FROM', "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'"],
      [
        'funciones de texto y de fecha de uso comun',
        "SELECT date_trunc('day', now()), to_char(now(), 'YYYY'), length(${texto})",
      ],
      ['join_to_xml como nombre parecido pero distinto, sin parentesis', 'SELECT t.table_to_xml_columna FROM t'],
      ['ts_stat como columna sin parentesis', 'SELECT t.ts_stat FROM t'],
      [
        'varias columnas con alias',
        'SELECT a.id, a.nombre, b.clave FROM academias a JOIN configuraciones b ON b.academia_id = a.id',
      ],
      ['IN (...) con un alias de columna', 'SELECT 1 FROM t a WHERE a.id IN (${id}, ${otro})'],
      ['ANY con un arreglo y un alias', 'SELECT 1 FROM t a WHERE a.id = ANY(${ids}::uuid[])'],
      ['VALUES (...) despues de un alias', 'SELECT 1 FROM (VALUES (1), (2)) AS v (n)'],
    ])('criterio 109: %s pasa el lint', async (_nombre, sql) => {
      await pasa(sql);
    });
  });

  describe('criterio 109: donde no se aplica', () => {
    const CODIGO = comoQueryRaw(
      "SELECT query_to_xml('SELECT 1', true, false, ''), dblink_exec('x'), cron.schedule('y'), otro.funcion(1)",
    );

    it('criterio 109: nada de lo anterior se aplica dentro de backend/src/infraestructura/prisma/', async () => {
      expect(await errores(obtener(), CODIGO, PRISMA)).toEqual([]);
    });

    it.each([
      ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
      ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
      ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
    ])('criterio 109: nada de lo anterior se aplica en %s', async (_nombre, archivo) => {
      expect(await errores(obtener(), CODIGO, archivo)).toEqual([]);
    });
  });
});
