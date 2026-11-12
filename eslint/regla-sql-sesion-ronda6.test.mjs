// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 136 (ataque ronda 6, O2 y O4; ajusta el alcance del criterio 84 y complementa el 94): fuera de
// backend/src/infraestructura/prisma/ (tambien en backend/src/cli/), sobre el texto normalizado de una plantilla analizada (criterios 83
// y 92):
//   - una sentencia (el texto completo o un tramo entre `;`) que es exactamente `SET CONSTRAINTS <lista> DEFERRED` o
//     `SET CONSTRAINTS <lista> IMMEDIATE`, donde `<lista>` es `ALL` o uno o mas nombres separados por comas (identificadores simples o
//     entre comillas dobles, con o sin `public.` delante), ya no hace fallar el lint: es local a la transaccion y no toca el contexto.
//     Cualquier otra forma de `SET` como sentencia sigue fallando (criterio 84), tambien `SET CONSTRAINTS ${nombre} DEFERRED` (un
//     marcador en lugar de un nombre), `SET CONSTRAINTS ALL` sin `DEFERRED` ni `IMMEDIATE`, y la sentencia que sigue a un `;`
//     (`SET CONSTRAINTS ALL DEFERRED; SET ROLE postgres` falla por la segunda);
//   - falla una llamada a `lastval` o a `currval`, con o sin `pg_catalog.`, con o sin comillas dobles o `U&"..."` en el nombre
//     (criterio 93) y con o sin espacios antes del parentesis: devuelven el ultimo valor de una secuencia en la SESION, y la conexion
//     del pool pasa de una academia a otra (se usa `RETURNING`).
// Pasan, por ejemplo, `SET CONSTRAINTS ALL DEFERRED`, `set constraints "pagos_caja_fk", public.otra_fk immediate`,
// `SELECT nextval('x_id_seq')`, `SELECT t.currval FROM t` (una columna, sin parentesis) e `INSERT ... RETURNING id`; fallan
// `SELECT lastval()`, `SELECT pg_catalog.currval('x_id_seq')`, `SELECT "currval" ('x')` y los de la vineta anterior.
// Ningun ejemplo de las pruebas protegidas de las rondas 1 a 5 usa `SET CONSTRAINTS`, `lastval` ni `currval`, asi que ninguno cambia de
// resultado. Se prueba con las dos configuraciones (eslint.config.mjs y la del paso protegido), por su efecto observable, como el
// criterio 92.
import { describe, expect, it } from 'vitest';
import { CLI, CONFIGURACIONES, MODULO, PRISMA, errores } from './ayuda-lint-ronda3.mjs';

/** Un SQL (sin valores interpolados salvo los que el propio texto trae) en las cuatro formas de plantilla etiquetada que se analizan. */
function enFormasAnalizadas(sql) {
  return [
    ['$queryRaw etiquetada', `export const f = (cliente) => cliente.$queryRaw\`${sql}\`;`],
    ['$executeRaw etiquetada', `export const f = (cliente) => cliente.$executeRaw\`${sql}\`;`],
    ['Prisma.sql etiquetada', `export const f = () => Prisma.sql\`${sql}\`;`],
    ['sql etiquetada', `export const f = () => sql\`${sql}\`;`],
  ];
}

