// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';
import { beforeAll, describe, expect, it, type TestContext } from 'vitest';
import {
  configuracionDistintaDeSearchPath,
  materializadasYForaneas,
  securityDefiner,
  tablasConAcademiaId,
  tablasSinAcademiaIdFueraDeLaLista,
  tablasSinRls,
  unicidadSinAcademia,
  vistasSinSecurityInvoker,
  type Consulta,
} from '../../utilidades/catalogo';
import { conClienteComo, conTransaccionRevertida } from '../../utilidades/base-datos';
import { puedeCrearEsquemas } from '../../utilidades/ronda5';

// Criterio 142 (ataque ronda 8, F1; AJUSTA el criterio 131 y, por el, los 9, 10, 11, 12, 124, 126, 132, 133 y la prueba de catalogo del
// 137): la condicion de esquemas revisados de las pruebas de catalogo (`esquemasRevisados` de `backend/test/utilidades/catalogo.ts`)
// sigue la definicion del criterio 141: incluye los esquemas que pertenecen a una extension y solo excluye los OBJETOS de extension
// (`relacionDeExtension` y `funcionDeExtension`, que no cambian). Asi, una tabla sin RLS (9), una tabla sin `academia_id` fuera de la
// lista (10), una tabla con `academia_id` (11, 12, 132 y 133), una vista sin `security_invoker` o una funcion `SECURITY DEFINER` (124) y
// una restriccion unica sin `academia_id` (126) se detectan tambien dentro de un esquema de extension; las excepciones por nombre siguen
// valiendo solo en `public`.
//
// Autocomprobacion (este archivo), como duenio, dentro de una transaccion que se revierte (`ALTER EXTENSION ... ADD SCHEMA` es
// transaccional) y con una extension de confianza de la que el duenio es duenio (`pgcrypto`, creada en la transaccion; si no se puede, la
// autocomprobacion se omite con aviso y las consultas sobre la base real corren igual): `CREATE SCHEMA reportes_ext_prueba` y `ALTER
// EXTENSION pgcrypto ADD SCHEMA reportes_ext_prueba`, y dentro una tabla sin RLS (la detecta la consulta del 9), una tabla
// `reportes_ext_prueba.academias` sin `academia_id` (la del 10), una vista sin `security_invoker` (124) y una tabla con `academia_id` y
// `UNIQUE (numero)` (126); cada una aparece en el resultado de su consulta. Control: una tabla sin RLS y sin `academia_id` del mismo
// esquema agregada a la extension (`ALTER EXTENSION ... ADD TABLE`) no aparece en las del 9 ni del 10.

const EXTENSION = 'pgcrypto';
const ESQUEMA = 'reportes_ext_prueba';
const SIN_INSTALAR = ['42501', '0A000', '58P01', '42710'];
const codigoDe = (error: unknown): string | undefined => (error as { code?: string }).code;

let creaEsquemas = false;
let creaExtension = false;

beforeAll(async () => {
  creaEsquemas = await puedeCrearEsquemas();
  creaExtension =
    creaEsquemas &&
    (await conTransaccionRevertida('propietario', undefined, async (cliente) => {
      try {
        await cliente.query(`CREATE EXTENSION ${EXTENSION} SCHEMA public`);
        return true;
      } catch (error) {
        // Sin permiso, no disponible o ya instalada por otro (no se toca).
        if (SIN_INSTALAR.includes(codigoDe(error) ?? '')) return false;
        throw error;
      }
    }));
  if (!creaExtension) {
    console.warn(
      `[criterio 142] AVISO: el duenio de la base de pruebas no puede crear la extension ${EXTENSION} (o ya esta instalada, o no puede crear esquemas); la autocomprobacion se omite. Las consultas sobre la base real corren igual.`,
    );
  }
});

/**
 * Como duenio, en una transaccion que se revierte: crea la extension en `public`, el esquema `reportes_ext_prueba` agregado a ella, ejecuta
 * las sentencias y devuelve lo que informa `leer`.
 */
