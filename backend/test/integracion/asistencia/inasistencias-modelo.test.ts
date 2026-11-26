// spec: 009-asistencia (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { conTransaccionRevertida, ejecutarComo } from '../../utilidades/base-datos';
import { exigirTablaDeInasistencias } from '../../utilidades/escenario-faltas';
import { type PoliticaLeida, problemasDeLaPolitica } from '../../utilidades/politicas';

// Criterio 22 (crítico, D-08, 9.1, D-23; criterios 12, 124 y 132 de 001), parte del catálogo: la migración `<marca>_inasistencias` crea la tabla `inasistencias` con `id`, `academia_id`, `alumno_id`,
// `matricula_id`, `clase_id`, `fecha` (`date`), `registrada_en` y `cubierta_en` (`timestamptz(3)`) y `asistencia_id` (`uuid`, nulo); las llaves compuestas `(academia_id, matricula_id, alumno_id)` → `matriculas`,
// `(academia_id, clase_id)` → `clases` y `(academia_id, asistencia_id, alumno_id, fecha)` → `asistencias (academia_id, id, alumno_id, fecha)` (una falta solo la cubre una asistencia del mismo alumno y del mismo día);
// el único `inasistencias_una_por_clase_key` sobre `(academia_id, alumno_id, clase_id, fecha)`; el `CHECK inasistencias_cubierta_coherente`; el trigger `inasistencias_se_cubre_una_vez` (`BEFORE UPDATE`, por fila,
// con su función `SECURITY INVOKER`, `search_path` fijo y sin `EXECUTE` para `PUBLIC`, como los de la 007); y la RLS activada y forzada con políticas de `SELECT`, `INSERT` y `UPDATE` de la forma exacta del criterio 132
// de la 001 (sin `DELETE`). Todo con el catálogo; no depende de qué rol es el dueño de las tablas.
// El comportamiento (únicos, llaves, `CHECK` y trigger, como app y como dueño) está en `inasistencias-checks-unicos.test.ts`; los privilegios, en `inasistencias-privilegios.test.ts`; la RLS en ejecución, en
// `inasistencias-rls.test.ts`.
// Lecturas estrictas elegidas: las tres llaves compuestas de la spec deben existir tal cual y toda otra llave foránea (si la migración suma, por ejemplo, `(academia_id, alumno_id)` → `alumnos`) debe ser también
// compuesta y empezar por `academia_id`; el único de la clase se comprueba como índice único (no se exige que sea una `CONSTRAINT UNIQUE` ni un índice a secas).

interface ColumnaLeida {
  columna: string;
  tipo: string;
  obligatoria: boolean;
  por_defecto: string | null;
}

async function columnasDe(tabla: string): Promise<Map<string, ColumnaLeida>> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT a.attname AS columna, pg_catalog.format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS obligatoria,
            pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS por_defecto
       FROM pg_catalog.pg_attribute a
       LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = ('public.' || $1)::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attname`,
    [tabla],
  );
  return new Map((rows as ColumnaLeida[]).map((fila) => [fila.columna, fila]));
}

interface IndiceLeido {
  nombre: string;
  unico: boolean;
  primaria: boolean;
  parcial: string | null;
  columnas: string[];
}

async function indicesDe(tabla: string): Promise<IndiceLeido[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT ic.relname AS nombre, i.indisunique AS unico, i.indisprimary AS primaria,
            pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS parcial,
            (SELECT array_agg(a.attname::text ORDER BY k.ord)::text[]
               FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS columnas
       FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = ('public.' || $1)::regclass`,
    [tabla],
  );
  return rows as IndiceLeido[];
}

interface LlaveLeida {
  nombre: string;
  columnas: string[];
  destino: string;
  destinos: string[];
  al_borrar: string;
}

