// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';

/**
 * Consultas de catalogo que comparten las pruebas de los criterios 9, 10, 11, 12, 124 y 126 y sus autocomprobaciones (criterio
 * 131, ataque ronda 6). Antes cada prueba miraba solo el esquema `public`; desde el criterio 131 miran los ESQUEMAS REVISADOS:
 * todos los de `pg_catalog.pg_namespace` salvo `pg_catalog`, `information_schema`, `pg_toast`, los temporales (`pg_temp_N` y
 * `pg_toast_temp_N`) y los que pertenecen a una extension; y no cuentan los objetos que pertenecen a una extension
 * (`pg_depend` con `deptype = 'e'` hacia `pg_extension`). Los nombres que devuelven las consultas llevan siempre el esquema
 * (`public.auditoria`), y las excepciones por nombre (`public._prisma_migrations`, la lista del criterio 10, las de los criterios
 * 124 y 126) valen solo en `public`: una tabla con ese nombre en otro esquema no tiene excepcion.
 *
 * Todo va calificado con `pg_catalog.` para que ningun `search_path` ni objeto de otro esquema cambie lo que miran.
 */

export type Consulta = (cliente: pg.ClientBase) => Promise<string[]>;

/** Condicion SQL: el esquema `n` es un esquema revisado (criterio 131). */
export const esquemasRevisados = (n = 'n'): string =>
  `(${n}.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
     AND ${n}.nspname !~ '^pg_(toast_)?temp_'
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dn
                      WHERE dn.classid = 'pg_catalog.pg_namespace'::pg_catalog.regclass AND dn.objid = ${n}.oid
                        AND dn.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND dn.deptype = 'e'))`;

/** Condicion SQL: la relacion `c` (`pg_class`) es un objeto de una extension. */
export const relacionDeExtension = (c = 'c'): string =>
  `EXISTS (SELECT 1 FROM pg_catalog.pg_depend dr
            WHERE dr.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND dr.objid = ${c}.oid
              AND dr.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND dr.deptype = 'e')`;

/** Condicion SQL: la funcion o procedimiento `p` (`pg_proc`) es un objeto de una extension. */
export const funcionDeExtension = (p = 'p'): string =>
  `EXISTS (SELECT 1 FROM pg_catalog.pg_depend df
            WHERE df.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND df.objid = ${p}.oid
              AND df.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND df.deptype = 'e')`;

/** Condicion SQL: la columna `academia_id` existe (y no esta borrada) en la relacion `c`. */
export const conAcademiaId = (c = 'c'): string =>
  `EXISTS (SELECT 1 FROM pg_catalog.pg_attribute ai
            WHERE ai.attrelid = ${c}.oid AND ai.attname = 'academia_id' AND ai.attnum > 0 AND NOT ai.attisdropped)`;

/** Expresion SQL que arma el `regclass` de `$esquema`, `$tabla` (dos parametros) sin depender del `search_path`. */
export const regclassDe = (esquema: string, tabla: string): string =>
  `(pg_catalog.quote_ident(${esquema}) || '.' || pg_catalog.quote_ident(${tabla}))::pg_catalog.regclass`;

/** Divide `esquema.tabla` (el esquema no lleva puntos en las pruebas) en sus dos partes. */
export function partirNombre(nombre: string): { esquema: string; tabla: string } {
  const punto = nombre.indexOf('.');
  return { esquema: nombre.slice(0, punto), tabla: nombre.slice(punto + 1) };
}

async function nombres(cliente: pg.ClientBase, sql: string, parametros: unknown[] = []): Promise<string[]> {
  const { rows } = await cliente.query(sql, parametros);
  return (rows as { objeto: string }[]).map((fila) => fila.objeto).sort();
}

// ---------------------------------------------------------------------------------------------------------------------------
// Criterios 9 y 10
// ---------------------------------------------------------------------------------------------------------------------------

/** Excepcion del criterio 9: la unica tabla sin RLS. Vale solo en `public`. */
export const EXCEPCION_RLS = 'public._prisma_migrations';

/** Lista del criterio 10: tablas sin `academia_id` permitidas (de plataforma). Valen solo en `public`. */
export const TABLAS_SIN_ACADEMIA_ID: readonly string[] = [
  'public._prisma_migrations',
  'public.academias',
  'public.auditoria_plataforma',
  'public.superadmins',
];

/** Tablas y particiones (`r`, `p`) de los esquemas revisados, como `esquema.tabla`. */
export const todasLasTablas: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT n.nspname || '.' || c.relname AS objeto
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${esquemasRevisados('n')} AND c.relkind IN ('r', 'p') AND NOT (${relacionDeExtension('c')})`,
  );

/** Tablas con `academia_id` (criterios 11, 12, 126, 132 y 133), como `esquema.tabla`. */
export const tablasConAcademiaId: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT n.nspname || '.' || c.relname AS objeto
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${esquemasRevisados('n')} AND c.relkind IN ('r', 'p') AND NOT (${relacionDeExtension('c')})
        AND ${conAcademiaId('c')}`,
  );

