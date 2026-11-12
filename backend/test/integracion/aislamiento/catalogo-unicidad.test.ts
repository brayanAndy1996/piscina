// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { conClienteComo, conTransaccionRevertida } from '../../utilidades/base-datos';

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

/** Indices (restriccion o no) de `public` sin `academia_id` entre sus columnas clave permitidos (criterio 126). Hoy ninguno. */
const UNICIDAD_SIN_ACADEMIA_PERMITIDA: readonly string[] = [];

/**
 * Indices unicos o de exclusion (llaves primarias y restricciones incluidas) de tablas de `public` con columna `academia_id` donde
 * esa columna no esta entre las columnas CLAVE del indice (las de INCLUDE van despues de `indnkeyatts`; una expresion tiene
 * `indkey = 0` y no cuenta), salvo la llave primaria formada solo por `id uuid DEFAULT gen_random_uuid()` y la lista permitida.
 */
async function unicidadSinAcademia(cliente: pg.ClientBase): Promise<string[]> {
  const { rows } = await cliente.query(
    `SELECT c.relname || '.' || i.relname AS objeto
       FROM pg_catalog.pg_index x
       JOIN pg_catalog.pg_class c ON c.oid = x.indrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
       JOIN pg_catalog.pg_attribute a
         ON a.attrelid = c.oid AND a.attname = 'academia_id' AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'public'
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
        AND NOT (c.relname || '.' || i.relname = ANY ($1::text[]))
      ORDER BY 1`,
    [UNICIDAD_SIN_ACADEMIA_PERMITIDA],
  );
  return (rows as { objeto: string }[]).map((fila) => fila.objeto);
}