async function llavesForaneasDe(tabla: string): Promise<LlaveLeida[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT c.conname AS nombre, c.confdeltype::text AS al_borrar,
            regexp_replace(c.confrelid::regclass::text, '^public\\.', '') AS destino,
            (SELECT array_agg(a.attname::text ORDER BY k.ord)::text[] FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columnas,
            (SELECT array_agg(a.attname::text ORDER BY k.ord)::text[] FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS destinos
       FROM pg_catalog.pg_constraint c WHERE c.conrelid = ('public.' || $1)::regclass AND c.contype = 'f'`,
    [tabla],
  );
  return rows as LlaveLeida[];
}

describe('criterio 22: la tabla inasistencias existe', () => {
  it('criterio 22: inasistencias está en public', async () => {
    await exigirTablaDeInasistencias();
  });
});

describe('criterio 22: columnas', () => {
  beforeEach(exigirTablaDeInasistencias);

  it('criterio 22: inasistencias tiene las columnas de la spec, con su tipo y su nulabilidad (asistencia_id y cubierta_en son nulas)', async () => {
    const columnas = await columnasDe('inasistencias');
    const esperado: Record<string, { tipo: RegExp; obligatoria: boolean }> = {
      id: { tipo: /^uuid$/, obligatoria: true },
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      alumno_id: { tipo: /^uuid$/, obligatoria: true },
      matricula_id: { tipo: /^uuid$/, obligatoria: true },
      clase_id: { tipo: /^uuid$/, obligatoria: true },
      fecha: { tipo: /^date$/, obligatoria: true },
      registrada_en: { tipo: /^timestamp\(3\) with time zone$/, obligatoria: true },
      asistencia_id: { tipo: /^uuid$/, obligatoria: false },
      cubierta_en: { tipo: /^timestamp\(3\) with time zone$/, obligatoria: false },
    };

    for (const [nombre, regla] of Object.entries(esperado)) {
      const columna = columnas.get(nombre);
      expect(columna, `falta la columna ${nombre}`).toBeDefined();
      expect(columna?.tipo, `tipo de ${nombre}`).toMatch(regla.tipo);
      expect(columna?.obligatoria, `${nombre} obligatoria`).toBe(regla.obligatoria);
    }
    const demas = [...columnas.values()].filter(
      (columna) => !(columna.columna in esperado) && columna.obligatoria && columna.por_defecto === null,
    );
    expect(
      demas.map((columna) => columna.columna),
      'columnas obligatorias que la spec no pide',
    ).toEqual([]);
  });
});

describe('criterio 22: claves, únicos y llaves foráneas', () => {
  beforeEach(exigirTablaDeInasistencias);

  it('criterio 22: inasistencias tiene su clave primaria (id) y academia_id apunta a academias(id) con RESTRICT', async () => {
    const primaria = (await indicesDe('inasistencias')).find((indice) => indice.primaria);
    const haciaAcademias = (await llavesForaneasDe('inasistencias')).filter((llave) => llave.destino === 'academias');

    expect(primaria?.columnas).toEqual(['id']);
    expect(haciaAcademias.map((llave) => llave.columnas)).toEqual([['academia_id']]);
    expect(haciaAcademias[0]?.destinos).toEqual(['id']);
    expect(haciaAcademias[0]?.al_borrar, 'ON DELETE RESTRICT').toBe('r');
  });

  it('criterio 22: inasistencias_una_por_clase_key es un único sobre (academia_id, alumno_id, clase_id, fecha), no parcial (una falta por alumno, clase y fecha)', async () => {
    const indice = (await indicesDe('inasistencias')).find((i) => i.nombre === 'inasistencias_una_por_clase_key');

    expect(indice, 'falta el único inasistencias_una_por_clase_key').toBeDefined();
    expect(indice?.unico).toBe(true);
    expect(indice?.columnas).toEqual(['academia_id', 'alumno_id', 'clase_id', 'fecha']);
    expect(indice?.parcial, 'sin predicado: vale para todas las faltas').toBeNull();
  });

  /** Las llaves foráneas que no van a `academias`, como `columnas->destino(destinos)`. */
  const llavesDe = async (tabla: string) =>
    (await llavesForaneasDe(tabla))
      .filter((llave) => llave.destino !== 'academias')
      .map((llave) => `${llave.columnas.join(',')}->${llave.destino}(${llave.destinos.join(',')})`)
      .sort();

  it('criterio 22: tiene las tres llaves compuestas de la spec: matrícula junto con el alumno, la clase, y la asistencia que la cubre junto con el alumno y la fecha', async () => {
    expect(await llavesDe('inasistencias')).toEqual(
      expect.arrayContaining([
        'academia_id,matricula_id,alumno_id->matriculas(academia_id,id,alumno_id)',
        'academia_id,clase_id->clases(academia_id,id)',
        'academia_id,asistencia_id,alumno_id,fecha->asistencias(academia_id,id,alumno_id,fecha)',
      ]),
    );
  });

  it('criterio 22: toda llave foránea de inasistencias es compuesta y empieza por academia_id (criterio 12 de 001)', async () => {
    const llaves = (await llavesForaneasDe('inasistencias')).filter((llave) => llave.destino !== 'academias');

    expect(llaves.length).toBeGreaterThanOrEqual(3);
    for (const llave of llaves) {
      expect(llave.columnas[0], `${llave.nombre} empieza por academia_id`).toBe('academia_id');
      expect(llave.columnas.length, `${llave.nombre} es compuesta`).toBeGreaterThanOrEqual(2);
    }
  });

  it('criterio 22: asistencias ya tiene UNIQUE (academia_id, id, alumno_id, fecha) para la llave de la cobertura (009a)', async () => {
    const unicos = (await indicesDe('asistencias'))
      .filter((i) => i.unico && i.parcial === null)
      .map((i) => i.columnas.join(','));

    expect(unicos).toContain('academia_id,id,alumno_id,fecha');
  });
});

describe('criterio 22: el CHECK de la cobertura y el trigger', () => {
  beforeEach(exigirTablaDeInasistencias);

  it('criterio 22: inasistencias_cubierta_coherente es un CHECK de la tabla sobre asistencia_id y cubierta_en', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT c.conname AS nombre, pg_catalog.pg_get_constraintdef(c.oid) AS definicion
         FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.inasistencias'::regclass AND c.contype = 'c'`,
    );
    const porNombre = new Map((rows as { nombre: string; definicion: string }[]).map((f) => [f.nombre, f.definicion]));

    expect(porNombre.has('inasistencias_cubierta_coherente'), 'falta el CHECK inasistencias_cubierta_coherente').toBe(
      true,
    );
    expect(porNombre.get('inasistencias_cubierta_coherente')).toMatch(/asistencia_id/);
    expect(porNombre.get('inasistencias_cubierta_coherente')).toMatch(/cubierta_en/);
  });

  interface TriggerLeido {
    nombre: string;
    tipo: number;
    habilitado: string;
    es_restriccion: boolean;
    funcion: string;
    security_definer: boolean;
    configuracion: string[] | null;
    ejecuta_public: boolean;
  }

  async function triggersDe(tabla: string): Promise<TriggerLeido[]> {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT t.tgname AS nombre, t.tgtype::int AS tipo, t.tgenabled::text AS habilitado, t.tgconstraint <> 0 AS es_restriccion,
              p.proname AS funcion, p.prosecdef AS security_definer, p.proconfig AS configuracion,
              coalesce((SELECT bool_or(a.grantee = 0) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), false) AS ejecuta_public
         FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = ('public.' || $1)::regclass AND NOT t.tgisinternal`,
      [tabla],
    );
    return rows as TriggerLeido[];
  }

  // tgtype: 1 = por fila, 2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE.
  const POR_FILA = 1;
  const ANTES = 2;
  const AL_INSERTAR = 4;
  const AL_BORRAR = 8;
  const AL_ACTUALIZAR = 16;

  it('criterio 22: inasistencias tiene el trigger inasistencias_se_cubre_una_vez, BEFORE UPDATE por fila, habilitado y solo para UPDATE', async () => {
    const trigger = (await triggersDe('inasistencias')).find((t) => t.nombre === 'inasistencias_se_cubre_una_vez');

    expect(trigger, 'falta el trigger inasistencias_se_cubre_una_vez').toBeDefined();
    expect(trigger!.tipo & POR_FILA, 'por fila').toBeTruthy();
    expect(trigger!.tipo & ANTES, 'BEFORE').toBeTruthy();
    expect(trigger!.tipo & AL_ACTUALIZAR, 'UPDATE').toBeTruthy();
    expect(trigger!.tipo & AL_INSERTAR, 'no es de INSERT').toBeFalsy();
    expect(trigger!.tipo & AL_BORRAR, 'no es de DELETE').toBeFalsy();
    expect(trigger!.es_restriccion, 'un trigger común, no de restricción').toBe(false);
    expect(trigger!.habilitado, 'habilitado siempre (también para el dueño)').toBe('O');
  });

  it('criterio 22: la función del trigger es SECURITY INVOKER, con search_path fijo y sin EXECUTE para PUBLIC (como los de la 007)', async () => {
    const trigger = (await triggersDe('inasistencias')).find((t) => t.nombre === 'inasistencias_se_cubre_una_vez');

    expect(trigger, 'falta el trigger inasistencias_se_cubre_una_vez').toBeDefined();
    expect(trigger!.security_definer, `${trigger!.funcion} no es SECURITY DEFINER`).toBe(false);
    expect(
      (trigger!.configuracion ?? []).some((valor) => /^search_path=/.test(valor)),
      `${trigger!.funcion} fija su search_path`,
    ).toBe(true);
    expect(trigger!.ejecuta_public, `${trigger!.funcion}: REVOKE ALL … FROM PUBLIC`).toBe(false);
  });
});

describe('criterio 22: RLS activada y forzada, y políticas', () => {
  beforeEach(exigirTablaDeInasistencias);

  it('criterio 22: inasistencias tiene la RLS activada y forzada', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT relrowsecurity AS activada, relforcerowsecurity AS forzada FROM pg_catalog.pg_class
        WHERE oid = 'public.inasistencias'::regclass`,
    );

    expect(rows).toEqual([{ activada: true, forzada: true }]);
  });

  it('criterio 22: inasistencias tiene políticas con la forma exacta de la 001 (criterio 132): SELECT, INSERT y UPDATE, y ninguna de DELETE', async () => {
    const politicas = await conTransaccionRevertida('propietario', undefined, async (cliente) => {
      await cliente.query('SET LOCAL search_path = pg_catalog, public');
      const { rows } = await cliente.query(
        `SELECT n.nspname AS esquema, c.relname AS tabla, p.polname AS nombre, p.polcmd::text AS comando,
                p.polpermissive AS permisiva,
                pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS usando,
                pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS comprobando
           FROM pg_catalog.pg_policy p
           JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'inasistencias'`,
      );
      return rows as PoliticaLeida[];
    });

    // a = INSERT, r = SELECT, w = UPDATE, d = DELETE.
    expect(politicas.map((politica) => politica.comando).sort()).toEqual(['a', 'r', 'w']);
    expect(politicas.every((politica) => politica.permisiva)).toBe(true);
    expect(politicas.flatMap(problemasDeLaPolitica)).toEqual([]);
    for (const politica of politicas) {
      expect(`${politica.usando ?? ''} ${politica.comprobando ?? ''}`).toMatch(
        /academia_id\s*=\s*\(?\s*(SELECT )?\s*app_academia_actual\(\)/,
      );
    }
  });
});
