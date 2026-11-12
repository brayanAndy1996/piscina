// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { conClienteComo, conTransaccionRevertida, limpiarBase, type Contexto } from '../../utilidades/base-datos';
import { conAcademiaId, esquemasRevisados, relacionDeExtension } from '../../utilidades/catalogo';
import { SEMBRADORES_POR_TABLA } from '../../utilidades/sembradores';

// Criterio 133 (ataque ronda 6, F2 (b); generaliza los criterios 13, 17 y 18): ninguna tabla de academia se ve fuera de su academia, en
// ejecucion. Dadas las migraciones aplicadas y, en CADA tabla con `academia_id` que encuentra el catalogo (criterio 131; no una lista
// fija), al menos una fila de A y una de B creadas por la prueba con el sembrador de esa tabla (`SEMBRADORES_POR_TABLA` de
// `backend/test/utilidades/sembradores.ts`, P-33; si una tabla no tiene sembrador, la prueba falla nombrandola, como la lista del
// criterio 10), entonces, como app:
//   - sin contexto, y con `app.academia_id` vacio: `SELECT` devuelve 0 filas;
//   - en contexto de plataforma: 0 filas;
//   - en contexto de plataforma y de A a la vez: solo filas de A;
//   - en contexto de B: ninguna fila de A (todas las que devuelve son de B);
//   - en contexto de A, un `INSERT` de una copia de una fila de A con el `academia_id` de B (sin las columnas generadas ni las
//     `GENERATED ALWAYS`) falla con `42501`;
//   - si la app no tiene `SELECT` sobre la tabla, el `SELECT` puede fallar con `42501` en lugar de devolver 0 filas.
// Antes, como dueno con el contexto de cada academia, la prueba confirma que las filas sembradas existen (no vale pasar en vacio).
// Autocomprobacion con tablas trampa en una transaccion que se revierte, como dueno que toma el rol de la app con
// `SET LOCAL ROLE aquagestion_app` (exige superusuario o ser miembro del rol: Docker y CI; en la nube se omite con aviso), cada una con
// `academia_id`, RLS forzada y `SELECT` e `INSERT` para la app: una con la politica `academia_id = app_academia_actual() OR
// app_es_plataforma()` (la detecta el contexto de plataforma), otra con una politica correcta mas una permisiva `FOR SELECT USING
// (true)` (la detecta la consulta sin contexto) y otra con `USING` correcto y `WITH CHECK (academia_id IS NOT NULL)` (la detecta el
// `INSERT` con B). Con las tablas de 001 (`auditoria` y `configuraciones`) la prueba pasa.
//
// Este archivo es una guarda para las historias siguientes: con las migraciones actuales pasa desde el principio (la autocomprobacion,
// donde el dueno puede tomar el rol de la app). Para una partición, sirve el sembrador de su tabla padre; el `INSERT` con B se prueba en
// las tablas ordinarias y en las particiones (no en la tabla particionada, cuyo enrutamiento puede fallar antes que la politica).

const APP = 'aquagestion_app';
const citar = (identificador: string): string => `"${identificador.replaceAll('"', '""')}"`;

interface TablaDeAcademia {
  readonly esquema: string;
  readonly tabla: string;
  /** `r` ordinaria o `p` particionada. */
  readonly tipo: string;
  /** Tabla raiz de la jerarquia de particiones (la misma tabla si no es particion): clave del sembrador. */
  readonly raiz: string;
}

const nombreDe = (t: TablaDeAcademia): string => `${t.esquema}.${t.tabla}`;
const calificada = (t: TablaDeAcademia): string => `${citar(t.esquema)}.${citar(t.tabla)}`;

