// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 94 (ataque ronda 3, F6 y O2; complementa el criterio 84): fuera de backend/src/infraestructura/prisma/ (tambien en
// backend/src/cli/), `npm run lint` falla si el texto normalizado de una plantilla analizada (criterio 92) contiene:
//   - como sentencia (al inicio del texto o despues de `;`): DECLARE, CLOSE, FETCH, MOVE, PREPARE, EXECUTE, DEALLOCATE o DO;
//   - en cualquier parte: WITH HOLD; ALTER DEFAULT PRIVILEGES (ademas de ALTER ROLE, USER, DATABASE y SYSTEM); o una llamada,
//     con o sin `pg_catalog.` y con o sin espacios antes del parentesis, a una funcion de objetos grandes (lo_..., loread,
//     lowrite), a pg_advisory_lock, pg_advisory_lock_shared, pg_try_advisory_lock, pg_try_advisory_lock_shared,
//     pg_advisory_unlock, pg_advisory_unlock_shared, pg_advisory_unlock_all, pg_terminate_backend o pg_cancel_backend.
// Siguen pasando pg_advisory_xact_lock y pg_try_advisory_xact_lock (bloqueos de transaccion), SELECT ... WHERE accion = 'FETCH',
// UPDATE t SET estado = 'CLOSE' WHERE ... y SELECT move FROM t.
// Se prueba con las dos configuraciones (eslint.config.mjs y la del paso protegido), por su efecto observable.
import { describe, expect, it } from 'vitest';
import { CONFIGURACIONES, CLI, MODULO, PRISMA, errores } from './ayuda-lint-ronda3.mjs';

/** Un SQL en las cuatro formas de plantilla etiquetada que se analizan (criterio 92). */
function enFormasAnalizadas(sql) {
  return [
    ['$queryRaw etiquetada', `export const leer = (cliente, id) => cliente.$queryRaw\`${sql} \${id}\`;`],
    ['$executeRaw etiquetada', `export const leer = (cliente, id) => cliente.$executeRaw\`${sql} \${id}\`;`],
    ['Prisma.sql etiquetada', `export const leer = (id) => Prisma.sql\`${sql} \${id}\`;`],
    ['sql etiquetada', `export const leer = (id) => sql\`${sql} \${id}\`;`],
  ];
}

const comoPlantilla = (sql) => `export const consulta = (cliente) => cliente.$queryRaw\`${sql}\`;`;

