// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 115 (ataque ronda 4, falsos positivos; complementa los criterios 73 y 84): `SET` como clausula no es `SET` de sesion.
// Dado el texto normalizado de una plantilla analizada, las formas `SET [LOCAL|SESSION] ROLE`, `SET SESSION`,
// `SET [LOCAL|SESSION] SESSION AUTHORIZATION` y `SET [LOCAL|SESSION] app.` que se buscan en cualquier parte del texto (criterios
// 73 y 84) no cuentan cuando, en la misma sentencia (sin un `;` en medio), las precede la palabra `update` fuera de una cadena:
// son la clausula `SET` de un `UPDATE`, de un `ON CONFLICT DO UPDATE` o de un `MERGE ... UPDATE`, que asigna columnas. `SET` al
// inicio de una sentencia sigue fallando siempre (criterio 84).
// Pasan, por ejemplo, `UPDATE usuarios SET role = ${r} WHERE id = ${id}::uuid`, `UPDATE t SET session = ${s} WHERE ...` e
// `INSERT ... ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`; siguen fallando `SET ROLE postgres`,
// `SELECT 1; SET ROLE postgres` y `UPDATE t SET x = 1; SET SESSION AUTHORIZATION postgres`. Una palabra prohibida dentro de una
// cadena SQL (`SELECT ... WHERE motivo = 'WITH HOLD'`) sigue haciendo fallar el lint (limitacion aceptada); el valor va como
// parametro (`${'WITH HOLD'}`). Ningun ejemplo de las pruebas protegidas de las rondas 1 a 3 cambia de resultado.
import { describe, expect, it } from 'vitest';
import { CONFIGURACIONES, CLI, MODULO, PRISMA, errores } from './ayuda-lint-ronda4.mjs';

/** Un SQL en las cuatro formas de plantilla etiquetada que se analizan (criterio 92). */
function enFormasAnalizadas(sql) {
  return [
    ['$queryRaw etiquetada', `export const f = (cliente, r, id) => cliente.$queryRaw\`${sql}\`;`],
    ['$executeRaw etiquetada', `export const f = (cliente, r, id) => cliente.$executeRaw\`${sql}\`;`],
    ['Prisma.sql etiquetada', `export const f = (r, id) => Prisma.sql\`${sql}\`;`],
    ['sql etiquetada', `export const f = (r, id) => sql\`${sql}\`;`],
  ];
}

