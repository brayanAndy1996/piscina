// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { conClienteComo, conTransaccionRevertida } from '../../utilidades/base-datos';

// Criterio 124 (ataque ronda 5, F3; complementa los criterios 9 y 11): ningun objeto se salta la seguridad a nivel de fila. Dadas
// las migraciones aplicadas en la base de pruebas, cuando se consulta el catalogo, la prueba falla si en el esquema `public` hay:
//   - una vista (`relkind = 'v'`) sin `security_invoker = true` en sus opciones (`reloptions`);
//   - una vista materializada (`'m'`) o una tabla foranea (`'f'`), sean como sean: no pasan por RLS;
//   - una funcion o procedimiento con `SECURITY DEFINER` (`pg_proc.prosecdef`), salvo los de la lista "Funciones SECURITY DEFINER
//     permitidas" (hoy vacia; `app_academia_actual`, `app_es_plataforma` y `resolver_academia` son SECURITY INVOKER);
//   - una funcion o procedimiento con valores propios (`proconfig`) que fijen algo distinto de `search_path` (por ejemplo
//     `SET row_security = off`);
//   - una regla de reescritura (`pg_rewrite`) que no sea la `_RETURN` de una vista: las reglas se ejecutan con los permisos del
//     dueno de la tabla, que en Docker y en la CI es superusuario;
//   - una tabla o particion (`'r'` o `'p'`, incluidas las particiones, `relispartition`) distinta de `_prisma_migrations` sin RLS
//     activada y forzada (criterio 9).
// La prueba comprueba tambien que sus consultas detectan cada caso: como dueno, dentro de una transaccion que se revierte al final,
// crea una vista sin `security_invoker` (detectada) y otra con `security_invoker = true` (no detectada), una vista materializada,
// una funcion SECURITY DEFINER, una funcion SECURITY INVOKER con `SET row_security = off`, una regla DO INSTEAD NOTHING sobre
// `configuraciones` y una tabla particionada con RLS forzada cuya particion no la tiene; cada una aparece en el resultado de su
// consulta. Una historia que necesite una excepcion la agrega a la lista, con su justificacion, en su especificacion.
//
// Este archivo es una guarda para las historias siguientes: con las migraciones actuales pasa desde el principio.

/** Funciones `SECURITY DEFINER` permitidas (criterio 124). Hoy ninguna: una historia que necesite una la agrega aqui con su justificacion. */
const FUNCIONES_SECURITY_DEFINER_PERMITIDAS: readonly string[] = [];

type Consulta = (cliente: pg.ClientBase) => Promise<string[]>;

async function nombres(cliente: pg.ClientBase, sql: string, parametros: unknown[] = []): Promise<string[]> {
  const { rows } = await cliente.query(sql, parametros);
  return (rows as { objeto: string }[]).map((fila) => fila.objeto).sort();
}

/** Vistas de `public` sin `security_invoker` verdadero (`true`, `on`, `1` o `yes`, sin distinguir mayusculas). */
const vistasSinSecurityInvoker: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT c.relname AS objeto
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v'
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_options_to_table(c.reloptions) o
           WHERE o.option_name = 'security_invoker' AND lower(o.option_value) IN ('true', 'on', '1', 'yes'))`,
  );

/** Vistas materializadas y tablas foraneas de `public`. */
const materializadasYForaneas: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT c.relname AS objeto
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('m', 'f')`,
  );

/** Funciones y procedimientos `SECURITY DEFINER` de `public` fuera de la lista permitida. */
const securityDefiner: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT p.proname AS objeto
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef AND NOT (p.proname = ANY ($1::text[]))`,
    [FUNCIONES_SECURITY_DEFINER_PERMITIDAS],
  );

/** Funciones y procedimientos de `public` con algun valor propio (`proconfig`) que no sea `search_path`. */
const configuracionDistintaDeSearchPath: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT DISTINCT p.proname AS objeto
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace,
            LATERAL pg_catalog.unnest(p.proconfig) AS valor
      WHERE n.nspname = 'public' AND valor NOT LIKE 'search_path=%'`,
  );

/** Reglas de reescritura sobre objetos de `public` que no son la `_RETURN` de una vista. */
const reglasQueNoSonDeVista: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT c.relname || '.' || r.rulename AS objeto
       FROM pg_catalog.pg_rewrite r
       JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT (r.rulename = '_RETURN' AND c.relkind = 'v')`,
  );

/** Tablas y particiones de `public` (salvo `_prisma_migrations`) sin RLS activada y forzada. */
const tablasSinRlsForzada: Consulta = (cliente) =>
  nombres(
    cliente,
    `SELECT c.relname AS objeto
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
  );

