// spec: 006-caja (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { conTransaccionRevertida, ejecutarComo } from '../../utilidades/base-datos';
import { exigirTablasDeCaja, TABLAS_006, type Tabla006 } from '../../utilidades/caja';
import { type PoliticaLeida, problemasDeLaPolitica } from '../../utilidades/politicas';

// Criterio 1 (crítico, D-17, D-23): existen `cajas`, `movimientos_caja` y `cierres_caja` con las columnas de "Cambios al modelo de datos",
// con `academia_id`, RLS activada y forzada, políticas de SELECT, INSERT y UPDATE (en `movimientos_caja`, solo SELECT e INSERT) con la
// forma exacta del criterio 132 de la 001, sin política de DELETE, UNIQUE (academia_id, id) en las tres, las llaves foráneas compuestas
// hacia `usuarios`, `alumnos` y `cajas`, y los índices únicos del criterio 5. Los tipos nuevos (`estado_caja`, `tipo_movimiento_caja`,
// `concepto_movimiento_caja` y `metodo_pago`). Todo con el catálogo; no depende de qué rol es el dueño de las tablas. Las pruebas de
// catálogo de la 001 y `TABLAS_DESPUES_DE_MIGRAR` las comprueban aparte (y los sembradores de `sembradores.ts` las hacen pasar por la
// prueba de RLS de todas las tablas).

interface ColumnaLeida {
  columna: string;
  tipo: string;
  obligatoria: boolean;
  por_defecto: string | null;
}

async function columnasDe(tabla: Tabla006): Promise<Map<string, ColumnaLeida>> {
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
  /** Si no se indica, la prueba no exige nada sobre la nulabilidad. */
  obligatoria?: boolean;
  porDefecto?: RegExp;
}

