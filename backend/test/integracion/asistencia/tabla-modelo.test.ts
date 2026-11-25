// spec: 009-asistencia (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { conTransaccionRevertida, ejecutarComo } from '../../utilidades/base-datos';
import { exigirTablaDeAsistencias } from '../../utilidades/escenario-asistencia';
import { type PoliticaLeida, problemasDeLaPolitica } from '../../utilidades/politicas';

// Criterio 1 (crítico, RN-16, D-07, D-23; criterio 12 de 001; criterio 132 de 001), parte del catálogo: la migración `<marca>_asistencias` crea los tipos `metodo_asistencia`
// (`QR`, `MANUAL`), `tipo_asistencia` (`NORMAL`, `RECUPERACION`, `FUERA_HORARIO`, `PARTICULAR`; DT-6) y `estado_llegada` (`PUNTUAL`, `TARDE`), y la tabla `asistencias` con las
// columnas de la spec (`tipo` por defecto `NORMAL`, `registro_posterior` por defecto `false`, `motivo` nulo, las dos marcas de tiempo `timestamptz(3)`), `academia_id`, RLS activada y forzada,
// políticas de SELECT e INSERT con la forma exacta del criterio 132 de la 001 (sin UPDATE ni DELETE), los cuatro únicos (`(academia_id, id)`, `(academia_id, id, alumno_id, fecha)`,
// `asistencias_un_dia_key` parcial sobre `(academia_id, alumno_id, fecha)` donde `tipo <> 'PARTICULAR'` y `asistencias_academia_id_clave_idempotencia_key`), las cuatro llaves compuestas
// `(academia_id, …)` (matrícula junto con el alumno, alumno, clase y usuario que registra) y los tres CHECK con su nombre. Todo con el catálogo; no depende de qué rol es el dueño de las tablas.
// El comportamiento de los CHECK, los únicos y las llaves, como app y como dueño, está en `tabla-checks-unicos.test.ts`; los privilegios, en `privilegios.test.ts`; la RLS en ejecución, en `tabla-rls.test.ts`.

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

interface Regla {
  tipo: RegExp;
  obligatoria?: boolean;
  porDefecto?: RegExp;
}

const UUID: Regla = { tipo: /^uuid$/, obligatoria: true };
const MARCA_MS: Regla = { tipo: /^timestamp\(3\) with time zone$/, obligatoria: true };