const CONSULTAS: readonly (readonly [string, Consulta])[] = [
  ['vistas sin security_invoker = true', vistasSinSecurityInvoker],
  ['vistas materializadas y tablas foraneas', materializadasYForaneas],
  ['funciones SECURITY DEFINER fuera de la lista permitida', securityDefiner],
  ['funciones con valores propios distintos de search_path', configuracionDistintaDeSearchPath],
  ['reglas de reescritura que no son la _RETURN de una vista', reglasQueNoSonDeVista],
  ['tablas y particiones sin RLS activada y forzada', tablasSinRlsForzada],
];

describe('criterio 124: con las migraciones aplicadas, ningun objeto de public se salta la seguridad a nivel de fila', () => {
  it.each(CONSULTAS)('criterio 124: no hay %s', async (_nombre, consulta) => {
    const encontrados = await conClienteComo('propietario', (cliente) => consulta(cliente));

    expect(encontrados).toEqual([]);
  });

  it('criterio 124: las funciones de la 001 (app_academia_actual, app_es_plataforma, resolver_academia) son SECURITY INVOKER', async () => {
    const filas = await conClienteComo('propietario', async (cliente) => {
      const { rows } = await cliente.query(
        `SELECT p.proname AS nombre, p.prosecdef AS definer
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname IN ('app_academia_actual', 'app_es_plataforma', 'resolver_academia')`,
      );
      return rows as { nombre: string; definer: boolean }[];
    });

    expect(filas.map((fila) => fila.nombre).sort()).toEqual([
      'app_academia_actual',
      'app_es_plataforma',
      'resolver_academia',
    ]);
    expect(filas.filter((fila) => fila.definer)).toEqual([]);
  });
});

