// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';
import { beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { conTransaccionRevertida } from '../../utilidades/base-datos';
import { cargarFuncionalidad } from '../../utilidades/ronda3';
import { puedeCrearEsquemas } from '../../utilidades/ronda5';

// Criterio 137 (ataque ronda 7, F1), prueba de catalogo: la exclusion de los objetos de extensiones de las comprobaciones de privilegios
// (criterios 102, 125 y 130, en la API y en `db:crear`) no puede tapar las tablas propias: un `ALTER EXTENSION ... ADD TABLE auditoria`
// sacaria la tabla de todas las comprobaciones. Con las migraciones aplicadas, esta prueba falla si es objeto de extension:
//   - alguna tabla de `PRIVILEGIOS_APP` (`public.<tabla>`, criterio 2; P-20);
//   - alguna funcion de `FUNCIONES_APP` (`public.<nombre>(<argumentos>)`; P-31);
//   - alguna relacion con columna `academia_id` de cualquier esquema que no sea `pg_catalog`, `information_schema`, `pg_toast` ni
//     temporal (tambien de un esquema de extension: aqui no se excluyen los esquemas de extensiones, justo se buscan sus objetos).
// Con las migraciones de esta historia y nada mas, pasa desde el principio. Autocomprobacion, como dueno, en una transaccion que se
// revierte, con una extension de confianza creada por la prueba (`pgcrypto`): una tabla `public.tabla_de_extension` con
// `academia_id uuid` agregada con `ALTER EXTENSION ... ADD TABLE` aparece en el resultado; tambien `public.auditoria` (una tabla de
// `PRIVILEGIOS_APP`) y `public.app_academia_actual()` (una funcion de `FUNCIONES_APP`) agregadas a la extension, y una tabla con
// `academia_id` en el esquema de la extension. Si el dueno no puede crear la extension (o ya esta instalada), la autocomprobacion se
// omite con aviso.

interface PrivilegioApp {
  readonly tabla: string;
  readonly columna: string | null;
  readonly privilegio: string;
}
interface FuncionApp {
  readonly esquema: 'public';
  readonly nombre: string;
  readonly argumentos: string;
}
interface Listas {
  readonly PRIVILEGIOS_APP: readonly PrivilegioApp[];
  readonly FUNCIONES_APP: readonly FuncionApp[];
}

const cargarListas = (): Promise<Listas> =>
  cargarFuncionalidad<Listas>('infraestructura/prisma/privilegios-app.ts', ['PRIVILEGIOS_APP', 'FUNCIONES_APP']);

const EXTENSION = 'pgcrypto';
const codigoDe = (error: unknown): string | undefined => (error as { code?: string }).code;

/** Condicion SQL: el objeto (`classid`, `objid`) es miembro de una extension. */
const deExtension = (clase: 'pg_class' | 'pg_proc', alias: string): string =>
  `EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
            WHERE d.classid = 'pg_catalog.${clase}'::pg_catalog.regclass AND d.objid = ${alias}.oid
              AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e')`;

interface Vigilado {
  readonly objeto: string;
  readonly deExtension: boolean;
}

/**
 * Los objetos vigilados (tablas de `PRIVILEGIOS_APP`, funciones de `FUNCIONES_APP` y relaciones con `academia_id` de cualquier esquema
 * que no sea del sistema ni temporal), cada uno con si es objeto de extension.
 */
async function objetosVigilados(cliente: pg.ClientBase, listas: Listas): Promise<Vigilado[]> {
  const tablas = [...new Set(listas.PRIVILEGIOS_APP.map((p) => p.tabla))];
  const relaciones = await cliente.query(
    `SELECT n.nspname || '.' || c.relname AS objeto, ${deExtension('pg_class', 'c')} AS de_extension
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_(toast_)?temp_'
        AND (EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'academia_id' AND a.attnum > 0 AND NOT a.attisdropped)
             OR (n.nspname = 'public' AND c.relname = ANY ($1::text[])))`,
    [tablas],
  );
  const nombres = listas.FUNCIONES_APP.map((f) => f.nombre);
  const funciones = await cliente.query(
    `SELECT n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS objeto,
            ${deExtension('pg_proc', 'p')} AS de_extension
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY ($1::text[])`,
    [nombres],
  );
  const permitidas = new Set(listas.FUNCIONES_APP.map((f) => `public.${f.nombre}(${f.argumentos})`));
  return [
    ...(relaciones.rows as { objeto: string; de_extension: boolean }[]).map((fila) => ({
      objeto: fila.objeto,
      deExtension: fila.de_extension,
    })),
    ...(funciones.rows as { objeto: string; de_extension: boolean }[])
      .filter((fila) => permitidas.has(fila.objeto))
      .map((fila) => ({ objeto: fila.objeto, deExtension: fila.de_extension })),
  ];
}

const objetosDeExtension = (vigilados: readonly Vigilado[]): string[] =>
  vigilados
    .filter((v) => v.deExtension)
    .map((v) => v.objeto)
    .sort();

describe('criterio 137: ninguna tabla ni funcion propia es objeto de una extension (con las migraciones aplicadas)', () => {
  it('criterio 137: la prueba mira los objetos propios (no pasa en vacio): auditoria, configuraciones, las tres funciones y toda relacion con academia_id', async () => {
    const listas = await cargarListas();
    const vigilados = await conTransaccionRevertida('propietario', undefined, (cliente) =>
      objetosVigilados(cliente, listas),
    );
    const nombres = vigilados.map((v) => v.objeto);

    expect(nombres).toEqual(
      expect.arrayContaining([
        'public.auditoria',
        'public.configuraciones',
        'public.academias',
        'public.superadmins',
        'public.auditoria_plataforma',
        'public.app_academia_actual()',
        'public.app_es_plataforma()',
        'public.resolver_academia(p_nombre_corto text)',
      ]),
    );
  });

  it('criterio 137: ninguna tabla de PRIVILEGIOS_APP, ninguna funcion de FUNCIONES_APP ni ninguna relacion con academia_id es objeto de una extension', async () => {
    const listas = await cargarListas();
    const vigilados = await conTransaccionRevertida('propietario', undefined, (cliente) =>
      objetosVigilados(cliente, listas),
    );

    expect(
      objetosDeExtension(vigilados),
      'objetos propios que son miembros de una extension: las comprobaciones de privilegios los ignorarian (criterio 137)',
    ).toEqual([]);
  });
});

describe('criterio 137: autocomprobacion, la prueba detecta un objeto propio agregado a una extension (en una transaccion que se revierte)', () => {
  let creaExtension = false;
  let creaEsquemas = false;

  beforeAll(async () => {
    creaEsquemas = await puedeCrearEsquemas();
    creaExtension = await conTransaccionRevertida('propietario', undefined, async (cliente) => {
      try {
        await cliente.query(`CREATE EXTENSION ${EXTENSION} SCHEMA public`);
        return true;
      } catch (error) {
        // 42501 y 0A000: sin permiso o no disponible; 42710: ya esta instalada por otro (no se toca).
        if (['42501', '0A000', '58P01', '42710'].includes(codigoDe(error) ?? '')) return false;
        throw error;
      }
    });
    if (!creaExtension) {
      console.warn(
        `[criterio 137] AVISO: el dueno de la base de pruebas no puede crear la extension ${EXTENSION} (o ya esta instalada); la autocomprobacion de la prueba de catalogo se omite.`,
      );
    }
  });

  function omitirSiNoSePuede(contexto: TestContext, exigeEsquemas = false): void {
    if (!creaExtension) contexto.skip(`el dueno de la base de pruebas no puede crear la extension ${EXTENSION}`);
    if (exigeEsquemas && !creaEsquemas) contexto.skip('el dueno de la base de pruebas no puede crear esquemas');
  }

  /** Crea la extension en `public`, ejecuta las sentencias y devuelve los objetos de extension que la prueba de catalogo encuentra. */
  async function encontrados(sentencias: readonly string[], esquemaDeLaExtension = 'public'): Promise<string[]> {
    const listas = await cargarListas();
    return conTransaccionRevertida('propietario', undefined, async (cliente) => {
      if (esquemaDeLaExtension !== 'public') await cliente.query(`CREATE SCHEMA ${esquemaDeLaExtension}`);
      await cliente.query(`CREATE EXTENSION ${EXTENSION} SCHEMA ${esquemaDeLaExtension}`);
      for (const sentencia of sentencias) await cliente.query(sentencia);
      return objetosDeExtension(await objetosVigilados(cliente, listas));
    });
  }

  it('criterio 137: una tabla public.tabla_de_extension con academia_id agregada con ALTER EXTENSION ... ADD TABLE aparece en el resultado', async (contexto) => {
    omitirSiNoSePuede(contexto);

    expect(
      await encontrados([
        'CREATE TABLE public.tabla_de_extension (academia_id uuid)',
        `ALTER EXTENSION ${EXTENSION} ADD TABLE public.tabla_de_extension`,
      ]),
    ).toEqual(['public.tabla_de_extension']);
  });

  it('criterio 137: una tabla de PRIVILEGIOS_APP (public.auditoria) agregada a una extension aparece en el resultado', async (contexto) => {
    omitirSiNoSePuede(contexto);

    expect(await encontrados([`ALTER EXTENSION ${EXTENSION} ADD TABLE public.auditoria`])).toEqual([
      'public.auditoria',
    ]);
  });

  it('criterio 137: una funcion de FUNCIONES_APP (public.app_academia_actual()) agregada a una extension aparece en el resultado', async (contexto) => {
    omitirSiNoSePuede(contexto);

    expect(await encontrados([`ALTER EXTENSION ${EXTENSION} ADD FUNCTION public.app_academia_actual()`])).toEqual([
      'public.app_academia_actual()',
    ]);
  });

  it('criterio 137: una tabla con academia_id en el esquema de la propia extension aparece en el resultado (aqui no se excluyen los esquemas de extensiones)', async (contexto) => {
    omitirSiNoSePuede(contexto, true);

    expect(
      await encontrados(
        [
          'CREATE TABLE ext_catalogo.tabla_de_extension (academia_id uuid)',
          `ALTER EXTENSION ${EXTENSION} ADD TABLE ext_catalogo.tabla_de_extension`,
        ],
        'ext_catalogo',
      ),
    ).toEqual(['ext_catalogo.tabla_de_extension']);
  });

  it('criterio 137 (control): una tabla con academia_id que no es objeto de extension no aparece, aunque la extension este instalada', async (contexto) => {
    omitirSiNoSePuede(contexto);

    expect(await encontrados(['CREATE TABLE public.tabla_propia (academia_id uuid)'])).toEqual([]);
  });

  it('criterio 137: lo creado en la autocomprobacion se revirtio (la extension ya no esta y la prueba de catalogo sigue limpia)', async () => {
    const listas = await cargarListas();
    const { extension, vigilados } = await conTransaccionRevertida('propietario', undefined, async (cliente) => ({
      extension: (await cliente.query('SELECT 1 FROM pg_catalog.pg_extension WHERE extname = $1', [EXTENSION])).rows,
      vigilados: await objetosVigilados(cliente, listas),
    }));

    if (creaExtension) expect(extension).toEqual([]);
    expect(objetosDeExtension(vigilados)).toEqual([]);
  });
});
