// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';
import { beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { conTransaccionRevertida } from '../../utilidades/base-datos';
import { conAcademiaId, esquemasRevisados, relacionDeExtension } from '../../utilidades/catalogo';
import { problemasDeLaPolitica, type PoliticaLeida } from '../../utilidades/politicas';
import { puedeCrearEsquemas } from '../../utilidades/ronda5';

// Criterio 132 (ataque ronda 6, F2 (a); complementa el criterio 11): cada politica de una tabla con `academia_id` (de cualquier esquema
// revisado, criterio 131) exige su academia. La prueba del criterio 11 aceptaba cualquier expresion que CONTUVIERA la comparacion
// (`academia_id = app_academia_actual() OR app_es_plataforma()`, `... OR <cualquier cosa>`, o un `EXISTS (...)` que no depende de la
// fila). Para cada politica, permisiva o restrictiva, y para cada una de sus expresiones (`USING` y `WITH CHECK`, las que tenga):
//   - la expresion es exactamente la comparacion `academia_id = app_academia_actual()` (en cualquier orden, con o sin `public.` y con o
//     sin parentesis) o una conjuncion (`AND`) en la que esa comparacion es uno de los terminos de primer nivel (una conjuncion anidada,
//     `a AND (b AND c)`, cuenta como de primer nivel; un termino dentro de `OR`, `NOT`, `CASE`, `EXISTS` o una subconsulta, no);
//   - ninguna expresion menciona `app_es_plataforma` ni `set_config`, en ningun termino;
//   - toda politica permisiva adicional cumple lo mismo (las permisivas se combinan con OR), y las de INSERT tienen WITH CHECK y las de
//     SELECT, UPDATE, DELETE y ALL, USING (criterio 11).
// Las expresiones se leen como dueno con `pg_catalog.pg_get_expr(polqual, polrelid)` y `pg_get_expr(polwithcheck, polrelid)` de
// `pg_catalog.pg_policy`, dentro de una transaccion con `search_path = pg_catalog, public` (asi un operador `=` o una funcion
// `app_academia_actual` de otro esquema aparecen calificados y no cumplen). Las politicas de las tablas sin `academia_id` (`academias`,
// `superadmins` y `auditoria_plataforma`) no cambian. El lector esta en `backend/test/utilidades/politicas.ts` (P-33).
//
// Este archivo es una guarda para las historias siguientes: con las migraciones actuales pasa desde el principio, y su
// autocomprobacion (tablas de ejemplo en una transaccion que se revierte) tambien.
//
// Criterio 140 (ataque ronda 7, O5; precisa el 132 y P-33): `academia_id = (SELECT app_academia_actual())` es la forma habitual de escribir
// la politica para que PostgreSQL evalue la funcion una vez por consulta y no por fila, y significa lo mismo que la comparacion directa.
// Un lado de la comparacion puede ser la llamada o una subconsulta escalar que solo la selecciona (con o sin `public.`, con o sin alias:
// `pg_get_expr` la escribe `( SELECT app_academia_actual() AS app_academia_actual)`, en cualquier espaciado y orden); la subconsulta no
// puede tener nada mas (`FROM`, `WHERE`, `LIMIT`, `UNION`, otra columna u otra funcion) y el operador sigue siendo `=`. Lo demas del
// criterio 132 no cambia. La autocomprobacion agrega los ejemplos marcados "criterio 140" a las listas de abajo; los ejemplos del
// criterio 132 no cambian de resultado.

/** Politicas de las tablas con `academia_id` de los esquemas revisados, leidas como dueno con `search_path = pg_catalog, public`. */
async function leerPoliticas(cliente: pg.ClientBase): Promise<PoliticaLeida[]> {
  await cliente.query('SET LOCAL search_path = pg_catalog, public');
  const { rows } = await cliente.query(
    `SELECT n.nspname AS esquema, c.relname AS tabla, p.polname AS nombre, p.polcmd::text AS comando,
            p.polpermissive AS permisiva,
            pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS usando,
            pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS comprobando
       FROM pg_catalog.pg_policy p
       JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${esquemasRevisados('n')} AND NOT (${relacionDeExtension('c')}) AND ${conAcademiaId('c')}
      ORDER BY n.nspname, c.relname, p.polname`,
  );
  return rows as PoliticaLeida[];
}

/** `esquema.tabla` de las tablas con algun incumplimiento, y los textos. */
async function incumplimientos(cliente: pg.ClientBase): Promise<Map<string, string[]>> {
  const resultado = new Map<string, string[]>();
  for (const politica of await leerPoliticas(cliente)) {
    const problemas = problemasDeLaPolitica(politica);
    if (problemas.length > 0) {
      const tabla = `${politica.esquema}.${politica.tabla}`;
      resultado.set(tabla, [...(resultado.get(tabla) ?? []), ...problemas]);
    }
  }
  return resultado;
}

describe('criterio 132: con las migraciones aplicadas, toda politica de una tabla con academia_id exige su academia', () => {
  it('criterio 132: ninguna politica de auditoria ni de configuraciones (ni de ninguna otra tabla con academia_id) incumple la forma exigida', async () => {
    const resultado = await conTransaccionRevertida('propietario', undefined, async (cliente) => ({
      politicas: await leerPoliticas(cliente),
      incumplimientos: await incumplimientos(cliente),
    }));

    const tablas = new Set(resultado.politicas.map((politica) => `${politica.esquema}.${politica.tabla}`));
    expect(
      [...tablas],
      'la consulta debe leer las politicas de las tablas con academia_id (no pasar en vacio)',
    ).toEqual(expect.arrayContaining(['public.auditoria', 'public.configuraciones']));
    expect([...resultado.incumplimientos.values()].flat()).toEqual([]);
  });

  it('criterio 132: la lectura con search_path = pg_catalog, public deja la comparacion sin calificar (academia_id = app_academia_actual())', async () => {
    const politicas = await conTransaccionRevertida('propietario', undefined, leerPoliticas);

    const deAuditoria = politicas.filter((politica) => politica.tabla === 'auditoria');
    expect(deAuditoria.length).toBeGreaterThan(0);
    for (const politica of deAuditoria) {
      expect(politica.usando).toMatch(/academia_id\s*=\s*app_academia_actual\(\)/);
    }
  });

  it('criterio 132: las politicas de las tablas sin academia_id (academias, superadmins, auditoria_plataforma) no cambian: siguen usando app_es_plataforma()', async () => {
    const filas = await conTransaccionRevertida('propietario', undefined, async (cliente) => {
      const { rows } = await cliente.query(
        `SELECT tablename AS tabla, qual, with_check FROM pg_catalog.pg_policies
          WHERE schemaname = 'public' AND tablename IN ('superadmins', 'auditoria_plataforma')`,
      );
      return rows as { tabla: string; qual: string | null; with_check: string | null }[];
    });
    const leidas = await conTransaccionRevertida('propietario', undefined, leerPoliticas);

    expect(filas.map((fila) => fila.tabla).sort()).toEqual(['auditoria_plataforma', 'superadmins']);
    for (const fila of filas) expect(`${fila.qual ?? ''} ${fila.with_check ?? ''}`).toContain('app_es_plataforma');
    expect(
      leidas.filter((politica) => ['academias', 'superadmins', 'auditoria_plataforma'].includes(politica.tabla)),
    ).toEqual([]);
  });
});

describe('criterio 132: autocomprobacion, la prueba detecta cada forma (tablas de ejemplo en una transaccion que se revierte)', () => {
  let creaEsquemas = false;
  beforeAll(async () => {
    creaEsquemas = await puedeCrearEsquemas();
    if (!creaEsquemas) {
      console.warn(
        '[criterio 132] AVISO: el dueno de la base de pruebas no puede crear esquemas; el caso de la funcion de otro esquema se omite. Corre en Docker y en la CI.',
      );
    }
  });

  /** Una tabla de ejemplo como las de 001: uuid NOT NULL, llave foranea a `academias` y RLS forzada. */
  const tabla = (nombre: string, esquema = 'public'): string[] => [
    `CREATE TABLE ${esquema}.${nombre} (
       id uuid NOT NULL DEFAULT gen_random_uuid(), academia_id uuid NOT NULL REFERENCES public.academias (id),
       clave text, valor text, PRIMARY KEY (academia_id, id))`,
    `ALTER TABLE ${esquema}.${nombre} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${esquema}.${nombre} FORCE ROW LEVEL SECURITY`,
  ];

  const CORRECTA = 'academia_id = app_academia_actual()';

  interface Ejemplo {
    readonly nombre: string;
    readonly politicas: readonly string[];
  }

  const DETECTADOS: readonly Ejemplo[] = [
    {
      nombre: 'USING (academia_id = app_academia_actual() OR app_es_plataforma())',
      politicas: [
        'CREATE POLICY p ON public.ej132_d1 USING (academia_id = app_academia_actual() OR app_es_plataforma())',
      ],
    },
    {
      nombre: 'USING ((academia_id = app_academia_actual()) OR true)',
      politicas: ['CREATE POLICY p ON public.ej132_d2 USING ((academia_id = app_academia_actual()) OR true)'],
    },
    {
      nombre:
        'USING (EXISTS (SELECT 1 FROM auditoria a WHERE a.academia_id = app_academia_actual())) (no depende de la fila)',
      politicas: [
        'CREATE POLICY p ON public.ej132_d3 USING (EXISTS (SELECT 1 FROM public.auditoria a WHERE a.academia_id = app_academia_actual()))',
      ],
    },
    {
      nombre: 'WITH CHECK (academia_id = app_academia_actual() OR app_es_plataforma()) con un USING correcto',
      politicas: [
        `CREATE POLICY p ON public.ej132_d4 USING (${CORRECTA}) WITH CHECK (academia_id = app_academia_actual() OR app_es_plataforma())`,
      ],
    },
    {
      nombre: 'una segunda politica permisiva USING (academia_id IS NOT NULL) junto a una correcta',
      politicas: [
        `CREATE POLICY correcta ON public.ej132_d5 USING (${CORRECTA}) WITH CHECK (${CORRECTA})`,
        'CREATE POLICY extra ON public.ej132_d5 AS PERMISSIVE FOR SELECT USING (academia_id IS NOT NULL)',
      ],
    },
    {
      nombre: 'una politica restrictiva USING (app_es_plataforma())',
      politicas: [
        `CREATE POLICY correcta ON public.ej132_d6 USING (${CORRECTA}) WITH CHECK (${CORRECTA})`,
        'CREATE POLICY restrictiva ON public.ej132_d6 AS RESTRICTIVE FOR SELECT USING (app_es_plataforma())',
      ],
    },
    {
      nombre:
        "USING (academia_id = app_academia_actual() AND pg_catalog.set_config('app.academia_id', '', true) IS NOT NULL)",
      politicas: [
        "CREATE POLICY p ON public.ej132_d7 USING (academia_id = app_academia_actual() AND pg_catalog.set_config('app.academia_id', '', true) IS NOT NULL)",
      ],
    },
    {
      nombre: 'una comparacion negada, USING (NOT (academia_id = app_academia_actual()))',
      politicas: ['CREATE POLICY p ON public.ej132_d8 USING (NOT (academia_id = app_academia_actual()))'],
    },
    {
      nombre: 'una politica correcta junto a una permisiva FOR SELECT USING (true)',
      politicas: [
        `CREATE POLICY correcta ON public.ej132_d9 USING (${CORRECTA}) WITH CHECK (${CORRECTA})`,
        'CREATE POLICY extra ON public.ej132_d9 FOR SELECT USING (true)',
      ],
    },
    // Criterio 140 (ataque ronda 7, O5): la subconsulta no puede tener nada mas que la funcion, y el operador sigue siendo `=`.
    {
      nombre: 'criterio 140: USING (academia_id = (SELECT app_academia_actual() FROM academias LIMIT 1))',
      politicas: [
        'CREATE POLICY p ON public.ej140_d1 USING (academia_id = (SELECT app_academia_actual() FROM academias LIMIT 1))',
      ],
    },
    {
      nombre: 'criterio 140: USING (academia_id = (SELECT app_academia_actual() WHERE true))',
      politicas: ['CREATE POLICY p ON public.ej140_d2 USING (academia_id = (SELECT app_academia_actual() WHERE true))'],
    },
    {
      nombre: 'criterio 140: USING (academia_id IN (SELECT app_academia_actual()))',
      politicas: ['CREATE POLICY p ON public.ej140_d3 USING (academia_id IN (SELECT app_academia_actual()))'],
    },
    {
      nombre: 'criterio 140: USING (academia_id = (SELECT app_academia_actual()) OR app_es_plataforma())',
      politicas: [
        'CREATE POLICY p ON public.ej140_d4 USING (academia_id = (SELECT app_academia_actual()) OR app_es_plataforma())',
      ],
    },
    {
      nombre: 'criterio 140: USING (academia_id = (SELECT app_academia_actual() UNION SELECT app_academia_actual()))',
      politicas: [
        'CREATE POLICY p ON public.ej140_d5 USING (academia_id = (SELECT app_academia_actual() UNION SELECT app_academia_actual()))',
      ],
    },
    {
      nombre: 'criterio 140: USING (academia_id = ANY (SELECT app_academia_actual()))',
      politicas: ['CREATE POLICY p ON public.ej140_d6 USING (academia_id = ANY (SELECT app_academia_actual()))'],
    },
    {
      nombre: 'criterio 140: USING (academia_id IS NOT DISTINCT FROM (SELECT app_academia_actual()))',
      politicas: [
        'CREATE POLICY p ON public.ej140_d7 USING (academia_id IS NOT DISTINCT FROM (SELECT app_academia_actual()))',
      ],
    },
    {
      nombre: 'criterio 140: USING (academia_id = (SELECT academia_id))',
      politicas: ['CREATE POLICY p ON public.ej140_d8 USING (academia_id = (SELECT academia_id))'],
    },
    {
      nombre:
        'criterio 140: WITH CHECK (academia_id = (SELECT app_academia_actual()) OR true) con un USING correcto con subconsulta',
      politicas: [
        'CREATE POLICY p ON public.ej140_d9 USING (academia_id = (SELECT app_academia_actual())) WITH CHECK (academia_id = (SELECT app_academia_actual()) OR true)',
      ],
    },
  ];

  const NO_DETECTADOS: readonly Ejemplo[] = [
    {
      nombre: 'USING (academia_id = app_academia_actual())',
      politicas: ['CREATE POLICY p ON public.ej132_ok1 USING (academia_id = app_academia_actual())'],
    },
    {
      nombre: 'USING (app_academia_actual() = academia_id)',
      politicas: ['CREATE POLICY p ON public.ej132_ok2 USING (app_academia_actual() = academia_id)'],
    },
    {
      nombre: 'USING (public.app_academia_actual() = academia_id)',
      politicas: ['CREATE POLICY p ON public.ej132_ok3 USING (public.app_academia_actual() = academia_id)'],
    },
    {
      nombre: "USING (academia_id = app_academia_actual() AND clave <> 'x')",
      politicas: ["CREATE POLICY p ON public.ej132_ok4 USING (academia_id = app_academia_actual() AND clave <> 'x')"],
    },
    {
      nombre: "USING (clave <> 'x' AND (academia_id = app_academia_actual() AND valor IS NOT NULL))",
      politicas: [
        "CREATE POLICY p ON public.ej132_ok5 USING (clave <> 'x' AND (academia_id = app_academia_actual() AND valor IS NOT NULL))",
      ],
    },
    {
      nombre: 'una politica ALL con USING y WITH CHECK correctos, como las de 001',
      politicas: [`CREATE POLICY p ON public.ej132_ok6 USING (${CORRECTA}) WITH CHECK (${CORRECTA})`],
    },
    {
      nombre: 'varias politicas, cada una correcta (FOR SELECT, FOR INSERT, FOR UPDATE, FOR DELETE)',
      politicas: [
        `CREATE POLICY s ON public.ej132_ok7 FOR SELECT USING (${CORRECTA})`,
        `CREATE POLICY i ON public.ej132_ok7 FOR INSERT WITH CHECK (${CORRECTA})`,
        `CREATE POLICY u ON public.ej132_ok7 FOR UPDATE USING (${CORRECTA}) WITH CHECK (${CORRECTA})`,
        `CREATE POLICY d ON public.ej132_ok7 FOR DELETE USING (${CORRECTA})`,
      ],
    },
    // Criterio 140 (ataque ronda 7, O5): la subconsulta escalar que solo selecciona la funcion cuenta como la comparacion.
    {
      nombre: 'criterio 140: USING (academia_id = (SELECT app_academia_actual()))',
      politicas: ['CREATE POLICY p ON public.ej140_ok1 USING (academia_id = (SELECT app_academia_actual()))'],
    },
    {
      nombre: 'criterio 140: USING ((SELECT public.app_academia_actual()) = academia_id)',
      politicas: ['CREATE POLICY p ON public.ej140_ok2 USING ((SELECT public.app_academia_actual()) = academia_id)'],
    },
    {
      nombre: 'criterio 140: WITH CHECK (academia_id = (SELECT app_academia_actual() AS a))',
      politicas: [
        `CREATE POLICY p ON public.ej140_ok3 USING (${CORRECTA}) WITH CHECK (academia_id = (SELECT app_academia_actual() AS a))`,
      ],
    },
    {
      nombre: "criterio 140: USING (academia_id = (SELECT app_academia_actual()) AND clave <> 'x')",
      politicas: [
        "CREATE POLICY p ON public.ej140_ok4 USING (academia_id = (SELECT app_academia_actual()) AND clave <> 'x')",
      ],
    },
    {
      nombre: 'criterio 140: una politica ALL con la subconsulta en USING y en WITH CHECK',
      politicas: [
        'CREATE POLICY p ON public.ej140_ok5 USING (academia_id = (SELECT app_academia_actual())) WITH CHECK (academia_id = (SELECT app_academia_actual()))',
      ],
    },
    {
      nombre: 'criterio 140: varias politicas por comando, cada una con la subconsulta',
      politicas: [
        'CREATE POLICY s ON public.ej140_ok6 FOR SELECT USING (academia_id = (SELECT app_academia_actual()))',
        'CREATE POLICY i ON public.ej140_ok6 FOR INSERT WITH CHECK (academia_id = (SELECT app_academia_actual()))',
        'CREATE POLICY u ON public.ej140_ok6 FOR UPDATE USING (academia_id = (SELECT app_academia_actual())) WITH CHECK (academia_id = (SELECT app_academia_actual()))',
        'CREATE POLICY d ON public.ej140_ok6 FOR DELETE USING (academia_id = (SELECT app_academia_actual()))',
      ],
    },
  ];

  const sufijo = (nombre: string): string => nombre.replace(/^.*ON public\./, '').split(' ')[0] ?? '';
  const tablaDe = (ejemplo: Ejemplo): string => sufijo(ejemplo.politicas[0] ?? '');

  async function incumplimientosDeEjemplos(ejemplos: readonly Ejemplo[]): Promise<Map<string, string[]>> {
    return conTransaccionRevertida('propietario', undefined, async (cliente) => {
      for (const ejemplo of ejemplos) {
        for (const sentencia of tabla(tablaDe(ejemplo))) await cliente.query(sentencia);
        for (const sentencia of ejemplo.politicas) await cliente.query(sentencia);
      }
      return incumplimientos(cliente);
    });
  }

  it.each(DETECTADOS.map((ejemplo) => [ejemplo.nombre, ejemplo] as const))(
    'criterio 132: se detecta %s',
    async (_nombre, ejemplo) => {
      const encontrados = await incumplimientosDeEjemplos([ejemplo]);

      expect([...encontrados.keys()]).toContain(`public.${tablaDe(ejemplo)}`);
    },
  );

  it.each(NO_DETECTADOS.map((ejemplo) => [ejemplo.nombre, ejemplo] as const))(
    'criterio 132: no se detecta %s',
    async (_nombre, ejemplo) => {
      const encontrados = await incumplimientosDeEjemplos([ejemplo]);

      expect([...encontrados.keys()]).not.toContain(`public.${tablaDe(ejemplo)}`);
      expect([...encontrados.values()].flat()).toEqual([]);
    },
  );

  it('criterio 140: pg_get_expr escribe la subconsulta como ( SELECT app_academia_actual() AS app_academia_actual) y la regla la acepta', async () => {
    const leidas = await conTransaccionRevertida('propietario', undefined, async (cliente) => {
      for (const sentencia of tabla('ej140_texto')) await cliente.query(sentencia);
      await cliente.query(
        'CREATE POLICY p ON public.ej140_texto USING (academia_id = (SELECT app_academia_actual())) WITH CHECK ((SELECT app_academia_actual()) = academia_id)',
      );
      return (await leerPoliticas(cliente)).filter((politica) => politica.tabla === 'ej140_texto');
    });

    expect(leidas).toHaveLength(1);
    expect(leidas[0]?.usando).toMatch(/academia_id\s*=\s*\(\s*SELECT\s+app_academia_actual\(\)/i);
    expect(leidas[0]?.comprobando).toMatch(/SELECT\s+app_academia_actual\(\)/i);
    expect(problemasDeLaPolitica(leidas[0] as PoliticaLeida)).toEqual([]);
  });

  it('criterio 132: todos los ejemplos juntos: se detectan los que deben y solo esos', async () => {
    const encontrados = await incumplimientosDeEjemplos([...DETECTADOS, ...NO_DETECTADOS]);

    expect([...encontrados.keys()].sort()).toEqual(DETECTADOS.map((ejemplo) => `public.${tablaDe(ejemplo)}`).sort());
  });

  it('criterio 132: una funcion app_academia_actual de otro esquema aparece calificada y no cumple; la politica de una tabla de otro esquema tambien se revisa', async (contexto: TestContext) => {
    if (!creaEsquemas) contexto.skip('el dueno de la base de pruebas no puede crear esquemas');
    const encontrados = await conTransaccionRevertida('propietario', undefined, async (cliente) => {
      await cliente.query('CREATE SCHEMA reportes_prueba');
      // Una funcion de otro esquema con el mismo nombre. El esquema del operador y de la funcion se leen con `search_path` fijo.
      await cliente.query(
        'CREATE FUNCTION reportes_prueba.app_academia_actual() RETURNS uuid LANGUAGE sql AS $f$ SELECT NULL::uuid $f$',
      );
      for (const sentencia of tabla('ej132_otra_funcion')) await cliente.query(sentencia);
      await cliente.query(
        'CREATE POLICY p ON public.ej132_otra_funcion USING (academia_id = reportes_prueba.app_academia_actual())',
      );
      for (const sentencia of tabla('ej132_en_otro_esquema', 'reportes_prueba')) await cliente.query(sentencia);
      await cliente.query('CREATE POLICY p ON reportes_prueba.ej132_en_otro_esquema USING (academia_id IS NOT NULL)');
      for (const sentencia of tabla('ej132_bien_en_otro_esquema', 'reportes_prueba')) await cliente.query(sentencia);
      await cliente.query(
        'CREATE POLICY p ON reportes_prueba.ej132_bien_en_otro_esquema USING (academia_id = public.app_academia_actual())',
      );
      return incumplimientos(cliente);
    });

    expect([...encontrados.keys()]).toEqual(
      expect.arrayContaining(['public.ej132_otra_funcion', 'reportes_prueba.ej132_en_otro_esquema']),
    );
    expect([...encontrados.keys()]).not.toContain('reportes_prueba.ej132_bien_en_otro_esquema');
  });

  it('criterio 132: lo creado en las autocomprobaciones se revirtio (la lectura sobre la base real no informa nada)', async () => {
    const encontrados = await conTransaccionRevertida('propietario', undefined, incumplimientos);

    expect([...encontrados.values()].flat()).toEqual([]);
  });
});
