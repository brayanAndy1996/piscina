// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';

const ROL = 'aquagestion_app';
const TABLAS_DE_LA_001 = ['academias', 'auditoria', 'auditoria_plataforma', 'configuraciones', 'superadmins'];
const TABLAS_SIN_ACADEMIA_ID = ['_prisma_migrations', 'academias', 'auditoria_plataforma', 'superadmins'];

async function consultar<T>(sql: string, parametros: unknown[] = []): Promise<T[]> {
  const { rows } = await ejecutarComo('propietario', sql, parametros);
  return rows as T[];
}

/** Tablas ordinarias de `public`. */
async function tablas(): Promise<string[]> {
  const filas = await consultar<{ nombre: string }>(
    `SELECT c.relname AS nombre FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`,
  );
  return filas.map((fila) => fila.nombre);
}

async function tablasConAcademiaId(): Promise<string[]> {
  const filas = await consultar<{ nombre: string }>(
    `SELECT DISTINCT c.relname AS nombre FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attname = 'academia_id'
        AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname`,
  );
  return filas.map((fila) => fila.nombre);
}

describe('criterio 9: seguridad a nivel de fila activada y forzada', () => {
  it('criterio 9: las cinco tablas de la 001 existen', async () => {
    expect(await tablas()).toEqual(expect.arrayContaining(TABLAS_DE_LA_001));
  });

  it('criterio 9: toda tabla de public salvo _prisma_migrations tiene relrowsecurity y relforcerowsecurity', async () => {
    const filas = await consultar<{ nombre: string; activa: boolean; forzada: boolean }>(
      `SELECT c.relname AS nombre, c.relrowsecurity AS activa, c.relforcerowsecurity AS forzada
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'
        ORDER BY c.relname`,
    );
    expect(filas.map((fila) => fila.nombre)).toEqual(expect.arrayContaining(TABLAS_DE_LA_001));
    const sinRls = filas.filter((fila) => !fila.activa || !fila.forzada).map((fila) => fila.nombre);
    expect(sinRls, 'tablas sin RLS activada y forzada').toEqual([]);
  });
});

describe('criterio 10: solo las tablas de plataforma carecen de academia_id', () => {
  it('criterio 10: las únicas tablas sin academia_id son academias, superadmins, auditoria_plataforma y _prisma_migrations', async () => {
    const todas = await tablas();
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['auditoria', 'configuraciones']));
    const sinAcademia = todas.filter((tabla) => !conAcademia.includes(tabla));
    expect(sinAcademia).toEqual([...TABLAS_SIN_ACADEMIA_ID].sort());
  });
});