describe.each(CONFIGURACIONES)('criterio 94 con %s', (_configuracion, obtener) => {
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

  describe('criterio 94: sentencias de cursor, sentencias preparadas y DO (al inicio o despues de ;)', () => {
    it.each([
      ['DECLARE', 'DECLARE c CURSOR FOR SELECT * FROM auditoria'],
      ['DECLARE ... WITH HOLD', 'DECLARE c CURSOR WITH HOLD FOR SELECT * FROM auditoria'],
      ['DECLARE en minusculas', 'declare c cursor for select 1'],
      ['CLOSE de un cursor', 'CLOSE c'],
      ['CLOSE ALL', 'CLOSE ALL'],
      ['FETCH', 'FETCH ALL FROM c'],
      ['FETCH con una cantidad', 'FETCH 10 FROM c'],
      ['MOVE', 'MOVE FORWARD 5 IN c'],
      ['PREPARE', 'PREPARE p AS SELECT 1'],
      ['EXECUTE', 'EXECUTE p'],
      ['EXECUTE con parametros', 'EXECUTE p (1, 2)'],
      ['DEALLOCATE', 'DEALLOCATE p'],
      ['DEALLOCATE ALL', 'DEALLOCATE ALL'],
      ['DO', 'DO $$ BEGIN PERFORM 1; END $$'],
      ['DO con un lenguaje', 'DO LANGUAGE plpgsql $$ BEGIN NULL; END $$'],
      ['FETCH despues de otra sentencia', 'SELECT 1; FETCH ALL FROM c'],
      ['CLOSE despues de otra sentencia, en otra linea', 'SELECT 1;\nCLOSE ALL'],
      ['DECLARE despues de una sentencia con espacios', 'SELECT 1 ;   DECLARE c CURSOR FOR SELECT 1'],
      ['EXECUTE con espacios y saltos de linea al inicio', '  \n EXECUTE p'],
      ['FETCH con un comentario antes', '/* x */ FETCH ALL FROM c'],
      ['MOVE en medio de varias sentencias', 'SELECT 1; SELECT 2; MOVE NEXT IN c'],
    ])('criterio 94: %s falla el lint', async (_nombre, sql) => {
      await esRechazado(sql);
    });
  });

  describe('criterio 94: WITH HOLD, ALTER DEFAULT PRIVILEGES y los demas ALTER', () => {
    it.each([
      ['WITH HOLD al final', 'SELECT 1 WITH HOLD'],
      ['WITH HOLD con saltos de linea', 'SELECT 1 WITH\n  HOLD'],
      ['WITH HOLD en minusculas', 'select 1 with hold'],
      ['WITH HOLD con un comentario en medio', 'SELECT 1 WITH /* x */ HOLD'],
      ['ALTER DEFAULT PRIVILEGES', 'ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO PUBLIC'],
      [
        'ALTER DEFAULT PRIVILEGES IN SCHEMA',
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO aquagestion_app',
      ],
      [
        'ALTER DEFAULT PRIVILEGES en minusculas y con saltos de linea',
        'alter\ndefault\nprivileges revoke all on tables from public',
      ],
      [
        'ALTER DEFAULT PRIVILEGES despues de otra sentencia',
        'SELECT 1; ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO PUBLIC',
      ],
      ['ALTER ROLE (ya estaba)', 'ALTER ROLE aquagestion_app SET statement_timeout = 0'],
      ['ALTER USER (ya estaba)', 'ALTER USER aquagestion_app BYPASSRLS'],
      ['ALTER DATABASE (ya estaba)', 'ALTER DATABASE aquagestion SET search_path = pg_temp'],
      ['ALTER SYSTEM (ya estaba)', "ALTER SYSTEM SET log_statement = 'all'"],
    ])('criterio 94: %s falla el lint', async (_nombre, sql) => {
      await esRechazado(sql);
    });
  });

  describe('criterio 94: funciones de objetos grandes, bloqueos de sesion y control de conexiones', () => {
    it.each([
      ['lo_create', 'SELECT lo_create(0)'],
      ['lo_import', "SELECT lo_import('/etc/passwd')"],
      ['lo_export', "SELECT lo_export(1, '/tmp/x')"],
      ['lo_from_bytea', "SELECT lo_from_bytea(0, 'x')"],
      ['lo_unlink', 'SELECT lo_unlink(1)'],
      ['lo_open con espacio antes del parentesis', 'SELECT lo_open (1, 262144)'],
      ['lo_get', 'SELECT lo_get(1)'],
      ['loread', 'SELECT loread(1, 10)'],
      ['lowrite', "SELECT lowrite(1, 'x')"],
      ['pg_catalog.lo_create', 'SELECT pg_catalog.lo_create(0)'],
      ['pg_catalog.loread', 'SELECT pg_catalog.loread(1, 10)'],
      ['lo_create en mayusculas', 'SELECT LO_CREATE(0)'],
      ['lo_create entre comillas dobles', 'SELECT "lo_create"(0)'],
      ['pg_advisory_lock', 'SELECT pg_advisory_lock(1)'],
      ['pg_advisory_lock_shared', 'SELECT pg_advisory_lock_shared(1)'],
      ['pg_try_advisory_lock', 'SELECT pg_try_advisory_lock(1)'],
      ['pg_try_advisory_lock_shared', 'SELECT pg_try_advisory_lock_shared(1)'],
      ['pg_advisory_unlock', 'SELECT pg_advisory_unlock(1)'],
      ['pg_advisory_unlock_shared', 'SELECT pg_advisory_unlock_shared(1)'],
      ['pg_advisory_unlock_all', 'SELECT pg_advisory_unlock_all()'],
      ['pg_catalog.pg_advisory_lock', 'SELECT pg_catalog.pg_advisory_lock(1)'],
      ['pg_advisory_lock con espacio antes del parentesis', 'SELECT pg_advisory_lock (1)'],
      ['PG_ADVISORY_LOCK en mayusculas', 'SELECT PG_ADVISORY_LOCK(1)'],
      ['pg_advisory_lock entre comillas dobles', 'SELECT "pg_advisory_lock"(1)'],
      ['pg_terminate_backend', 'SELECT pg_terminate_backend(1)'],
      ['pg_cancel_backend', 'SELECT pg_cancel_backend(1)'],
      ['pg_catalog.pg_terminate_backend', 'SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_stat_activity'],
      ['pg_cancel_backend con espacio antes del parentesis', 'SELECT pg_cancel_backend (1)'],
    ])('criterio 94: %s falla el lint', async (_nombre, sql) => {
      await esRechazado(sql);
    });

    it('criterio 94: pg_advisory_lock con un valor interpolado en la plantilla falla el lint', async () => {
      const codigo = 'export const f = (cliente, clave) => cliente.$queryRaw`SELECT pg_advisory_lock(${clave})`;';

      expect(await errores(obtener(), codigo, PRISMA)).toEqual([]);
      expect((await errores(obtener(), codigo, MODULO)).length).toBeGreaterThan(0);
      expect((await errores(obtener(), codigo, CLI)).length, 'cli/').toBeGreaterThan(0);
    });
  });

  describe('criterio 94: lo que sigue pasando', () => {
    it.each([
      ['pg_advisory_xact_lock', 'SELECT pg_advisory_xact_lock(${clave})'],
      ['pg_try_advisory_xact_lock', 'SELECT pg_try_advisory_xact_lock(${clave})'],
      ['pg_catalog.pg_advisory_xact_lock', 'SELECT pg_catalog.pg_advisory_xact_lock(${clave})'],
      ['FETCH como literal de datos', "SELECT * FROM auditoria WHERE accion = 'FETCH'"],
      ['CLOSE como literal de datos', "UPDATE configuraciones SET valor = 'CLOSE' WHERE clave = 'estado'"],
      ['UPDATE ... SET estado = CLOSE', "UPDATE t SET estado = 'CLOSE' WHERE id = ${id}"],
      ['move como nombre de columna', 'SELECT move FROM t'],
      ['declare, prepare y execute como nombres de columna', 'SELECT declare, prepare, execute FROM t'],
      ['DEALLOCATE como literal', "SELECT 'DEALLOCATE'"],
      ['una columna llamada hold', 'SELECT hold FROM t WHERE hold = true'],
      ['una columna llamada with_hold', 'SELECT with_hold FROM t'],
      ['una consulta con WITH (CTE)', 'WITH x AS (SELECT 1) SELECT * FROM x'],
      ['un nombre que termina en lock', 'SELECT row_lock FROM t'],
      ['loan como nombre de columna (empieza por lo)', 'SELECT loan FROM t'],
    ])('criterio 94: %s pasa el lint en un modulo y en cli/', async (_nombre, sql) => {
      const eslint = obtener();
      for (const [forma, codigo] of enFormasAnalizadas(sql.replaceAll('${clave}', '1').replaceAll('${id}', '1'))) {
        expect(await errores(eslint, codigo, MODULO), `modulo, forma ${forma}: ${sql}`).toEqual([]);
        expect(await errores(eslint, codigo, CLI), `cli/, forma ${forma}: ${sql}`).toEqual([]);
      }
    });

    it('criterio 94: el mismo SQL de cursores como cadena o plantilla sin etiqueta pasa el lint (criterio 92)', async () => {
      const sql = 'DECLARE c CURSOR WITH HOLD FOR SELECT 1';

      expect(await errores(obtener(), `export const texto = ${JSON.stringify(sql)};`, MODULO)).toEqual([]);
      expect(await errores(obtener(), `export const texto = (id) => \`${sql} \${id}\`;`, MODULO)).toEqual([]);
    });
  });

  // Criterio 98: para que `enPlataforma` fije la zona horaria, en backend/src/cli/ la regla del criterio 83 admite ademas
  // exactamente `set_config('TimeZone', 'UTC', true)` (sin distinguir mayusculas en el nombre de la variable); fuera de cli/ y de
  // infraestructura/prisma/ sigue prohibida toda llamada a set_config.
  describe("criterio 98: set_config('TimeZone', 'UTC', true) solo se admite en backend/src/cli/", () => {
    it.each([
      ['la forma simple', "SELECT set_config('TimeZone', 'UTC', true)"],
      ['el nombre en minusculas', "SELECT set_config('timezone', 'UTC', true)"],
      ['el nombre en mayusculas', "SELECT set_config('TIMEZONE', 'UTC', true)"],
      ['TRUE en mayusculas', "SELECT set_config('TimeZone', 'UTC', TRUE)"],
      [
        'junto con el contexto de la transaccion',
        "SELECT set_config('app.plataforma', 'si', true), set_config('app.academia_id', '', true), set_config('TimeZone', 'UTC', true)",
      ],
    ])('criterio 98: %s pasa el lint en cli/ y en prisma/, y falla en un modulo', async (_nombre, sql) => {
      const eslint = obtener();
      expect(await errores(eslint, comoPlantilla(sql), CLI), `cli/: ${sql}`).toEqual([]);
      expect(await errores(eslint, comoPlantilla(sql), PRISMA), `prisma/: ${sql}`).toEqual([]);
      expect((await errores(eslint, comoPlantilla(sql), MODULO)).length, `modulo: ${sql}`).toBeGreaterThan(0);
    });

    it.each([
      ["otra zona horaria: 'America/Lima'", "SELECT set_config('TimeZone', 'America/Lima', true)"],
      ['TimeZone con false', "SELECT set_config('TimeZone', 'UTC', false)"],
      ['TimeZone con un valor interpolado', "SELECT set_config('TimeZone', ${zona}, true)"],
      ['TimeZone con un parametro', "SELECT set_config('TimeZone', $1, true)"],
      ['otra variable (search_path)', "SELECT set_config('search_path', 'UTC', true)"],
      ['otra variable (statement_timeout)', "SELECT set_config('statement_timeout', '0', true)"],
      ['el nombre armado con una columna', "SELECT set_config(nombre, 'UTC', true) FROM ajustes"],
    ])('criterio 98: %s sigue fallando el lint en cli/', async (_nombre, sql) => {
      const codigo = `export const f = (cliente, zona) => cliente.$queryRaw\`${sql}\`;`;

      expect((await errores(obtener(), codigo, CLI)).length, sql).toBeGreaterThan(0);
    });
  });

  describe('criterio 94: donde no se aplica', () => {
    it.each([
      ['DECLARE ... WITH HOLD', 'DECLARE c CURSOR WITH HOLD FOR SELECT 1'],
      ['CLOSE ALL', 'CLOSE ALL'],
      ['ALTER DEFAULT PRIVILEGES', 'ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO PUBLIC'],
      ['pg_advisory_lock', 'SELECT pg_advisory_lock(1)'],
      ['lo_create', 'SELECT lo_create(0)'],
      ['pg_terminate_backend', 'SELECT pg_terminate_backend(1)'],
    ])('criterio 94: %s no falla dentro de backend/src/infraestructura/prisma/', async (_nombre, sql) => {
      expect(await errores(obtener(), comoPlantilla(sql), PRISMA)).toEqual([]);
    });

    it.each([
      ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
      ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
      ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
    ])('criterio 94: los mismos textos no fallan en %s', async (_nombre, archivo) => {
      for (const sql of ['DECLARE c CURSOR WITH HOLD FOR SELECT 1', 'CLOSE ALL', 'SELECT pg_advisory_lock(1)']) {
        expect(await errores(obtener(), comoPlantilla(sql), archivo), sql).toEqual([]);
      }
    });
  });
});