/** Las tablas con `academia_id` de los esquemas revisados (criterio 131), con la raiz de sus particiones. */
async function descubrirTablas(): Promise<TablaDeAcademia[]> {
  return conClienteComo('propietario', async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT n.nspname AS esquema, c.relname AS tabla, c.relkind::text AS tipo,
              (WITH RECURSIVE ascendientes(oid) AS (
                 SELECT c.oid
                 UNION ALL
                 SELECT i.inhparent FROM pg_catalog.pg_inherits i JOIN ascendientes a ON i.inhrelid = a.oid)
               SELECT rn.nspname || '.' || rc.relname
                 FROM ascendientes a JOIN pg_catalog.pg_class rc ON rc.oid = a.oid
                 JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
                WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits j WHERE j.inhrelid = a.oid)
                LIMIT 1) AS raiz
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE ${esquemasRevisados('n')} AND c.relkind IN ('r', 'p') AND NOT (${relacionDeExtension('c')})
          AND ${conAcademiaId('c')}
        ORDER BY 1, 2`,
    );
    return rows as TablaDeAcademia[];
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// La comprobacion de una tabla, con un ejecutor (la base real o la autocomprobacion)
// ---------------------------------------------------------------------------------------------------------------------------

interface Ejecutor {
  /** Consulta como dueno con el contexto indicado. */
  comoDueno(contexto: Contexto, sql: string, parametros?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Consulta como `aquagestion_app` con el contexto indicado. Rechaza con el error de `pg` (con su `code`). */
  comoApp(contexto: Contexto, sql: string, parametros?: unknown[]): Promise<Record<string, unknown>[]>;
}

const filasDe = (resultado: pg.QueryResult): Record<string, unknown>[] => resultado.rows as Record<string, unknown>[];

/** Ejecutor sobre la base real: cada consulta en una conexion nueva y una transaccion que se revierte. */
const ejecutorReal: Ejecutor = {
  comoDueno: (contexto, sql, parametros = []) =>
    conTransaccionRevertida('propietario', contexto, async (cliente) => filasDe(await cliente.query(sql, parametros))),
  comoApp: (contexto, sql, parametros = []) =>
    conTransaccionRevertida('app', contexto, async (cliente) => filasDe(await cliente.query(sql, parametros))),
};

async function fijarContexto(cliente: pg.ClientBase, contexto: Contexto): Promise<void> {
  if (contexto.academiaId !== undefined) {
    await cliente.query("SELECT set_config('app.academia_id', $1, true)", [contexto.academiaId]);
  }
  if (contexto.plataforma !== undefined && contexto.plataforma !== false) {
    await cliente.query("SELECT set_config('app.plataforma', $1, true)", [
      contexto.plataforma === true ? 'si' : contexto.plataforma,
    ]);
  }
}

/**
 * Ejecutor de la autocomprobacion: corre dentro de UNA transaccion del dueno (que el llamador revierte). Cada consulta va en un
 * `SAVEPOINT`; como app, con `SET LOCAL ROLE aquagestion_app`; `ROLLBACK TO SAVEPOINT` deshace el rol y el contexto.
 */
function ejecutorEnTransaccion(cliente: pg.ClientBase): Ejecutor {
  const correr =
    (comoApp: boolean): Ejecutor['comoApp'] =>
    async (contexto, sql, parametros = []) => {
      await cliente.query('SAVEPOINT autocomprobacion');
      try {
        if (comoApp) await cliente.query(`SET LOCAL ROLE ${APP}`);
        await fijarContexto(cliente, contexto);
        return filasDe(await cliente.query(sql, parametros));
      } finally {
        await cliente.query('ROLLBACK TO SAVEPOINT autocomprobacion');
      }
    };
  return { comoDueno: correr(false), comoApp: correr(true) };
}

const codigoDe = (error: unknown): string | undefined => (error as { code?: string }).code;

/** Rows de academia_id de la tabla como app, o `'42501'` si la app no puede leerla. Otro error se propaga. */
async function leerAcademiasComoApp(
  ejecutor: Ejecutor,
  t: TablaDeAcademia,
  contexto: Contexto,
): Promise<string[] | '42501'> {
  try {
    const filas = await ejecutor.comoApp(contexto, `SELECT academia_id::text AS academia FROM ${calificada(t)}`);
    return filas.map((fila) => fila.academia as string);
  } catch (error) {
    if (codigoDe(error) === '42501') return '42501';
    throw error;
  }
}

/** Los problemas de una tabla (vacio: ninguna fuga). Cada texto empieza por `[etiqueta]`. */
async function problemasDeLaTabla(ejecutor: Ejecutor, t: TablaDeAcademia, A: string, B: string): Promise<string[]> {
  const problemas: string[] = [];
  const nombre = nombreDe(t);

  // 1. Las filas sembradas existen (no vale pasar en vacio).
  for (const [etiqueta, id] of [
    ['A', A],
    ['B', B],
  ] as const) {
    const filas = await ejecutor.comoDueno(
      { academiaId: id },
      `SELECT count(*)::int AS n FROM ${calificada(t)} WHERE academia_id = $1::uuid`,
      [id],
    );
    if (((filas[0]?.n as number | undefined) ?? 0) < 1)
      problemas.push(`[sin-sembrar] ${nombre}: no hay fila de ${etiqueta}`);
  }

  // 2. SELECT como app.
  const contextos: { etiqueta: string; contexto: Contexto; regla: 'vacio' | 'solo-A' | 'sin-A' }[] = [
    { etiqueta: 'sin-contexto', contexto: {}, regla: 'vacio' },
    { etiqueta: 'contexto-vacio', contexto: { academiaId: '' }, regla: 'vacio' },
    { etiqueta: 'plataforma', contexto: { plataforma: true }, regla: 'vacio' },
    { etiqueta: 'plataforma-y-A', contexto: { plataforma: true, academiaId: A }, regla: 'solo-A' },
    { etiqueta: 'contexto-B', contexto: { academiaId: B }, regla: 'sin-A' },
  ];
  for (const { etiqueta, contexto, regla } of contextos) {
    const leidas = await leerAcademiasComoApp(ejecutor, t, contexto);
    if (leidas === '42501') continue; // sin SELECT: puede fallar con 42501 en lugar de devolver 0 filas
    const ajenas =
      regla === 'vacio'
        ? leidas
        : regla === 'solo-A'
          ? leidas.filter((id) => id !== A)
          : leidas.filter((id) => id === A);
    if (ajenas.length > 0) {
      problemas.push(
        `[${etiqueta}] ${nombre}: devuelve ${leidas.length} fila(s), ${ajenas.length} que no debia(n) ver`,
      );
    }
  }

  // 3. INSERT de una copia de una fila de A con el academia_id de B, en contexto de A: debe fallar con 42501.
  if (t.tipo === 'r') {
    const [copia] = await ejecutor.comoDueno(
      { academiaId: A },
      `SELECT pg_catalog.to_jsonb(t) AS fila FROM ${calificada(t)} t WHERE academia_id = $1::uuid LIMIT 1`,
      [A],
    );
    if (copia !== undefined) {
      const columnas = (
        await ejecutor.comoDueno(
          { academiaId: A },
          `SELECT a.attname::text AS columna FROM pg_catalog.pg_attribute a
            WHERE a.attrelid = (pg_catalog.quote_ident($1) || '.' || pg_catalog.quote_ident($2))::pg_catalog.regclass
              AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity <> 'a'
            ORDER BY a.attnum`,
          [t.esquema, t.tabla],
        )
      ).map((fila) => citar(fila.columna as string));
      const fila = { ...(copia.fila as Record<string, unknown>), academia_id: B };
      const lista = columnas.join(', ');
      let codigo: string | undefined;
      try {
        await ejecutor.comoApp(
          { academiaId: A },
          `INSERT INTO ${calificada(t)} (${lista}) SELECT ${lista} FROM pg_catalog.jsonb_populate_record(NULL::${calificada(t)}, $1::jsonb)`,
          [JSON.stringify(fila)],
        );
      } catch (error) {
        codigo = codigoDe(error);
      }
      if (codigo !== '42501') {
        problemas.push(
          `[insert] ${nombre}: el INSERT de una fila con el academia_id de B en contexto de A ${codigo === undefined ? 'se acepto' : `fallo con ${codigo}`} (se esperaba 42501)`,
        );
      }
    }
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Datos: dos academias y una fila de cada una en cada tabla, con el sembrador de la tabla
// ---------------------------------------------------------------------------------------------------------------------------

let A = '';
let B = '';
let tablas: TablaDeAcademia[] = [];

beforeAll(async () => {
  await limpiarBase();
  A = (await crearAcademiaDePrueba({ nombreCorto: 'academia-a', nombre: 'Academia A' })).id;
  B = (await crearAcademiaDePrueba({ nombreCorto: 'academia-b', nombre: 'Academia B' })).id;
  tablas = await descubrirTablas();
  // Cada tabla (y la raiz de cada jerarquia de particiones) se siembra una vez por academia, si tiene sembrador.
  const sembradas = new Set<string>();
  for (const t of tablas) {
    const sembrador = SEMBRADORES_POR_TABLA[t.raiz];
    if (!sembrador || sembradas.has(t.raiz)) continue;
    sembradas.add(t.raiz);
    await sembrador(A);
    await sembrador(B);
  }
});
afterAll(async () => {
  await limpiarBase();
});

describe('criterio 133: toda tabla con academia_id se ve solo dentro de su academia, en ejecucion', () => {
  it('criterio 133: el catalogo encuentra las tablas de 001 con academia_id (no se prueba en vacio)', () => {
    expect(tablas.map(nombreDe)).toEqual(expect.arrayContaining(['public.auditoria', 'public.configuraciones']));
  });

  it('criterio 133: toda tabla con academia_id que encuentra el catalogo tiene un sembrador en SEMBRADORES_POR_TABLA (si no, falla nombrandola)', () => {
    const sinSembrador = [...new Set(tablas.map((t) => t.raiz))].filter((raiz) => !SEMBRADORES_POR_TABLA[raiz]);

    expect(
      sinSembrador,
      'tablas con academia_id sin sembrador: agregalo a SEMBRADORES_POR_TABLA (backend/test/utilidades/sembradores.ts)',
    ).toEqual([]);
  });

  it('criterio 133: en cada tabla con academia_id, sin contexto, en plataforma, en plataforma y A, y en contexto de B, la app solo ve lo suyo; y no puede insertar con el academia_id de otra', async () => {
    const problemas: string[] = [];
    for (const t of tablas) problemas.push(...(await problemasDeLaTabla(ejecutorReal, t, A, B)));

    expect(problemas).toEqual([]);
  });

  it('criterio 133: las filas sembradas existen en auditoria y configuraciones (dueño con el contexto de cada academia)', async () => {
    for (const nombre of ['public.auditoria', 'public.configuraciones']) {
      const t = tablas.find((tabla) => nombreDe(tabla) === nombre);
      expect(t, nombre).toBeDefined();
      if (!t) continue;
      for (const id of [A, B]) {
        const filas = await ejecutorReal.comoDueno(
          { academiaId: id },
          `SELECT count(*)::int AS n FROM ${calificada(t)} WHERE academia_id = $1::uuid`,
          [id],
        );
        expect(filas[0]?.n as number, `${nombre} de ${id}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('criterio 133: autocomprobacion, la prueba detecta las tablas trampa (en una transaccion que se revierte, con SET LOCAL ROLE aquagestion_app)', () => {
  let puedeTomarElRol = false;

  beforeAll(async () => {
    puedeTomarElRol = await conTransaccionRevertida('propietario', undefined, async (cliente) => {
      await cliente.query('SAVEPOINT sonda');
      try {
        await cliente.query(`SET LOCAL ROLE ${APP}`);
        return true;
      } catch (error) {
        if (codigoDe(error) === '42501') return false;
        throw error;
      } finally {
        await cliente.query('ROLLBACK TO SAVEPOINT sonda').catch(() => undefined);
      }
    });
    if (!puedeTomarElRol) {
      console.warn(
        '[criterio 133] AVISO: el dueno de la base de pruebas no puede tomar el rol aquagestion_app (SET ROLE exige superusuario o ser miembro del rol; nube); la autocomprobacion se omite. Corre en Docker y en la CI.',
      );
    }
  });

  const OK = 'academia_id = app_academia_actual()';

  /** Politicas de cada tabla trampa (despues de ENABLE y FORCE ROW LEVEL SECURITY). */
  const TRAMPAS: Record<string, readonly string[]> = {
    trampa_plataforma: [
      'CREATE POLICY p ON public.trampa_plataforma USING (academia_id = app_academia_actual() OR app_es_plataforma())',
    ],
    trampa_sin_contexto: [
      `CREATE POLICY p ON public.trampa_sin_contexto USING (${OK}) WITH CHECK (${OK})`,
      'CREATE POLICY extra ON public.trampa_sin_contexto FOR SELECT USING (true)',
    ],
    trampa_insert: [`CREATE POLICY p ON public.trampa_insert USING (${OK}) WITH CHECK (academia_id IS NOT NULL)`],
    // Control: una tabla correcta con el mismo formato que las trampas.
    trampa_correcta: [`CREATE POLICY p ON public.trampa_correcta USING (${OK}) WITH CHECK (${OK})`],
  };

  async function conTrampas<T>(trabajo: (cliente: pg.ClientBase, ejecutor: Ejecutor) => Promise<T>): Promise<T> {
    return conClienteComo('propietario', async (cliente) => {
      await cliente.query('BEGIN');
      try {
        for (const [tabla, politicas] of Object.entries(TRAMPAS)) {
          await cliente.query(
            `CREATE TABLE public.${tabla} (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, academia_id uuid NOT NULL, dato text)`,
          );
          await cliente.query(`ALTER TABLE public.${tabla} ENABLE ROW LEVEL SECURITY`);
          await cliente.query(`ALTER TABLE public.${tabla} FORCE ROW LEVEL SECURITY`);
          for (const politica of politicas) await cliente.query(politica);
          await cliente.query(`GRANT SELECT, INSERT ON public.${tabla} TO ${APP}`);
          // Una fila de cada academia (con su contexto, por si el dueno no es superusuario).
          for (const id of [A, B]) {
            await cliente.query("SELECT set_config('app.academia_id', $1, true)", [id]);
            await cliente.query(`INSERT INTO public.${tabla} (academia_id, dato) VALUES ($1::uuid, 'trampa')`, [id]);
          }
          await cliente.query("SELECT set_config('app.academia_id', '', true)");
        }
        return await trabajo(cliente, ejecutorEnTransaccion(cliente));
      } finally {
        await cliente.query('ROLLBACK').catch(() => undefined);
      }
    });
  }

  const trampa = (nombre: string): TablaDeAcademia => ({
    esquema: 'public',
    tabla: nombre,
    tipo: 'r',
    raiz: `public.${nombre}`,
  });

  function omitirSiNoSePuede(contexto: TestContext): void {
    if (!puedeTomarElRol)
      contexto.skip('el dueno no puede tomar el rol de la app (SET ROLE): corre en Docker y en la CI');
  }

  it('criterio 133: la tabla con "OR app_es_plataforma()" se detecta por el contexto de plataforma', async (contexto) => {
    omitirSiNoSePuede(contexto);
    const problemas = await conTrampas((_cliente, ejecutor) =>
      problemasDeLaTabla(ejecutor, trampa('trampa_plataforma'), A, B),
    );

    expect(
      problemas.some((texto) => texto.startsWith('[plataforma]')),
      problemas.join('\n'),
    ).toBe(true);
  });

  it('criterio 133: la tabla con una politica permisiva FOR SELECT USING (true) se detecta por la consulta sin contexto', async (contexto) => {
    omitirSiNoSePuede(contexto);
    const problemas = await conTrampas((_cliente, ejecutor) =>
      problemasDeLaTabla(ejecutor, trampa('trampa_sin_contexto'), A, B),
    );

    expect(
      problemas.some((texto) => texto.startsWith('[sin-contexto]')),
      problemas.join('\n'),
    ).toBe(true);
  });

  it('criterio 133: la tabla con WITH CHECK (academia_id IS NOT NULL) se detecta por el INSERT con el academia_id de B', async (contexto) => {
    omitirSiNoSePuede(contexto);
    const problemas = await conTrampas((_cliente, ejecutor) =>
      problemasDeLaTabla(ejecutor, trampa('trampa_insert'), A, B),
    );

    expect(
      problemas.some((texto) => texto.startsWith('[insert]')),
      problemas.join('\n'),
    ).toBe(true);
    expect(
      problemas.filter((texto) => !texto.startsWith('[insert]')),
      'solo el INSERT debe delatarla',
    ).toEqual([]);
  });

  it('criterio 133 (control): una tabla trampa correcta no tiene problemas', async (contexto) => {
    omitirSiNoSePuede(contexto);
    const problemas = await conTrampas((_cliente, ejecutor) =>
      problemasDeLaTabla(ejecutor, trampa('trampa_correcta'), A, B),
    );

    expect(problemas).toEqual([]);
  });

  it('criterio 133 (control): con las tablas de 001 (auditoria y configuraciones) la comprobacion pasa con el ejecutor de la autocomprobacion', async (contexto) => {
    omitirSiNoSePuede(contexto);
    const reales = tablas.filter((t) => ['public.auditoria', 'public.configuraciones'].includes(nombreDe(t)));
    expect(reales).toHaveLength(2);

    const problemas = await conTrampas(async (_cliente, ejecutor) => {
      const salida: string[] = [];
      for (const t of reales) salida.push(...(await problemasDeLaTabla(ejecutor, t, A, B)));
      return salida;
    });

    expect(problemas).toEqual([]);
  });

  it('criterio 133: lo creado en la autocomprobacion se revirtio (las tablas trampa ya no existen)', async () => {
    const { rows } = await conClienteComo('propietario', (cliente) =>
      cliente.query("SELECT 1 FROM pg_catalog.pg_tables WHERE tablename LIKE 'trampa\\_%'"),
    );

    expect(rows).toEqual([]);
  });
});
