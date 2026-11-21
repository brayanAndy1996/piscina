// spec: 005-inscripcion-publica (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { conTransaccionRevertida, ejecutarComo } from '../../utilidades/base-datos';
import { exigirTablasDeInscripcion, TABLAS_005, type Tabla005 } from '../../utilidades/inscripciones';
import { problemasDeLaPolitica, type PoliticaLeida } from '../../utilidades/politicas';

// Criterio 1 (crítico, D-17, D-23): existen `alumnos`, `apoderados`, `fichas_medicas`, `consentimientos`, `solicitudes_inscripcion`,
// `matriculas` y `matricula_clases`, con las columnas de "Cambios al modelo de datos", con `academia_id`, RLS activada y forzada,
// políticas de SELECT, INSERT y UPDATE con la forma exacta del criterio 132 de la 001 (y de DELETE solo en `apoderados`),
// UNIQUE (academia_id, id) en las que reciben llaves y toda referencia entre ellas y hacia `planes`, `clases` y `usuarios` como llave
// foránea compuesta (academia_id, …) -> (academia_id, id). Los tipos nuevos y el valor PUBLICO de `tipo_actor` (DT-2). Todo con el
// catálogo; no depende de qué rol es el dueño de las tablas. Las pruebas de catálogo de la 001 y TABLAS_DESPUES_DE_MIGRAR las comprueban
// aparte (y los sembradores de `sembradores.ts` las hacen pasar por la prueba de RLS de todas las tablas).

interface ColumnaLeida {
  columna: string;
  tipo: string;
  obligatoria: boolean;
  por_defecto: string | null;
}

