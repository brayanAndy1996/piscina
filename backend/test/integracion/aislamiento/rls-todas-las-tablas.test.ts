// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import {
  conClienteComo,
  conTransaccionRevertida,
  ejecutarComo,
  limpiarBase,
  type Contexto,
} from '../../utilidades/base-datos';
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
//
// Criterio 138 (ataque ronda 7, F2; AJUSTA la quinta vineta del criterio 133): el `INSERT` en otra academia se juzga por lo que escribe,
// no por el codigo del error. Un disparador `BEFORE INSERT ... FOR EACH ROW` legitimo (que fuerza `academia_id` al contexto, o que valida
// y lanza un error) hace que el `INSERT` con la `academia_id` de B termine con otro codigo (`23505`, `P0001`) o sin error, aunque la
// tabla no deja escribir en otra academia. El paso del `INSERT` (para cada tabla ordinaria con `academia_id`) queda asi:
//   - fila de prueba: como dueno con el contexto de B, se llama otra vez al sembrador de la tabla para B, se toma una fila de la tabla
//     creada por esa llamada (comparando las filas de B antes y despues), se guarda (como `to_jsonb`) y se borra; asi la fila es valida en
//     B (llaves foraneas hacia filas de B, cumple los `CHECK`) y no choca con ninguna restriccion unica. Si el dueno no puede borrarla
//     (por ejemplo, un disparador que lo impide), se usa la forma anterior del criterio 133 (copia de una fila de A con la `academia_id`
//     de B) y se exige exactamente `42501` (falla cerrada), y se informa;
//   - intento: como app, en contexto de A, un `INSERT` de esa fila con todas sus columnas salvo las generadas y las `GENERATED ALWAYS`;
//     la transaccion del intento termina (se confirma si no hubo error) antes de comprobar;
//   - comprobacion: como dueno con el contexto de B, se lee otra vez la tabla. Pasa si el `INSERT` fallo con `42501` o con cualquier otro
//     error, o si termino sin error, y en los tres casos ninguna fila de B que no estaba antes del intento quedo escrita. Falla solo si
//     quedo escrita una fila de B (el mensaje nombra la tabla). Un error distinto de `42501` se informa con su codigo en el registro.
// Cada sembrador debe crear una fila nueva en cada llamada (precision P-33, ronda 7); si no lo hace, la prueba falla nombrando la tabla.
// La autocomprobacion (con las mismas condiciones: `SET LOCAL ROLE aquagestion_app`, omitida con aviso en la nube) agrega tablas con
// disparadores (pasan: uno que fuerza la academia, otro que ademas pone un `id` nuevo y otro que valida y lanza `P0001`) y tablas que se
// detectan (la de `WITH CHECK (academia_id IS NOT NULL)`, la misma con una restriccion `UNIQUE (academia_id, clave)` y una llave foranea
// compuesta hacia una tabla padre, y una con politica mal hecha y un disparador que no cambia nada).

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

/** Resultado de un intento de escritura como app (criterio 138): sin error, o el codigo del error de PostgreSQL. */
type Intento = { readonly fallo: false } | { readonly fallo: true; readonly codigo: string };

