// spec: 004-planes-clases-aforo (pruebas protegidas)
import { beforeAll, describe, expect, it } from 'vitest';
import { conTransaccionRevertida, ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { problemasDeLaPolitica, type PoliticaLeida } from '../../utilidades/politicas';
import {
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  crearPlanDePrueba,
  exigirTablasDePlanesYClases,
  insertarClase,
  insertarPlan,
} from '../../utilidades/planes-clases';

// Criterio 1 (crítico, D-17, D-23): las tablas `planes` y `clases` existen con las columnas de "Cambios al modelo de datos", con RLS
// activada y forzada, políticas de SELECT, INSERT y UPDATE con la forma exacta del criterio 132 de la 001, sin política de DELETE,
// UNIQUE (academia_id, id) en las dos, la llave foránea compuesta clases (academia_id, entrenador_id) -> usuarios (academia_id, id) y
// los índices únicos de la spec. Las pruebas de catálogo de la 001 (criterios 9 a 13, 17, 18, 124 a 126 y 131 a 133) y
// TABLAS_DESPUES_DE_MIGRAR de scripts las comprueban aparte. Todo con el catálogo y con conexiones reales de PostgreSQL; no depende
// de qué rol es el dueño de las tablas (superusuario o no).

interface ColumnaLeida {
  columna: string;
  tipo: string;
  obligatoria: boolean;
  por_defecto: string | null;
}

async function columnasDe(tabla: 'planes' | 'clases'): Promise<Map<string, ColumnaLeida>> {
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

type Regla = { tipo: RegExp; obligatoria: boolean; porDefecto?: RegExp };

function comprobarColumnas(columnas: Map<string, ColumnaLeida>, esperado: Record<string, Regla>): void {
  expect([...columnas.keys()].sort()).toEqual(Object.keys(esperado).sort());
  for (const [nombre, regla] of Object.entries(esperado)) {
    const columna = columnas.get(nombre);
    expect(columna?.tipo, `tipo de ${nombre}`).toMatch(regla.tipo);
    expect(columna?.obligatoria, `${nombre} obligatoria`).toBe(regla.obligatoria);
    if (regla.porDefecto) expect(columna?.por_defecto, `valor por defecto de ${nombre}`).toMatch(regla.porDefecto);
  }
}

interface IndiceLeido {
  unico: boolean;
  primaria: boolean;
  parcial: string | null;
  columnas: string[];
  definicion: string;
}

async function indicesDe(tabla: 'planes' | 'clases'): Promise<IndiceLeido[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT i.indisunique AS unico, i.indisprimary AS primaria,
            pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS parcial,
            pg_catalog.pg_get_indexdef(i.indexrelid) AS definicion,
            (SELECT array_agg(a.attname::text ORDER BY k.ord)::text[]
               FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS columnas
       FROM pg_catalog.pg_index i WHERE i.indrelid = ('public.' || $1)::regclass`,
    [tabla],
  );
  return rows as IndiceLeido[];
}

describe('criterio 1: la tabla planes', () => {
  beforeAll(exigirTablasDePlanesYClases);

  it('criterio 1: existe con las columnas, tipos, nulabilidad y valores por defecto del modelo de datos', async () => {
    comprobarColumnas(await columnasDe('planes'), {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      nombre: { tipo: /^text$/, obligatoria: true },
      veces_por_semana: { tipo: /^smallint$/, obligatoria: true },
      clases_por_mes: { tipo: /^smallint$/, obligatoria: true },
      duracion_minutos: { tipo: /^smallint$/, obligatoria: true, porDefecto: /^60$/ },
      precio: { tipo: /^numeric\(10,2\)$/, obligatoria: true },
      dias_permitidos: { tipo: /^smallint\[\]$/, obligatoria: true },
      franjas_permitidas: { tipo: /^time\(0\) without time zone\[\]$/, obligatoria: true },
      niveles_aplicables: { tipo: /nivel_natacion\[\]$/, obligatoria: true },
      vigencia_inicio: { tipo: /^date$/, obligatoria: false },
      vigencia_fin: { tipo: /^date$/, obligatoria: false },
      activo: { tipo: /^boolean$/, obligatoria: true, porDefecto: /^true$/ },
      creado_en: { tipo: /^timestamp(\(\d\))? with time zone$/, obligatoria: true },
      actualizado_en: { tipo: /^timestamp(\(\d\))? with time zone$/, obligatoria: true },
    });
  });

  it('criterio 1: academia_id apunta a academias(id) con RESTRICT', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT c.confdeltype::text AS al_borrar, c.confrelid::regclass::text AS destino,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)::text[] FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columnas
         FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.planes'::regclass AND c.contype = 'f'`,
    );

    const haciaAcademias = (rows as { al_borrar: string; destino: string; columnas: string[] }[]).filter(
      (fila) => fila.destino === 'academias' || fila.destino === 'public.academias',
    );
    expect(haciaAcademias.map((fila) => fila.columnas)).toEqual([['academia_id']]);
    expect(haciaAcademias[0]?.al_borrar, 'ON DELETE RESTRICT').toBe('r');
  });

  it('criterio 1: clave primaria en id, UNIQUE (academia_id, id) y un índice único sobre (academia_id, lower(nombre)); el nombre no es único global', async () => {
    const indices = await indicesDe('planes');

    expect(indices.find((indice) => indice.primaria)?.columnas).toEqual(['id']);
    expect(indices.filter((i) => i.unico).map((i) => i.columnas.join(','))).toContain('academia_id,id');
    const delNombre = indices.filter((indice) => indice.unico && /lower\(/i.test(indice.definicion));
    expect(delNombre, 'índice único sobre lower(nombre)').toHaveLength(1);
    expect(delNombre[0]?.definicion).toMatch(/\(academia_id, lower\(nombre\)\)/);
    expect(
      indices.filter((indice) => indice.unico && indice.columnas.join(',') === 'nombre'),
      'el nombre no puede ser único global',
    ).toEqual([]);
  });

  it('criterio 1: el nombre se repite en otra academia y no en la misma, sin distinguir mayúsculas (pregunta N8)', async () => {
    await limpiarBase();
    const A = await crearAcademiaDePrueba();
    const B = await crearAcademiaDePrueba();
    await crearPlanDePrueba(A.id, { nombre: 'Plan Mensual' });

    for (const repetido of ['Plan Mensual', 'plan mensual', 'PLAN MENSUAL']) {
      await expect(
        insertarPlan('propietario', A.id, { nombre: repetido }),
        `nombre ${JSON.stringify(repetido)} en la misma academia`,
      ).rejects.toMatchObject({ code: '23505' });
    }
    await expect(insertarPlan('propietario', B.id, { nombre: 'Plan Mensual' })).resolves.toEqual(expect.any(String));
  });

  it('criterio 1: la RLS está activada y forzada', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT relrowsecurity AS activada, relforcerowsecurity AS forzada FROM pg_catalog.pg_class
        WHERE oid = 'public.planes'::regclass`,
    );

    expect(rows).toEqual([{ activada: true, forzada: true }]);
  });
});

describe('criterio 1: la tabla clases', () => {
  beforeAll(exigirTablasDePlanesYClases);

  it('criterio 1: existe con las columnas, tipos, nulabilidad y valores por defecto del modelo de datos', async () => {
    comprobarColumnas(await columnasDe('clases'), {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      nivel: { tipo: /nivel_natacion$/, obligatoria: true },
      dia_semana: { tipo: /^smallint$/, obligatoria: true },
      hora_inicio: { tipo: /^time\(0\) without time zone$/, obligatoria: true },
      hora_fin: { tipo: /^time\(0\) without time zone$/, obligatoria: true },
      entrenador_id: { tipo: /^uuid$/, obligatoria: true },
      aforo: { tipo: /^smallint$/, obligatoria: true },
      activo: { tipo: /^boolean$/, obligatoria: true, porDefecto: /^true$/ },
      creado_en: { tipo: /^timestamp(\(\d\))? with time zone$/, obligatoria: true },
      actualizado_en: { tipo: /^timestamp(\(\d\))? with time zone$/, obligatoria: true },
    });
  });

  it('criterio 1: el tipo nivel_natacion tiene BASICO, INTERMEDIO y AVANZADO', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT e.enumlabel AS valor
         FROM pg_catalog.pg_type t
         JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
         JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'nivel_natacion'
        ORDER BY e.enumlabel`,
    );

    expect((rows as { valor: string }[]).map((fila) => fila.valor)).toEqual(['AVANZADO', 'BASICO', 'INTERMEDIO']);
  });

  it('criterio 1: academia_id apunta a academias(id) con RESTRICT', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT c.confdeltype::text AS al_borrar, c.confrelid::regclass::text AS destino,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)::text[] FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columnas
         FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.clases'::regclass AND c.contype = 'f'`,
    );

    const haciaAcademias = (rows as { al_borrar: string; destino: string; columnas: string[] }[]).filter(
      (fila) => fila.destino === 'academias' || fila.destino === 'public.academias',
    );
    expect(haciaAcademias.map((fila) => fila.columnas)).toEqual([['academia_id']]);
    expect(haciaAcademias[0]?.al_borrar, 'ON DELETE RESTRICT').toBe('r');
  });

  it('criterio 1: la llave foránea compuesta (academia_id, entrenador_id) apunta a usuarios (academia_id, id) con RESTRICT', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT c.confdeltype::text AS al_borrar, c.confupdtype::text AS al_cambiar, c.confrelid::regclass::text AS destino,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)::text[] FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columnas,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)::text[] FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS destinos
         FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.clases'::regclass AND c.contype = 'f'`,
    );

    const haciaUsuarios = (
      rows as { al_borrar: string; al_cambiar: string; destino: string; columnas: string[]; destinos: string[] }[]
    ).filter((fila) => fila.destino === 'usuarios' || fila.destino === 'public.usuarios');
    expect(haciaUsuarios).toHaveLength(1);
    expect(haciaUsuarios[0]?.columnas).toEqual(['academia_id', 'entrenador_id']);
    expect(haciaUsuarios[0]?.destinos).toEqual(['academia_id', 'id']);
    expect(haciaUsuarios[0]?.al_borrar, 'ON DELETE RESTRICT').toBe('r');
    expect(haciaUsuarios[0]?.al_cambiar, 'ON UPDATE RESTRICT').toMatch(/^[ra]$/);
  });

  it('criterio 1: clave primaria en id, UNIQUE (academia_id, id) e índice (academia_id, dia_semana, hora_inicio)', async () => {
    const indices = await indicesDe('clases');

    expect(indices.find((indice) => indice.primaria)?.columnas).toEqual(['id']);
    expect(indices.filter((i) => i.unico).map((i) => i.columnas.join(','))).toContain('academia_id,id');
    expect(indices.map((indice) => indice.columnas.join(','))).toContain('academia_id,dia_semana,hora_inicio');
  });

  it('criterio 1: dos clases activas del mismo entrenador en el mismo día y bloque chocan (23505); con otro día, otro bloque o una clase inactiva no', async () => {
    await limpiarBase();
    const A = await crearAcademiaDePrueba();
    const entrenador = await crearEntrenadorDePrueba(A.id);
    await crearClaseDePrueba(A.id, entrenador.id, { nivel: 'BASICO', dia_semana: 2, hora_inicio: '10:00' });

    await expect(
      insertarClase('propietario', A.id, entrenador.id, { nivel: 'AVANZADO', dia_semana: 2, hora_inicio: '10:00' }),
    ).rejects.toMatchObject({ code: '23505' });
    for (const otro of [
      { nivel: 'AVANZADO', dia_semana: 3, hora_inicio: '10:00' },
      { nivel: 'AVANZADO', dia_semana: 2, hora_inicio: '11:00' },
      { nivel: 'AVANZADO', dia_semana: 2, hora_inicio: '10:00', activo: false },
    ]) {
      await expect(insertarClase('propietario', A.id, entrenador.id, otro), JSON.stringify(otro)).resolves.toEqual(
        expect.any(String),
      );
    }
  });

  it('criterio 1: dos clases activas del mismo nivel en el mismo día y bloque chocan (23505) aunque tengan otro entrenador; las inactivas no cuentan', async () => {
    await limpiarBase();
    const A = await crearAcademiaDePrueba();
    const B = await crearAcademiaDePrueba();
    const uno = await crearEntrenadorDePrueba(A.id);
    const otro = await crearEntrenadorDePrueba(A.id);
    const deB = await crearEntrenadorDePrueba(B.id);
    await crearClaseDePrueba(A.id, uno.id, { nivel: 'INTERMEDIO', dia_semana: 4, hora_inicio: '18:00' });

    await expect(
      insertarClase('propietario', A.id, otro.id, { nivel: 'INTERMEDIO', dia_semana: 4, hora_inicio: '18:00' }),
    ).rejects.toMatchObject({ code: '23505' });
    // Distinto nivel en el mismo bloque con otro entrenador (RN-10), una inactiva repetida y la misma clase en otra academia: sí.
    for (const [academiaId, entrenadorId, columnas] of [
      [A.id, otro.id, { nivel: 'BASICO', dia_semana: 4, hora_inicio: '18:00' }],
      [A.id, otro.id, { nivel: 'INTERMEDIO', dia_semana: 4, hora_inicio: '18:00', activo: false }],
      [B.id, deB.id, { nivel: 'INTERMEDIO', dia_semana: 4, hora_inicio: '18:00' }],
    ] as const) {
      await expect(
        insertarClase('propietario', academiaId, entrenadorId, columnas),
        JSON.stringify(columnas),
      ).resolves.toEqual(expect.any(String));
    }
  });

  it('criterio 1: la RLS está activada y forzada', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT relrowsecurity AS activada, relforcerowsecurity AS forzada FROM pg_catalog.pg_class
        WHERE oid = 'public.clases'::regclass`,
    );

    expect(rows).toEqual([{ activada: true, forzada: true }]);
  });
});

describe.each(['planes', 'clases'] as const)('criterio 1: las políticas de %s', (tabla) => {
  beforeAll(exigirTablasDePlanesYClases);

  it('criterio 1: tiene políticas de SELECT, INSERT y UPDATE con la forma exacta de la 001 (criterio 132) y ninguna de DELETE ni ALL', async () => {
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
          WHERE n.nspname = 'public' AND c.relname = $1`,
        [tabla],
      );
      return rows as PoliticaLeida[];
    });

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