const UUID: Regla = { tipo: /^uuid$/, obligatoria: true };
const UUID_NULO: Regla = { tipo: /^uuid$/, obligatoria: false };
const TEXTO_NULO: Regla = { tipo: /^text$/, obligatoria: false };
const MARCA = /^timestamp(\(3\))? with time zone$/;
const FECHAS_DE_FILA: Record<string, Regla> = {
  creado_en: { tipo: /^timestamp(\(\d\))? with time zone$/ },
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

async function indicesDe(tabla: Tabla006): Promise<IndiceLeido[]> {
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
  columnas: string[];
  destino: string;
  destinos: string[];
  al_borrar: string;
}

async function llavesForaneasDe(tabla: Tabla006): Promise<LlaveLeida[]> {
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

const parcialesDe = (indices: IndiceLeido[]) =>
  indices.filter((i) => i.unico && i.parcial !== null).map((i) => ({ ...i, clave: i.columnas.join(',') }));

async function valoresDe(tipo: string): Promise<string[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT e.enumlabel AS valor FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1 AND t.typnamespace = 'public'::regnamespace ORDER BY e.enumlabel`,
    [tipo],
  );
  return (rows as { valor: string }[]).map((fila) => fila.valor);
}

describe('criterio 1: las tres tablas existen', () => {
  it('criterio 1: cajas, movimientos_caja y cierres_caja están en public', async () => {
    await exigirTablasDeCaja();
  });
});

describe('criterio 1: tipos nuevos', () => {
  beforeEach(exigirTablasDeCaja);

  it.each([
    ['estado_caja', ['ABIERTA', 'CERRADA']],
    ['tipo_movimiento_caja', ['EGRESO', 'INGRESO']],
    ['concepto_movimiento_caja', ['CLASE_PARTICULAR', 'EGRESO_MENOR', 'INSCRIPCION', 'MENSUALIDAD']],
    ['metodo_pago', ['EFECTIVO', 'TRANSFERENCIA', 'YAPE']],
  ])('criterio 1: el tipo %s tiene exactamente los valores del contrato', async (tipo, esperado) => {
    expect(await valoresDe(tipo)).toEqual(esperado);
  });
});

describe('criterio 1: columnas de cada tabla', () => {
  beforeEach(exigirTablasDeCaja);

  it('criterio 1: cajas', async () => {
    comprobarColumnas(await columnasDe('cajas'), {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: UUID,
      fecha: { tipo: /^date$/, obligatoria: true },
      estado: { tipo: /estado_caja$/, obligatoria: true, porDefecto: /'ABIERTA'/ },
      monto_inicial: { tipo: /^numeric\(10,2\)$/, obligatoria: true },
      abierta_por: UUID,
      abierta_en: { tipo: MARCA, obligatoria: true },
      clave_idempotencia: UUID,
      ...FECHAS_DE_FILA,
      actualizado_en: { tipo: /^timestamp(\(\d\))? with time zone$/ },
    });
  });

  it('criterio 1: movimientos_caja (sin actualizado_en: los movimientos no cambian)', async () => {
    const columnas = await columnasDe('movimientos_caja');

    comprobarColumnas(columnas, {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: UUID,
      caja_id: UUID,
      numero: { tipo: /^integer$/, obligatoria: true },
      tipo: { tipo: /tipo_movimiento_caja$/, obligatoria: true },
      concepto: { tipo: /concepto_movimiento_caja$/, obligatoria: true },
      metodo: { tipo: /metodo_pago$/, obligatoria: true },
      monto: { tipo: /^numeric\(10,2\)$/, obligatoria: true },
      descripcion: TEXTO_NULO,
      comprobante: TEXTO_NULO,
      alumno_id: UUID_NULO,
      pago_id: UUID_NULO,
      registrado_por: UUID,
      registrado_en: { tipo: MARCA, obligatoria: true },
      clave_idempotencia: UUID_NULO,
    });
    expect(columnas.has('actualizado_en'), 'los movimientos no llevan actualizado_en').toBe(false);
  });

  it('criterio 1: cierres_caja', async () => {
    const dinero: Regla = { tipo: /^numeric\(12,2\)$/, obligatoria: true };
    comprobarColumnas(await columnasDe('cierres_caja'), {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: UUID,
      caja_id: UUID,
      numero: { tipo: /^smallint$/, obligatoria: true },
      movimientos_hasta: { tipo: /^integer$/, obligatoria: true },
      monto_inicial: dinero,
      ingresos_efectivo: dinero,
      ingresos_yape: dinero,
      ingresos_transferencia: dinero,
      egresos_efectivo: dinero,
      esperado_efectivo: dinero,
      monto_declarado: dinero,
      diferencia: dinero,
      observacion: TEXTO_NULO,
      tardio: { tipo: /^boolean$/, obligatoria: true },
      cerrado_por: UUID,
      cerrado_en: { tipo: MARCA, obligatoria: true },
      clave_idempotencia: UUID,
      reabierto_por: UUID_NULO,
      reabierto_en: { tipo: MARCA, obligatoria: false },
      motivo_reapertura: TEXTO_NULO,
      ...FECHAS_DE_FILA,
    });
  });
});

describe('criterio 1: claves, índices y llaves foráneas', () => {
  beforeEach(exigirTablasDeCaja);

  it.each(TABLAS_006)('criterio 1: %s tiene su clave primaria (id)', async (tabla) => {
    const primaria = (await indicesDe(tabla)).find((indice) => indice.primaria);

    expect(primaria?.columnas).toEqual(['id']);
  });

  it.each(TABLAS_006)('criterio 1: %s: academia_id apunta a academias(id) con RESTRICT', async (tabla) => {
    const haciaAcademias = (await llavesForaneasDe(tabla)).filter((llave) => llave.destino === 'academias');

    expect(haciaAcademias.map((llave) => llave.columnas)).toEqual([['academia_id']]);
    expect(haciaAcademias[0]?.destinos).toEqual(['id']);
    expect(haciaAcademias[0]?.al_borrar, 'ON DELETE RESTRICT').toBe('r');
  });

  it.each(TABLAS_006)('criterio 1: %s tiene UNIQUE (academia_id, id)', async (tabla) => {
    expect(unicosDe(await indicesDe(tabla))).toContain('academia_id,id');
  });

  it('criterio 1: cajas: únicos por (academia_id, clave_idempotencia) y (academia_id, fecha), ninguno global', async () => {
    const indices = await indicesDe('cajas');
    const unicos = unicosDe(indices);

    expect(unicos).toEqual(expect.arrayContaining(['academia_id,clave_idempotencia', 'academia_id,fecha']));
    for (const global of ['clave_idempotencia', 'fecha']) {
      expect(unicos, `${global} no puede ser único global`).not.toContain(global);
    }
    expect(
      indices.find((i) => i.unico && i.columnas.join(',') === 'academia_id,fecha')?.nombre,
      'una caja por día (DR-1): el nombre que traduce la API',
    ).toBe('cajas_academia_id_fecha_key');
  });

  it('criterio 1: cajas: índice único parcial cajas_una_abierta_por_academia sobre (academia_id) donde estado = ABIERTA', async () => {
    const parcial = parcialesDe(await indicesDe('cajas')).filter((i) => i.nombre === 'cajas_una_abierta_por_academia');

    expect(parcial).toHaveLength(1);
    expect(parcial[0]?.clave).toBe('academia_id');
    expect(parcial[0]?.parcial).toMatch(/estado/);
    expect(parcial[0]?.parcial).toMatch(/ABIERTA/);
  });

  it('criterio 1: movimientos_caja: únicos (academia_id, caja_id, numero) y parciales por pago_id y por clave_idempotencia', async () => {
    const indices = await indicesDe('movimientos_caja');

    expect(unicosDe(indices)).toContain('academia_id,caja_id,numero');
    const parciales = parcialesDe(indices);
    const porPago = parciales.filter((i) => i.clave === 'academia_id,pago_id');
    const porClave = parciales.filter((i) => i.clave === 'academia_id,clave_idempotencia');
    expect(porPago, 'un pago entra una sola vez a la caja').toHaveLength(1);
    expect(porPago[0]?.parcial).toMatch(/pago_id IS NOT NULL/);
    expect(porClave, 'una clave de idempotencia por egreso').toHaveLength(1);
    expect(porClave[0]?.parcial).toMatch(/clave_idempotencia IS NOT NULL/);
  });

  it('criterio 1: cierres_caja: únicos (academia_id, caja_id, numero) y (academia_id, clave_idempotencia) e índice parcial cierres_caja_un_vigente_por_caja', async () => {
    const indices = await indicesDe('cierres_caja');
    const unicos = unicosDe(indices);

    expect(unicos).toEqual(expect.arrayContaining(['academia_id,caja_id,numero', 'academia_id,clave_idempotencia']));
    expect(unicos, 'la clave no puede ser única global').not.toContain('clave_idempotencia');
    const vigente = parcialesDe(indices).filter((i) => i.nombre === 'cierres_caja_un_vigente_por_caja');
    expect(vigente).toHaveLength(1);
    expect(vigente[0]?.clave).toBe('academia_id,caja_id');
    expect(vigente[0]?.parcial).toMatch(/reabierto_en IS NULL/);
  });

  /** Las llaves foráneas que no van a `academias`, como `columnas->destino(destinos)`. */
  const llavesDe = async (tabla: Tabla006) =>
    (await llavesForaneasDe(tabla))
      .filter((llave) => llave.destino !== 'academias')
      .map((llave) => `${llave.columnas.join(',')}->${llave.destino}(${llave.destinos.join(',')})`)
      .sort();

  it.each([
    ['cajas', ['academia_id,abierta_por->usuarios(academia_id,id)']],
    [
      'movimientos_caja',
      [
        'academia_id,alumno_id->alumnos(academia_id,id)',
        'academia_id,caja_id->cajas(academia_id,id)',
        'academia_id,registrado_por->usuarios(academia_id,id)',
      ],
    ],
    [
      'cierres_caja',
      [
        'academia_id,caja_id->cajas(academia_id,id)',
        'academia_id,cerrado_por->usuarios(academia_id,id)',
        'academia_id,reabierto_por->usuarios(academia_id,id)',
      ],
    ],
  ] as const)(
    'criterio 1: %s: toda referencia es una llave foránea compuesta (academia_id, …) hacia (academia_id, id); pago_id no tiene llave (la agrega la 007)',
    async (tabla, esperadas) => {
      expect(await llavesDe(tabla)).toEqual([...esperadas].sort());
    },
  );
});

describe('criterio 1: RLS activada y forzada, y políticas', () => {
  beforeEach(exigirTablasDeCaja);

  it.each(TABLAS_006)('criterio 1: %s tiene la RLS activada y forzada', async (tabla) => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT relrowsecurity AS activada, relforcerowsecurity AS forzada FROM pg_catalog.pg_class
        WHERE oid = ('public.' || $1)::regclass`,
      [tabla],
    );

    expect(rows).toEqual([{ activada: true, forzada: true }]);
  });

  it.each(TABLAS_006)(
    'criterio 1: %s tiene políticas con la forma exacta de la 001 (criterio 132): SELECT, INSERT y UPDATE (movimientos_caja, solo SELECT e INSERT) y ninguna de DELETE',
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
      const esperados = tabla === 'movimientos_caja' ? ['a', 'r'] : ['a', 'r', 'w'];
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