interface Ejecutor {
  /** Consulta como dueno con el contexto indicado (no deja cambios). */
  comoDueno(contexto: Contexto, sql: string, parametros?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Consulta como `aquagestion_app` con el contexto indicado (no deja cambios). Rechaza con el error de `pg` (con su `code`). */
  comoApp(contexto: Contexto, sql: string, parametros?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Escribe como dueno con el contexto indicado y DEJA el cambio (criterio 138). Rechaza con el error de `pg`. Devuelve las filas afectadas. */
  escribirComoDueno(contexto: Contexto, sql: string, parametros?: unknown[]): Promise<number>;
  /**
   * Escribe como app con el contexto indicado; si no hay error, el cambio queda (la transaccion del intento termina antes de comprobar).
   * Un error de PostgreSQL no se propaga: se devuelve su codigo. Un error que no es de PostgreSQL (sin `code`) si se propaga.
   */
  intentarComoApp(contexto: Contexto, sql: string, parametros?: unknown[]): Promise<Intento>;
}

/** Siembra una fila nueva de la tabla para la academia (criterio 138): el sembrador de la tabla o el de una tabla de ejemplo. */
type Sembrar = (academiaId: string) => Promise<void>;

const codigoDe = (error: unknown): string | undefined => (error as { code?: string }).code;

const filasDe = (resultado: pg.QueryResult): Record<string, unknown>[] => resultado.rows as Record<string, unknown>[];

/** Ejecutor sobre la base real: cada consulta en una conexion nueva y una transaccion que se revierte. */
const ejecutorReal: Ejecutor = {
  comoDueno: (contexto, sql, parametros = []) =>
    conTransaccionRevertida('propietario', contexto, async (cliente) => filasDe(await cliente.query(sql, parametros))),
  comoApp: (contexto, sql, parametros = []) =>
    conTransaccionRevertida('app', contexto, async (cliente) => filasDe(await cliente.query(sql, parametros))),
  escribirComoDueno: async (contexto, sql, parametros = []) =>
    (await ejecutarComo('propietario', sql, parametros, contexto)).rowCount ?? 0,
  intentarComoApp: async (contexto, sql, parametros = []) => {
    try {
      await ejecutarComo('app', sql, parametros, contexto);
      return { fallo: false };
    } catch (error) {
      const codigo = codigoDe(error);
      if (codigo === undefined) throw error;
      return { fallo: true, codigo };
    }
  },
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
  /** Escritura que DEJA el cambio en la transaccion (que el llamador revierte): `SAVEPOINT` propio, que se libera. */
  const escribir = async (
    comoApp: boolean,
    contexto: Contexto,
    sql: string,
    parametros: unknown[],
  ): Promise<{ fallo: false; filas: number } | { fallo: true; codigo: string }> => {
    await cliente.query('SAVEPOINT escritura');
    try {
      if (comoApp) await cliente.query(`SET LOCAL ROLE ${APP}`);
      await fijarContexto(cliente, contexto);
      const resultado = await cliente.query(sql, parametros);
      if (comoApp) await cliente.query('RESET ROLE');
      // El contexto no debe quedar fijado para las consultas siguientes de la misma transaccion.
      await cliente.query("SELECT set_config('app.academia_id', '', true), set_config('app.plataforma', '', true)");
      await cliente.query('RELEASE SAVEPOINT escritura');
      return { fallo: false, filas: resultado.rowCount ?? 0 };
    } catch (error) {
      await cliente.query('ROLLBACK TO SAVEPOINT escritura');
      await cliente.query('RELEASE SAVEPOINT escritura');
      const codigo = codigoDe(error);
      if (codigo === undefined) throw error;
      return { fallo: true, codigo };
    }
  };
  return {
    comoDueno: correr(false),
    comoApp: correr(true),
    escribirComoDueno: async (contexto, sql, parametros = []) => {
      const resultado = await escribir(false, contexto, sql, parametros);
      if (resultado.fallo) {
        throw Object.assign(new Error(`la escritura fallo con ${resultado.codigo}`), { code: resultado.codigo });
      }
      return resultado.filas;
    },
    intentarComoApp: async (contexto, sql, parametros = []) => {
      const resultado = await escribir(true, contexto, sql, parametros);
      return resultado.fallo ? { fallo: true, codigo: resultado.codigo } : { fallo: false };
    },
  };
}

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

/**
 * Los problemas de una tabla (vacio: ninguna fuga). Cada texto empieza por `[etiqueta]`. `sembrar` crea una fila NUEVA de la tabla
 * para una academia en cada llamada (criterio 138; P-33, ronda 7).
 */
async function problemasDeLaTabla(
  ejecutor: Ejecutor,
  t: TablaDeAcademia,
  A: string,
  B: string,
  sembrar: Sembrar | undefined,
): Promise<string[]> {
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

  // 3. INSERT en otra academia (criterio 138): se juzga por lo que escribe, no por el codigo del error.
  if (t.tipo === 'r') problemas.push(...(await problemasDelInsert(ejecutor, t, A, B, sembrar)));
  return problemas;
}

/** `to_jsonb` de cada fila de la academia en la tabla, como dueno con el contexto de esa academia. */
async function filasDeAcademia(ejecutor: Ejecutor, t: TablaDeAcademia, academiaId: string): Promise<Set<string>> {
  const filas = await ejecutor.comoDueno(
    { academiaId },
    `SELECT pg_catalog.to_jsonb(t)::text AS fila FROM ${calificada(t)} t WHERE academia_id = $1::uuid`,
    [academiaId],
  );
  return new Set(filas.map((fila) => fila.fila as string));
}

/** Las columnas del `INSERT`: todas salvo las generadas y las `GENERATED ALWAYS`, citadas y separadas por comas. */
async function columnasDelInsert(ejecutor: Ejecutor, t: TablaDeAcademia, A: string): Promise<string> {
  return (
    await ejecutor.comoDueno(
      { academiaId: A },
      `SELECT a.attname::text AS columna FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = (pg_catalog.quote_ident($1) || '.' || pg_catalog.quote_ident($2))::pg_catalog.regclass
          AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity <> 'a'
        ORDER BY a.attnum`,
      [t.esquema, t.tabla],
    )
  )
    .map((fila) => citar(fila.columna as string))
    .join(', ');
}

/**
 * El paso del `INSERT` del criterio 138. Fila de prueba: la que crea una llamada nueva del sembrador para B (valida en B), guardada y
 * borrada como dueno. Intento: como app en contexto de A, el `INSERT` de esa fila (con la `academia_id` de B). Comprobacion: ninguna fila
 * de B que no estaba antes del intento quedo escrita, sea cual sea el error (o ninguno).
 */
async function problemasDelInsert(
  ejecutor: Ejecutor,
  t: TablaDeAcademia,
  A: string,
  B: string,
  sembrar: Sembrar | undefined,
): Promise<string[]> {
  const nombre = nombreDe(t);
  const columnas = await columnasDelInsert(ejecutor, t, A);
  const insertar = `INSERT INTO ${calificada(t)} (${columnas}) SELECT ${columnas} FROM pg_catalog.jsonb_populate_record(NULL::${calificada(t)}, $1::jsonb)`;

  // Fila de prueba: una fila nueva de B, creada por una llamada del sembrador.
  if (sembrar === undefined) {
    return [`[sin-sembrar] ${nombre}: no hay sembrador para crear la fila de prueba del INSERT`];
  }
  const antesDeSembrar = await filasDeAcademia(ejecutor, t, B);
  await sembrar(B);
  const nuevas = [...(await filasDeAcademia(ejecutor, t, B))].filter((fila) => !antesDeSembrar.has(fila));
  if (nuevas[0] === undefined) {
    // P-33 (ronda 7): si una llamada no crea ninguna fila nueva de la tabla, la prueba falla nombrandola (tambien una particion).
    return [
      `[sin-sembrar] ${nombre}: el sembrador no creo una fila nueva de B en esta llamada (cada llamada debe crear una fila nueva)`,
    ];
  }
  const filaDePrueba = nuevas[0];

  // La borra como dueno con el contexto de B. Si no puede, se usa la forma anterior (copia de una fila de A) con 42501 exacto.
  let borrada = false;
  try {
    borrada =
      (await ejecutor.escribirComoDueno(
        { academiaId: B },
        `DELETE FROM ${calificada(t)} t WHERE pg_catalog.to_jsonb(t) = $1::jsonb`,
        [filaDePrueba],
      )) > 0;
  } catch (error) {
    console.warn(
      `[criterio 138] AVISO: el dueno no puede borrar la fila de prueba de ${nombre} (${codigoDe(error) ?? 'error'}); se usa la copia de una fila de A y se exige exactamente 42501.`,
    );
  }

  if (borrada) {
    const antes = await filasDeAcademia(ejecutor, t, B);
    const intento = await ejecutor.intentarComoApp({ academiaId: A }, insertar, [filaDePrueba]);
    if (intento.fallo && intento.codigo !== '42501') {
      console.info(`[criterio 138] ${nombre}: el INSERT con el academia_id de B fallo con ${intento.codigo}`);
    }
    const escritas = [...(await filasDeAcademia(ejecutor, t, B))].filter((fila) => !antes.has(fila));
    return escritas.length > 0
      ? [
          `[insert] ${nombre}: el INSERT de una fila con el academia_id de B en contexto de A ${intento.fallo ? `fallo con ${intento.codigo} pero` : 'se acepto y'} dejo escrita(s) ${escritas.length} fila(s) en B`,
        ]
      : [];
  }

  // Forma anterior (criterio 133): copia de una fila de A con el academia_id de B; debe fallar con exactamente 42501.
  const [copia] = await ejecutor.comoDueno(
    { academiaId: A },
    `SELECT pg_catalog.to_jsonb(t) AS fila FROM ${calificada(t)} t WHERE academia_id = $1::uuid LIMIT 1`,
    [A],
  );
  if (copia === undefined) return [];
  const fila = { ...(copia.fila as Record<string, unknown>), academia_id: B };
  const intento = await ejecutor.intentarComoApp({ academiaId: A }, insertar, [JSON.stringify(fila)]);
  return intento.fallo && intento.codigo === '42501'
    ? []
    : [
        `[insert] ${nombre}: el INSERT de una copia de una fila de A con el academia_id de B en contexto de A ${intento.fallo ? `fallo con ${intento.codigo}` : 'se acepto'} (se esperaba 42501)`,
      ];
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
    for (const t of tablas) {
      problemas.push(...(await problemasDeLaTabla(ejecutorReal, t, A, B, SEMBRADORES_POR_TABLA[t.raiz])));
    }

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

describe('criterio 133 y 138: autocomprobacion, la prueba detecta las tablas trampa (en una transaccion que se revierte, con SET LOCAL ROLE aquagestion_app)', () => {
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

  /** Disparadores de ejemplo (criterio 138): fuerzan la academia, ademas ponen un `id` nuevo, validan y lanzan un error, no hacen nada, o impiden el borrado. */
  const FUNCIONES: readonly string[] = [
    `CREATE FUNCTION public.trampa_fuerza_academia() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN NEW.academia_id := public.app_academia_actual(); RETURN NEW; END $f$`,
    `CREATE FUNCTION public.trampa_fuerza_academia_e_id() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN NEW.academia_id := public.app_academia_actual(); NEW.id := gen_random_uuid(); RETURN NEW; END $f$`,
    `CREATE FUNCTION public.trampa_valida_academia() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN
         IF NEW.academia_id IS DISTINCT FROM public.app_academia_actual() THEN
           RAISE EXCEPTION 'la academia no es la del contexto' USING ERRCODE = 'P0001';
         END IF;
         RETURN NEW;
       END $f$`,
    `CREATE FUNCTION public.trampa_no_hace_nada() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN RETURN NEW; END $f$`,
    `CREATE FUNCTION public.trampa_impide_borrar() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN RAISE EXCEPTION 'no se puede borrar' USING ERRCODE = 'P0001'; END $f$`,
  ];

  interface Trampa {
    /** Sentencias extra despues de crear la tabla: politicas, disparadores. */
    readonly extra: readonly string[];
    /** Columnas y restricciones adicionales de la tabla (despues de `dato text`). */
    readonly columnas?: string;
    /** Sentencias que crean las tablas auxiliares (antes de la tabla). */
    readonly antes?: readonly string[];
    /** Sentencia que siembra UNA fila nueva ($1 = academia). Por defecto, un `INSERT` simple. */
    readonly sembrar?: string;
  }

  const CHECK_NO_NULO = 'WITH CHECK (academia_id IS NOT NULL)';
  const DISPARADOR = (tabla: string, funcion: string, evento = 'INSERT'): string =>
    `CREATE TRIGGER disparador BEFORE ${evento} ON public.${tabla} FOR EACH ROW EXECUTE FUNCTION public.${funcion}()`;

  /** Politicas de cada tabla trampa (despues de ENABLE y FORCE ROW LEVEL SECURITY). */
  const TRAMPAS: Record<string, Trampa> = {
    trampa_plataforma: {
      extra: [
        'CREATE POLICY p ON public.trampa_plataforma USING (academia_id = app_academia_actual() OR app_es_plataforma())',
      ],
    },
    trampa_sin_contexto: {
      extra: [
        `CREATE POLICY p ON public.trampa_sin_contexto USING (${OK}) WITH CHECK (${OK})`,
        'CREATE POLICY extra ON public.trampa_sin_contexto FOR SELECT USING (true)',
      ],
    },
    trampa_insert: {
      extra: [`CREATE POLICY p ON public.trampa_insert USING (${OK}) ${CHECK_NO_NULO}`],
    },
    // Control: una tabla correcta con el mismo formato que las trampas.
    trampa_correcta: { extra: [`CREATE POLICY p ON public.trampa_correcta USING (${OK}) WITH CHECK (${OK})`] },

    // Criterio 138: disparadores legitimos con politica correcta (pasan).
    trampa_disp_fuerza: {
      extra: [
        `CREATE POLICY p ON public.trampa_disp_fuerza USING (${OK}) WITH CHECK (${OK})`,
        DISPARADOR('trampa_disp_fuerza', 'trampa_fuerza_academia'),
      ],
    },
    trampa_disp_fuerza_id: {
      extra: [
        `CREATE POLICY p ON public.trampa_disp_fuerza_id USING (${OK}) WITH CHECK (${OK})`,
        DISPARADOR('trampa_disp_fuerza_id', 'trampa_fuerza_academia_e_id'),
      ],
    },
    trampa_disp_valida: {
      extra: [
        `CREATE POLICY p ON public.trampa_disp_valida USING (${OK}) WITH CHECK (${OK})`,
        DISPARADOR('trampa_disp_valida', 'trampa_valida_academia'),
      ],
    },
    // Criterio 138: el duenio no puede borrar la fila de prueba -> forma anterior, 42501 exacto. Con la politica correcta pasa...
    trampa_sin_borrado: {
      extra: [
        `CREATE POLICY p ON public.trampa_sin_borrado USING (${OK}) WITH CHECK (${OK})`,
        DISPARADOR('trampa_sin_borrado', 'trampa_impide_borrar', 'DELETE'),
      ],
    },
    // ... y con una politica mal hecha se detecta (la copia choca con la llave primaria, 23505, y no es 42501: falla cerrada).
    trampa_sin_borrado_mala: {
      extra: [
        `CREATE POLICY p ON public.trampa_sin_borrado_mala USING (${OK}) ${CHECK_NO_NULO}`,
        DISPARADOR('trampa_sin_borrado_mala', 'trampa_impide_borrar', 'DELETE'),
      ],
    },

    // Criterio 138: politicas mal hechas que el INSERT con B debe detectar (se detectan).
    trampa_unica_fk: {
      antes: [
        `CREATE TABLE public.trampa_padre (
           id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, academia_id uuid NOT NULL, UNIQUE (academia_id, id))`,
      ],
      columnas: `, clave text NOT NULL DEFAULT 'k_' || gen_random_uuid()::text, padre_id uuid NOT NULL,
        UNIQUE (academia_id, clave), FOREIGN KEY (academia_id, padre_id) REFERENCES public.trampa_padre (academia_id, id)`,
      extra: [`CREATE POLICY p ON public.trampa_unica_fk USING (${OK}) ${CHECK_NO_NULO}`],
      sembrar: `WITH padre AS (INSERT INTO public.trampa_padre (academia_id) VALUES ($1::uuid) RETURNING id)
        INSERT INTO public.trampa_unica_fk (academia_id, dato, padre_id) SELECT $1::uuid, 'trampa', id FROM padre`,
    },
    trampa_disp_nada: {
      extra: [
        `CREATE POLICY p ON public.trampa_disp_nada USING (${OK}) ${CHECK_NO_NULO}`,
        DISPARADOR('trampa_disp_nada', 'trampa_no_hace_nada'),
      ],
    },
  };

  /** Crea las tablas trampa indicadas (todas, si no se indica ninguna) en la transaccion del duenio. */
  async function crearTrampas(cliente: pg.ClientBase, nombres: readonly string[]): Promise<void> {
    for (const funcion of FUNCIONES) await cliente.query(funcion);
    for (const nombre of nombres) {
      const trampa = TRAMPAS[nombre];
      if (!trampa) throw new Error(`trampa desconocida: ${nombre}`);
      for (const sentencia of trampa.antes ?? []) await cliente.query(sentencia);
      await cliente.query(
        `CREATE TABLE public.${nombre} (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, academia_id uuid NOT NULL, dato text${trampa.columnas ?? ''})`,
      );
      await cliente.query(`ALTER TABLE public.${nombre} ENABLE ROW LEVEL SECURITY`);
      await cliente.query(`ALTER TABLE public.${nombre} FORCE ROW LEVEL SECURITY`);
      for (const sentencia of trampa.extra) await cliente.query(sentencia);
      await cliente.query(`GRANT SELECT, INSERT ON public.${nombre} TO ${APP}`);
    }
  }

  /** Sembrador que escribe en la transaccion del dueno (sin confirmar): `sql` inserta UNA fila nueva ($1 = academia). */
  function sembradorEnTransaccion(cliente: pg.ClientBase, sql: string): Sembrar {
    return async (academiaId) => {
      await cliente.query("SELECT set_config('app.academia_id', $1, true)", [academiaId]);
      try {
        await cliente.query(sql, [academiaId]);
      } finally {
        await cliente.query("SELECT set_config('app.academia_id', '', true)");
      }
    };
  }

  /** Sembrador de una tabla trampa: UNA fila nueva de la academia, como dueno con su contexto, dentro de la transaccion. */
  function sembradorDeTrampa(cliente: pg.ClientBase, nombre: string): Sembrar {
    return sembradorEnTransaccion(
      cliente,
      TRAMPAS[nombre]?.sembrar ?? `INSERT INTO public.${nombre} (academia_id, dato) VALUES ($1::uuid, 'trampa')`,
    );
  }

  /** Equivalentes en la transaccion de los sembradores reales de 001 (sembradores.ts): una fila nueva por llamada. */
  const SEMBRADO_EN_TRANSACCION: Readonly<Record<string, string>> = {
    'public.auditoria': `INSERT INTO public.auditoria (id, academia_id, fecha_hora, actor_tipo, accion, entidad)
       VALUES (gen_random_uuid(), $1::uuid, now(), 'SISTEMA', 'SEMBRADA_PARA_RLS', 'prueba')`,
    'public.configuraciones': `INSERT INTO public.configuraciones (academia_id, clave, valor, actualizado_en)
       VALUES ($1::uuid, 'sembrada_' || replace(gen_random_uuid()::text, '-', ''), '{}'::jsonb, now())`,
  };

  /** Filas confirmadas de B en las tablas, como texto ordenado (para comprobar que la autocomprobacion no confirmo nada). */
  async function filasConfirmadasDeB(reales: readonly TablaDeAcademia[]): Promise<string[]> {
    const salida: string[] = [];
    for (const t of reales) {
      for (const fila of await filasDeAcademia(ejecutorReal, t, B)) salida.push(`${nombreDe(t)} ${fila}`);
    }
    return salida.sort();
  }

  async function conTrampas<T>(
    nombres: readonly string[],
    trabajo: (cliente: pg.ClientBase, ejecutor: Ejecutor) => Promise<T>,
  ): Promise<T> {
    return conClienteComo('propietario', async (cliente) => {
      await cliente.query('BEGIN');
      try {
        await crearTrampas(cliente, nombres);
        // Una fila de cada academia (con su contexto, por si el dueno no es superusuario).
        for (const nombre of nombres) {
          const sembrar = sembradorDeTrampa(cliente, nombre);
          await sembrar(A);
          await sembrar(B);
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

  /** Los problemas de UNA tabla trampa, con su propio sembrador. */
  const problemasDeLaTrampa = (nombre: string): Promise<string[]> =>
    conTrampas([nombre], (cliente, ejecutor) =>
      problemasDeLaTabla(ejecutor, trampa(nombre), A, B, sembradorDeTrampa(cliente, nombre)),
    );

  function omitirSiNoSePuede(contexto: TestContext): void {
    if (!puedeTomarElRol)
      contexto.skip('el dueno no puede tomar el rol de la app (SET ROLE): corre en Docker y en la CI');
  }

  it('criterio 133: la tabla con "OR app_es_plataforma()" se detecta por el contexto de plataforma', async (contexto) => {
    omitirSiNoSePuede(contexto);
    const problemas = await problemasDeLaTrampa('trampa_plataforma');

    expect(
      problemas.some((texto) => texto.startsWith('[plataforma]')),
      problemas.join('\n'),
    ).toBe(true);
  });

  it('criterio 133: la tabla con una politica permisiva FOR SELECT USING (true) se detecta por la consulta sin contexto', async (contexto) => {
    omitirSiNoSePuede(contexto);
    const problemas = await problemasDeLaTrampa('trampa_sin_contexto');

    expect(
      problemas.some((texto) => texto.startsWith('[sin-contexto]')),
      problemas.join('\n'),
    ).toBe(true);
  });

  it('criterio 133 y 138: la tabla con WITH CHECK (academia_id IS NOT NULL) se detecta por lo que el INSERT con el academia_id de B escribe', async (contexto) => {
    omitirSiNoSePuede(contexto);
    const problemas = await problemasDeLaTrampa('trampa_insert');

    expect(
      problemas.some((texto) => texto.startsWith('[insert]') && texto.includes('trampa_insert')),
      problemas.join('\n'),
    ).toBe(true);
    expect(
      problemas.filter((texto) => !texto.startsWith('[insert]')),
      'solo el INSERT debe delatarla',
    ).toEqual([]);
  });

  it('criterio 133 (control): una tabla trampa correcta no tiene problemas', async (contexto) => {
    omitirSiNoSePuede(contexto);

    expect(await problemasDeLaTrampa('trampa_correcta')).toEqual([]);
  });

  describe('criterio 138: disparadores BEFORE INSERT legitimos no se detectan', () => {
    it.for([
      [
        'un disparador que fuerza academia_id al contexto (el INSERT termina sin error y la fila queda en A)',
        'trampa_disp_fuerza',
      ],
      ['un disparador que fuerza academia_id y ademas pone un id nuevo', 'trampa_disp_fuerza_id'],
      ['un disparador que valida y lanza un error (RAISE EXCEPTION, P0001)', 'trampa_disp_valida'],
    ] as const)('criterio 138: %s no se detecta', async ([, tabla], contexto) => {
      omitirSiNoSePuede(contexto);

      expect(await problemasDeLaTrampa(tabla)).toEqual([]);
    });

    it('criterio 138: si el duenio no puede borrar la fila de prueba (un disparador que lo impide) se usa la copia de A y se exige 42501: con la politica correcta no se detecta', async (contexto) => {
      omitirSiNoSePuede(contexto);

      expect(await problemasDeLaTrampa('trampa_sin_borrado')).toEqual([]);
    });
  });

  describe('criterio 138: las politicas mal hechas se siguen detectando', () => {
    it.for([
      [
        'WITH CHECK (academia_id IS NOT NULL) con una restriccion UNIQUE (academia_id, clave) y una llave foranea compuesta (academia_id, padre_id)',
        'trampa_unica_fk',
      ],
      ['una politica mal hecha y un disparador BEFORE INSERT que no cambia nada', 'trampa_disp_nada'],
      [
        'WITH CHECK (academia_id IS NOT NULL) cuando el duenio no puede borrar la fila de prueba (falla cerrada: el codigo no es 42501)',
        'trampa_sin_borrado_mala',
      ],
    ] as const)('criterio 138: %s se detecta', async ([, tabla], contexto) => {
      omitirSiNoSePuede(contexto);
      const problemas = await problemasDeLaTrampa(tabla);

      expect(
        problemas.some((texto) => texto.startsWith('[insert]') && texto.includes(tabla)),
        problemas.join('\n'),
      ).toBe(true);
      expect(
        problemas.filter((texto) => !texto.startsWith('[insert]')),
        'solo el INSERT debe delatarla',
      ).toEqual([]);
    });

    it('criterio 138: un sembrador que no crea una fila nueva en cada llamada hace fallar la prueba nombrando la tabla', async (contexto) => {
      omitirSiNoSePuede(contexto);
      const problemas = await conTrampas(['trampa_correcta'], (_cliente, ejecutor) =>
        // Un sembrador que no hace nada: la llamada no crea ninguna fila nueva.
        problemasDeLaTabla(ejecutor, trampa('trampa_correcta'), A, B, () => Promise.resolve()),
      );

      expect(
        problemas.some((texto) => texto.includes('trampa_correcta')),
        problemas.join('\n'),
      ).toBe(true);
    });
  });

  it('criterio 133 (control): con las tablas de 001 (auditoria y configuraciones) la comprobacion pasa con el ejecutor de la autocomprobacion', async (contexto) => {
    omitirSiNoSePuede(contexto);
    const reales = tablas.filter((t) => ['public.auditoria', 'public.configuraciones'].includes(nombreDe(t)));
    expect(reales).toHaveLength(2);

    const filasDeBAntes = await filasConfirmadasDeB(reales);

    // Los sembradores reales confirman con `ejecutarComo` (otra conexion): dentro de la autocomprobacion, que se revierte, se usan
    // sembradores equivalentes que escriben en la transaccion del dueno. El paso real sigue usando SEMBRADORES_POR_TABLA.
    const problemas = await conTrampas([], async (cliente, ejecutor) => {
      const salida: string[] = [];
      for (const t of reales) {
        const sembrar = sembradorEnTransaccion(cliente, SEMBRADO_EN_TRANSACCION[nombreDe(t)] ?? '');
        salida.push(...(await problemasDeLaTabla(ejecutor, t, A, B, sembrar)));
      }
      return salida;
    });

    expect(problemas).toEqual([]);
    expect(await filasConfirmadasDeB(reales), 'la autocomprobacion dejo filas de B confirmadas').toEqual(filasDeBAntes);
  });

  it('criterio 133: lo creado en la autocomprobacion se revirtio (las tablas y funciones trampa ya no existen)', async () => {
    const { rows } = await conClienteComo('propietario', (cliente) =>
      cliente.query("SELECT 1 FROM pg_catalog.pg_tables WHERE tablename LIKE 'trampa\\_%'"),
    );
    const funciones = await conClienteComo('propietario', (cliente) =>
      cliente.query("SELECT 1 FROM pg_catalog.pg_proc WHERE proname LIKE 'trampa\\_%'"),
    );

    expect(rows).toEqual([]);
    expect(funciones.rows).toEqual([]);
  });
});
