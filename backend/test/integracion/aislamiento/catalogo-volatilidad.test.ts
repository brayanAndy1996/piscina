// spec: 001-academias-aislamiento (pruebas protegidas)
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { conClienteComo, conTransaccionRevertida } from '../../utilidades/base-datos';
import { esquemasRevisados, funcionDeExtension } from '../../utilidades/catalogo';
import { cargarFuncionalidad } from '../../utilidades/ronda3';

// Criterio 144 (ataque ronda 9, F1; complementa los criterios 11, 12, 124 y 132; decision del orquestador), prueba de catalogo: PostgreSQL
// calcula una funcion `IMMUTABLE` al planificar y deja su valor como constante en el plan, y los planes genericos que se guardan por sesion (los
// de plpgsql y las sentencias preparadas) se reusan en la misma conexion del pool con otra academia. Por eso, sobre las migraciones aplicadas en la
// base de pruebas, esta prueba falla, con un mensaje que nombra la funcion (esquema, nombre y argumentos) y su volatilidad, si:
//   1. `public.app_academia_actual()` o `public.app_es_plataforma()` no tienen `pg_proc.provolatile = 's'` (STABLE; ni IMMUTABLE ni VOLATILE, que
//      impediria usar los indices que empiezan por `academia_id`);
//   2. alguna funcion de la que depende una politica (`pg_depend` con `classid = pg_policy` y `refclassid = pg_proc`), de cualquier esquema salvo
//      `pg_catalog`, tiene `provolatile = 'i'`;
//   3. alguna funcion de `FUNCIONES_APP` (P-31) tiene `provolatile = 'i'` (hoy `resolver_academia` es VOLATILE y asi sigue);
//   4. alguna funcion de los esquemas revisados (criterio 141) que no sea objeto de extension y cuyo `prosrc` contenga, sin distinguir mayusculas,
//      `current_setting`, `app_academia_actual` o `app_es_plataforma`, tiene `provolatile = 'i'` (cubre una funcion auxiliar llamada dentro del
//      cuerpo de otra, que `pg_depend` no registra);
//   5. el cuerpo de las dos funciones no es el esperado: lenguaje `sql`, `prosecdef` falso, `proconfig` nulo, retorno `uuid` y `boolean`, sin
//      argumentos, y `prosrc` (cada tramo de espacios en blanco reducido a un espacio y sin espacios al principio ni al final) exactamente el texto
//      de la migracion `20261111150000_academias_aislamiento`. Una historia que necesite cambiarlas lo hace con una migracion nueva y ajusta esta
//      prueba protegida en su commit de pruebas protegidas.
// Con las migraciones actuales pasa. Autocomprobacion, como duenio, en una transaccion que se revierte (cada caso en su SAVEPOINT):
//   - `ALTER FUNCTION public.app_academia_actual() IMMUTABLE` aparece por la 1 y la 2; `ALTER FUNCTION public.app_es_plataforma() VOLATILE`, por la 1;
//   - `public.prueba_r9_auxiliar()` (sql, IMMUTABLE, con `current_setting`) sin politicas que la usen, por la 4;
//   - una politica de ejemplo sobre una tabla de ejemplo con RLS que usa una funcion IMMUTABLE sin `current_setting` en el cuerpo, por la 2;
//   - `CREATE OR REPLACE FUNCTION public.app_es_plataforma() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$`, por la 5.
// Ademas (mismo criterio, no listados en la especificacion): `ALTER FUNCTION public.resolver_academia(text) IMMUTABLE` por la 3, y por la 5 un
// cuerpo `SECURITY DEFINER`, con `SET search_path` propio o en otro lenguaje; y un cuerpo con el mismo texto y otros espacios NO aparece (control).

const ESQUEMA = 'public';
const VOLATILIDAD: Record<string, string> = { i: 'IMMUTABLE', s: 'STABLE', v: 'VOLATILE' };

/** Texto de las dos funciones de contexto en la migracion `20261111150000_academias_aislamiento`, con los espacios ya normalizados. */
const CUERPO_ESPERADO: Record<string, { retorno: string; texto: string }> = {
  app_academia_actual: {
    retorno: 'uuid',
    texto: "SELECT CAST(NULLIF(pg_catalog.current_setting('app.academia_id', true), '') AS pg_catalog.uuid)",
  },
  app_es_plataforma: {
    retorno: 'boolean',
    texto: "SELECT COALESCE(pg_catalog.current_setting('app.plataforma', true), '') = 'si'",
  },
};