async function columnasDe(tabla: Tabla005): Promise<Map<string, ColumnaLeida>> {
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

const TIMESTAMPTZ = /^timestamp(\(\d\))? with time zone$/;
const FECHAS: Record<string, Regla> = {
  creado_en: { tipo: TIMESTAMPTZ, obligatoria: true },
  actualizado_en: { tipo: TIMESTAMPTZ, obligatoria: true },
};

/**
 * Las columnas de la spec deben existir con su tipo y su nulabilidad; cualquier columna de más debe poder omitirse al insertar
 * (nula o con valor por defecto), para no exigir datos que la spec no pide.
 */
function comprobarColumnas(columnas: Map<string, ColumnaLeida>, esperado: Record<string, Regla>): void {
  for (const [nombre, regla] of Object.entries(esperado)) {
    const columna = columnas.get(nombre);
    expect(columna, `falta la columna ${nombre}`).toBeDefined();
    expect(columna?.tipo, `tipo de ${nombre}`).toMatch(regla.tipo);
    expect(columna?.obligatoria, `${nombre} obligatoria`).toBe(regla.obligatoria);
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
  unico: boolean;
  primaria: boolean;
  parcial: string | null;
  columnas: string[];
  definicion: string;
}

async function indicesDe(tabla: Tabla005): Promise<IndiceLeido[]> {
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

interface LlaveLeida {
  columnas: string[];
  destino: string;
  destinos: string[];
  al_borrar: string;
}

async function llavesForaneasDe(tabla: Tabla005): Promise<LlaveLeida[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT c.confdeltype::text AS al_borrar, regexp_replace(c.confrelid::regclass::text, '^public\\.', '') AS destino,
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

describe('criterio 1: las siete tablas existen', () => {
  it('criterio 1: alumnos, apoderados, fichas_medicas, consentimientos, solicitudes_inscripcion, matriculas y matricula_clases están en public', async () => {
    await exigirTablasDeInscripcion();
  });
});

describe('criterio 1: columnas de cada tabla', () => {
  beforeEach(exigirTablasDeInscripcion);

  it('criterio 1: alumnos', async () => {
    comprobarColumnas(await columnasDe('alumnos'), {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      dni: { tipo: /^text$/, obligatoria: true },
      nombres: { tipo: /^text$/, obligatoria: true },
      apellidos: { tipo: /^text$/, obligatoria: true },
      fecha_nacimiento: { tipo: /^date$/, obligatoria: true },
      telefono: { tipo: /^text$/, obligatoria: true },
      correo: { tipo: /^text$/, obligatoria: false },
      direccion: { tipo: /^text$/, obligatoria: false },
      grado_colegio: { tipo: /grado_colegio$/, obligatoria: false },
      nivel: { tipo: /nivel_natacion$/, obligatoria: true },
      foto_clave: { tipo: /^text$/, obligatoria: false },
      estado: { tipo: /estado_alumno$/, obligatoria: true, porDefecto: /'CLIENTE'/ },
      usuario_id: { tipo: /^uuid$/, obligatoria: false },
      ...FECHAS,
    });
  });

  it('criterio 1: apoderados', async () => {
    comprobarColumnas(await columnasDe('apoderados'), {
      alumno_id: { tipo: /^uuid$/, obligatoria: true },
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      nombres: { tipo: /^text$/, obligatoria: true },
      apellidos: { tipo: /^text$/, obligatoria: true },
      dni: { tipo: /^text$/, obligatoria: true },
      telefono: { tipo: /^text$/, obligatoria: true },
      parentesco: { tipo: /parentesco$/, obligatoria: true },
      correo: { tipo: /^text$/, obligatoria: false },
      ...FECHAS,
    });
  });

  it('criterio 1: fichas_medicas', async () => {
    comprobarColumnas(await columnasDe('fichas_medicas'), {
      alumno_id: { tipo: /^uuid$/, obligatoria: true },
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      tipo_sangre: { tipo: /tipo_sangre$/, obligatoria: true },
      enfermedades: { tipo: /^text$/, obligatoria: false },
      alergias: { tipo: /^text$/, obligatoria: false },
      medicamentos: { tipo: /^text$/, obligatoria: false },
      seguro: { tipo: /^text$/, obligatoria: false },
      contacto_emergencia_nombre: { tipo: /^text$/, obligatoria: true },
      contacto_emergencia_telefono: { tipo: /^text$/, obligatoria: true },
      ...FECHAS,
    });
  });

  it('criterio 1: consentimientos (solo evidencia: columnas de la spec)', async () => {
    comprobarColumnas(await columnasDe('consentimientos'), {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      alumno_id: { tipo: /^uuid$/, obligatoria: true },
      solicitud_id: { tipo: /^uuid$/, obligatoria: true },
      tipo: { tipo: /tipo_consentimiento$/, obligatoria: true },
      version: { tipo: /^text$/, obligatoria: true },
      aceptado_en: { tipo: TIMESTAMPTZ, obligatoria: true },
      ip: { tipo: /^inet$/, obligatoria: false },
      otorgado_por: { tipo: /otorgante_consentimiento$/, obligatoria: true },
      aceptado: { tipo: /^boolean$/, obligatoria: true },
    });
  });

  it('criterio 1: solicitudes_inscripcion', async () => {
    comprobarColumnas(await columnasDe('solicitudes_inscripcion'), {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      alumno_id: { tipo: /^uuid$/, obligatoria: true },
      codigo: { tipo: /^text$/, obligatoria: true },
      token_hash: { tipo: /^bytea$/, obligatoria: true },
      clave_idempotencia: { tipo: /^uuid$/, obligatoria: true },
      estado: { tipo: /estado_solicitud$/, obligatoria: true, porDefecto: /'PENDIENTE_PAGO'/ },
      ip_origen: { tipo: /^inet$/, obligatoria: false },
      ...FECHAS,
    });
  });

  it('criterio 1: matriculas', async () => {
    comprobarColumnas(await columnasDe('matriculas'), {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      alumno_id: { tipo: /^uuid$/, obligatoria: true },
      plan_id: { tipo: /^uuid$/, obligatoria: true },
      solicitud_id: { tipo: /^uuid$/, obligatoria: false },
      anio: { tipo: /^smallint$/, obligatoria: true },
      mes: { tipo: /^smallint$/, obligatoria: true },
      fecha_inicio: { tipo: /^date$/, obligatoria: true },
      fecha_fin: { tipo: /^date$/, obligatoria: true },
      clases_totales: { tipo: /^smallint$/, obligatoria: true },
      clases_usadas: { tipo: /^smallint$/, obligatoria: true, porDefecto: /^0$/ },
      es_proporcional: { tipo: /^boolean$/, obligatoria: true },
      precio_plan: { tipo: /^numeric\(10,2\)$/, obligatoria: true },
      clases_por_mes_plan: { tipo: /^smallint$/, obligatoria: true },
      monto_calculado: { tipo: /^numeric\(10,2\)$/, obligatoria: true },
      monto_ajustado: { tipo: /^numeric\(10,2\)$/, obligatoria: false },
      motivo_ajuste: { tipo: /^text$/, obligatoria: false },
      estado: { tipo: /estado_matricula$/, obligatoria: true },
      reserva_vence_en: { tipo: TIMESTAMPTZ, obligatoria: false },
      ...FECHAS,
    });
  });

  it('criterio 1: matricula_clases', async () => {
    comprobarColumnas(await columnasDe('matricula_clases'), {
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      matricula_id: { tipo: /^uuid$/, obligatoria: true },
      clase_id: { tipo: /^uuid$/, obligatoria: true },
    });
  });
});

describe('criterio 1: tipos enumerados', () => {
  beforeEach(exigirTablasDeInscripcion);

  async function valoresDe(tipo: string): Promise<string[]> {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT e.enumlabel AS valor
         FROM pg_catalog.pg_type t
         JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
         JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = $1
        ORDER BY e.enumlabel`,
      [tipo],
    );
    return (rows as { valor: string }[]).map((fila) => fila.valor);
  }

  it.each([
    ['estado_alumno', ['ALUMNO_ACTIVO', 'ALUMNO_VENCIDO', 'CLIENTE', 'INACTIVO']],
    ['estado_solicitud', ['CANCELADA', 'PENDIENTE_PAGO', 'VENCIDA']],
    ['estado_matricula', ['CANCELADA', 'FINALIZADA', 'RESERVADA', 'VIGENTE']],
    ['tipo_consentimiento', ['DATOS_PERSONALES', 'DESLINDE', 'IMAGEN']],
    ['otorgante_consentimiento', ['APODERADO', 'TITULAR']],
  ])('criterio 1: el tipo %s tiene exactamente los valores del contrato', async (tipo, esperado) => {
    expect(await valoresDe(tipo)).toEqual(esperado);
  });

  it.each(['tipo_sangre', 'grado_colegio', 'parentesco'])(
    'criterio 1: el tipo %s existe y tiene al menos un valor (las listas son las de N5)',
    async (tipo) => {
      expect((await valoresDe(tipo)).length).toBeGreaterThan(0);
    },
  );

  it('criterio 1: tipo_actor suma PUBLICO (DT-2) sin quitar USUARIO, SUPERADMIN ni SISTEMA', async () => {
    expect(await valoresDe('tipo_actor')).toEqual(
      expect.arrayContaining(['PUBLICO', 'SISTEMA', 'SUPERADMIN', 'USUARIO']),
    );
  });
});

describe('criterio 1: claves, índices y llaves foráneas', () => {
  beforeEach(exigirTablasDeInscripcion);

  it.each([
    ['alumnos', ['id']],
    // El criterio 126 de la 001 exige `academia_id` en toda llave primaria que no sea solo `id uuid gen_random_uuid()`: la spec dice
    // "`alumno_id` PK", y esa PK es (academia_id, alumno_id), igual que la de `matricula_clases`.
    ['apoderados', ['academia_id', 'alumno_id']],
    ['fichas_medicas', ['academia_id', 'alumno_id']],
    ['consentimientos', ['id']],
    ['solicitudes_inscripcion', ['id']],
    ['matriculas', ['id']],
    ['matricula_clases', ['academia_id', 'matricula_id', 'clase_id']],
  ] as const)('criterio 1: %s tiene su clave primaria', async (tabla, columnas) => {
    const primaria = (await indicesDe(tabla)).find((indice) => indice.primaria);

    expect([...(primaria?.columnas ?? [])].sort()).toEqual([...columnas].sort());
  });

  it.each(TABLAS_005)('criterio 1: %s: academia_id apunta a academias(id) con RESTRICT', async (tabla) => {
    const haciaAcademias = (await llavesForaneasDe(tabla)).filter((llave) => llave.destino === 'academias');

    expect(haciaAcademias.map((llave) => llave.columnas)).toEqual([['academia_id']]);
    expect(haciaAcademias[0]?.destinos).toEqual(['id']);
    expect(haciaAcademias[0]?.al_borrar, 'ON DELETE RESTRICT').toBe('r');
  });

  // P5: `consentimientos` también lleva UNIQUE (academia_id, id), como exige el catálogo de la 001 (criterios 12 y 131).
  it.each(['alumnos', 'consentimientos', 'solicitudes_inscripcion', 'matriculas'] as const)(
    'criterio 1: %s tiene UNIQUE (academia_id, id) (llaves compuestas y criterio 131 de la 001)',
    async (tabla) => {
      expect(unicosDe(await indicesDe(tabla))).toContain('academia_id,id');
    },
  );

  it('criterio 1: alumnos: UNIQUE (academia_id, dni) y el DNI no es único global (D-28)', async () => {
    const unicos = unicosDe(await indicesDe('alumnos'));

    expect(unicos).toContain('academia_id,dni');
    expect(unicos, 'el DNI no puede ser único global').not.toContain('dni');
  });

  it('criterio 1: solicitudes_inscripcion: únicos por (academia_id, codigo), (academia_id, token_hash) y (academia_id, clave_idempotencia)', async () => {
    const unicos = unicosDe(await indicesDe('solicitudes_inscripcion'));

    expect(unicos).toEqual(
      expect.arrayContaining(['academia_id,codigo', 'academia_id,token_hash', 'academia_id,clave_idempotencia']),
    );
    for (const global of ['codigo', 'token_hash', 'clave_idempotencia']) {
      expect(unicos, `${global} no puede ser único global`).not.toContain(global);
    }
  });

  it('criterio 1: solicitudes_inscripcion: índice único parcial (academia_id, alumno_id) donde estado = PENDIENTE_PAGO e índice (academia_id, ip_origen, estado)', async () => {
    const indices = await indicesDe('solicitudes_inscripcion');

    const parcial = indices.filter(
      (i) => i.unico && i.parcial !== null && i.columnas.join(',') === 'academia_id,alumno_id',
    );
    expect(parcial, 'índice único parcial de la solicitud activa').toHaveLength(1);
    expect(parcial[0]?.parcial).toMatch(/PENDIENTE_PAGO/);
    expect(indices.map((i) => i.columnas.join(','))).toContain('academia_id,ip_origen,estado');
  });

  it('criterio 1: matriculas: índice único parcial (academia_id, alumno_id, anio, mes) sobre RESERVADA y VIGENTE e índice (academia_id, anio, mes, estado)', async () => {
    const indices = await indicesDe('matriculas');

    const parcial = indices.filter(
      (i) => i.unico && i.parcial !== null && i.columnas.join(',') === 'academia_id,alumno_id,anio,mes',
    );
    expect(parcial, 'índice único parcial de la matrícula que ocupa cupo').toHaveLength(1);
    expect(parcial[0]?.parcial).toMatch(/RESERVADA/);
    expect(parcial[0]?.parcial).toMatch(/VIGENTE/);
    expect(parcial[0]?.parcial, 'FINALIZADA y CANCELADA no entran').not.toMatch(/CANCELADA|FINALIZADA/);
    expect(indices.map((i) => i.columnas.join(','))).toContain('academia_id,anio,mes,estado');
  });

  it('criterio 1: matricula_clases: índice (academia_id, clase_id) para contar la ocupación', async () => {
    expect((await indicesDe('matricula_clases')).map((i) => i.columnas.join(','))).toContain('academia_id,clase_id');
  });

  /** Las llaves foráneas que no van a `academias`, como `columnas->destino(destinos)`. */
  const llavesDe = async (tabla: Tabla005) =>
    (await llavesForaneasDe(tabla))
      .filter((llave) => llave.destino !== 'academias')
      .map((llave) => `${llave.columnas.join(',')}->${llave.destino}(${llave.destinos.join(',')})`)
      .sort();

  it.each([
    ['alumnos', ['academia_id,usuario_id->usuarios(academia_id,id)']],
    ['apoderados', ['academia_id,alumno_id->alumnos(academia_id,id)']],
    ['fichas_medicas', ['academia_id,alumno_id->alumnos(academia_id,id)']],
    [
      'consentimientos',
      [
        'academia_id,alumno_id->alumnos(academia_id,id)',
        'academia_id,solicitud_id->solicitudes_inscripcion(academia_id,id)',
      ],
    ],
    ['solicitudes_inscripcion', ['academia_id,alumno_id->alumnos(academia_id,id)']],
    [
      'matriculas',
      [
        'academia_id,alumno_id->alumnos(academia_id,id)',
        'academia_id,plan_id->planes(academia_id,id)',
        'academia_id,solicitud_id->solicitudes_inscripcion(academia_id,id)',
      ],
    ],
    [
      'matricula_clases',
      ['academia_id,clase_id->clases(academia_id,id)', 'academia_id,matricula_id->matriculas(academia_id,id)'],
    ],
  ] as const)(
    'criterio 1: %s: toda referencia es una llave foránea compuesta (academia_id, …) hacia (academia_id, id)',
    async (tabla, esperadas) => {
      expect(await llavesDe(tabla)).toEqual([...esperadas].sort());
    },
  );
});

describe('criterio 1: RLS activada y forzada, y políticas', () => {
  beforeEach(exigirTablasDeInscripcion);

  it.each(TABLAS_005)('criterio 1: %s tiene la RLS activada y forzada', async (tabla) => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT relrowsecurity AS activada, relforcerowsecurity AS forzada FROM pg_catalog.pg_class
        WHERE oid = ('public.' || $1)::regclass`,
      [tabla],
    );

    expect(rows).toEqual([{ activada: true, forzada: true }]);
  });

  it.each(TABLAS_005)(
    'criterio 1: %s tiene políticas con la forma exacta de la 001 (criterio 132) y solo las de SELECT, INSERT y UPDATE (más DELETE en apoderados)',
    async (tabla) => {
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

      // a = INSERT, r = SELECT, w = UPDATE, d = DELETE.
      const esperados = tabla === 'apoderados' ? ['a', 'd', 'r', 'w'] : ['a', 'r', 'w'];
      expect(politicas.map((politica) => politica.comando).sort()).toEqual(esperados);
      expect(politicas.every((politica) => politica.permisiva)).toBe(true);
      expect(politicas.flatMap(problemasDeLaPolitica)).toEqual([]);
      for (const politica of politicas) {
        expect(`${politica.usando ?? ''} ${politica.comprobando ?? ''}`).toMatch(
          /academia_id\s*=\s*\(?\s*(SELECT )?\s*app_academia_actual\(\)/,
        );
      }
    },
  );
});
