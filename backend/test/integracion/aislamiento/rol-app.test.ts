// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { conClienteComo, ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { obtenerBaseDatos } from '../../utilidades/modulos';

const ROL = 'aquagestion_app';

async function consultar<T>(sql: string, parametros: unknown[] = []): Promise<T[]> {
  const { rows } = await ejecutarComo('propietario', sql, parametros);
  return rows as T[];
}

async function exigirRolDeLaApp(): Promise<void> {
  const filas = await consultar('SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1', [ROL]);
  if (filas.length === 0) {
    throw new Error(`Falta el rol ${ROL} en PostgreSQL (criterio 1): lo crea npm run db:crear y lo usa la migración.`);
  }
}

// Criterio 1: el rol de la aplicación no tiene privilegios. Si los tuviera, RLS no protegería nada (D-23).
describe('criterio 1: el rol aquagestion_app no tiene privilegios', () => {
  beforeAll(exigirRolDeLaApp);

  it('criterio 1: existe con LOGIN y sin SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE ni REPLICATION', async () => {
    const [rol] = await consultar<Record<string, boolean>>(
      `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
         FROM pg_catalog.pg_roles WHERE rolname = $1`,
      [ROL],
    );
    expect(rol).toEqual({
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
    });
  });

  it('criterio 1: no es miembro de ningún otro rol', async () => {
    const filas = await consultar<{ rol: string }>(
      `SELECT g.rolname AS rol FROM pg_catalog.pg_auth_members m
         JOIN pg_catalog.pg_roles u ON u.oid = m.member
         JOIN pg_catalog.pg_roles g ON g.oid = m.roleid
        WHERE u.rolname = $1`,
      [ROL],
    );
    expect(filas).toEqual([]);
  });

  it('criterio 1: no es dueño de ninguna tabla, vista, secuencia, tipo ni función del esquema public', async () => {
    const relaciones = await consultar<{ nombre: string; tipo: string }>(
      `SELECT c.relname AS nombre, c.relkind::text AS tipo FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'public' AND r.rolname = $1`,
      [ROL],
    );
    const tipos = await consultar<{ nombre: string }>(
      `SELECT t.typname AS nombre FROM pg_catalog.pg_type t
         JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_catalog.pg_roles r ON r.oid = t.typowner
        WHERE n.nspname = 'public' AND r.rolname = $1`,
      [ROL],
    );
    const funciones = await consultar<{ nombre: string }>(
      `SELECT p.proname AS nombre FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
        WHERE n.nspname = 'public' AND r.rolname = $1`,
      [ROL],
    );
    expect({ relaciones, tipos, funciones }).toEqual({ relaciones: [], tipos: [], funciones: [] });
  });

  it('criterio 1: las tablas de la historia existen y su dueño no es el rol de la app', async () => {
    const filas = await consultar<{ nombre: string; dueno: string }>(
      `SELECT c.relname AS nombre, r.rolname AS dueno FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
        ORDER BY c.relname`,
    );
    expect(filas.map((fila) => fila.nombre)).toEqual(
      expect.arrayContaining(['academias', 'auditoria', 'auditoria_plataforma', 'configuraciones', 'superadmins']),
    );
    for (const fila of filas) expect(fila.dueno, `dueño de ${fila.nombre}`).not.toBe(ROL);
  });

  it('criterio 1: no tiene CREATE sobre el esquema public ni sobre la base', async () => {
    const [privilegios] = await consultar<{ esquema: boolean; base: boolean }>(
      `SELECT pg_catalog.has_schema_privilege($1::name, 'public', 'CREATE') AS esquema,
              pg_catalog.has_database_privilege($1::name, pg_catalog.current_database(), 'CREATE') AS base`,
      [ROL],
    );
    expect(privilegios).toEqual({ esquema: false, base: false });
  });

  it('criterio 1: no tiene ningún privilegio sobre _prisma_migrations', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `SELECT pg_catalog.has_table_privilege($1::name, '_prisma_migrations', 'SELECT') AS "select",
              pg_catalog.has_table_privilege($1::name, '_prisma_migrations', 'INSERT') AS "insert",
              pg_catalog.has_table_privilege($1::name, '_prisma_migrations', 'UPDATE') AS "update",
              pg_catalog.has_table_privilege($1::name, '_prisma_migrations', 'DELETE') AS "delete",
              pg_catalog.has_table_privilege($1::name, '_prisma_migrations', 'TRUNCATE') AS "truncate",
              pg_catalog.has_table_privilege($1::name, '_prisma_migrations', 'REFERENCES') AS "references",
              pg_catalog.has_table_privilege($1::name, '_prisma_migrations', 'TRIGGER') AS "trigger",
              pg_catalog.has_any_column_privilege($1::name, '_prisma_migrations', 'SELECT') AS "columna_select",
              pg_catalog.has_any_column_privilege($1::name, '_prisma_migrations', 'UPDATE') AS "columna_update"`,
      [ROL],
    );
    expect(Object.values(privilegios ?? {}).every((valor) => valor === false)).toBe(true);
    await expect(ejecutarComo('app', 'SELECT 1 FROM _prisma_migrations')).rejects.toMatchObject({ code: '42501' });
  });
});

