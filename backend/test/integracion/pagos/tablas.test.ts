// spec: 007-pagos (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { conTransaccionRevertida, ejecutarComo } from '../../utilidades/base-datos';
import { exigirTablaDePagos } from '../../utilidades/pagos';
import { type PoliticaLeida, problemasDeLaPolitica } from '../../utilidades/politicas';

// Criterio 1 (crítico, D-17, D-23; criterio 12 de 001; criterio 5 de 006): existe `pagos` con las columnas de «Cambios al modelo de datos», con
// `academia_id`, RLS activada y forzada, políticas de SELECT, INSERT y UPDATE con la forma exacta del criterio 132 de la 001 y sin DELETE, y
// `UNIQUE (academia_id, id)`. Sus referencias son llaves compuestas `(academia_id, …)`: a `matriculas` (junto con el alumno, para que el pago y
// su matrícula sean del mismo alumno), a `alumnos` y a `usuarios` (`registrado_por`, `verificado_por`). `movimientos_caja.pago_id` pasa a tener
// la llave compuesta `(academia_id, pago_id) → pagos (academia_id, id)`, diferida (`DEFERRABLE INITIALLY DEFERRED`). El tipo `estado_pago`; los
// índices del criterio 4 y los triggers de los criterios 5 y 6 existen con sus nombres, y sus funciones son `SECURITY INVOKER`, con `search_path`
// fijo y sin `EXECUTE` para PUBLIC. Todo con el catálogo; no depende de qué rol es el dueño de las tablas. Las pruebas de catálogo de la 001 y
// `TABLAS_DESPUES_DE_MIGRAR` las comprueban aparte (y el sembrador `public.pagos` de `sembradores.ts` las hace pasar por la prueba de RLS de
// todas las tablas).

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
const UUID_NULO: Regla = { tipo: /^uuid$/, obligatoria: false };
const TEXTO_NULO: Regla = { tipo: /^text$/, obligatoria: false };
const MARCA = /^timestamp(\(3\))? with time zone$/;

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
  diferible: boolean;
  diferida: boolean;
}

