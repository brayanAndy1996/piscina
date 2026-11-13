// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  FUNCIONES_SECURITY_DEFINER_PERMITIDAS,
  configuracionDistintaDeSearchPath,
  materializadasYForaneas,
  reglasQueNoSonDeVista,
  securityDefiner,
  securityDefinerFueraDe,
  tablasSinRls as tablasSinRlsForzada,
  vistasSinSecurityInvoker,
  type Consulta,
} from '../../utilidades/catalogo';
import { conClienteComo, conTransaccionRevertida } from '../../utilidades/base-datos';

// AMPLIADO POR EL CRITERIO 131 (ataque ronda 6, F1 (b)): las consultas miran todos los esquemas revisados (todos menos `pg_catalog`,
// `information_schema`, `pg_toast` y los temporales; sin los objetos de extensiones; criterio 142: un esquema de extension tambien se revisa), no solo `public`. Los
// nombres se comparan como `esquema.nombre` y la lista de funciones `SECURITY DEFINER` permitidas (hoy vacia) se escribe con el
// esquema (`public.nombre`). Las consultas estan en `backend/test/utilidades/catalogo.ts`; que detectan objetos de otro esquema lo
// comprueba `catalogo-esquemas.test.ts`. Lo que se comprueba en `public` no cambia.
//
// Criterio 124 (ataque ronda 5, F3; complementa los criterios 9 y 11): ningun objeto se salta la seguridad a nivel de fila. Dadas
// las migraciones aplicadas en la base de pruebas, cuando se consulta el catalogo, la prueba falla si en el esquema `public` (criterio
// 131: en cualquier esquema revisado) hay:
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

const CONSULTAS: readonly (readonly [string, Consulta])[] = [
  ['vistas sin security_invoker = true', vistasSinSecurityInvoker],
  ['vistas materializadas y tablas foraneas', materializadasYForaneas],
  ['funciones SECURITY DEFINER fuera de la lista permitida', securityDefiner],
  ['funciones con valores propios distintos de search_path', configuracionDistintaDeSearchPath],
  ['reglas de reescritura que no son la _RETURN de una vista', reglasQueNoSonDeVista],
  ['tablas y particiones sin RLS activada y forzada', tablasSinRlsForzada],
];

describe('criterio 124 y 131: con las migraciones aplicadas, ningun objeto de ningun esquema revisado se salta la seguridad a nivel de fila', () => {
  it.each(CONSULTAS)('criterio 124 y 131: no hay %s', async (_nombre, consulta) => {
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

    expect(encontrados).toContain('public.v_sin_invoker');
    expect(encontrados, 'una vista con security_invoker = false se salta la RLS').toContain('public.v_invoker_apagado');
    expect(encontrados).not.toContain('public.v_con_invoker');
  });

  it('criterio 124: una vista materializada se detecta', async () => {
    const encontrados = await conObjetosDeEjemplo(
      ['CREATE MATERIALIZED VIEW public.mv_ejemplo AS SELECT id FROM public.academias'],
      materializadasYForaneas,
    );

    expect(encontrados).toContain('public.mv_ejemplo');
  });

  it('criterio 124: una funcion SECURITY DEFINER se detecta y una SECURITY INVOKER no', async () => {
    const encontrados = await conObjetosDeEjemplo(
      [
        "CREATE FUNCTION public.f_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'",
        "CREATE FUNCTION public.f_invoker() RETURNS int LANGUAGE sql SECURITY INVOKER AS 'SELECT 1'",
      ],
      securityDefiner,
    );

    expect(encontrados).toContain('public.f_definer');
    expect(encontrados).not.toContain('public.f_invoker');
  });

  it('criterio 124: un procedimiento SECURITY DEFINER se detecta', async () => {
    const encontrados = await conObjetosDeEjemplo(
      ["CREATE PROCEDURE public.p_definer() LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'"],
      securityDefiner,
    );

    expect(encontrados).toContain('public.p_definer');
  });

  it('criterio 124: una funcion SECURITY INVOKER con SET row_security = off se detecta y una con SET search_path no', async () => {
    const encontrados = await conObjetosDeEjemplo(
      [
        "CREATE FUNCTION public.f_sin_rls() RETURNS int LANGUAGE sql SECURITY INVOKER SET row_security = off AS 'SELECT 1'",
        "CREATE FUNCTION public.f_con_ruta() RETURNS int LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public AS 'SELECT 1'",
      ],
      configuracionDistintaDeSearchPath,
    );

    expect(encontrados).toContain('public.f_sin_rls');
    expect(encontrados).not.toContain('public.f_con_ruta');
  });

  it('criterio 124: una regla DO INSTEAD NOTHING sobre configuraciones se detecta', async () => {
    const encontrados = await conObjetosDeEjemplo(
      ['CREATE RULE regla_ejemplo AS ON INSERT TO public.configuraciones DO INSTEAD NOTHING'],
      reglasQueNoSonDeVista,
    );

    expect(encontrados).toContain('public.configuraciones.regla_ejemplo');
  });

  it('criterio 124: la regla _RETURN de una vista no se detecta', async () => {
    const encontrados = await conObjetosDeEjemplo(
      ['CREATE VIEW public.v_para_regla WITH (security_invoker = true) AS SELECT id FROM public.academias'],
      reglasQueNoSonDeVista,
    );

    expect(encontrados.filter((nombre) => nombre.startsWith('public.v_para_regla'))).toEqual([]);
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

    expect(encontrados).toContain('public.p_ejemplo_1');
    expect(encontrados).not.toContain('public.p_ejemplo');
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

    expect(encontrados).toEqual(expect.arrayContaining(['public.t_sin_rls', 'public.t_rls_no_forzada']));
    expect(encontrados).not.toContain('public.t_con_rls');
  });

  it('criterio 124 y 131: una funcion SECURITY DEFINER de la lista permitida (escrita con el esquema, public.nombre) no se informa', async () => {
    // La lista real esta vacia: se comprueba la consulta con una lista que si trae el nombre.
    expect(FUNCIONES_SECURITY_DEFINER_PERMITIDAS).toEqual([]);
    const encontrados = await conObjetosDeEjemplo(
      ["CREATE FUNCTION public.f_permitida() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'"],
      securityDefinerFueraDe(['public.f_permitida']),
    );

    expect(encontrados).toEqual([]);
  });

  it('criterio 124 y 131: la misma funcion sin estar en la lista se informa (la lista se aplica por esquema y nombre)', async () => {
    const encontrados = await conObjetosDeEjemplo(
      ["CREATE FUNCTION public.f_permitida() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'"],
      securityDefinerFueraDe(['f_permitida', 'otro.f_permitida']),
    );

    expect(encontrados, 'el nombre sin esquema o con otro esquema no es una excepcion').toContain('public.f_permitida');
  });

  it('criterio 124: lo creado en las autocomprobaciones se revirtio (el catalogo sigue limpio)', async () => {
    for (const [nombre, consulta] of CONSULTAS) {
      const encontrados = await conClienteComo('propietario', (cliente) => consulta(cliente));
      expect(encontrados, nombre).toEqual([]);
    }
  });
});