interface FuncionApp {
  readonly esquema: 'public';
  readonly nombre: string;
  readonly argumentos: string;
}

const cargarFuncionesApp = async (): Promise<readonly FuncionApp[]> =>
  (
    await cargarFuncionalidad<{ FUNCIONES_APP: readonly FuncionApp[] }>('infraestructura/prisma/privilegios-app.ts', [
      'FUNCIONES_APP',
    ])
  ).FUNCIONES_APP;

type Regla = 1 | 2 | 3 | 4 | 5;

interface Hallazgo {
  /** Cual de las cinco condiciones del criterio 144 se cumple. */
  readonly regla: Regla;
  /** `esquema.nombre(argumentos)`. */
  readonly funcion: string;
  readonly mensaje: string;
}

interface FilaFuncion {
  esquema: string;
  nombre: string;
  argumentos: string;
  volatilidad: string;
}

const nombreCompleto = (fila: Pick<FilaFuncion, 'esquema' | 'nombre' | 'argumentos'>): string =>
  `${fila.esquema}.${fila.nombre}(${fila.argumentos})`;

async function filas<T>(cliente: pg.ClientBase, sql: string, parametros: unknown[] = []): Promise<T[]> {
  return (await cliente.query(sql, parametros)).rows as T[];
}

/** Todo lo que el criterio 144 prohibe, sobre la base a la que apunta `cliente`; cada hallazgo nombra la funcion y su volatilidad. */
async function hallazgosDeVolatilidad(
  cliente: pg.ClientBase,
  funcionesApp: readonly FuncionApp[],
): Promise<Hallazgo[]> {
  const hallazgos: Hallazgo[] = [];
  const agregar = (regla: Regla, fila: FilaFuncion, motivo: string): void => {
    const funcion = nombreCompleto(fila);
    hallazgos.push({
      regla,
      funcion,
      mensaje: `${funcion} es ${VOLATILIDAD[fila.volatilidad] ?? fila.volatilidad}: ${motivo}`,
    });
  };

  // Regla 1: las dos funciones de contexto son STABLE.
  const contexto = await filas<FilaFuncion>(
    cliente,
    `SELECT n.nspname::text AS esquema, p.proname::text AS nombre,
            pg_catalog.pg_get_function_identity_arguments(p.oid) AS argumentos, p.provolatile::text AS volatilidad
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND p.proname = ANY ($2::text[]) AND p.pronargs = 0`,
    [ESQUEMA, Object.keys(CUERPO_ESPERADO)],
  );
  for (const nombre of Object.keys(CUERPO_ESPERADO)) {
    if (!contexto.some((fila) => fila.nombre === nombre)) {
      hallazgos.push({
        regla: 1,
        funcion: `${ESQUEMA}.${nombre}()`,
        mensaje: `${ESQUEMA}.${nombre}() no existe (debe ser STABLE)`,
      });
    }
  }
  for (const fila of contexto.filter((f) => f.volatilidad !== 's')) {
    agregar(1, fila, 'debe ser STABLE (ni IMMUTABLE ni VOLATILE)');
  }

  // Regla 2: funciones de las que depende una politica y que son IMMUTABLE (cualquier esquema salvo pg_catalog).
  const deLasPoliticas = await filas<FilaFuncion>(
    cliente,
    `SELECT DISTINCT n.nspname::text AS esquema, p.proname::text AS nombre,
            pg_catalog.pg_get_function_identity_arguments(p.oid) AS argumentos, p.provolatile::text AS volatilidad
       FROM pg_catalog.pg_depend d
       JOIN pg_catalog.pg_proc p ON p.oid = d.refobjid
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE d.classid = 'pg_catalog.pg_policy'::pg_catalog.regclass
        AND d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        AND n.nspname <> 'pg_catalog' AND p.provolatile = 'i'`,
  );
  for (const fila of deLasPoliticas) agregar(2, fila, 'es IMMUTABLE y de ella depende una politica');

  // Regla 3: funciones de FUNCIONES_APP (P-31) que son IMMUTABLE.
  const deLaApp = await filas<FilaFuncion>(
    cliente,
    `SELECT n.nspname::text AS esquema, p.proname::text AS nombre,
            pg_catalog.pg_get_function_identity_arguments(p.oid) AS argumentos, p.provolatile::text AS volatilidad
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND p.proname = ANY ($2::text[]) AND p.provolatile = 'i'`,
    [ESQUEMA, funcionesApp.map((f) => f.nombre)],
  );
  const permitidas = new Set(funcionesApp.map((f) => `${f.esquema}.${f.nombre}(${f.argumentos})`));
  for (const fila of deLaApp.filter((f) => permitidas.has(nombreCompleto(f)))) {
    agregar(3, fila, 'es una funcion de FUNCIONES_APP y no puede ser IMMUTABLE');
  }

  // Regla 4: funciones propias que leen el contexto (por su cuerpo) y son IMMUTABLE.
  const quePidenContexto = await filas<FilaFuncion>(
    cliente,
    `SELECT n.nspname::text AS esquema, p.proname::text AS nombre,
            pg_catalog.pg_get_function_identity_arguments(p.oid) AS argumentos, p.provolatile::text AS volatilidad
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE ${esquemasRevisados('n')} AND NOT (${funcionDeExtension('p')})
        AND p.provolatile = 'i'
        AND p.prosrc ~* '(current_setting|app_academia_actual|app_es_plataforma)'`,
  );
  for (const fila of quePidenContexto) agregar(4, fila, 'su cuerpo lee el contexto de la academia y es IMMUTABLE');

  // Regla 5: el cuerpo de las dos funciones de contexto.
  const cuerpos = await filas<{
    nombre: string;
    volatilidad: string;
    argumentos: string;
    lenguaje: string;
    seguridad_definer: boolean;
    configuracion: string[] | null;
    retorno: string;
    fuente: string;
  }>(
    cliente,
    `SELECT p.proname::text AS nombre, p.provolatile::text AS volatilidad,
            pg_catalog.pg_get_function_identity_arguments(p.oid) AS argumentos, l.lanname::text AS lenguaje,
            p.prosecdef AS seguridad_definer, p.proconfig AS configuracion, p.prorettype::pg_catalog.regtype::text AS retorno,
            p.prosrc AS fuente
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE n.nspname = $1 AND p.proname = ANY ($2::text[]) AND p.pronargs = 0`,
    [ESQUEMA, Object.keys(CUERPO_ESPERADO)],
  );
  for (const fila of cuerpos) {
    const esperado = CUERPO_ESPERADO[fila.nombre];
    if (!esperado) continue;
    const problemas: string[] = [];
    if (fila.lenguaje !== 'sql') problemas.push(`lenguaje ${fila.lenguaje} en lugar de sql`);
    if (fila.seguridad_definer) problemas.push('es SECURITY DEFINER');
    if (fila.configuracion !== null) problemas.push(`tiene valores propios (${fila.configuracion.join(', ')})`);
    if (fila.retorno !== esperado.retorno) problemas.push(`retorna ${fila.retorno} en lugar de ${esperado.retorno}`);
    if (fila.fuente.replace(/\s+/g, ' ').trim() !== esperado.texto)
      problemas.push('su cuerpo no es el de la migracion');
    if (problemas.length > 0) {
      agregar(
        5,
        { esquema: ESQUEMA, nombre: fila.nombre, argumentos: fila.argumentos, volatilidad: fila.volatilidad },
        problemas.join('; '),
      );
    }
  }
  return hallazgos;
}