describe('criterio 124: autocomprobacion, las consultas detectan cada caso (objetos creados en una transaccion que se revierte)', () => {
  /** Crea los objetos de ejemplo como dueno, dentro de una transaccion que se revierte, y devuelve lo que detecta cada consulta. */
  async function conObjetosDeEjemplo<T>(
    sentencias: readonly string[],
    leer: (cliente: pg.ClientBase) => Promise<T>,
  ): Promise<T> {
    return conTransaccionRevertida('propietario', undefined, async (cliente) => {
      for (const sentencia of sentencias) await cliente.query(sentencia);
      return leer(cliente);
    });
  }

  it('criterio 124: una vista sin security_invoker se detecta y otra con security_invoker = true no', async () => {
    const encontrados = await conObjetosDeEjemplo(
      [
        'CREATE VIEW public.v_sin_invoker AS SELECT id FROM public.academias',
        'CREATE VIEW public.v_con_invoker WITH (security_invoker = true) AS SELECT id FROM public.academias',
        'CREATE VIEW public.v_invoker_apagado WITH (security_invoker = false) AS SELECT id FROM public.academias',
      ],
      vistasSinSecurityInvoker,
    );

    expect(encontrados).toContain('v_sin_invoker');
    expect(encontrados, 'una vista con security_invoker = false se salta la RLS').toContain('v_invoker_apagado');
    expect(encontrados).not.toContain('v_con_invoker');
  });

  it('criterio 124: una vista materializada se detecta', async () => {
    const encontrados = await conObjetosDeEjemplo(
      ['CREATE MATERIALIZED VIEW public.mv_ejemplo AS SELECT id FROM public.academias'],
      materializadasYForaneas,
    );

    expect(encontrados).toContain('mv_ejemplo');
  });

  it('criterio 124: una funcion SECURITY DEFINER se detecta y una SECURITY INVOKER no', async () => {
    const encontrados = await conObjetosDeEjemplo(
      [
        "CREATE FUNCTION public.f_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'",
        "CREATE FUNCTION public.f_invoker() RETURNS int LANGUAGE sql SECURITY INVOKER AS 'SELECT 1'",
      ],
      securityDefiner,
    );

    expect(encontrados).toContain('f_definer');
    expect(encontrados).not.toContain('f_invoker');
  });

  it('criterio 124: un procedimiento SECURITY DEFINER se detecta', async () => {
    const encontrados = await conObjetosDeEjemplo(
      ["CREATE PROCEDURE public.p_definer() LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'"],
      securityDefiner,
    );

    expect(encontrados).toContain('p_definer');
  });

  it('criterio 124: una funcion SECURITY INVOKER con SET row_security = off se detecta y una con SET search_path no', async () => {
    const encontrados = await conObjetosDeEjemplo(
      [
        "CREATE FUNCTION public.f_sin_rls() RETURNS int LANGUAGE sql SECURITY INVOKER SET row_security = off AS 'SELECT 1'",
        "CREATE FUNCTION public.f_con_ruta() RETURNS int LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public AS 'SELECT 1'",
      ],
      configuracionDistintaDeSearchPath,
    );

    expect(encontrados).toContain('f_sin_rls');
    expect(encontrados).not.toContain('f_con_ruta');
  });

  it('criterio 124: una regla DO INSTEAD NOTHING sobre configuraciones se detecta', async () => {
    const encontrados = await conObjetosDeEjemplo(
      ['CREATE RULE regla_ejemplo AS ON INSERT TO public.configuraciones DO INSTEAD NOTHING'],
      reglasQueNoSonDeVista,
    );

    expect(encontrados).toContain('configuraciones.regla_ejemplo');
  });

  it('criterio 124: la regla _RETURN de una vista no se detecta', async () => {
    const encontrados = await conObjetosDeEjemplo(
      ['CREATE VIEW public.v_para_regla WITH (security_invoker = true) AS SELECT id FROM public.academias'],
      reglasQueNoSonDeVista,
    );

    expect(encontrados.filter((nombre) => nombre.startsWith('v_para_regla'))).toEqual([]);
  });

  it('criterio 124: una tabla particionada con RLS forzada cuya particion no la tiene se detecta (la particion, no la tabla)', async () => {
    const encontrados = await conObjetosDeEjemplo(
      [
        'CREATE TABLE public.p_ejemplo (academia_id uuid NOT NULL, dato int) PARTITION BY LIST (academia_id)',
        'ALTER TABLE public.p_ejemplo ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE public.p_ejemplo FORCE ROW LEVEL SECURITY',
        "CREATE TABLE public.p_ejemplo_1 PARTITION OF public.p_ejemplo FOR VALUES IN ('00000000-0000-4000-8000-000000000001')",
      ],
      tablasSinRlsForzada,
    );

    expect(encontrados).toContain('p_ejemplo_1');
    expect(encontrados).not.toContain('p_ejemplo');
  });

  it('criterio 124: una tabla ordinaria sin RLS y otra con RLS activada pero no forzada se detectan', async () => {
    const encontrados = await conObjetosDeEjemplo(
      [
        'CREATE TABLE public.t_sin_rls (academia_id uuid NOT NULL)',
        'CREATE TABLE public.t_rls_no_forzada (academia_id uuid NOT NULL)',
        'ALTER TABLE public.t_rls_no_forzada ENABLE ROW LEVEL SECURITY',
        'CREATE TABLE public.t_con_rls (academia_id uuid NOT NULL)',
        'ALTER TABLE public.t_con_rls ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE public.t_con_rls FORCE ROW LEVEL SECURITY',
      ],
      tablasSinRlsForzada,
    );

    expect(encontrados).toEqual(expect.arrayContaining(['t_sin_rls', 't_rls_no_forzada']));
    expect(encontrados).not.toContain('t_con_rls');
  });

  it('criterio 124: una funcion SECURITY DEFINER de la lista permitida no se informa (la lista se aplica por nombre)', async () => {
    // La lista de la prueba esta vacia: se comprueba la consulta con una lista que si trae el nombre.
    const encontrados = await conObjetosDeEjemplo(
      ["CREATE FUNCTION public.f_permitida() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'"],
      async (cliente) => {
        const { rows } = await cliente.query(
          `SELECT p.proname AS objeto
             FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosecdef AND NOT (p.proname = ANY ($1::text[]))`,
          [['f_permitida']],
        );
        return (rows as { objeto: string }[]).map((fila) => fila.objeto);
      },
    );

    expect(encontrados).toEqual([]);
  });

  it('criterio 124: lo creado en las autocomprobaciones se revirtio (el catalogo sigue limpio)', async () => {
    for (const [nombre, consulta] of CONSULTAS) {
      const encontrados = await conClienteComo('propietario', (cliente) => consulta(cliente));
      expect(encontrados, nombre).toEqual([]);
    }
  });
});