/** Las columnas de la spec existen con su tipo y su nulabilidad; cualquier columna de más debe poder omitirse al insertar. */
function comprobarColumnas(columnas: Map<string, ColumnaLeida>, esperado: Record<string, Regla>): void {
  for (const [nombre, regla] of Object.entries(esperado)) {
    const columna = columnas.get(nombre);
    expect(columna, `falta la columna ${nombre}`).toBeDefined();
    expect(columna?.tipo, `tipo de ${nombre}`).toMatch(regla.tipo);
    if (regla.obligatoria !== undefined) expect(columna?.obligatoria, `${nombre} obligatoria`).toBe(regla.obligatoria);
    if (regla.porDefecto) expect(columna?.por_defecto, `valor por defecto de ${nombre}`).toMatch(regla.porDefecto);
  }
  const demas = [...columnas.values()].filter(
    (columna) => !(columna.columna in esperado) && columna.obligatoria && columna.por_defecto === null,
  );
  expect(
    demas.map((columna) => columna.columna),
    'columnas obligatorias que la spec no pide',
  ).toEqual([]);
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

const unicosDe = (indices: IndiceLeido[]) =>
  indices.filter((i) => i.unico && i.parcial === null).map((i) => i.columnas.join(','));

async function valoresDe(tipo: string): Promise<string[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT e.enumlabel AS valor FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1 AND t.typnamespace = 'public'::regnamespace ORDER BY e.enumlabel`,
    [tipo],
  );
  return (rows as { valor: string }[]).map((fila) => fila.valor);
}

describe('criterio 1: la tabla asistencias existe', () => {
  it('criterio 1: asistencias está en public', async () => {
    await exigirTablaDeAsistencias();
  });
});

describe('criterio 1: los tipos', () => {
  beforeEach(exigirTablaDeAsistencias);

  it('criterio 1: metodo_asistencia tiene exactamente QR y MANUAL (D-07)', async () => {
    expect(await valoresDe('metodo_asistencia')).toEqual(['MANUAL', 'QR']);
  });

  it('criterio 1: tipo_asistencia nace con los cuatro valores de D-07: NORMAL, RECUPERACION, FUERA_HORARIO y PARTICULAR (DT-6)', async () => {
    expect(await valoresDe('tipo_asistencia')).toEqual(['FUERA_HORARIO', 'NORMAL', 'PARTICULAR', 'RECUPERACION']);
  });

  it('criterio 1: estado_llegada tiene exactamente PUNTUAL y TARDE (D-11)', async () => {
    expect(await valoresDe('estado_llegada')).toEqual(['PUNTUAL', 'TARDE']);
  });
});

describe('criterio 1: columnas', () => {
  beforeEach(exigirTablaDeAsistencias);

  it('criterio 1: asistencias tiene las columnas de la spec, con su tipo, su nulabilidad y sus valores por defecto', async () => {
    comprobarColumnas(await columnasDe('asistencias'), {
      id: UUID,
      academia_id: UUID,
      alumno_id: UUID,
      matricula_id: UUID,
      clase_id: UUID,
      fecha: { tipo: /^date$/, obligatoria: true },
      llegada_en: MARCA_MS,
      registrado_en: MARCA_MS,
      metodo: { tipo: /metodo_asistencia$/, obligatoria: true },
      tipo: { tipo: /tipo_asistencia$/, obligatoria: true, porDefecto: /NORMAL/ },
      estado_llegada: { tipo: /estado_llegada$/, obligatoria: true },
      registrado_por: UUID,
      registro_posterior: { tipo: /^boolean$/, obligatoria: true, porDefecto: /false/ },
      motivo: { tipo: /^text$/, obligatoria: false },
      clave_idempotencia: UUID,
    });
  });
});

describe('criterio 1: claves, únicos y llaves foráneas', () => {
  beforeEach(exigirTablaDeAsistencias);

  it('criterio 1: asistencias tiene su clave primaria (id) y academia_id apunta a academias(id) con RESTRICT', async () => {
    const primaria = (await indicesDe('asistencias')).find((indice) => indice.primaria);
    const haciaAcademias = (await llavesForaneasDe('asistencias')).filter((llave) => llave.destino === 'academias');

    expect(primaria?.columnas).toEqual(['id']);
    expect(haciaAcademias.map((llave) => llave.columnas)).toEqual([['academia_id']]);
    expect(haciaAcademias[0]?.destinos).toEqual(['id']);
    expect(haciaAcademias[0]?.al_borrar, 'ON DELETE RESTRICT').toBe('r');
  });

  it('criterio 1: tiene UNIQUE (academia_id, id), (academia_id, id, alumno_id, fecha) y (academia_id, clave_idempotencia), ninguno global', async () => {
    const unicos = unicosDe(await indicesDe('asistencias'));

    expect(unicos).toEqual(
      expect.arrayContaining(['academia_id,id', 'academia_id,id,alumno_id,fecha', 'academia_id,clave_idempotencia']),
    );
    expect(unicos, 'la clave de idempotencia no puede ser única global').not.toContain('clave_idempotencia');
  });

  it('criterio 1: el único de la clave se llama asistencias_academia_id_clave_idempotencia_key (el 409 sale de su nombre)', async () => {
    const indice = (await indicesDe('asistencias')).find(
      (i) => i.nombre === 'asistencias_academia_id_clave_idempotencia_key',
    );

    expect(indice?.unico).toBe(true);
    expect(indice?.columnas).toEqual(['academia_id', 'clave_idempotencia']);
  });

  it("criterio 1: asistencias_un_dia_key es un único parcial sobre (academia_id, alumno_id, fecha) donde tipo <> 'PARTICULAR' (RN-16)", async () => {
    const indice = (await indicesDe('asistencias')).find((i) => i.nombre === 'asistencias_un_dia_key');

    expect(indice, 'falta el índice asistencias_un_dia_key').toBeDefined();
    expect(indice?.unico).toBe(true);
    expect(indice?.columnas).toEqual(['academia_id', 'alumno_id', 'fecha']);
    expect(indice?.parcial).toMatch(/tipo/);
    expect(indice?.parcial).toMatch(/PARTICULAR/);
    expect(indice?.parcial).toMatch(/<>|!=/);
  });

  /** Las llaves foráneas que no van a `academias`, como `columnas->destino(destinos)`. */
  const llavesDe = async (tabla: string) =>
    (await llavesForaneasDe(tabla))
      .filter((llave) => llave.destino !== 'academias')
      .map((llave) => `${llave.columnas.join(',')}->${llave.destino}(${llave.destinos.join(',')})`)
      .sort();

  it('criterio 1: toda referencia es una llave foránea compuesta (academia_id, …): la matrícula va junto con el alumno, y la clase apunta a clases (DT-7)', async () => {
    expect(await llavesDe('asistencias')).toEqual(
      [
        'academia_id,alumno_id->alumnos(academia_id,id)',
        'academia_id,matricula_id,alumno_id->matriculas(academia_id,id,alumno_id)',
        'academia_id,clase_id->clases(academia_id,id)',
        'academia_id,registrado_por->usuarios(academia_id,id)',
      ].sort(),
    );
  });

  it('criterio 1: matriculas ya tiene UNIQUE (academia_id, id, alumno_id) para esa llave (007)', async () => {
    expect(unicosDe(await indicesDe('matriculas'))).toContain('academia_id,id,alumno_id');
  });
});

describe('criterio 1: los tres CHECK existen con su nombre', () => {
  beforeEach(exigirTablaDeAsistencias);

  it('criterio 1: asistencias_fecha_de_lima, asistencias_registro_despues y asistencias_posterior_coherente son CHECK de la tabla', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT c.conname AS nombre, pg_catalog.pg_get_constraintdef(c.oid) AS definicion
         FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.asistencias'::regclass AND c.contype = 'c'`,
    );
    const porNombre = new Map((rows as { nombre: string; definicion: string }[]).map((f) => [f.nombre, f.definicion]));

    for (const nombre of [
      'asistencias_fecha_de_lima',
      'asistencias_registro_despues',
      'asistencias_posterior_coherente',
    ]) {
      expect(porNombre.has(nombre), `falta el CHECK ${nombre}`).toBe(true);
    }
    expect(porNombre.get('asistencias_fecha_de_lima'), 'la fecha es la de Lima, no la de la zona del servidor').toMatch(
      /America\/Lima/,
    );
  });
});