/** Funciones de los esquemas revisados que mencionan el contexto, de cualquier volatilidad: para comprobar que la regla 4 no mira en vacio. */
async function funcionesQueMencionanElContexto(cliente: pg.ClientBase): Promise<string[]> {
  return (
    await filas<FilaFuncion>(
      cliente,
      `SELECT n.nspname::text AS esquema, p.proname::text AS nombre,
              pg_catalog.pg_get_function_identity_arguments(p.oid) AS argumentos, p.provolatile::text AS volatilidad
         FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE ${esquemasRevisados('n')} AND NOT (${funcionDeExtension('p')})
          AND p.prosrc ~* '(current_setting|app_academia_actual|app_es_plataforma)'`,
    )
  )
    .map(nombreCompleto)
    .sort();
}

/** Las funciones (de cualquier volatilidad) de las que depende alguna politica, fuera de pg_catalog: para comprobar que la regla 2 no mira en vacio. */
async function funcionesDeLasPoliticas(cliente: pg.ClientBase): Promise<string[]> {
  return (
    await filas<FilaFuncion>(
      cliente,
      `SELECT DISTINCT n.nspname::text AS esquema, p.proname::text AS nombre,
              pg_catalog.pg_get_function_identity_arguments(p.oid) AS argumentos, p.provolatile::text AS volatilidad
         FROM pg_catalog.pg_depend d
         JOIN pg_catalog.pg_proc p ON p.oid = d.refobjid
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE d.classid = 'pg_catalog.pg_policy'::pg_catalog.regclass
          AND d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND n.nspname <> 'pg_catalog'`,
    )
  )
    .map(nombreCompleto)
    .sort();
}

