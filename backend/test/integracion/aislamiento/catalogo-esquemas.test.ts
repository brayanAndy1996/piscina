// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';
import { beforeAll, describe, expect, it, type TestContext } from 'vitest';
import {
  configuracionDistintaDeSearchPath,
  materializadasYForaneas,
  reglasQueNoSonDeVista,
  securityDefiner,
  securityDefinerFueraDe,
  tablasConAcademiaId,
  tablasSinAcademiaIdFueraDeLaLista,
  tablasSinRls,
  unicidadSinAcademia,
  vistasSinSecurityInvoker,
  type Consulta,
} from '../../utilidades/catalogo';
import { conClienteComo, conTransaccionRevertida } from '../../utilidades/base-datos';
import { puedeCrearEsquemas } from '../../utilidades/ronda5';

// Criterio 131 (ataque ronda 6, F1 (b); amplia los criterios 9, 10, 11, 12, 124 y 126): las pruebas de catalogo revisan las
// relaciones, funciones, reglas, indices, restricciones y politicas de todos los esquemas revisados (todos menos `pg_catalog`,
// `information_schema`, `pg_toast` y los temporales; sin los objetos de extensiones; criterio 142: un esquema de extension tambien se revisa), no solo de `public`.
//   - Las excepciones por nombre (`_prisma_migrations` del criterio 9 y la lista del criterio 10) valen solo en `public`: una tabla con
//     ese nombre en otro esquema no tiene excepcion.
//   - "Tabla con `academia_id`" en los criterios 11, 12, 126, 132 y 133 es una tabla de cualquiera de esos esquemas.
//   - Las listas de excepciones de los criterios 124 y 126 (hoy vacias) se escriben con el esquema (`public.nombre`).
// Autocomprobacion (este archivo): como dueno, dentro de una transaccion que se revierte, crea el esquema `reportes_prueba` con una tabla
// sin RLS (la detecta la consulta del criterio 9), una tabla `reportes_prueba.academias` sin `academia_id` (la detecta la del 10: la
// excepcion no vale fuera de `public`), una vista sin `security_invoker` y una funcion `SECURITY DEFINER` (124), y una tabla con
// `academia_id` y `UNIQUE (numero)` (126); cada una aparece en el resultado de su consulta. Si el dueno no puede crear esquemas, la
// autocomprobacion se omite con aviso; las consultas sobre la base real corren igual (en los demas archivos de catalogo).
// Ademas: los objetos que pertenecen a una extension no cuentan (se agregan a `pgcrypto` con `ALTER EXTENSION ... ADD`); si el dueno no
// puede instalar la extension, ese caso se omite con aviso.

let creaEsquemas = false;
let instalaExtensiones = false;