/** Tablas sin `academia_id`, como `esquema.tabla`. */
export const tablasSinAcademiaId: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT n.nspname || '.' || c.relname AS objeto
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${esquemasRevisados('n')} AND c.relkind IN ('r', 'p') AND NOT (${relacionDeExtension('c')})
        AND NOT (${conAcademiaId('c')})`,
  );

/** Criterio 10: las tablas sin `academia_id` que no estan en la lista (por nombre con esquema). */
export const tablasSinAcademiaIdFueraDeLaLista: Consulta = async (cliente) =>
  (await tablasSinAcademiaId(cliente)).filter((tabla) => !TABLAS_SIN_ACADEMIA_ID.includes(tabla));

/** Criterio 9: tablas y particiones sin RLS activada y forzada, salvo `public._prisma_migrations`. */
export const tablasSinRls: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT n.nspname || '.' || c.relname AS objeto
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${esquemasRevisados('n')} AND c.relkind IN ('r', 'p') AND NOT (${relacionDeExtension('c')})
        AND n.nspname || '.' || c.relname <> $1
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
    [EXCEPCION_RLS],
  );

// ---------------------------------------------------------------------------------------------------------------------------
// Criterio 124
// ---------------------------------------------------------------------------------------------------------------------------

/** Funciones `SECURITY DEFINER` permitidas (criterio 124), como `esquema.nombre`. Hoy ninguna: una historia que necesite una la agrega aqui con su justificacion. */
export const FUNCIONES_SECURITY_DEFINER_PERMITIDAS: readonly string[] = [];

/** Vistas sin `security_invoker` verdadero (`true`, `on`, `1` o `yes`, sin distinguir mayusculas). */
export const vistasSinSecurityInvoker: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT n.nspname || '.' || c.relname AS objeto
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${esquemasRevisados('n')} AND c.relkind = 'v' AND NOT (${relacionDeExtension('c')})
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_options_to_table(c.reloptions) o
           WHERE o.option_name = 'security_invoker' AND lower(o.option_value) IN ('true', 'on', '1', 'yes'))`,
  );

/** Vistas materializadas y tablas foraneas. */
export const materializadasYForaneas: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT n.nspname || '.' || c.relname AS objeto
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${esquemasRevisados('n')} AND c.relkind IN ('m', 'f') AND NOT (${relacionDeExtension('c')})`,
  );

/** Consulta de funciones `SECURITY DEFINER` fuera de una lista dada (`esquema.nombre`). */
export const securityDefinerFueraDe =
  (permitidas: readonly string[]): Consulta =>
  (cliente) =>
    nombres(
      cliente,
      `SELECT n.nspname || '.' || p.proname AS objeto
         FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE ${esquemasRevisados('n')} AND p.prosecdef AND NOT (${funcionDeExtension('p')})
          AND NOT (n.nspname || '.' || p.proname = ANY ($1::text[]))`,
      [permitidas],
    );

/** Funciones y procedimientos `SECURITY DEFINER` fuera de la lista permitida. */
export const securityDefiner: Consulta = securityDefinerFueraDe(FUNCIONES_SECURITY_DEFINER_PERMITIDAS);

/** Funciones y procedimientos con algun valor propio (`proconfig`) que no sea `search_path`. */
export const configuracionDistintaDeSearchPath: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT DISTINCT n.nspname || '.' || p.proname AS objeto
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace,
            LATERAL pg_catalog.unnest(p.proconfig) AS valor
      WHERE ${esquemasRevisados('n')} AND NOT (${funcionDeExtension('p')}) AND valor NOT LIKE 'search_path=%'`,
  );

/** Reglas de reescritura que no son la `_RETURN` de una vista, como `esquema.tabla.regla`. */
export const reglasQueNoSonDeVista: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT n.nspname || '.' || c.relname || '.' || r.rulename AS objeto
       FROM pg_catalog.pg_rewrite r
       JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${esquemasRevisados('n')} AND NOT (${relacionDeExtension('c')})
        AND NOT (r.rulename = '_RETURN' AND c.relkind = 'v')`,
  );

// ---------------------------------------------------------------------------------------------------------------------------
// Criterio 126
// ---------------------------------------------------------------------------------------------------------------------------

/** Indices de tablas de academia sin `academia_id` entre sus claves permitidos (criterio 126), como `esquema.tabla.indice`. Hoy ninguno. */
export const UNICIDAD_SIN_ACADEMIA_PERMITIDA: readonly string[] = [];

/**
 * Indices unicos o de exclusion (llaves primarias y restricciones incluidas) de tablas con columna `academia_id` donde esa columna
 * no esta entre las columnas CLAVE del indice (las de INCLUDE van despues de `indnkeyatts`; una expresion tiene `indkey = 0` y no
 * cuenta), salvo la llave primaria formada solo por `id uuid DEFAULT gen_random_uuid()` y la lista permitida. Devuelve
 * `esquema.tabla.indice`.
 */
export const unicidadSinAcademia: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT n.nspname || '.' || c.relname || '.' || i.relname AS objeto
       FROM pg_catalog.pg_index x
       JOIN pg_catalog.pg_class c ON c.oid = x.indrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
       JOIN pg_catalog.pg_attribute a
         ON a.attrelid = c.oid AND a.attname = 'academia_id' AND a.attnum > 0 AND NOT a.attisdropped
      WHERE ${esquemasRevisados('n')} AND NOT (${relacionDeExtension('c')})
        AND (x.indisunique OR x.indisexclusion)
        AND NOT (a.attnum = ANY ((string_to_array(x.indkey::text, ' ')::int2[])[1:x.indnkeyatts]))
        AND NOT (
          x.indisprimary AND x.indnkeyatts = 1 AND EXISTS (
            SELECT 1
              FROM pg_catalog.pg_attribute k
              JOIN pg_catalog.pg_type t ON t.oid = k.atttypid
              JOIN pg_catalog.pg_attrdef d ON d.adrelid = k.attrelid AND d.adnum = k.attnum
             WHERE k.attrelid = c.oid AND k.attnum = x.indkey[0] AND k.attname = 'id' AND t.typname = 'uuid'
               AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'gen_random_uuid()'))
        AND NOT (n.nspname || '.' || c.relname || '.' || i.relname = ANY ($1::text[]))`,
    [UNICIDAD_SIN_ACADEMIA_PERMITIDA],
  );