async function llavesForaneasDe(tabla: string): Promise<LlaveLeida[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT c.conname AS nombre, c.confdeltype::text AS al_borrar, c.condeferrable AS diferible, c.condeferred AS diferida,
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

describe('criterio 1: la tabla pagos existe', () => {
  it('criterio 1: pagos está en public', async () => {
    await exigirTablaDePagos();
  });
});

describe('criterio 1: tipo estado_pago', () => {
  beforeEach(exigirTablaDePagos);

  it('criterio 1: estado_pago tiene exactamente PENDIENTE_VERIFICACION, CONFIRMADO y RECHAZADO (sección 8.8)', async () => {
    expect(await valoresDe('estado_pago')).toEqual(['CONFIRMADO', 'PENDIENTE_VERIFICACION', 'RECHAZADO']);
  });

  it('criterio 1: se reutilizan metodo_pago y concepto_movimiento_caja de la 006, sin tocar sus valores', async () => {
    expect(await valoresDe('metodo_pago')).toEqual(['EFECTIVO', 'TRANSFERENCIA', 'YAPE']);
    expect(await valoresDe('concepto_movimiento_caja')).toEqual([
      'CLASE_PARTICULAR',
      'EGRESO_MENOR',
      'INSCRIPCION',
      'MENSUALIDAD',
    ]);
  });
});

describe('criterio 1: columnas', () => {
  beforeEach(exigirTablaDePagos);

  it('criterio 1: pagos tiene las columnas de «Cambios al modelo de datos»', async () => {
    comprobarColumnas(await columnasDe('pagos'), {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: UUID,
      alumno_id: UUID,
      matricula_id: UUID,
      concepto: { tipo: /concepto_movimiento_caja$/, obligatoria: true },
      metodo: { tipo: /metodo_pago$/, obligatoria: true },
      estado: { tipo: /estado_pago$/, obligatoria: true },
      monto: { tipo: /^numeric\(10,2\)$/, obligatoria: true },
      numero_operacion: TEXTO_NULO,
      numero_operacion_normalizado: TEXTO_NULO,
      fecha_operacion: { tipo: /^date$/, obligatoria: false },
      comprobante_clave: TEXTO_NULO,
      ip_origen: { tipo: /^inet$/, obligatoria: false },
      registrado_por: UUID_NULO,
      verificado_por: UUID_NULO,
      registrado_en: { tipo: MARCA, obligatoria: true },
      verificado_en: { tipo: MARCA, obligatoria: false },
      motivo_rechazo: TEXTO_NULO,
      numero_ticket: { tipo: /^integer$/, obligatoria: false },
      clave_idempotencia: UUID,
      creado_en: { tipo: /^timestamp(\(\d\))? with time zone$/ },
      actualizado_en: { tipo: /^timestamp(\(\d\))? with time zone$/ },
    });
  });

  it('criterio 7: solicitudes_inscripcion suma registrada_por (uuid, nula)', async () => {
    const columna = (await columnasDe('solicitudes_inscripcion')).get('registrada_por');

    expect(columna?.tipo).toBe('uuid');
    expect(columna?.obligatoria).toBe(false);
  });
});

describe('criterio 1: claves, índices y llaves foráneas', () => {
  beforeEach(exigirTablaDePagos);

  it('criterio 1: pagos tiene su clave primaria (id) y academia_id apunta a academias(id) con RESTRICT', async () => {
    const primaria = (await indicesDe('pagos')).find((indice) => indice.primaria);
    const haciaAcademias = (await llavesForaneasDe('pagos')).filter((llave) => llave.destino === 'academias');

    expect(primaria?.columnas).toEqual(['id']);
    expect(haciaAcademias.map((llave) => llave.columnas)).toEqual([['academia_id']]);
    expect(haciaAcademias[0]?.destinos).toEqual(['id']);
    expect(haciaAcademias[0]?.al_borrar, 'ON DELETE RESTRICT').toBe('r');
  });

  it('criterio 1: pagos tiene UNIQUE (academia_id, id), (academia_id, clave_idempotencia) y (academia_id, numero_ticket), ninguno global', async () => {
    const indices = await indicesDe('pagos');
    const unicos = unicosDe(indices);

    expect(unicos).toEqual(expect.arrayContaining(['academia_id,id', 'academia_id,clave_idempotencia']));
    expect(
      indices.some((i) => i.unico && i.columnas.join(',') === 'academia_id,numero_ticket'),
      'único (academia_id, numero_ticket): un número de ticket por academia',
    ).toBe(true);
    for (const global of ['clave_idempotencia', 'numero_ticket']) {
      expect(unicos, `${global} no puede ser único global`).not.toContain(global);
    }
  });

  it('criterio 4 f: índice único parcial pagos_un_abierto_por_matricula sobre (academia_id, matricula_id) donde el estado es PENDIENTE_VERIFICACION o CONFIRMADO', async () => {
    const indice = (await indicesDe('pagos')).find((i) => i.nombre === 'pagos_un_abierto_por_matricula');

    expect(indice?.unico).toBe(true);
    expect(indice?.columnas).toEqual(['academia_id', 'matricula_id']);
    expect(indice?.parcial).toMatch(/PENDIENTE_VERIFICACION/);
    expect(indice?.parcial).toMatch(/CONFIRMADO/);
    expect(indice?.parcial, 'un RECHAZADO no cuenta').not.toMatch(/RECHAZADO/);
  });

  it('criterio 4 g: índice único parcial pagos_numero_operacion_abierto_key sobre (academia_id, metodo, numero_operacion_normalizado) de los pagos abiertos con número', async () => {
    const indice = (await indicesDe('pagos')).find((i) => i.nombre === 'pagos_numero_operacion_abierto_key');

    expect(indice?.unico).toBe(true);
    expect(indice?.columnas).toEqual(['academia_id', 'metodo', 'numero_operacion_normalizado']);
    expect(indice?.parcial).toMatch(/PENDIENTE_VERIFICACION/);
    expect(indice?.parcial).toMatch(/CONFIRMADO/);
    expect(indice?.parcial).toMatch(/numero_operacion_normalizado IS NOT NULL/);
    expect(indice?.parcial, 'un RECHAZADO no cuenta').not.toMatch(/RECHAZADO/);
  });

  it('criterio 1: índice (academia_id, estado, registrado_en) para la bandeja', async () => {
    expect((await indicesDe('pagos')).map((i) => i.columnas.join(','))).toContain('academia_id,estado,registrado_en');
  });

  /** Las llaves foráneas que no van a `academias`, como `columnas->destino(destinos)`. */
  const llavesDe = async (tabla: string) =>
    (await llavesForaneasDe(tabla))
      .filter((llave) => llave.destino !== 'academias')
      .map((llave) => `${llave.columnas.join(',')}->${llave.destino}(${llave.destinos.join(',')})`)
      .sort();

  it('criterio 1: pagos: toda referencia es una llave foránea compuesta (academia_id, …); la matrícula va junto con el alumno', async () => {
    expect(await llavesDe('pagos')).toEqual(
      [
        'academia_id,alumno_id->alumnos(academia_id,id)',
        'academia_id,matricula_id,alumno_id->matriculas(academia_id,id,alumno_id)',
        'academia_id,registrado_por->usuarios(academia_id,id)',
        'academia_id,verificado_por->usuarios(academia_id,id)',
      ].sort(),
    );
  });

  it('criterio 1: matriculas suma UNIQUE (academia_id, id, alumno_id) para esa llave', async () => {
    expect(unicosDe(await indicesDe('matriculas'))).toContain('academia_id,id,alumno_id');
  });

  it('criterio 1 y 5: movimientos_caja.pago_id tiene la llave compuesta (academia_id, pago_id) -> pagos (academia_id, id), DEFERRABLE INITIALLY DEFERRED', async () => {
    const llave = (await llavesForaneasDe('movimientos_caja')).find((l) => l.destino === 'pagos');

    expect(llave?.columnas).toEqual(['academia_id', 'pago_id']);
    expect(llave?.destinos).toEqual(['academia_id', 'id']);
    expect(llave?.diferible, 'DEFERRABLE').toBe(true);
    expect(llave?.diferida, 'INITIALLY DEFERRED').toBe(true);
  });

  it('criterio 7: solicitudes_inscripcion: registrada_por tiene la llave compuesta (academia_id, registrada_por) -> usuarios (academia_id, id)', async () => {
    expect(await llavesDe('solicitudes_inscripcion')).toContain('academia_id,registrada_por->usuarios(academia_id,id)');
  });
});

describe('criterio 1: RLS activada y forzada, y políticas', () => {
  beforeEach(exigirTablaDePagos);

  it('criterio 1: pagos tiene la RLS activada y forzada', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT relrowsecurity AS activada, relforcerowsecurity AS forzada FROM pg_catalog.pg_class
        WHERE oid = 'public.pagos'::regclass`,
    );

    expect(rows).toEqual([{ activada: true, forzada: true }]);
  });

  it('criterio 1: pagos tiene políticas con la forma exacta de la 001 (criterio 132): SELECT, INSERT y UPDATE, y ninguna de DELETE', async () => {
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
          WHERE n.nspname = 'public' AND c.relname = 'pagos'`,
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

describe('criterio 1, 5 y 6: triggers y sus funciones', () => {
  beforeEach(exigirTablaDePagos);

  interface TriggerLeido {
    tabla: string;
    nombre: string;
    tipo: number;
    diferible: boolean;
    diferido: boolean;
    es_restriccion: boolean;
    funcion: string;
    security_definer: boolean;
    configuracion: string[] | null;
    ejecuta_public: boolean;
  }

  async function triggersDe(tabla: string): Promise<TriggerLeido[]> {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT c.relname AS tabla, t.tgname AS nombre, t.tgtype::int AS tipo, t.tgdeferrable AS diferible, t.tginitdeferred AS diferido,
              t.tgconstraint <> 0 AS es_restriccion, p.proname AS funcion, p.prosecdef AS security_definer, p.proconfig AS configuracion,
              coalesce((SELECT bool_or(a.grantee = 0) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), false) AS ejecuta_public
         FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
         JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
        WHERE c.oid = ('public.' || $1)::regclass AND NOT t.tgisinternal`,
      [tabla],
    );
    return rows as TriggerLeido[];
  }

  // tgtype: 1 = por fila, 2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE.
  const POR_FILA = 1;
  const ANTES = 2;
  const AL_INSERTAR = 4;
  const AL_ACTUALIZAR = 16;

  it('criterio 6: pagos tiene el trigger pagos_transiciones, BEFORE UPDATE por fila', async () => {
    const trigger = (await triggersDe('pagos')).find((t) => t.nombre === 'pagos_transiciones');

    expect(trigger, 'falta el trigger pagos_transiciones').toBeDefined();
    expect(trigger!.tipo & POR_FILA, 'por fila').toBeTruthy();
    expect(trigger!.tipo & ANTES, 'BEFORE').toBeTruthy();
    expect(trigger!.tipo & AL_ACTUALIZAR, 'UPDATE').toBeTruthy();
  });

  it.each(['pagos', 'movimientos_caja'])(
    'criterio 5: %s tiene el trigger de restricción pagos_confirmado_con_movimiento, por fila, DEFERRABLE INITIALLY DEFERRED',
    async (tabla) => {
      const trigger = (await triggersDe(tabla)).find((t) => t.nombre === 'pagos_confirmado_con_movimiento');

      expect(trigger, `falta el trigger pagos_confirmado_con_movimiento en ${tabla}`).toBeDefined();
      expect(trigger!.es_restriccion, 'trigger de restricción').toBe(true);
      expect(trigger!.diferible, 'DEFERRABLE').toBe(true);
      expect(trigger!.diferido, 'INITIALLY DEFERRED').toBe(true);
      expect(trigger!.tipo & POR_FILA, 'por fila').toBeTruthy();
      expect(trigger!.tipo & AL_INSERTAR, 'INSERT').toBeTruthy();
      if (tabla === 'pagos') expect(trigger!.tipo & AL_ACTUALIZAR, 'UPDATE').toBeTruthy();
    },
  );

  it('criterio 5 y 6: las funciones de los triggers son SECURITY INVOKER, con search_path fijo y sin EXECUTE para PUBLIC', async () => {
    const triggers = [...(await triggersDe('pagos')), ...(await triggersDe('movimientos_caja'))].filter((t) =>
      ['pagos_transiciones', 'pagos_confirmado_con_movimiento'].includes(t.nombre),
    );

    expect(triggers.length).toBeGreaterThanOrEqual(3);
    for (const trigger of triggers) {
      expect(trigger.security_definer, `${trigger.funcion} no es SECURITY DEFINER`).toBe(false);
      expect(
        (trigger.configuracion ?? []).some((valor) => /^search_path=/.test(valor)),
        `${trigger.funcion} fija su search_path`,
      ).toBe(true);
      expect(trigger.ejecuta_public, `${trigger.funcion}: REVOKE ALL … FROM PUBLIC`).toBe(false);
    }
  });
});