async function sePuedeInstalarPgcrypto(): Promise<boolean> {
  try {
    await conTransaccionRevertida('propietario', undefined, async (cliente) => {
      await cliente.query('CREATE SCHEMA ext_sonda');
      await cliente.query('CREATE EXTENSION pgcrypto SCHEMA ext_sonda');
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === '42501' || (error as { code?: string }).code === '0A000') return false;
    throw error;
  }
}

beforeAll(async () => {
  creaEsquemas = await puedeCrearEsquemas();
  instalaExtensiones = creaEsquemas && (await sePuedeInstalarPgcrypto());
  if (!creaEsquemas) {
    console.warn(
      '[criterio 131] AVISO: el dueno de la base de pruebas no puede crear esquemas (CREATE sobre la base); la autocomprobacion se omite. Corre en Docker y en la CI.',
    );
  } else if (!instalaExtensiones) {
    console.warn(
      '[criterio 131] AVISO: el dueno de la base de pruebas no puede instalar pgcrypto; el caso de los objetos de extension se omite.',
    );
  }
});

/** Ejecuta las sentencias como dueno, dentro de una transaccion que se revierte, y devuelve lo que informa cada consulta. */
async function conObjetosDeEjemplo<T>(
  contexto: TestContext,
  sentencias: readonly string[],
  leer: (cliente: pg.ClientBase) => Promise<T>,
  { extension = false }: { extension?: boolean } = {},
): Promise<T> {
  if (!creaEsquemas) contexto.skip('el dueno de la base de pruebas no puede crear esquemas');
  if (extension && !instalaExtensiones) contexto.skip('el dueno de la base de pruebas no puede instalar pgcrypto');
  return conTransaccionRevertida('propietario', undefined, async (cliente) => {
    await cliente.query('CREATE SCHEMA reportes_prueba');
    for (const sentencia of sentencias) await cliente.query(sentencia);
    return leer(cliente);
  });
}

describe('criterio 131: autocomprobacion, las consultas de catalogo detectan objetos de otro esquema (reportes_prueba)', () => {
  it('criterio 131 (criterio 9): una tabla sin RLS en reportes_prueba aparece en la consulta de tablas sin RLS', async (contexto) => {
    const encontrados = await conObjetosDeEjemplo(
      contexto,
      [
        'CREATE TABLE reportes_prueba.t_sin_rls (id int)',
        'CREATE TABLE reportes_prueba.t_rls_no_forzada (id int)',
        'ALTER TABLE reportes_prueba.t_rls_no_forzada ENABLE ROW LEVEL SECURITY',
        'CREATE TABLE reportes_prueba.t_con_rls (id int)',
        'ALTER TABLE reportes_prueba.t_con_rls ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE reportes_prueba.t_con_rls FORCE ROW LEVEL SECURITY',
      ],
      tablasSinRls,
    );

    expect(encontrados).toEqual(
      expect.arrayContaining(['reportes_prueba.t_sin_rls', 'reportes_prueba.t_rls_no_forzada']),
    );
    expect(encontrados).not.toContain('reportes_prueba.t_con_rls');
  });

  it('criterio 131 (criterio 9): la excepcion de _prisma_migrations vale solo en public (reportes_prueba._prisma_migrations se detecta)', async (contexto) => {
    const encontrados = await conObjetosDeEjemplo(
      contexto,
      ['CREATE TABLE reportes_prueba._prisma_migrations (id int)'],
      tablasSinRls,
    );

    expect(encontrados).toContain('reportes_prueba._prisma_migrations');
    expect(encontrados, 'public._prisma_migrations sigue exceptuada').not.toContain('public._prisma_migrations');
  });

  it('criterio 131 (criterio 10): reportes_prueba.academias, sin academia_id, aparece en la consulta de tablas sin academia_id fuera de la lista', async (contexto) => {
    const encontrados = await conObjetosDeEjemplo(
      contexto,
      [
        'CREATE TABLE reportes_prueba.academias (id int)',
        'CREATE TABLE reportes_prueba.superadmins (id int)',
        'CREATE TABLE reportes_prueba.con_academia (academia_id uuid NOT NULL)',
      ],
      tablasSinAcademiaIdFueraDeLaLista,
    );

    expect(encontrados, 'la excepcion de la lista no vale fuera de public').toEqual(
      expect.arrayContaining(['reportes_prueba.academias', 'reportes_prueba.superadmins']),
    );
    expect(encontrados).not.toContain('reportes_prueba.con_academia');
    expect(encontrados.filter((nombre) => nombre.startsWith('public.'))).toEqual([]);
  });

  it('criterio 131 (criterios 11, 12 y 126): una tabla con academia_id de reportes_prueba cuenta como tabla de academia', async (contexto) => {
    const encontrados = await conObjetosDeEjemplo(
      contexto,
      ['CREATE TABLE reportes_prueba.pagos (academia_id uuid NOT NULL, numero text)'],
      tablasConAcademiaId,
    );

    expect(encontrados).toEqual(expect.arrayContaining(['public.auditoria', 'reportes_prueba.pagos']));
  });

  it('criterio 131 (criterio 124): una vista sin security_invoker en reportes_prueba se detecta y una con security_invoker = true no', async (contexto) => {
    const encontrados = await conObjetosDeEjemplo(
      contexto,
      [
        'CREATE VIEW reportes_prueba.v_sin_invoker AS SELECT id FROM public.academias',
        'CREATE VIEW reportes_prueba.v_con_invoker WITH (security_invoker = true) AS SELECT id FROM public.academias',
      ],
      vistasSinSecurityInvoker,
    );

    expect(encontrados).toContain('reportes_prueba.v_sin_invoker');
    expect(encontrados).not.toContain('reportes_prueba.v_con_invoker');
  });

  it('criterio 131 (criterio 124): una vista materializada en reportes_prueba se detecta', async (contexto) => {
    const encontrados = await conObjetosDeEjemplo(
      contexto,
      ['CREATE MATERIALIZED VIEW reportes_prueba.mv_ejemplo AS SELECT id FROM public.academias'],
      materializadasYForaneas,
    );

    expect(encontrados).toContain('reportes_prueba.mv_ejemplo');
  });

  it('criterio 131 (criterio 124): una funcion SECURITY DEFINER en reportes_prueba se detecta, y una excepcion public.nombre no la cubre', async (contexto) => {
    const sentencias = [
      "CREATE FUNCTION reportes_prueba.f_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'",
    ];
    const encontrados = await conObjetosDeEjemplo(contexto, sentencias, securityDefiner);
    const conExcepcionDePublic = await conObjetosDeEjemplo(
      contexto,
      sentencias,
      securityDefinerFueraDe(['public.f_definer']),
    );

    expect(encontrados).toContain('reportes_prueba.f_definer');
    expect(conExcepcionDePublic, 'la lista se escribe con el esquema').toContain('reportes_prueba.f_definer');
  });

  it('criterio 131 (criterio 124): una funcion con SET row_security = off y una regla DO INSTEAD NOTHING en reportes_prueba se detectan', async (contexto) => {
    const sentencias = [
      "CREATE FUNCTION reportes_prueba.f_sin_rls() RETURNS int LANGUAGE sql SET row_security = off AS 'SELECT 1'",
      'CREATE TABLE reportes_prueba.t_regla (id int)',
      'CREATE RULE regla_ejemplo AS ON INSERT TO reportes_prueba.t_regla DO INSTEAD NOTHING',
    ];
    const configuracion = await conObjetosDeEjemplo(contexto, sentencias, configuracionDistintaDeSearchPath);
    const reglas = await conObjetosDeEjemplo(contexto, sentencias, reglasQueNoSonDeVista);

    expect(configuracion).toContain('reportes_prueba.f_sin_rls');
    expect(reglas).toContain('reportes_prueba.t_regla.regla_ejemplo');
  });

  it('criterio 131 (criterio 126): una tabla con academia_id y UNIQUE (numero) en reportes_prueba se detecta y UNIQUE (academia_id, numero) no', async (contexto) => {
    const encontrados = await conObjetosDeEjemplo(
      contexto,
      [
        'CREATE TABLE reportes_prueba.u_global (academia_id uuid NOT NULL, numero text, UNIQUE (numero))',
        'CREATE TABLE reportes_prueba.u_ok (academia_id uuid NOT NULL, numero text, UNIQUE (academia_id, numero))',
      ],
      unicidadSinAcademia,
    );

    expect(encontrados.filter((nombre) => nombre.startsWith('reportes_prueba.u_global.'))).toHaveLength(1);
    expect(encontrados.filter((nombre) => nombre.startsWith('reportes_prueba.u_ok.'))).toEqual([]);
  });

  const CONSULTAS_QUE_NO_CUENTAN_LA_EXTENSION: readonly (readonly [string, Consulta])[] = [
    ['tablas sin RLS', tablasSinRls],
    ['tablas sin academia_id fuera de la lista', tablasSinAcademiaIdFueraDeLaLista],
    ['vistas sin security_invoker', vistasSinSecurityInvoker],
    ['vistas materializadas y tablas foraneas', materializadasYForaneas],
    ['funciones SECURITY DEFINER', securityDefiner],
    ['funciones con valores propios', configuracionDistintaDeSearchPath],
    ['reglas que no son de vista', reglasQueNoSonDeVista],
    ['unicidad sin academia_id', unicidadSinAcademia],
  ];

  it('criterio 131: los objetos que pertenecen a una extension no se cuentan en ninguna consulta (se agregan a pgcrypto con ALTER EXTENSION ... ADD)', async (contexto) => {
    const resultados = await conObjetosDeEjemplo(
      contexto,
      [
        'CREATE EXTENSION pgcrypto SCHEMA reportes_prueba',
        // Objetos propios de la extension (sin RLS, sin academia_id, SECURITY DEFINER, ...): no deben aparecer.
        'CREATE TABLE reportes_prueba.t_de_extension (academia_id uuid NOT NULL, numero text UNIQUE)',
        'CREATE VIEW reportes_prueba.v_de_extension AS SELECT id FROM public.academias',
        'CREATE MATERIALIZED VIEW reportes_prueba.mv_de_extension AS SELECT id FROM public.academias',
        "CREATE FUNCTION reportes_prueba.f_de_extension() RETURNS int LANGUAGE sql SECURITY DEFINER SET row_security = off AS 'SELECT 1'",
        'ALTER EXTENSION pgcrypto ADD TABLE reportes_prueba.t_de_extension',
        'ALTER EXTENSION pgcrypto ADD VIEW reportes_prueba.v_de_extension',
        'ALTER EXTENSION pgcrypto ADD MATERIALIZED VIEW reportes_prueba.mv_de_extension',
        'ALTER EXTENSION pgcrypto ADD FUNCTION reportes_prueba.f_de_extension()',
      ],
      async (cliente) => {
        const salida: [string, string[]][] = [];
        for (const [nombre, consulta] of CONSULTAS_QUE_NO_CUENTAN_LA_EXTENSION) {
          salida.push([nombre, (await consulta(cliente)).filter((objeto) => objeto.startsWith('reportes_prueba.'))]);
        }
        return salida;
      },
      { extension: true },
    );

    for (const [nombre, encontrados] of resultados) {
      expect(encontrados, `${nombre}: no debe contar objetos de una extension`).toEqual([]);
    }
  });

  it('criterio 131: lo creado en las autocomprobaciones se revirtio (reportes_prueba ya no existe y las consultas sobre la base real no informan nada)', async () => {
    const { rows } = await conClienteComo('propietario', (cliente) =>
      cliente.query("SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'reportes_prueba'"),
    );
    expect(rows).toEqual([]);
    for (const [nombre, consulta] of [
      ['tablas sin RLS', tablasSinRls],
      ['tablas sin academia_id fuera de la lista', tablasSinAcademiaIdFueraDeLaLista],
      ['vistas sin security_invoker', vistasSinSecurityInvoker],
      ['unicidad sin academia_id', unicidadSinAcademia],
    ] as const) {
      expect(await conClienteComo('propietario', consulta), nombre).toEqual([]);
    }
  });
});