const textoDe = (hallazgos: readonly Hallazgo[]): string => hallazgos.map((h) => h.mensaje).join('\n');
const reglasDe = (hallazgos: readonly Hallazgo[], funcion: string): Regla[] =>
  hallazgos.filter((h) => h.funcion === funcion).map((h) => h.regla);

describe('criterio 144: con las migraciones aplicadas, las funciones de contexto son STABLE y nunca IMMUTABLE', () => {
  it('criterio 144 (premisa): la prueba mira algo: las dos funciones de contexto, las politicas que dependen de ellas y las funciones que leen el contexto', async () => {
    const { deLasPoliticas, queMencionan } = await conClienteComo('propietario', async (cliente) => ({
      deLasPoliticas: await funcionesDeLasPoliticas(cliente),
      queMencionan: await funcionesQueMencionanElContexto(cliente),
    }));

    expect(deLasPoliticas).toEqual(
      expect.arrayContaining(['public.app_academia_actual()', 'public.app_es_plataforma()']),
    );
    expect(queMencionan).toEqual(
      expect.arrayContaining([
        'public.app_academia_actual()',
        'public.app_es_plataforma()',
        'public.resolver_academia(p_nombre_corto text)',
      ]),
    );
  });

  it('criterio 144 (1): public.app_academia_actual() y public.app_es_plataforma() tienen provolatile = s (STABLE)', async () => {
    const funcionesApp = await cargarFuncionesApp();
    const hallazgos = await conClienteComo('propietario', (cliente) => hallazgosDeVolatilidad(cliente, funcionesApp));

    expect(textoDe(hallazgos.filter((h) => h.regla === 1)), 'volatilidad de las funciones de contexto').toBe('');
  });

  it('criterio 144 (2): ninguna funcion de la que dependa una politica (fuera de pg_catalog) es IMMUTABLE', async () => {
    const funcionesApp = await cargarFuncionesApp();
    const hallazgos = await conClienteComo('propietario', (cliente) => hallazgosDeVolatilidad(cliente, funcionesApp));

    expect(textoDe(hallazgos.filter((h) => h.regla === 2)), 'funciones de las politicas').toBe('');
  });

  it('criterio 144 (3): ninguna funcion de FUNCIONES_APP (incluida resolver_academia, VOLATILE) es IMMUTABLE', async () => {
    const funcionesApp = await cargarFuncionesApp();
    const hallazgos = await conClienteComo('propietario', (cliente) => hallazgosDeVolatilidad(cliente, funcionesApp));

    expect(textoDe(hallazgos.filter((h) => h.regla === 3)), 'funciones de FUNCIONES_APP').toBe('');
    expect(funcionesApp.map((f) => f.nombre).sort()).toEqual([
      'app_academia_actual',
      'app_es_plataforma',
      'resolver_academia',
    ]);
  });

  it('criterio 144 (4): ninguna funcion propia de los esquemas revisados que mencione current_setting o las funciones de contexto es IMMUTABLE', async () => {
    const funcionesApp = await cargarFuncionesApp();
    const hallazgos = await conClienteComo('propietario', (cliente) => hallazgosDeVolatilidad(cliente, funcionesApp));

    expect(textoDe(hallazgos.filter((h) => h.regla === 4)), 'funciones que leen el contexto').toBe('');
  });

  it('criterio 144 (5): el cuerpo de las dos funciones es exactamente el de la migracion (sql, sin SECURITY DEFINER, sin valores propios, sin argumentos)', async () => {
    const funcionesApp = await cargarFuncionesApp();
    const hallazgos = await conClienteComo('propietario', (cliente) => hallazgosDeVolatilidad(cliente, funcionesApp));

    expect(textoDe(hallazgos.filter((h) => h.regla === 5)), 'cuerpo de las funciones de contexto').toBe('');
  });

  it('criterio 144: en conjunto, ninguna de las cinco condiciones se cumple con las migraciones actuales', async () => {
    const funcionesApp = await cargarFuncionesApp();
    const hallazgos = await conClienteComo('propietario', (cliente) => hallazgosDeVolatilidad(cliente, funcionesApp));

    expect(textoDe(hallazgos)).toBe('');
  });
});

