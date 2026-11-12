// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { UNICIDAD_SIN_ACADEMIA_PERMITIDA, unicidadSinAcademia } from '../../utilidades/catalogo';
import { conClienteComo, conTransaccionRevertida } from '../../utilidades/base-datos';

// AMPLIADO POR EL CRITERIO 131 (ataque ronda 6, F1 (b)): la consulta mira las tablas con `academia_id` de todos los esquemas revisados
// (sin los objetos de extensiones), no solo `public`; los nombres que informa son `esquema.tabla.indice` y la lista "Unicidad sin
// `academia_id` permitida" (hoy vacia) se escribe con el esquema (`public.tabla.indice`). La consulta esta en
// `backend/test/utilidades/catalogo.ts`; que detecta una tabla de otro esquema lo comprueba `catalogo-esquemas.test.ts`. Lo que se
// comprueba en `public` no cambia.
//
// Criterio 126 (ataque ronda 5, O5; complementa los criterios 11 y 12): unicidad siempre dentro de la academia. Una restriccion
// unica global en una tabla de academia respondería 409 ante un valor que existe en otra academia (por ejemplo, un
// `numero_operacion` de pagos, RN-28) y revelaria asi datos de esa academia. Por eso, en el esquema `public`, toda llave primaria,
// restriccion UNIQUE, indice unico (tambien parcial) y restriccion de exclusion de una tabla con columna `academia_id` tiene
// `academia_id` entre sus columnas clave (no basta en INCLUDE ni dentro de una expresion), con dos excepciones: la llave primaria
// formada solo por `id`, de tipo `uuid` y con valor por defecto `gen_random_uuid()`; y las de la lista "Unicidad sin `academia_id`
// permitida" (hoy vacia). Prueba de catalogo que, ademas, como dueno dentro de una transaccion que se revierte, comprueba que
// detecta una tabla de ejemplo con `numero_operacion text UNIQUE`, otra con `CREATE UNIQUE INDEX ... (numero_operacion) INCLUDE
// (academia_id)`, otra con llave primaria `(numero)` de texto y otra con llave primaria `id uuid` sin valor por defecto, y que no
// detecta `UNIQUE (academia_id, numero_operacion)`. Las historias siguientes declaran asi sus restricciones unicas (por ejemplo,
// el DNI unico por academia de D-28).
//
// Este archivo es una guarda para las historias siguientes: con las migraciones actuales pasa desde el principio.

describe('criterio 126 y 131: con las migraciones aplicadas, toda unicidad de una tabla de academia incluye academia_id', () => {
  it('criterio 126 y 131: ninguna llave primaria, restriccion UNIQUE, indice unico o de exclusion de ningun esquema revisado deja a academia_id fuera de sus columnas clave', async () => {
    expect(UNICIDAD_SIN_ACADEMIA_PERMITIDA).toEqual([]);
    const encontrados = await conClienteComo('propietario', unicidadSinAcademia);

    expect(encontrados).toEqual([]);
  });

  it('criterio 126: la consulta mira las tablas de academia que hay (auditoria y configuraciones tienen indices unicos)', async () => {
    const { rows } = await conClienteComo('propietario', (cliente) =>
      cliente.query(
        `SELECT c.relname AS tabla, count(*)::int AS indices
           FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class c ON c.oid = x.indrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND x.indisunique AND c.relname IN ('auditoria', 'configuraciones')
          GROUP BY c.relname ORDER BY 1`,
      ),
    );

    expect((rows as { tabla: string }[]).map((fila) => fila.tabla)).toEqual(['auditoria', 'configuraciones']);
  });
});