describe('criterio 11: tablas con academia_id', () => {
  it('criterio 11: academia_id es uuid NOT NULL en toda tabla que lo tiene', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['auditoria', 'configuraciones']));
    const filas = await consultar<{ tabla: string; tipo: string; nulo: boolean }>(
      `SELECT c.relname AS tabla, t.typname AS tipo, NOT a.attnotnull AS nulo FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
        WHERE n.nspname = 'public' AND a.attname = 'academia_id' AND c.relkind IN ('r', 'p')
          AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    for (const fila of filas) {
      expect(fila.tipo, `tipo de ${fila.tabla}.academia_id`).toBe('uuid');
      expect(fila.nulo, `${fila.tabla}.academia_id admite nulos`).toBe(false);
    }
  });

  it('criterio 11: tiene una llave foránea a academias(id) sin borrado en cascada', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['auditoria', 'configuraciones']));
    for (const tabla of conAcademia) {
      const llaves = await consultar<{ accion: string }>(
        `SELECT f.confdeltype::text AS accion FROM pg_catalog.pg_constraint f
           JOIN pg_catalog.pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = ANY (f.conkey)
          WHERE f.contype = 'f' AND f.conrelid = ('public.' || $1)::regclass
            AND f.confrelid = 'public.academias'::regclass AND a.attname = 'academia_id'
            AND array_length(f.conkey, 1) = 1
            AND (SELECT r.attname FROM pg_catalog.pg_attribute r
                  WHERE r.attrelid = f.confrelid AND r.attnum = f.confkey[1]) = 'id'`,
        [`"${tabla}"`],
      );
      expect(llaves.length, `${tabla}: falta la llave foránea academia_id -> academias(id)`).toBeGreaterThan(0);
      for (const llave of llaves) {
        // 'a' = NO ACTION, 'r' = RESTRICT; 'c' = CASCADE sería borrar los datos de una academia al borrarla.
        expect(['a', 'r'], `${tabla}: borrado de la llave foránea`).toContain(llave.accion);
      }
    }
  });

  it('criterio 11: tiene políticas para cada comando concedido a aquagestion_app', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['auditoria', 'configuraciones']));
    for (const tabla of conAcademia) {
      const [concedidos] = await consultar<Record<string, boolean>>(
        `SELECT pg_catalog.has_any_column_privilege($1::name, ('public.' || $2)::regclass, 'SELECT') AS "SELECT",
                pg_catalog.has_any_column_privilege($1::name, ('public.' || $2)::regclass, 'INSERT') AS "INSERT",
                pg_catalog.has_any_column_privilege($1::name, ('public.' || $2)::regclass, 'UPDATE') AS "UPDATE",
                pg_catalog.has_table_privilege($1::name, ('public.' || $2)::regclass, 'DELETE') AS "DELETE"`,
        [ROL, `"${tabla}"`],
      );
      const politicas = await consultar<{ comando: string }>(
        `SELECT cmd AS comando FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = $1`,
        [tabla],
      );
      const comandos = politicas.map((politica) => politica.comando);
      for (const comando of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        if (concedidos?.[comando]) {
          expect(
            comandos.includes(comando) || comandos.includes('ALL'),
            `${tabla}: el rol tiene ${comando} pero no hay política para ese comando`,
          ).toBe(true);
        }
      }
    }
  });

  it('criterio 11: toda política compara academia_id con app_academia_actual() y ninguna es USING (true)', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['auditoria', 'configuraciones']));
    const politicas = await consultar<{
      tabla: string;
      nombre: string;
      comando: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `SELECT tablename AS tabla, policyname AS nombre, cmd AS comando, qual, with_check
         FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY ($1::text[])`,
      [conAcademia],
    );
    expect(politicas.length).toBeGreaterThan(0);
    const compara =
      /academia_id\s*=\s*(public\.)?app_academia_actual\(\)|(public\.)?app_academia_actual\(\)\s*=\s*academia_id/;
    const esTrue = /^\(*\s*true\s*\)*$/i;
    for (const politica of politicas) {
      const etiqueta = `${politica.tabla}.${politica.nombre} (${politica.comando})`;
      const expresiones = [politica.qual, politica.with_check].filter((texto): texto is string => texto !== null);
      expect(expresiones.length, `${etiqueta}: sin expresión`).toBeGreaterThan(0);
      if (politica.comando === 'INSERT') expect(politica.with_check, `${etiqueta}: falta WITH CHECK`).not.toBeNull();
      else expect(politica.qual, `${etiqueta}: falta USING`).not.toBeNull();
      for (const expresion of expresiones) {
        expect(expresion.trim(), `${etiqueta} es siempre verdadera`).not.toMatch(esTrue);
        expect(expresion, `${etiqueta} no compara academia_id con app_academia_actual()`).toMatch(compara);
      }
    }
  });
});

describe('criterio 12: las llaves foráneas no cruzan academias', () => {
  it('criterio 12: toda llave foránea entre tablas con academia_id incluye academia_id en ambos lados', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['auditoria', 'configuraciones']));
    const llaves = await consultar<{ nombre: string; tabla: string; destino: string; pares: string[] }>(
      `SELECT f.conname AS nombre, f.conrelid::regclass::text AS tabla, f.confrelid::regclass::text AS destino,
              ARRAY(SELECT o.attname || '->' || d.attname
                      FROM unnest(f.conkey, f.confkey) AS k(origen, referido)
                      JOIN pg_catalog.pg_attribute o ON o.attrelid = f.conrelid AND o.attnum = k.origen
                      JOIN pg_catalog.pg_attribute d ON d.attrelid = f.confrelid AND d.attnum = k.referido) AS pares
         FROM pg_catalog.pg_constraint f
         JOIN pg_catalog.pg_namespace n ON n.oid = f.connamespace
        WHERE f.contype = 'f' AND n.nspname = 'public'`,
    );
    for (const llave of llaves) {
      const origen = llave.tabla.replace(/"/g, '');
      const destino = llave.destino.replace(/"/g, '');
      if (!conAcademia.includes(origen) || !conAcademia.includes(destino)) continue;
      expect(llave.pares, `${llave.nombre} (${origen} -> ${destino}) no incluye academia_id en ambos lados`).toContain(
        'academia_id->academia_id',
      );
    }
  });

  it('criterio 12: toda tabla con academia_id y columna id tiene UNIQUE o PRIMARY KEY sobre (academia_id, id)', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['auditoria', 'configuraciones']));
    const conId = await consultar<{ tabla: string }>(
      `SELECT c.relname AS tabla FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND a.attname = 'id' AND c.relkind IN ('r', 'p')
          AND a.attnum > 0 AND NOT a.attisdropped AND c.relname = ANY ($1::text[])`,
      [conAcademia],
    );
    expect(conId.map((fila) => fila.tabla)).toContain('auditoria');
    for (const { tabla } of conId) {
      const restricciones = await consultar<{ columnas: string[] }>(
        `SELECT ARRAY(SELECT a.attname::text FROM unnest(k.conkey) AS u(num)
                        JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.num
                       ORDER BY a.attname) AS columnas
           FROM pg_catalog.pg_constraint k
          WHERE k.contype IN ('u', 'p') AND k.conrelid = ('public.' || $1)::regclass`,
        [`"${tabla}"`],
      );
      const buscadas = restricciones.some(
        (restriccion) => restriccion.columnas.join(',') === ['academia_id', 'id'].join(','),
      );
      expect(buscadas, `${tabla}: falta UNIQUE (academia_id, id)`).toBe(true);
    }
  });
});