describe('criterio 144: autocomprobacion, la prueba detecta una funcion de contexto IMMUTABLE o con otro cuerpo (como duenio, en una transaccion que se revierte)', () => {
  /** Como duenio, en una transaccion que se revierte: ejecuta las sentencias dentro de un SAVEPOINT y devuelve los hallazgos. */
  async function conSentencias(sentencias: readonly string[]): Promise<Hallazgo[]> {
    const funcionesApp = await cargarFuncionesApp();
    return conTransaccionRevertida('propietario', undefined, async (cliente) => {
      await cliente.query('SAVEPOINT caso_r9');
      for (const sentencia of sentencias) await cliente.query(sentencia);
      const hallazgos = await hallazgosDeVolatilidad(cliente, funcionesApp);
      await cliente.query('ROLLBACK TO SAVEPOINT caso_r9');
      return hallazgos;
    });
  }

  it('criterio 144: ALTER FUNCTION public.app_academia_actual() IMMUTABLE aparece por la primera y la segunda condicion, nombrando la funcion y IMMUTABLE', async () => {
    const hallazgos = await conSentencias(['ALTER FUNCTION public.app_academia_actual() IMMUTABLE']);

    expect(reglasDe(hallazgos, 'public.app_academia_actual()')).toEqual(expect.arrayContaining([1, 2]));
    const mensajes = hallazgos.filter((h) => h.funcion === 'public.app_academia_actual()' && [1, 2].includes(h.regla));
    for (const hallazgo of mensajes) {
      expect(hallazgo.mensaje).toContain('public.app_academia_actual()');
      expect(hallazgo.mensaje).toContain('IMMUTABLE');
    }
    expect(reglasDe(hallazgos, 'public.app_es_plataforma()'), 'la otra funcion no cambio').toEqual([]);
  });

  it('criterio 144: ALTER FUNCTION public.app_es_plataforma() VOLATILE aparece por la primera condicion, nombrando VOLATILE', async () => {
    const hallazgos = await conSentencias(['ALTER FUNCTION public.app_es_plataforma() VOLATILE']);

    expect(reglasDe(hallazgos, 'public.app_es_plataforma()')).toEqual([1]);
    expect(textoDe(hallazgos)).toContain('VOLATILE');
    expect(reglasDe(hallazgos, 'public.app_academia_actual()'), 'la otra funcion no cambio').toEqual([]);
  });

  it('criterio 144: public.prueba_r9_auxiliar() (sql, IMMUTABLE, con current_setting), sin politicas que la usen, aparece por la cuarta condicion', async () => {
    const hallazgos = await conSentencias([
      `CREATE FUNCTION public.prueba_r9_auxiliar() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT pg_catalog.current_setting('app.academia_id', true) $$`,
    ]);

    expect(reglasDe(hallazgos, 'public.prueba_r9_auxiliar()')).toEqual([4]);
    expect(textoDe(hallazgos)).toContain('IMMUTABLE');
  });

  it('criterio 144: la misma funcion auxiliar STABLE no aparece (control)', async () => {
    const hallazgos = await conSentencias([
      `CREATE FUNCTION public.prueba_r9_auxiliar() RETURNS text LANGUAGE sql STABLE AS $$ SELECT pg_catalog.current_setting('app.academia_id', true) $$`,
    ]);

    expect(textoDe(hallazgos)).toBe('');
  });

  it('criterio 144: una politica de ejemplo con una funcion IMMUTABLE sin current_setting en el cuerpo aparece por la segunda condicion y no por la cuarta', async () => {
    const hallazgos = await conSentencias([
      'CREATE TABLE public.prueba_r9_tabla (academia_id uuid)',
      'ALTER TABLE public.prueba_r9_tabla ENABLE ROW LEVEL SECURITY',
      'CREATE FUNCTION public.prueba_r9_inmutable() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::uuid $$',
      'CREATE POLICY prueba_r9_politica ON public.prueba_r9_tabla USING (academia_id = public.prueba_r9_inmutable())',
    ]);

    expect(reglasDe(hallazgos, 'public.prueba_r9_inmutable()')).toEqual([2]);
    expect(textoDe(hallazgos)).toContain('public.prueba_r9_inmutable()');
  });

  it('criterio 144: la misma politica con la funcion STABLE no aparece (control)', async () => {
    const hallazgos = await conSentencias([
      'CREATE TABLE public.prueba_r9_tabla (academia_id uuid)',
      'ALTER TABLE public.prueba_r9_tabla ENABLE ROW LEVEL SECURITY',
      'CREATE FUNCTION public.prueba_r9_estable() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$',
      'CREATE POLICY prueba_r9_politica ON public.prueba_r9_tabla USING (academia_id = public.prueba_r9_estable())',
    ]);

    expect(textoDe(hallazgos)).toBe('');
  });

  it('criterio 144: CREATE OR REPLACE FUNCTION public.app_es_plataforma() ... STABLE ... SELECT true aparece por la quinta condicion', async () => {
    const hallazgos = await conSentencias([
      'CREATE OR REPLACE FUNCTION public.app_es_plataforma() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$',
    ]);

    expect(reglasDe(hallazgos, 'public.app_es_plataforma()')).toEqual([5]);
    expect(reglasDe(hallazgos, 'public.app_academia_actual()')).toEqual([]);
  });

  it('criterio 144 (3): ALTER FUNCTION public.resolver_academia(text) IMMUTABLE aparece por la tercera condicion', async () => {
    const hallazgos = await conSentencias(['ALTER FUNCTION public.resolver_academia(text) IMMUTABLE']);

    expect(reglasDe(hallazgos, 'public.resolver_academia(p_nombre_corto text)')).toEqual(expect.arrayContaining([3]));
    expect(textoDe(hallazgos)).toContain('public.resolver_academia(p_nombre_corto text)');
  });

  it.each([
    ['SECURITY DEFINER', 'ALTER FUNCTION public.app_academia_actual() SECURITY DEFINER'],
    ['un valor propio (SET search_path)', 'ALTER FUNCTION public.app_academia_actual() SET search_path = public'],
    [
      'otro lenguaje (plpgsql) con el mismo resultado',
      `CREATE OR REPLACE FUNCTION public.app_academia_actual() RETURNS uuid LANGUAGE plpgsql STABLE AS $$ BEGIN RETURN CAST(NULLIF(pg_catalog.current_setting('app.academia_id', true), '') AS pg_catalog.uuid); END $$`,
    ],
    [
      'otro texto: sin el NULLIF',
      `CREATE OR REPLACE FUNCTION public.app_academia_actual() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT CAST(pg_catalog.current_setting('app.academia_id', true) AS pg_catalog.uuid) $$`,
    ],
  ])('criterio 144 (5): %s en app_academia_actual() aparece por la quinta condicion', async (_caso, sentencia) => {
    const hallazgos = await conSentencias([sentencia]);

    expect(reglasDe(hallazgos, 'public.app_academia_actual()')).toEqual(expect.arrayContaining([5]));
  });

  it('criterio 144 (5, control): el mismo texto con otros espacios, saltos de linea y sangrias no aparece', async () => {
    const hallazgos = await conSentencias([
      `CREATE OR REPLACE FUNCTION public.app_academia_actual() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT   CAST(NULLIF(pg_catalog.current_setting('app.academia_id',   true),
                               '')
                        AS pg_catalog.uuid)
        $$`,
    ]);

    expect(textoDe(hallazgos)).toBe('');
  });

  it('criterio 144: lo creado en la autocomprobacion se revirtio (las funciones de ejemplo ya no estan y las dos de contexto siguen STABLE)', async () => {
    const funcionesApp = await cargarFuncionesApp();
    const { ejemplo, hallazgos } = await conClienteComo('propietario', async (cliente) => ({
      ejemplo: await filas<{ proname: string }>(
        cliente,
        `SELECT proname::text FROM pg_catalog.pg_proc WHERE proname LIKE 'prueba\\_r9\\_%'`,
      ),
      hallazgos: await hallazgosDeVolatilidad(cliente, funcionesApp),
    }));

    expect(ejemplo).toEqual([]);
    expect(textoDe(hallazgos)).toBe('');
  });
});
