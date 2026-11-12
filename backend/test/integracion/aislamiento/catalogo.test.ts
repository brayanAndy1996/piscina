// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import {
  TABLAS_SIN_ACADEMIA_ID,
  conAcademiaId,
  esquemasRevisados,
  partirNombre,
  regclassDe,
  relacionDeExtension,
  tablasConAcademiaId as consultaTablasConAcademiaId,
  tablasSinAcademiaId,
  tablasSinRls,
  todasLasTablas,
} from '../../utilidades/catalogo';
import { conClienteComo, ejecutarComo } from '../../utilidades/base-datos';

// Criterios 9 a 12 (spec 001). AMPLIADO POR EL CRITERIO 131 (ataque ronda 6, F1 (b)): las pruebas de catalogo miran las relaciones, las
// restricciones y las politicas de TODOS los esquemas revisados (todos menos `pg_catalog`, `information_schema`, `pg_toast`, los
// temporales y los de una extension; sin los objetos de extensiones), no solo `public`. Las excepciones por nombre
// (`public._prisma_migrations` del criterio 9 y la lista del criterio 10) valen solo en `public`; "tabla con `academia_id`" es una
// tabla de cualquiera de esos esquemas, y los nombres se comparan como `esquema.tabla`. Lo que se comprueba en `public` no cambia.
// Las consultas compartidas estan en `backend/test/utilidades/catalogo.ts`; la autocomprobacion de que detectan una tabla de otro
// esquema esta en `catalogo-esquemas.test.ts`.

const ROL = 'aquagestion_app';
const TABLAS_DE_LA_001 = [
  'public.academias',
  'public.auditoria',
  'public.auditoria_plataforma',
  'public.configuraciones',
  'public.superadmins',
];

async function consultar<T>(sql: string, parametros: unknown[] = []): Promise<T[]> {
  const { rows } = await ejecutarComo('propietario', sql, parametros);
  return rows as T[];
}

/** Tablas ordinarias y particionadas de los esquemas revisados, como `esquema.tabla`. */
const tablas = (): Promise<string[]> => conClienteComo('propietario', todasLasTablas);

const tablasConAcademiaId = (): Promise<string[]> => conClienteComo('propietario', consultaTablasConAcademiaId);

describe('criterio 9: seguridad a nivel de fila activada y forzada', () => {
  it('criterio 9: las cinco tablas de la 001 existen', async () => {
    expect(await tablas()).toEqual(expect.arrayContaining(TABLAS_DE_LA_001));
  });

  it('criterio 9 y 131: toda tabla de los esquemas revisados salvo public._prisma_migrations tiene relrowsecurity y relforcerowsecurity', async () => {
    const filas = await consultar<{ nombre: string; activa: boolean; forzada: boolean }>(
      `SELECT n.nspname || '.' || c.relname AS nombre, c.relrowsecurity AS activa, c.relforcerowsecurity AS forzada
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE ${esquemasRevisados('n')} AND c.relkind IN ('r', 'p') AND NOT (${relacionDeExtension('c')})
          AND n.nspname || '.' || c.relname <> 'public._prisma_migrations'
        ORDER BY 1`,
    );
    expect(filas.map((fila) => fila.nombre)).toEqual(expect.arrayContaining(TABLAS_DE_LA_001));
    const sinRls = filas.filter((fila) => !fila.activa || !fila.forzada).map((fila) => fila.nombre);
    expect(sinRls, 'tablas sin RLS activada y forzada').toEqual([]);
  });

  it('criterio 9 y 131: ninguna tabla de ningun esquema revisado (salvo public._prisma_migrations) queda sin RLS activada y forzada', async () => {
    expect(await conClienteComo('propietario', tablasSinRls)).toEqual([]);
  });
});