async function enEsquemaDeExtension<T>(
  contexto: TestContext,
  sentencias: readonly string[],
  leer: (cliente: pg.ClientBase) => Promise<T>,
): Promise<T> {
  if (!creaExtension) contexto.skip(`el duenio de la base de pruebas no puede crear la extension ${EXTENSION}`);
  return conTransaccionRevertida('propietario', undefined, async (cliente) => {
    await cliente.query(`CREATE EXTENSION ${EXTENSION} SCHEMA public`);
    await cliente.query(`CREATE SCHEMA ${ESQUEMA}`);
    await cliente.query(`ALTER EXTENSION ${EXTENSION} ADD SCHEMA ${ESQUEMA}`);
    for (const sentencia of sentencias) await cliente.query(sentencia);
    return leer(cliente);
  });
}

describe('criterio 142: autocomprobacion, las consultas de catalogo detectan objetos propios dentro de un esquema de extension', () => {
  it('criterio 142 (premisa): reportes_ext_prueba pertenece a la extension y lo que se crea dentro no es objeto de extension', async (contexto) => {
    const { esquema, tabla } = await enEsquemaDeExtension(
      contexto,
      [`CREATE TABLE ${ESQUEMA}.t_propia (id int)`],
      async (cliente) => ({
        esquema: (
          await cliente.query(
            `SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_namespace'::pg_catalog.regclass AND d.objid = $1::pg_catalog.regnamespace::pg_catalog.oid
                AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e'`,
            [ESQUEMA],
          )
        ).rows,
        tabla: (
          await cliente.query(
            `SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND d.objid = $1::pg_catalog.regclass::pg_catalog.oid
                AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e'`,
            [`${ESQUEMA}.t_propia`],
          )
        ).rows,
      }),
    );

    expect(esquema).toHaveLength(1);
    expect(tabla).toEqual([]);
  });

  it('criterio 142 (criterio 9): una tabla sin RLS en el esquema de la extension aparece en la consulta de tablas sin RLS', async (contexto) => {
    const encontrados = await enEsquemaDeExtension(
      contexto,
      [
        `CREATE TABLE ${ESQUEMA}.t_sin_rls (id int)`,
        `CREATE TABLE ${ESQUEMA}.t_con_rls (id int)`,
        `ALTER TABLE ${ESQUEMA}.t_con_rls ENABLE ROW LEVEL SECURITY`,
        `ALTER TABLE ${ESQUEMA}.t_con_rls FORCE ROW LEVEL SECURITY`,
      ],
      tablasSinRls,
    );

    expect(encontrados).toContain(`${ESQUEMA}.t_sin_rls`);
    expect(encontrados).not.toContain(`${ESQUEMA}.t_con_rls`);
  });

  it('criterio 142 (criterio 9): la excepcion de _prisma_migrations vale solo en public: la del esquema de la extension se detecta', async (contexto) => {
    const encontrados = await enEsquemaDeExtension(
      contexto,
      [`CREATE TABLE ${ESQUEMA}._prisma_migrations (id int)`],
      tablasSinRls,
    );

    expect(encontrados).toContain(`${ESQUEMA}._prisma_migrations`);
    expect(encontrados, 'public._prisma_migrations sigue exceptuada').not.toContain('public._prisma_migrations');
  });

  it('criterio 142 (criterio 10): reportes_ext_prueba.academias, sin academia_id, aparece en la consulta de tablas sin academia_id fuera de la lista', async (contexto) => {
    const encontrados = await enEsquemaDeExtension(
      contexto,
      [
        `CREATE TABLE ${ESQUEMA}.academias (id int)`,
        `CREATE TABLE ${ESQUEMA}.superadmins (id int)`,
        `CREATE TABLE ${ESQUEMA}.con_academia (academia_id uuid NOT NULL)`,
      ],
      tablasSinAcademiaIdFueraDeLaLista,
    );

    expect(encontrados, 'la excepcion de la lista no vale fuera de public').toEqual(
      expect.arrayContaining([`${ESQUEMA}.academias`, `${ESQUEMA}.superadmins`]),
    );
    expect(encontrados).not.toContain(`${ESQUEMA}.con_academia`);
    expect(encontrados.filter((nombre) => nombre.startsWith('public.'))).toEqual([]);
  });

  it('criterio 142 (criterios 11, 12, 132 y 133): una tabla con academia_id del esquema de la extension cuenta como tabla de academia', async (contexto) => {
    const encontrados = await enEsquemaDeExtension(
      contexto,
      [`CREATE TABLE ${ESQUEMA}.pagos (academia_id uuid NOT NULL, numero text)`],
      tablasConAcademiaId,
    );

    expect(encontrados).toEqual(expect.arrayContaining(['public.auditoria', `${ESQUEMA}.pagos`]));
  });

  it('criterio 142 (criterio 124): una vista sin security_invoker en el esquema de la extension se detecta y una con security_invoker = true no', async (contexto) => {
    const encontrados = await enEsquemaDeExtension(
      contexto,
      [
        `CREATE VIEW ${ESQUEMA}.v_sin_invoker AS SELECT id FROM public.academias`,
        `CREATE VIEW ${ESQUEMA}.v_con_invoker WITH (security_invoker = true) AS SELECT id FROM public.academias`,
      ],
      vistasSinSecurityInvoker,
    );

    expect(encontrados).toContain(`${ESQUEMA}.v_sin_invoker`);
    expect(encontrados).not.toContain(`${ESQUEMA}.v_con_invoker`);
  });

  it('criterio 142 (criterio 124): una vista materializada, una funcion SECURITY DEFINER y una funcion con row_security = off del esquema de la extension se detectan', async (contexto) => {
    const sentencias = [
      `CREATE MATERIALIZED VIEW ${ESQUEMA}.mv_ejemplo AS SELECT id FROM public.academias`,
      `CREATE FUNCTION ${ESQUEMA}.f_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`,
      `CREATE FUNCTION ${ESQUEMA}.f_sin_rls() RETURNS int LANGUAGE sql SET row_security = off AS 'SELECT 1'`,
    ];
    const resultados = await enEsquemaDeExtension(contexto, sentencias, async (cliente) => ({
      materializadas: await materializadasYForaneas(cliente),
      definer: await securityDefiner(cliente),
      configuracion: await configuracionDistintaDeSearchPath(cliente),
    }));

    expect(resultados.materializadas).toContain(`${ESQUEMA}.mv_ejemplo`);
    expect(resultados.definer).toContain(`${ESQUEMA}.f_definer`);
    expect(resultados.configuracion).toContain(`${ESQUEMA}.f_sin_rls`);
  });

  it('criterio 142 (criterio 126): una tabla con academia_id y UNIQUE (numero) en el esquema de la extension se detecta y UNIQUE (academia_id, numero) no', async (contexto) => {
    const encontrados = await enEsquemaDeExtension(
      contexto,
      [
        `CREATE TABLE ${ESQUEMA}.u_global (academia_id uuid NOT NULL, numero text, UNIQUE (numero))`,
        `CREATE TABLE ${ESQUEMA}.u_ok (academia_id uuid NOT NULL, numero text, UNIQUE (academia_id, numero))`,
      ],
      unicidadSinAcademia,
    );

    expect(encontrados.filter((nombre) => nombre.startsWith(`${ESQUEMA}.u_global.`))).toHaveLength(1);
    expect(encontrados.filter((nombre) => nombre.startsWith(`${ESQUEMA}.u_ok.`))).toEqual([]);
  });

  it('criterio 142 (control): una tabla sin RLS y sin academia_id del mismo esquema agregada a la extension no aparece en las consultas del 9 ni del 10', async (contexto) => {
    const { sinRls, sinAcademia } = await enEsquemaDeExtension(
      contexto,
      [
        `CREATE TABLE ${ESQUEMA}.t_de_extension (id int)`,
        `ALTER EXTENSION ${EXTENSION} ADD TABLE ${ESQUEMA}.t_de_extension`,
      ],
      async (cliente) => ({
        sinRls: await tablasSinRls(cliente),
        sinAcademia: await tablasSinAcademiaIdFueraDeLaLista(cliente),
      }),
    );

    expect(sinRls).not.toContain(`${ESQUEMA}.t_de_extension`);
    expect(sinAcademia).not.toContain(`${ESQUEMA}.t_de_extension`);
  });

  const CONSULTAS: readonly (readonly [string, Consulta])[] = [
    ['tablas sin RLS', tablasSinRls],
    ['tablas con academia_id', tablasConAcademiaId],
    ['tablas sin academia_id fuera de la lista', tablasSinAcademiaIdFueraDeLaLista],
    ['vistas sin security_invoker', vistasSinSecurityInvoker],
    ['vistas materializadas y tablas foraneas', materializadasYForaneas],
    ['funciones SECURITY DEFINER', securityDefiner],
    ['funciones con valores propios', configuracionDistintaDeSearchPath],
    ['unicidad sin academia_id', unicidadSinAcademia],
  ];

  it('criterio 142 (control): ninguna consulta cuenta un objeto de la extension dentro del esquema de la extension (tabla, vista, vista materializada y funcion agregadas con ALTER EXTENSION ... ADD)', async (contexto) => {
    const resultados = await enEsquemaDeExtension(
      contexto,
      [
        `CREATE TABLE ${ESQUEMA}.t_de_extension (academia_id uuid NOT NULL, numero text UNIQUE)`,
        `CREATE VIEW ${ESQUEMA}.v_de_extension AS SELECT id FROM public.academias`,
        `CREATE MATERIALIZED VIEW ${ESQUEMA}.mv_de_extension AS SELECT id FROM public.academias`,
        `CREATE FUNCTION ${ESQUEMA}.f_de_extension() RETURNS int LANGUAGE sql SECURITY DEFINER SET row_security = off AS 'SELECT 1'`,
        `ALTER EXTENSION ${EXTENSION} ADD TABLE ${ESQUEMA}.t_de_extension`,
        `ALTER EXTENSION ${EXTENSION} ADD VIEW ${ESQUEMA}.v_de_extension`,
        `ALTER EXTENSION ${EXTENSION} ADD MATERIALIZED VIEW ${ESQUEMA}.mv_de_extension`,
        `ALTER EXTENSION ${EXTENSION} ADD FUNCTION ${ESQUEMA}.f_de_extension()`,
      ],
      async (cliente) => {
        const salida: [string, string[]][] = [];
        for (const [nombre, consulta] of CONSULTAS) {
          salida.push([nombre, (await consulta(cliente)).filter((objeto) => objeto.startsWith(`${ESQUEMA}.`))]);
        }
        return salida;
      },
    );

    for (const [nombre, encontrados] of resultados) {
      expect(encontrados, `${nombre}: no debe contar objetos de una extension`).toEqual([]);
    }
  });

  it('criterio 142: lo creado en las autocomprobaciones se revirtio (el esquema y la extension ya no estan) y las consultas sobre la base real no informan nada', async () => {
    const { esquema, extension } = await conClienteComo('propietario', async (cliente) => ({
      esquema: (await cliente.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [ESQUEMA])).rows,
      extension: (await cliente.query('SELECT 1 FROM pg_catalog.pg_extension WHERE extname = $1', [EXTENSION])).rows,
    }));

    expect(esquema).toEqual([]);
    if (creaExtension) expect(extension).toEqual([]);
    for (const [nombre, consulta] of [
      ['tablas sin RLS', tablasSinRls],
      ['tablas sin academia_id fuera de la lista', tablasSinAcademiaIdFueraDeLaLista],
      ['vistas sin security_invoker', vistasSinSecurityInvoker],
      ['funciones SECURITY DEFINER', securityDefiner],
      ['unicidad sin academia_id', unicidadSinAcademia],
    ] as const) {
      expect(await conClienteComo('propietario', consulta), nombre).toEqual([]);
    }
  });
});