describe('criterio 1: RLS activada y forzada, y políticas', () => {
  beforeEach(exigirTablaDeAsistencias);

  it('criterio 1: asistencias tiene la RLS activada y forzada', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT relrowsecurity AS activada, relforcerowsecurity AS forzada FROM pg_catalog.pg_class
        WHERE oid = 'public.asistencias'::regclass`,
    );

    expect(rows).toEqual([{ activada: true, forzada: true }]);
  });

  it('criterio 1: asistencias tiene políticas con la forma exacta de la 001 (criterio 132): solo SELECT e INSERT, y ninguna de UPDATE ni de DELETE', async () => {
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
          WHERE n.nspname = 'public' AND c.relname = 'asistencias'`,
      );
      return rows as PoliticaLeida[];
    });

    // a = INSERT, r = SELECT, w = UPDATE, d = DELETE.
    expect(politicas.map((politica) => politica.comando).sort()).toEqual(['a', 'r']);
    expect(politicas.every((politica) => politica.permisiva)).toBe(true);
    expect(politicas.flatMap(problemasDeLaPolitica)).toEqual([]);
    for (const politica of politicas) {
      expect(`${politica.usando ?? ''} ${politica.comprobando ?? ''}`).toMatch(
        /academia_id\s*=\s*\(?\s*(SELECT )?\s*app_academia_actual\(\)/,
      );
    }
  });
});