describe('criterio 10: solo las tablas de plataforma carecen de academia_id', () => {
  it('criterio 10 y 131: las únicas tablas sin academia_id son public.academias, public.superadmins, public.auditoria_plataforma y public._prisma_migrations', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['public.auditoria', 'public.configuraciones']));
    const sinAcademia = await conClienteComo('propietario', tablasSinAcademiaId);
    expect(sinAcademia).toEqual([...TABLAS_SIN_ACADEMIA_ID].sort());
  });
});

describe('criterio 11: tablas con academia_id', () => {
  it('criterio 11 y 131: academia_id es uuid NOT NULL en toda tabla que lo tiene', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['public.auditoria', 'public.configuraciones']));
    const filas = await consultar<{ tabla: string; tipo: string; nulo: boolean }>(
      `SELECT n.nspname || '.' || c.relname AS tabla, t.typname AS tipo, NOT a.attnotnull AS nulo
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
        WHERE ${esquemasRevisados('n')} AND NOT (${relacionDeExtension('c')})
          AND a.attname = 'academia_id' AND c.relkind IN ('r', 'p')
          AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    expect(filas.map((fila) => fila.tabla).sort()).toEqual(conAcademia);
    for (const fila of filas) {
      expect(fila.tipo, `tipo de ${fila.tabla}.academia_id`).toBe('uuid');
      expect(fila.nulo, `${fila.tabla}.academia_id admite nulos`).toBe(false);
    }
  });

  it('criterio 11 y 131: tiene una llave foránea a public.academias(id) sin borrado en cascada', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['public.auditoria', 'public.configuraciones']));
    for (const nombre of conAcademia) {
      const { esquema, tabla } = partirNombre(nombre);
      const llaves = await consultar<{ accion: string }>(
        `SELECT f.confdeltype::text AS accion FROM pg_catalog.pg_constraint f
           JOIN pg_catalog.pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = ANY (f.conkey)
          WHERE f.contype = 'f' AND f.conrelid = ${regclassDe('$1', '$2')}
            AND f.confrelid = 'public.academias'::pg_catalog.regclass AND a.attname = 'academia_id'
            AND array_length(f.conkey, 1) = 1
            AND (SELECT r.attname FROM pg_catalog.pg_attribute r
                  WHERE r.attrelid = f.confrelid AND r.attnum = f.confkey[1]) = 'id'`,
        [esquema, tabla],
      );
      expect(llaves.length, `${nombre}: falta la llave foránea academia_id -> academias(id)`).toBeGreaterThan(0);
      for (const llave of llaves) {
        // 'a' = NO ACTION, 'r' = RESTRICT; 'c' = CASCADE sería borrar los datos de una academia al borrarla.
        expect(['a', 'r'], `${nombre}: borrado de la llave foránea`).toContain(llave.accion);
      }
    }
  });

  it('criterio 11 y 131: tiene políticas para cada comando concedido a aquagestion_app', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['public.auditoria', 'public.configuraciones']));
    for (const nombre of conAcademia) {
      const { esquema, tabla } = partirNombre(nombre);
      const [concedidos] = await consultar<Record<string, boolean>>(
        `SELECT pg_catalog.has_any_column_privilege($1::name, ${regclassDe('$2', '$3')}, 'SELECT') AS "SELECT",
                pg_catalog.has_any_column_privilege($1::name, ${regclassDe('$2', '$3')}, 'INSERT') AS "INSERT",
                pg_catalog.has_any_column_privilege($1::name, ${regclassDe('$2', '$3')}, 'UPDATE') AS "UPDATE",
                pg_catalog.has_table_privilege($1::name, ${regclassDe('$2', '$3')}, 'DELETE') AS "DELETE"`,
        [ROL, esquema, tabla],
      );
      const politicas = await consultar<{ comando: string }>(
        `SELECT cmd AS comando FROM pg_catalog.pg_policies WHERE schemaname = $1 AND tablename = $2`,
        [esquema, tabla],
      );
      const comandos = politicas.map((politica) => politica.comando);
      for (const comando of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        if (concedidos?.[comando]) {
          expect(
            comandos.includes(comando) || comandos.includes('ALL'),
            `${nombre}: el rol tiene ${comando} pero no hay política para ese comando`,
          ).toBe(true);
        }
      }
    }
  });

  it('criterio 11 y 131: toda política compara academia_id con app_academia_actual() y ninguna es USING (true)', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['public.auditoria', 'public.configuraciones']));
    const politicas = await consultar<{
      tabla: string;
      nombre: string;
      comando: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `SELECT schemaname || '.' || tablename AS tabla, policyname AS nombre, cmd AS comando, qual, with_check
         FROM pg_catalog.pg_policies WHERE schemaname || '.' || tablename = ANY ($1::text[])`,
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
  it('criterio 12 y 131: toda llave foránea entre tablas con academia_id incluye academia_id en ambos lados', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['public.auditoria', 'public.configuraciones']));
    const llaves = await consultar<{ nombre: string; tabla: string; destino: string; pares: string[] }>(
      `SELECT f.conname AS nombre, no.nspname || '.' || co.relname AS tabla, nd.nspname || '.' || cd.relname AS destino,
              ARRAY(SELECT o.attname || '->' || d.attname
                      FROM unnest(f.conkey, f.confkey) AS k(origen, referido)
                      JOIN pg_catalog.pg_attribute o ON o.attrelid = f.conrelid AND o.attnum = k.origen
                      JOIN pg_catalog.pg_attribute d ON d.attrelid = f.confrelid AND d.attnum = k.referido) AS pares
         FROM pg_catalog.pg_constraint f
         JOIN pg_catalog.pg_class co ON co.oid = f.conrelid
         JOIN pg_catalog.pg_namespace no ON no.oid = co.relnamespace
         JOIN pg_catalog.pg_class cd ON cd.oid = f.confrelid
         JOIN pg_catalog.pg_namespace nd ON nd.oid = cd.relnamespace
        WHERE f.contype = 'f' AND ${esquemasRevisados('no')} AND NOT (${relacionDeExtension('co')})`,
    );
    for (const llave of llaves) {
      if (!conAcademia.includes(llave.tabla) || !conAcademia.includes(llave.destino)) continue;
      expect(
        llave.pares,
        `${llave.nombre} (${llave.tabla} -> ${llave.destino}) no incluye academia_id en ambos lados`,
      ).toContain('academia_id->academia_id');
    }
  });

  it('criterio 12 y 131: toda tabla con academia_id y columna id tiene UNIQUE o PRIMARY KEY sobre (academia_id, id)', async () => {
    const conAcademia = await tablasConAcademiaId();
    expect(conAcademia).toEqual(expect.arrayContaining(['public.auditoria', 'public.configuraciones']));
    const conId = await consultar<{ tabla: string }>(
      `SELECT n.nspname || '.' || c.relname AS tabla FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE ${esquemasRevisados('n')} AND NOT (${relacionDeExtension('c')})
          AND a.attname = 'id' AND c.relkind IN ('r', 'p')
          AND a.attnum > 0 AND NOT a.attisdropped AND ${conAcademiaId('c')}`,
    );
    expect(conId.map((fila) => fila.tabla)).toContain('public.auditoria');
    for (const { tabla: nombre } of conId) {
      const { esquema, tabla } = partirNombre(nombre);
      const restricciones = await consultar<{ columnas: string[] }>(
        `SELECT ARRAY(SELECT a.attname::text FROM unnest(k.conkey) AS u(num)
                        JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.num
                       ORDER BY a.attname) AS columnas
           FROM pg_catalog.pg_constraint k
          WHERE k.contype IN ('u', 'p') AND k.conrelid = ${regclassDe('$1', '$2')}`,
        [esquema, tabla],
      );
      const buscadas = restricciones.some(
        (restriccion) => restriccion.columnas.join(',') === ['academia_id', 'id'].join(','),
      );
      expect(buscadas, `${nombre}: falta UNIQUE (academia_id, id)`).toBe(true);
    }
  });
});