describe.each(CONFIGURACIONES)('criterio 115 con %s', (_configuracion, obtener) => {
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

  async function pasa(sql) {
    const eslint = obtener();
    for (const [forma, codigo] of enFormasAnalizadas(sql)) {
      for (const archivo of [MODULO, CLI]) {
        expect(await errores(eslint, codigo, archivo), `el lint rechazo en ${archivo} (${forma}): ${sql}`).toEqual([]);
      }
    }
  }

  describe('criterio 115: la clausula SET de un UPDATE, de ON CONFLICT DO UPDATE o de MERGE ... UPDATE pasa', () => {
    it.each([
      ['UPDATE ... SET role (ejemplo de la especificacion)', 'UPDATE usuarios SET role = ${r} WHERE id = ${id}::uuid'],
      ['UPDATE ... SET session (ejemplo de la especificacion)', 'UPDATE t SET session = ${s} WHERE id = ${id}::uuid'],
      [
        'ON CONFLICT DO UPDATE SET role (ejemplo de la especificacion)',
        'INSERT INTO usuarios (id, role) VALUES (${id}::uuid, ${r}) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role',
      ],
      [
        'MERGE ... WHEN MATCHED THEN UPDATE SET role',
        'MERGE INTO usuarios u USING nuevos n ON u.id = n.id WHEN MATCHED THEN UPDATE SET role = n.role',
      ],
      ['update en minusculas', 'update usuarios set role = ${r} where id = ${id}::uuid'],
      ['UPDATE con mayusculas y minusculas mezcladas', 'Update usuarios Set Role = ${r}'],
      ['UPDATE con saltos de linea', 'UPDATE usuarios\n  SET role = ${r}\n WHERE id = ${id}::uuid'],
      ['UPDATE con varios espacios', 'UPDATE   usuarios     SET    role = ${r}'],
      ['UPDATE con un comentario antes del SET', 'UPDATE usuarios /* roles */ SET role = ${r}'],
      ['UPDATE ... SET session_user_id (columna que empieza por session)', 'UPDATE t SET session_id = ${s}'],
      [
        'UPDATE ... SET session con otra columna despues',
        'UPDATE t SET session = ${s}, role = ${r} WHERE id = ${id}::uuid',
      ],
      ['UPDATE ONLY', 'UPDATE ONLY usuarios SET role = ${r}'],
      ['UPDATE con alias', 'UPDATE usuarios AS u SET role = ${r} WHERE u.id = ${id}::uuid'],
      ['UPDATE con RETURNING', 'UPDATE usuarios SET role = ${r} WHERE id = ${id}::uuid RETURNING id'],
      ['UPDATE de varias sentencias sin SET de sesion', 'UPDATE a SET x = 1; UPDATE b SET role = ${r}'],
      ['UPDATE ... SET con una columna app_algo', 'UPDATE t SET app_valor = ${r}'],
      ['UPDATE ... SET role dentro de un WITH', 'WITH x AS (SELECT 1) UPDATE usuarios SET role = ${r}'],
      [
        'ON CONFLICT DO UPDATE SET session',
        'INSERT INTO t (id, session) VALUES (${id}::uuid, ${s}) ON CONFLICT (id) DO UPDATE SET session = EXCLUDED.session',
      ],
    ])('criterio 115: %s pasa el lint', async (_nombre, sql) => {
      await pasa(sql);
    });

    it('criterio 115: un UPDATE ... SET role con un valor literal, como $queryRaw etiquetada', async () => {
      const eslint = obtener();
      const codigo =
        "export const f = (cliente) => cliente.$queryRaw`UPDATE usuarios SET role = 'admin' WHERE id = 1`;";

      for (const archivo of [MODULO, CLI]) expect(await errores(eslint, codigo, archivo), archivo).toEqual([]);
    });
  });

  describe('criterio 115: SET al inicio de una sentencia sigue fallando siempre (criterio 84)', () => {
    it.each([
      ['SET ROLE (ejemplo de la especificacion)', 'SET ROLE postgres'],
      ['SELECT 1; SET ROLE (ejemplo de la especificacion)', 'SELECT 1; SET ROLE postgres'],
      [
        'UPDATE ... ; SET SESSION AUTHORIZATION (ejemplo de la especificacion)',
        'UPDATE t SET x = 1; SET SESSION AUTHORIZATION postgres',
      ],
      ['SET LOCAL ROLE', 'SET LOCAL ROLE postgres'],
      ['SET SESSION ROLE', 'SET SESSION ROLE postgres'],
      ['SET SESSION AUTHORIZATION', 'SET SESSION AUTHORIZATION postgres'],
      ['SET LOCAL SESSION AUTHORIZATION', 'SET LOCAL SESSION AUTHORIZATION postgres'],
      ['SET SESSION CHARACTERISTICS', 'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE'],
      ['SET app.plataforma', "SET app.plataforma = 'si'"],
      ['SET LOCAL app.academia_id', "SET LOCAL app.academia_id = 'x'"],
      ['SET SESSION app.plataforma', "SET SESSION app.plataforma = 'si'"],
      ['UPDATE ... ; SET ROLE', 'UPDATE t SET x = 1; SET ROLE postgres'],
      ['UPDATE ... ; SET LOCAL ROLE', 'UPDATE t SET x = 1; SET LOCAL ROLE postgres'],
      ['UPDATE ... ; SET app.plataforma', "UPDATE t SET x = 1; SET app.plataforma = 'si'"],
      [
        'UPDATE ... ; SET statement_timeout (cualquier SET como sentencia)',
        'UPDATE t SET x = 1; SET statement_timeout = 0',
      ],
      ['UPDATE ... ; SET con saltos de linea', 'UPDATE t SET x = 1;\n  SET ROLE postgres'],
      ['SET ROLE en minusculas', 'set role postgres'],
      ['SET ROLE con un comentario antes', '/* x */ SET ROLE postgres'],
      ['SET ROLE despues de dos UPDATE', 'UPDATE a SET x = 1; UPDATE b SET y = 2; SET ROLE postgres'],
    ])('criterio 115: %s falla el lint', async (_nombre, sql) => {
      await esRechazado(sql);
    });

    it.each([
      [
        'la palabra update despues de la forma prohibida (no la precede)',
        'WITH x AS (SELECT 1) SET ROLE postgres UPDATE t SET a = 1',
      ],
      ['update solo en una cadena anterior', "SELECT 'update' AS palabra, 1 SET ROLE postgres"],
      ['update dentro de una cadena con mayusculas', "SELECT 'UPDATE t' SET SESSION AUTHORIZATION postgres"],
      ['update en una sentencia anterior separada por ;', 'SELECT 1 FROM t WHERE x = 1; SELECT 2 SET ROLE postgres'],
      ['update en una sentencia anterior y SET SESSION despues', 'UPDATE t SET x = 1; SELECT 1 SET SESSION y'],
    ])('criterio 115: %s falla el lint', async (_nombre, sql) => {
      await esRechazado(sql);
    });
  });

  describe('criterio 115: una palabra prohibida dentro de una cadena SQL sigue fallando (limitacion aceptada)', () => {
    it("criterio 115: SELECT ... WHERE motivo = 'WITH HOLD' falla el lint", async () => {
      await esRechazado("SELECT id FROM t WHERE motivo = 'WITH HOLD'");
    });

    it("criterio 115: el valor como parametro (${'WITH HOLD'}) pasa el lint", async () => {
      const codigo = "export const f = (cliente) => cliente.$queryRaw`SELECT id FROM t WHERE motivo = ${'WITH HOLD'}`;";

      for (const archivo of [MODULO, CLI]) expect(await errores(obtener(), codigo, archivo), archivo).toEqual([]);
    });
  });

  describe('criterio 115: donde no se aplica', () => {
    it('criterio 115: nada de lo anterior se evalua dentro de backend/src/infraestructura/prisma/', async () => {
      const codigo = 'export const f = (cliente) => cliente.$queryRaw`SET ROLE postgres; UPDATE t SET role = 1`;';

      expect(await errores(obtener(), codigo, PRISMA)).toEqual([]);
    });
  });
});