// Criterio 2: privilegios exactos sobre las tablas.
describe('criterio 2: privilegios exactos del rol de la app', () => {
  type Privilegio = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE' | 'REFERENCES' | 'TRIGGER';
  const PRIVILEGIOS: Privilegio[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  const PRIVILEGIOS_DE_COLUMNA: Privilegio[] = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'];

  /** Privilegios de tabla completos que debe tener el rol en cada tabla. */
  const ESPERADO_TABLA: Record<string, Privilegio[]> = {
    academias: ['SELECT', 'INSERT'],
    superadmins: ['SELECT'],
    auditoria: ['SELECT', 'INSERT'],
    auditoria_plataforma: ['SELECT', 'INSERT'],
    configuraciones: ['SELECT', 'INSERT', 'UPDATE'],
  };
  /** `UPDATE` solo de estas columnas (sin `UPDATE` de tabla completa). */
  const ESPERADO_UPDATE_COLUMNAS: Record<string, string[]> = {
    academias: ['actualizada_en', 'estado', 'motivo_suspension', 'suspendida_en'],
    superadmins: ['actualizado_en', 'bloqueado_hasta', 'intentos_fallidos', 'ultimo_acceso', 'version_token'],
  };

  beforeAll(exigirRolDeLaApp);

  it('criterio 2: sobre las cinco tablas tiene exactamente los privilegios de tabla indicados', async () => {
    const obtenido: Record<string, string[]> = {};
    for (const tabla of Object.keys(ESPERADO_TABLA)) {
      const consultas = PRIVILEGIOS.map(
        (privilegio) =>
          `pg_catalog.has_table_privilege($1::name, 'public.${tabla}', '${privilegio}') AS "${privilegio}"`,
      );
      const [fila] = await consultar<Record<string, boolean>>(`SELECT ${consultas.join(', ')}`, [ROL]);
      obtenido[tabla] = PRIVILEGIOS.filter((privilegio) => fila?.[privilegio] === true);
    }
    expect(obtenido).toEqual(ESPERADO_TABLA);
  });

  it('criterio 2: UPDATE en academias y superadmins es solo de las columnas indicadas', async () => {
    const obtenido: Record<string, string[]> = {};
    for (const tabla of Object.keys(ESPERADO_UPDATE_COLUMNAS)) {
      const filas = await consultar<{ columna: string; puede: boolean }>(
        `SELECT a.attname AS columna, pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'UPDATE') AS puede
           FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
          WHERE c.oid = ('public.' || $2)::regclass AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attname`,
        [ROL, tabla],
      );
      obtenido[tabla] = filas.filter((fila) => fila.puede).map((fila) => fila.columna);
    }
    expect(obtenido).toEqual(ESPERADO_UPDATE_COLUMNAS);
  });

  it('criterio 2: ninguna columna tiene REFERENCES, y SELECT e INSERT por columna coinciden con los de tabla', async () => {
    const filas = await consultar<{ tabla: string; columna: string; privilegio: Privilegio; puede: boolean }>(
      `SELECT c.relname AS tabla, a.attname AS columna, p.privilegio,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, p.privilegio) AS puede
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        CROSS JOIN unnest($2::text[]) AS p(privilegio)
        WHERE n.nspname = 'public' AND c.relkind = 'r'`,
      [ROL, PRIVILEGIOS_DE_COLUMNA],
    );
    for (const fila of filas) {
      if (fila.privilegio === 'UPDATE') continue; // lo comprueba la prueba anterior
      if (!(fila.tabla in ESPERADO_TABLA) && fila.tabla !== '_prisma_migrations') continue; // tablas de historias futuras
      const esperado = (ESPERADO_TABLA[fila.tabla] ?? []).includes(fila.privilegio);
      expect(fila.puede, `${fila.privilegio} en ${fila.tabla}.${fila.columna}`).toBe(esperado);
    }
  });

  it('criterio 2: ninguna tabla de public tiene DELETE, TRUNCATE, REFERENCES ni TRIGGER para el rol', async () => {
    const filas = await consultar<{ tabla: string; privilegio: string }>(
      `SELECT c.relname AS tabla, p.privilegio FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN unnest(ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(privilegio)
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
          AND pg_catalog.has_table_privilege($1::name, c.oid, p.privilegio)`,
      [ROL],
    );
    expect(filas).toEqual([]);
  });
});

// Criterio 3: la API se conecta con DATABASE_URL_APP.
describe('criterio 3: la API corre como aquagestion_app', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await crearAppDePruebas();
  });
  beforeEach(limpiarBase);
  afterAll(async () => {
    await app?.close();
  });

  it('criterio 3: SELECT current_user dentro de conAcademia devuelve aquagestion_app', async () => {
    const academia = await crearAcademiaDePrueba();
    const baseDatos = await obtenerBaseDatos(app);

    const usuario = await baseDatos.conAcademia(academia.id, (tx) =>
      tx.cliente.$queryRawUnsafe<{ usuario: string }[]>('SELECT current_user::text AS usuario'),
    );

    expect(usuario).toEqual([{ usuario: ROL }]);
  });

  it('criterio 3: SELECT current_user dentro de comoPlataforma devuelve aquagestion_app', async () => {
    const baseDatos = await obtenerBaseDatos(app);

    const usuario = await baseDatos.comoPlataforma((tx) =>
      tx.cliente.$queryRawUnsafe<{ usuario: string }[]>('SELECT current_user::text AS usuario'),
    );

    expect(usuario).toEqual([{ usuario: ROL }]);
  });
});

// Criterio 47: el rol de la app no puede tomar los privilegios de otro.
describe('criterio 47: la app no puede cambiar de rol', () => {
  beforeAll(exigirRolDeLaApp);

  function usuarioPropietario(): string {
    const url = process.env['DATABASE_URL_PRUEBAS'] ?? '';
    return decodeURIComponent(new URL(url).username);
  }

  it.each([
    ['SET ROLE hacia el dueño de las tablas', () => `SET ROLE "${usuarioPropietario()}"`],
    ['SET ROLE hacia postgres', () => 'SET ROLE postgres'],
    ['SET SESSION AUTHORIZATION hacia el dueño', () => `SET SESSION AUTHORIZATION "${usuarioPropietario()}"`],
    ['SET SESSION AUTHORIZATION hacia postgres', () => 'SET SESSION AUTHORIZATION postgres'],
  ])('criterio 47: %s falla por falta de permisos', async (_nombre, sentencia) => {
    await conClienteComo('app', async (cliente) => {
      await expect(cliente.query(sentencia())).rejects.toMatchObject({ code: '42501' });
      const { rows } = await cliente.query<{ usuario: string }>('SELECT current_user::text AS usuario');
      expect(rows[0]?.usuario).toBe(ROL);
    });
  });
});
