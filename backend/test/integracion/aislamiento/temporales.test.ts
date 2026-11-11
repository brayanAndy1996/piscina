// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { type BaseDatosPrueba, obtenerBaseDatos } from '../../utilidades/modulos';

// Criterio 82 (ataque ronda 2, F4): con las migraciones aplicadas, PUBLIC no tiene TEMPORARY sobre la base y
// `aquagestion_app` tampoco (ni directo ni heredado); CONNECT se conserva. Como app, tambien dentro de `conAcademia` y de
// `comoPlataforma`, `CREATE TEMP TABLE`, `CREATE TEMPORARY TABLE superadmins` (una tabla temporal con el nombre de una
// tabla del negocio taparia la verdadera) y `SELECT 1 AS a INTO TEMP t` fallan con SQLSTATE 42501.
// La parte de `db:crear` (revocacion idempotente sobre las bases que crea o encuentra) esta en
// scripts/test/integracion/rol-app-ronda2.test.mjs.

const SENTENCIAS_TEMPORALES: readonly (readonly [string, string])[] = [
  ['CREATE TEMP TABLE t (a int)', 'CREATE TEMP TABLE t (a int)'],
  ['CREATE TEMPORARY TABLE superadmins (id uuid)', 'CREATE TEMPORARY TABLE superadmins (id uuid)'],
  ['SELECT 1 AS a INTO TEMP t', 'SELECT 1 AS a INTO TEMP t'],
];

/** Texto del error y de sus partes (Prisma deja el codigo de PostgreSQL en el mensaje y en `meta`). */
function textoDelError(error: unknown): string {
  if (error === undefined || error === null) return '';
  if (!(error instanceof Error)) return typeof error === 'string' ? error : JSON.stringify(error);
  const extra = error as { code?: unknown; meta?: unknown };
  const codigo = typeof extra.code === 'string' ? extra.code : '';
  return [error.name, error.message, codigo, JSON.stringify(extra.meta ?? null), textoDelError(error.cause)].join(' ');
}

async function intentar(trabajo: () => Promise<unknown>): Promise<unknown> {
  try {
    await trabajo();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('criterio 82: catalogo, sin TEMPORARY para PUBLIC ni para aquagestion_app', () => {
  it('criterio 82: PUBLIC no tiene TEMPORARY sobre la base', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT a.privilege_type
         FROM pg_catalog.pg_database d,
              LATERAL pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
        WHERE d.datname = pg_catalog.current_database() AND a.grantee = 0`,
    );

    const privilegios = (rows as { privilege_type: string }[]).map((fila) => fila.privilege_type);
    expect(privilegios).not.toContain('TEMPORARY');
  });

  it('criterio 82: aquagestion_app no tiene TEMPORARY sobre la base, ni directo ni heredado', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT pg_catalog.has_database_privilege('aquagestion_app', pg_catalog.current_database(), 'TEMPORARY') AS temporal`,
    );

    expect((rows[0] as { temporal: boolean }).temporal).toBe(false);
  });

  it('criterio 82: aquagestion_app conserva CONNECT sobre la base (la revocacion no lo quita)', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT pg_catalog.has_database_privilege('aquagestion_app', pg_catalog.current_database(), 'CONNECT') AS conecta`,
    );

    expect((rows[0] as { conecta: boolean }).conecta).toBe(true);
  });

  it('criterio 82: como app, sin contexto, cada forma de tabla temporal falla con SQLSTATE 42501', async () => {
    for (const [, sql] of SENTENCIAS_TEMPORALES) {
      const error = await ejecutarComo('app', sql).then(
        () => undefined,
        (causa: unknown) => causa,
      );

      expect((error as { code?: string } | undefined)?.code, `se esperaba 42501 con: ${sql}`).toBe('42501');
    }
  });

  it('criterio 82: como app con el contexto de plataforma, una tabla temporal tambien falla con 42501', async () => {
    const error = await ejecutarComo('app', 'CREATE TEMPORARY TABLE superadmins (id uuid)', [], {
      plataforma: true,
    }).then(
      () => undefined,
      (causa: unknown) => causa,
    );

    expect((error as { code?: string } | undefined)?.code).toBe('42501');
  });
});

describe('criterio 82: dentro de BaseDatos (conAcademia y comoPlataforma)', () => {
  let app: NestExpressApplication;
  let baseDatos: BaseDatosPrueba;
  let academia: AcademiaDePrueba;

  // Una aplicacion nueva por caso: si el rol todavia pudiera crear tablas temporales, la tabla quedaria en la conexion del
  // pool y tapar a la verdadera en los casos siguientes.
  beforeEach(async () => {
    await limpiarBase();
    academia = await crearAcademiaDePrueba();
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    baseDatos = await obtenerBaseDatos(app);
  });
  afterEach(async () => {
    await app?.close();
  });

  it.each(SENTENCIAS_TEMPORALES)('criterio 82: conAcademia rechaza %s con SQLSTATE 42501', async (_nombre, sql) => {
    const error = await intentar(() =>
      baseDatos.conAcademia(academia.id, async (tx) => {
        if (sql.startsWith('SELECT')) await tx.cliente.$queryRawUnsafe(sql);
        else await tx.cliente.$executeRawUnsafe(sql);
      }),
    );

    expect(error, `la sentencia se ejecuto: ${sql}`).toBeDefined();
    expect(textoDelError(error)).toContain('42501');
  });

  it.each(SENTENCIAS_TEMPORALES)('criterio 82: comoPlataforma rechaza %s con SQLSTATE 42501', async (_nombre, sql) => {
    const error = await intentar(() =>
      baseDatos.comoPlataforma(async (tx) => {
        if (sql.startsWith('SELECT')) await tx.cliente.$queryRawUnsafe(sql);
        else await tx.cliente.$executeRawUnsafe(sql);
      }),
    );

    expect(error, `la sentencia se ejecuto: ${sql}`).toBeDefined();
    expect(textoDelError(error)).toContain('42501');
  });
});