describe('criterio 126: autocomprobacion, la consulta detecta cada caso (tablas creadas en una transaccion que se revierte)', () => {
  async function detectadas(sentencias: readonly string[]): Promise<string[]> {
    return conTransaccionRevertida('propietario', undefined, async (cliente) => {
      for (const sentencia of sentencias) await cliente.query(sentencia);
      return unicidadSinAcademia(cliente);
    });
  }

  // Los nombres que informa la consulta llevan el esquema: `public.<tabla>.<indice>` (criterio 131).

  const tabla = (nombre: string, columnas: string): string =>
    `CREATE TABLE public.${nombre} (academia_id uuid NOT NULL, ${columnas})`;

  it('criterio 126: numero_operacion text UNIQUE se detecta', async () => {
    const encontrados = await detectadas([tabla('u_columna', 'numero_operacion text UNIQUE')]);

    expect(encontrados.filter((nombre) => nombre.startsWith('public.u_columna.'))).toHaveLength(1);
  });

  it('criterio 126: CREATE UNIQUE INDEX ... (numero_operacion) INCLUDE (academia_id) se detecta (INCLUDE no basta)', async () => {
    const encontrados = await detectadas([
      tabla('u_include', 'numero_operacion text'),
      'CREATE UNIQUE INDEX u_include_idx ON public.u_include (numero_operacion) INCLUDE (academia_id)',
    ]);

    expect(encontrados).toContain('public.u_include.u_include_idx');
  });

  it('criterio 126: una llave primaria (numero) de texto se detecta', async () => {
    const encontrados = await detectadas([tabla('u_pk_texto', 'numero text PRIMARY KEY')]);

    expect(encontrados.filter((nombre) => nombre.startsWith('public.u_pk_texto.'))).toHaveLength(1);
  });

  it('criterio 126: una llave primaria id uuid sin valor por defecto se detecta', async () => {
    const encontrados = await detectadas([tabla('u_pk_uuid', 'id uuid PRIMARY KEY')]);

    expect(encontrados.filter((nombre) => nombre.startsWith('public.u_pk_uuid.'))).toHaveLength(1);
  });

  it('criterio 126: una llave primaria id uuid con un valor por defecto fijo (no gen_random_uuid()) se detecta', async () => {
    const encontrados = await detectadas([
      tabla('u_pk_otro_default', "id uuid PRIMARY KEY DEFAULT '00000000-0000-4000-8000-000000000000'"),
    ]);

    expect(encontrados.filter((nombre) => nombre.startsWith('public.u_pk_otro_default.'))).toHaveLength(1);
  });

  it('criterio 126: una llave primaria id de tipo texto con gen_random_uuid()::text se detecta (debe ser uuid)', async () => {
    const encontrados = await detectadas([
      tabla('u_pk_texto_uuid', 'id text PRIMARY KEY DEFAULT gen_random_uuid()::text'),
    ]);

    expect(encontrados.filter((nombre) => nombre.startsWith('public.u_pk_texto_uuid.'))).toHaveLength(1);
  });

  it('criterio 126: academia_id solo dentro de una expresion del indice se detecta', async () => {
    const encontrados = await detectadas([
      tabla('u_expresion', 'numero text'),
      'CREATE UNIQUE INDEX u_expresion_idx ON public.u_expresion (lower(numero), (academia_id::text))',
    ]);

    expect(encontrados).toContain('public.u_expresion.u_expresion_idx');
  });

  it('criterio 126: un indice unico parcial sin academia_id se detecta y uno con academia_id no', async () => {
    const encontrados = await detectadas([
      tabla('u_parcial', 'numero text, activo boolean'),
      'CREATE UNIQUE INDEX u_parcial_sin ON public.u_parcial (numero) WHERE activo',
      'CREATE UNIQUE INDEX u_parcial_con ON public.u_parcial (academia_id, numero) WHERE activo',
    ]);

    expect(encontrados).toContain('public.u_parcial.u_parcial_sin');
    expect(encontrados).not.toContain('public.u_parcial.u_parcial_con');
  });

  it('criterio 126: una restriccion de exclusion sin academia_id se detecta y una con academia_id no', async () => {
    const encontrados = await detectadas([
      tabla(
        'u_exclusion',
        'numero text, CONSTRAINT excl_sin EXCLUDE USING btree (numero WITH =), CONSTRAINT excl_con EXCLUDE USING btree (academia_id WITH =, numero WITH =)',
      ),
    ]);

    expect(encontrados).toContain('public.u_exclusion.excl_sin');
    expect(encontrados).not.toContain('public.u_exclusion.excl_con');
  });

  it('criterio 126: UNIQUE (academia_id, numero_operacion) no se detecta', async () => {
    const encontrados = await detectadas([
      tabla('u_ok', 'numero_operacion text, UNIQUE (academia_id, numero_operacion)'),
    ]);

    expect(encontrados.filter((nombre) => nombre.startsWith('public.u_ok.'))).toEqual([]);
  });

  it('criterio 126: academia_id como segunda columna clave (numero_operacion, academia_id) no se detecta (basta que este entre las claves)', async () => {
    const encontrados = await detectadas([
      tabla('u_orden', 'numero_operacion text, UNIQUE (numero_operacion, academia_id)'),
    ]);

    expect(encontrados.filter((nombre) => nombre.startsWith('public.u_orden.'))).toEqual([]);
  });

  it('criterio 126: una llave primaria id uuid DEFAULT gen_random_uuid() (la excepcion) no se detecta', async () => {
    const encontrados = await detectadas([tabla('u_excepcion', 'id uuid PRIMARY KEY DEFAULT gen_random_uuid()')]);

    expect(encontrados.filter((nombre) => nombre.startsWith('public.u_excepcion.'))).toEqual([]);
  });

  it('criterio 126: una llave primaria (academia_id, id) y una tabla sin academia_id con UNIQUE no se detectan', async () => {
    const encontrados = await detectadas([
      tabla('u_compuesta', 'id uuid, PRIMARY KEY (academia_id, id)'),
      'CREATE TABLE public.u_global (correo text UNIQUE)',
    ]);

    expect(
      encontrados.filter((nombre) => nombre.startsWith('public.u_compuesta.') || nombre.startsWith('public.u_global.')),
    ).toEqual([]);
  });

  it('criterio 126: lo creado en las autocomprobaciones se revirtio (el catalogo sigue limpio)', async () => {
    const encontrados = await conClienteComo('propietario', unicidadSinAcademia);

    expect(encontrados).toEqual([]);
  });
});