describe('criterio 126: con las migraciones aplicadas, toda unicidad de una tabla de academia incluye academia_id', () => {
  it('criterio 126: ninguna llave primaria, restriccion UNIQUE, indice unico o de exclusion de public deja a academia_id fuera de sus columnas clave', async () => {
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

  const tabla = (nombre: string, columnas: string): string =>
    `CREATE TABLE public.${nombre} (academia_id uuid NOT NULL, ${columnas})`;

  it('criterio 126: numero_operacion text UNIQUE se detecta', async () => {
    const encontrados = await detectadas([tabla('u_columna', 'numero_operacion text UNIQUE')]);

    expect(encontrados.filter((nombre) => nombre.startsWith('u_columna.'))).toHaveLength(1);
  });

  it('criterio 126: CREATE UNIQUE INDEX ... (numero_operacion) INCLUDE (academia_id) se detecta (INCLUDE no basta)', async () => {
    const encontrados = await detectadas([
      tabla('u_include', 'numero_operacion text'),
      'CREATE UNIQUE INDEX u_include_idx ON public.u_include (numero_operacion) INCLUDE (academia_id)',
    ]);

    expect(encontrados).toContain('u_include.u_include_idx');
  });

  it('criterio 126: una llave primaria (numero) de texto se detecta', async () => {
    const encontrados = await detectadas([tabla('u_pk_texto', 'numero text PRIMARY KEY')]);

    expect(encontrados.filter((nombre) => nombre.startsWith('u_pk_texto.'))).toHaveLength(1);
  });

  it('criterio 126: una llave primaria id uuid sin valor por defecto se detecta', async () => {
    const encontrados = await detectadas([tabla('u_pk_uuid', 'id uuid PRIMARY KEY')]);

    expect(encontrados.filter((nombre) => nombre.startsWith('u_pk_uuid.'))).toHaveLength(1);
  });

  it('criterio 126: una llave primaria id uuid con un valor por defecto fijo (no gen_random_uuid()) se detecta', async () => {
    const encontrados = await detectadas([
      tabla('u_pk_otro_default', "id uuid PRIMARY KEY DEFAULT '00000000-0000-4000-8000-000000000000'"),
    ]);

    expect(encontrados.filter((nombre) => nombre.startsWith('u_pk_otro_default.'))).toHaveLength(1);
  });

  it('criterio 126: una llave primaria id de tipo texto con gen_random_uuid()::text se detecta (debe ser uuid)', async () => {
    const encontrados = await detectadas([
      tabla('u_pk_texto_uuid', 'id text PRIMARY KEY DEFAULT gen_random_uuid()::text'),
    ]);

    expect(encontrados.filter((nombre) => nombre.startsWith('u_pk_texto_uuid.'))).toHaveLength(1);
  });

  it('criterio 126: academia_id solo dentro de una expresion del indice se detecta', async () => {
    const encontrados = await detectadas([
      tabla('u_expresion', 'numero text'),
      'CREATE UNIQUE INDEX u_expresion_idx ON public.u_expresion (lower(numero), (academia_id::text))',
    ]);

    expect(encontrados).toContain('u_expresion.u_expresion_idx');
  });

  it('criterio 126: un indice unico parcial sin academia_id se detecta y uno con academia_id no', async () => {
    const encontrados = await detectadas([
      tabla('u_parcial', 'numero text, activo boolean'),
      'CREATE UNIQUE INDEX u_parcial_sin ON public.u_parcial (numero) WHERE activo',
      'CREATE UNIQUE INDEX u_parcial_con ON public.u_parcial (academia_id, numero) WHERE activo',
    ]);

    expect(encontrados).toContain('u_parcial.u_parcial_sin');
    expect(encontrados).not.toContain('u_parcial.u_parcial_con');
  });

  it('criterio 126: una restriccion de exclusion sin academia_id se detecta y una con academia_id no', async () => {
    const encontrados = await detectadas([
      tabla(
        'u_exclusion',
        'numero text, CONSTRAINT excl_sin EXCLUDE USING btree (numero WITH =), CONSTRAINT excl_con EXCLUDE USING btree (academia_id WITH =, numero WITH =)',
      ),
    ]);

    expect(encontrados).toContain('u_exclusion.excl_sin');
    expect(encontrados).not.toContain('u_exclusion.excl_con');
  });

  it('criterio 126: UNIQUE (academia_id, numero_operacion) no se detecta', async () => {
    const encontrados = await detectadas([
      tabla('u_ok', 'numero_operacion text, UNIQUE (academia_id, numero_operacion)'),
    ]);

    expect(encontrados.filter((nombre) => nombre.startsWith('u_ok.'))).toEqual([]);
  });

  it('criterio 126: academia_id como segunda columna clave (numero_operacion, academia_id) no se detecta (basta que este entre las claves)', async () => {
    const encontrados = await detectadas([
      tabla('u_orden', 'numero_operacion text, UNIQUE (numero_operacion, academia_id)'),
    ]);

    expect(encontrados.filter((nombre) => nombre.startsWith('u_orden.'))).toEqual([]);
  });

  it('criterio 126: una llave primaria id uuid DEFAULT gen_random_uuid() (la excepcion) no se detecta', async () => {
    const encontrados = await detectadas([tabla('u_excepcion', 'id uuid PRIMARY KEY DEFAULT gen_random_uuid()')]);

    expect(encontrados.filter((nombre) => nombre.startsWith('u_excepcion.'))).toEqual([]);
  });

  it('criterio 126: una llave primaria (academia_id, id) y una tabla sin academia_id con UNIQUE no se detectan', async () => {
    const encontrados = await detectadas([
      tabla('u_compuesta', 'id uuid, PRIMARY KEY (academia_id, id)'),
      'CREATE TABLE public.u_global (correo text UNIQUE)',
    ]);

    expect(encontrados.filter((nombre) => nombre.startsWith('u_compuesta.') || nombre.startsWith('u_global.'))).toEqual(
      [],
    );
  });

  it('criterio 126: lo creado en las autocomprobaciones se revirtio (el catalogo sigue limpio)', async () => {
    const encontrados = await conClienteComo('propietario', unicidadSinAcademia);

    expect(encontrados).toEqual([]);
  });
});