describe.each(CONFIGURACIONES)('criterio 136 con %s', (_configuracion, obtener) => {
  /** Pasa en las cuatro formas, en un modulo, en cli/ y en prisma/. */
  async function pasa(sql) {
    const eslint = obtener();
    for (const [forma, codigo] of enFormasAnalizadas(sql)) {
      for (const archivo of [MODULO, CLI, PRISMA]) {
        expect(await errores(eslint, codigo, archivo), `el lint rechazo en ${archivo} (${forma}): ${sql}`).toEqual([]);
      }
    }
  }

  /** Falla en las cuatro formas, en un modulo y en cli/; limpio en prisma/ (el error es de la regla, no del ejemplo). */
  async function falla(sql) {
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

  describe('criterio 136: SET CONSTRAINTS ... DEFERRED / IMMEDIATE como sentencia exacta', () => {
    it.each([
      ['ALL DEFERRED', 'SET CONSTRAINTS ALL DEFERRED'],
      ['ALL IMMEDIATE', 'SET CONSTRAINTS ALL IMMEDIATE'],
      ['en minusculas', 'set constraints all deferred'],
      ['un nombre simple', 'SET CONSTRAINTS pagos_caja_fk DEFERRED'],
      ['un nombre con public. delante', 'SET CONSTRAINTS public.pagos_caja_fk IMMEDIATE'],
      [
        'varios nombres, uno entre comillas dobles y otro con public.',
        'set constraints "pagos_caja_fk", public.otra_fk immediate',
      ],
      ['tres nombres', 'SET CONSTRAINTS a_fk, b_fk, c_fk DEFERRED'],
      ['un nombre entre comillas dobles con espacios', 'SET CONSTRAINTS public."Mi llave" DEFERRED'],
      ['espacios y saltos de linea de mas', 'SET   CONSTRAINTS\n  ALL\n DEFERRED'],
      ['con punto y coma al final', 'SET CONSTRAINTS ALL DEFERRED;'],
      ['seguida de otra sentencia permitida', 'SET CONSTRAINTS ALL DEFERRED; SELECT 1'],
      ['despues de otra sentencia permitida', 'SELECT 1; SET CONSTRAINTS ALL IMMEDIATE'],
      ['dos SET CONSTRAINTS seguidos', 'SET CONSTRAINTS ALL DEFERRED; SET CONSTRAINTS ALL IMMEDIATE'],
    ])('criterio 136: %s ya no hace fallar el lint', async (_nombre, sql) => {
      await pasa(sql);
    });

    it.each([
      ['un marcador en lugar de un nombre', 'SET CONSTRAINTS ${nombre} DEFERRED'],
      ['un marcador entre varios nombres', 'SET CONSTRAINTS a_fk, ${nombre} DEFERRED'],
      ['ALL sin DEFERRED ni IMMEDIATE', 'SET CONSTRAINTS ALL'],
      ['un nombre sin DEFERRED ni IMMEDIATE', 'SET CONSTRAINTS pagos_caja_fk'],
      ['sin lista', 'SET CONSTRAINTS DEFERRED'],
      ['ALL junto con un nombre', 'SET CONSTRAINTS ALL, a_fk DEFERRED'],
      ['un modo que no existe', 'SET CONSTRAINTS ALL LATER'],
      ['algo despues del modo', 'SET CONSTRAINTS ALL DEFERRED extra'],
      ['un nombre de otro esquema', 'SET CONSTRAINTS otro.pagos_caja_fk DEFERRED'],
      ['ALL DEFERRED seguida de SET ROLE', 'SET CONSTRAINTS ALL DEFERRED; SET ROLE postgres'],
      ['SET ROLE seguida de ALL DEFERRED', 'SET ROLE postgres; SET CONSTRAINTS ALL DEFERRED'],
      ['ALL DEFERRED seguida de un SET de la sesion', "SET CONSTRAINTS ALL DEFERRED; SET app.plataforma = 'si'"],
      ['ALL DEFERRED seguida de RESET ALL', 'SET CONSTRAINTS ALL DEFERRED; RESET ALL'],
    ])('criterio 136: %s sigue fallando el lint', async (_nombre, sql) => {
      await falla(sql);
    });

    it.each([
      ['SET ROLE', 'SET ROLE postgres'],
      ['SET LOCAL de un parametro', 'SET LOCAL statement_timeout = 0'],
      ['SET search_path', 'SET search_path = trampa, public'],
      ['SET TIME ZONE', "SET TIME ZONE 'UTC'"],
      ['SET TRANSACTION', 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'],
      ['SET SESSION', "SET SESSION app.plataforma = 'si'"],
      ['RESET ALL', 'RESET ALL'],
    ])('criterio 136: %s, otra forma de SET como sentencia, sigue fallando (criterio 84)', async (_nombre, sql) => {
      await falla(sql);
    });
  });

  describe('criterio 136: lastval y currval fallan', () => {
    it.each([
      ['lastval()', 'SELECT lastval()'],
      ['lastval () con espacio antes del parentesis', 'SELECT lastval ()'],
      ['LASTVAL en mayusculas', 'SELECT LASTVAL()'],
      ['pg_catalog.lastval()', 'SELECT pg_catalog.lastval()'],
      ['"lastval" entre comillas dobles', 'SELECT "lastval"()'],
      ['pg_catalog."lastval"', 'SELECT pg_catalog."lastval"()'],
      ["currval('x_id_seq')", "SELECT currval('x_id_seq')"],
      ["pg_catalog.currval('x_id_seq')", "SELECT pg_catalog.currval('x_id_seq')"],
      ['"currval" (\'x\') entre comillas dobles y con espacio', 'SELECT "currval" (\'x\')'],
      ['CURRVAL en mayusculas', "SELECT CURRVAL('x_id_seq')"],
      ['currval con un valor interpolado', 'SELECT currval(${secuencia})'],
      ['currval con espacio y salto de linea antes del parentesis', "SELECT currval\n  ('x_id_seq')"],
      ['U&"..." con UESCAPE en el nombre (criterio 93)', `SELECT U&"curr!0076al" UESCAPE '!'('x_id_seq')`],
      ['U&"..." con UESCAPE en lastval', `SELECT U&"lastv!0061l" UESCAPE '!'()`],
      ['lastval dentro de un INSERT', 'INSERT INTO hijas (padre_id) VALUES (lastval())'],
      ['lastval despues de otra sentencia', 'INSERT INTO padres DEFAULT VALUES; SELECT lastval()'],
    ])('criterio 136: %s falla el lint', async (_nombre, sql) => {
      await falla(sql);
    });
  });

  describe('criterio 136: lo que sigue pasando', () => {
    it.each([
      ['nextval', "SELECT nextval('x_id_seq')"],
      ['pg_catalog.nextval', "SELECT pg_catalog.nextval('x_id_seq')"],
      ['currval como columna, sin parentesis', 'SELECT t.currval FROM t'],
      ['currval como columna sola', 'SELECT currval FROM t WHERE currval > 1'],
      ['lastval como columna, sin parentesis', 'SELECT lastval FROM t'],
      ['currval y lastval como alias', 'SELECT 1 AS currval, 2 AS lastval'],
      ['INSERT ... RETURNING id', 'INSERT INTO pagos (monto) VALUES (10) RETURNING id'],
    ])('criterio 136: %s pasa el lint', async (_nombre, sql) => {
      await pasa(sql);
    });

    it('criterio 136: un valor interpolado en SET CONSTRAINTS ... DEFERRED hecho con una cadena o una plantilla sin etiqueta no se analiza (criterio 92)', async () => {
      const eslint = obtener();

      expect(
        await errores(eslint, 'export const texto = "SET CONSTRAINTS ALL DEFERRED; SET ROLE postgres";', MODULO),
      ).toEqual([]);
      expect(await errores(eslint, 'export const texto = (n) => `SELECT lastval() ${n}`;', MODULO)).toEqual([]);
    });
  });

  describe('criterio 136: donde no se aplica', () => {
    it.each([
      ['lastval()', 'SELECT lastval()'],
      ['currval', "SELECT currval('x_id_seq')"],
      ['SET CONSTRAINTS ALL DEFERRED; SET ROLE postgres', 'SET CONSTRAINTS ALL DEFERRED; SET ROLE postgres'],
    ])('criterio 136: %s no falla dentro de backend/src/infraestructura/prisma/', async (_nombre, sql) => {
      for (const [forma, codigo] of enFormasAnalizadas(sql)) {
        expect(await errores(obtener(), codigo, PRISMA), forma).toEqual([]);
      }
    });

    it.each([
      ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
      ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
      ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
    ])('criterio 136: los mismos textos no fallan en %s', async (_nombre, archivo) => {
      for (const sql of ['SELECT lastval()', "SELECT currval('x_id_seq')"]) {
        const [, codigo] = enFormasAnalizadas(sql)[0];
        expect(await errores(obtener(), codigo, archivo), sql).toEqual([]);
      }
    });
  });
});
