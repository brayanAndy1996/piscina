// spec: 002-autenticacion-roles (pruebas protegidas)
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { conTransaccionRevertida, ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { problemasDeLaPolitica, type PoliticaLeida } from '../../utilidades/politicas';
import { crearUsuarioDePrueba, dniInventado, hashDeClave, leerUsuario } from '../../utilidades/usuarios';

// Criterio 1 (tabla `usuarios`, RLS, políticas, unicidad), criterio 2 (privilegios exactos de `aquagestion_app`) y criterio 4
// (aislamiento por RLS), todos con el catálogo y con conexiones reales de PostgreSQL. No depende de qué rol es el dueño de las
// tablas (superusuario o no): las lecturas de catálogo y las preparaciones se hacen como dueño con el contexto de la academia, y
// lo que importa para RLS se prueba con el rol de la app.

const COLUMNAS_UPDATE_DE_LA_APP = [
  'actualizado_en',
  'bloqueado_hasta',
  'clave_hash',
  'debe_cambiar_clave',
  'estado',
  'intentos_fallidos',
  'ultimo_acceso',
  'version_token',
];

async function tablaExiste(): Promise<boolean> {
  const { rows } = await ejecutarComo(
    'propietario',
    "SELECT pg_catalog.to_regclass('public.usuarios') IS NOT NULL AS existe",
  );
  return (rows[0] as { existe: boolean }).existe;
}

/** Falla con un mensaje claro si la migración de la 002 todavía no creó la tabla. */
async function exigirTabla(): Promise<void> {
  expect(await tablaExiste(), 'Falta la funcionalidad de la 002: la tabla public.usuarios no existe').toBe(true);
}

describe('criterio 1: la tabla usuarios', () => {
  it('criterio 1: existe con las columnas, tipos, nulabilidad y valores por defecto del modelo de datos', async () => {
    await exigirTabla();

    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT a.attname AS columna, pg_catalog.format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS obligatoria,
              pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS por_defecto
         FROM pg_catalog.pg_attribute a
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = 'public.usuarios'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attname`,
    );
    const columnas = new Map(
      (rows as { columna: string; tipo: string; obligatoria: boolean; por_defecto: string | null }[]).map((fila) => [
        fila.columna,
        fila,
      ]),
    );

    expect([...columnas.keys()].sort()).toEqual(
      [
        'academia_id',
        'actualizado_en',
        'apellidos',
        'bloqueado_hasta',
        'clave_hash',
        'creado_en',
        'debe_cambiar_clave',
        'dni',
        'estado',
        'id',
        'intentos_fallidos',
        'nombres',
        'rol',
        'ultimo_acceso',
        'version_token',
      ].sort(),
    );
    const esperado: Record<string, { tipo: RegExp; obligatoria: boolean; porDefecto?: RegExp }> = {
      id: { tipo: /^uuid$/, obligatoria: true, porDefecto: /gen_random_uuid\(\)/ },
      academia_id: { tipo: /^uuid$/, obligatoria: true },
      dni: { tipo: /^text$/, obligatoria: true },
      nombres: { tipo: /^text$/, obligatoria: true },
      apellidos: { tipo: /^text$/, obligatoria: true },
      rol: { tipo: /rol_usuario$/, obligatoria: true },
      clave_hash: { tipo: /^text$/, obligatoria: true },
      debe_cambiar_clave: { tipo: /^boolean$/, obligatoria: true, porDefecto: /^true$/ },
      estado: { tipo: /estado_usuario$/, obligatoria: true, porDefecto: /'ACTIVO'/ },
      version_token: { tipo: /^integer$/, obligatoria: true, porDefecto: /^0$/ },
      intentos_fallidos: { tipo: /^integer$/, obligatoria: true, porDefecto: /^0$/ },
      bloqueado_hasta: { tipo: /^timestamp(\(\d\))? with time zone$/, obligatoria: false },
      ultimo_acceso: { tipo: /^timestamp(\(\d\))? with time zone$/, obligatoria: false },
      creado_en: { tipo: /^timestamp(\(\d\))? with time zone$/, obligatoria: true },
      actualizado_en: { tipo: /^timestamp(\(\d\))? with time zone$/, obligatoria: true },
    };
    for (const [nombre, regla] of Object.entries(esperado)) {
      const columna = columnas.get(nombre);
      expect(columna?.tipo, `tipo de ${nombre}`).toMatch(regla.tipo);
      expect(columna?.obligatoria, `${nombre} obligatoria`).toBe(regla.obligatoria);
      if (regla.porDefecto) expect(columna?.por_defecto, `valor por defecto de ${nombre}`).toMatch(regla.porDefecto);
    }
  });

  it('criterio 1: los tipos rol_usuario y estado_usuario tienen los valores del contrato', async () => {
    await exigirTabla();

    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT t.typname AS tipo, e.enumlabel AS valor
         FROM pg_catalog.pg_type t
         JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
         JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname IN ('rol_usuario', 'estado_usuario')
        ORDER BY t.typname, e.enumlabel`,
    );

    const porTipo: Record<string, string[]> = {};
    for (const fila of rows as { tipo: string; valor: string }[]) (porTipo[fila.tipo] ??= []).push(fila.valor);
    expect(porTipo['rol_usuario']).toEqual(['ADMIN', 'ALUMNO', 'ENTRENADOR', 'SECRETARIA']);
    expect(porTipo['estado_usuario']).toEqual(['ACTIVO', 'INACTIVO']);
  });

  it('criterio 1: academia_id apunta a academias(id) con RESTRICT', async () => {
    await exigirTabla();

    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT c.confdeltype::text AS al_borrar, c.confupdtype::text AS al_cambiar,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)::text[] FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columnas,
              c.confrelid::regclass::text AS destino
         FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = 'public.usuarios'::regclass AND c.contype = 'f'`,
    );

    const hacia = (rows as { al_borrar: string; al_cambiar: string; columnas: string[]; destino: string }[]).filter(
      (fila) => fila.destino === 'academias' || fila.destino === 'public.academias',
    );
    expect(hacia.map((fila) => fila.columnas)).toContainEqual(['academia_id']);
    for (const fila of hacia) {
      expect(fila.al_borrar, 'ON DELETE RESTRICT (r) o NO ACTION (a)').toMatch(/^[ra]$/);
    }
    expect(hacia.find((fila) => fila.columnas.join() === 'academia_id')?.al_borrar).toBe('r');
  });

  it('criterio 1: tiene UNIQUE (academia_id, id), UNIQUE (academia_id, dni), clave primaria en id e índice (academia_id, rol, apellidos, nombres)', async () => {
    await exigirTabla();

    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT i.indisunique AS unico, i.indisprimary AS primaria,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)::text[]
                 FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS columnas
         FROM pg_catalog.pg_index i WHERE i.indrelid = 'public.usuarios'::regclass`,
    );
    const indices = rows as { unico: boolean; primaria: boolean; columnas: string[] }[];
    const unicos = indices.filter((indice) => indice.unico).map((indice) => indice.columnas.join(','));

    expect(indices.find((indice) => indice.primaria)?.columnas).toEqual(['id']);
    expect(unicos).toContain('academia_id,id');
    expect(unicos).toContain('academia_id,dni');
    expect(
      unicos.filter((columnas) => columnas === 'dni'),
      'el DNI no puede ser único global (D-28)',
    ).toEqual([]);
    expect(indices.map((indice) => indice.columnas.join(','))).toContain('academia_id,rol,apellidos,nombres');
  });

  it('criterio 1: el DNI debe tener exactamente 8 dígitos (CHECK en la base)', async () => {
    await exigirTabla();
    await limpiarBase();
    const academia = await crearAcademiaDePrueba();

    for (const invalido of [
      '1234567',
      '123456789',
      '1234567a',
      ' 12345678',
      '12345678 ',
      '12345678\n',
      '１２３４５６７８',
      '',
    ]) {
      await expect(
        crearUsuarioDePrueba({ academiaId: academia.id, rol: 'ADMIN', dni: invalido, clave: 'clave-de-prueba-1' }),
        `DNI ${JSON.stringify(invalido)}`,
      ).rejects.toMatchObject({ code: '23514' });
    }
    const conCeros = await crearUsuarioDePrueba({ academiaId: academia.id, rol: 'ADMIN', dni: '01234567' });
    expect((await leerUsuario(academia.id, conCeros.id))?.dni).toBe('01234567');
  });

  it('criterio 1: el mismo DNI dos veces en la misma academia falla con 23505; en otra academia se permite (D-28)', async () => {
    await exigirTabla();
    await limpiarBase();
    const A = await crearAcademiaDePrueba();
    const B = await crearAcademiaDePrueba();
    const dni = dniInventado();
    await crearUsuarioDePrueba({ academiaId: A.id, rol: 'ADMIN', dni });

    await expect(crearUsuarioDePrueba({ academiaId: A.id, rol: 'SECRETARIA', dni })).rejects.toMatchObject({
      code: '23505',
    });
    const enB = await crearUsuarioDePrueba({ academiaId: B.id, rol: 'ADMIN', dni });

    expect((await leerUsuario(B.id, enB.id))?.dni).toBe(dni);
  });

  it('criterio 1: la RLS está activada y forzada', async () => {
    await exigirTabla();

    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT relrowsecurity AS activada, relforcerowsecurity AS forzada FROM pg_catalog.pg_class
        WHERE oid = 'public.usuarios'::regclass`,
    );

    expect(rows).toEqual([{ activada: true, forzada: true }]);
  });

  it('criterio 1: tiene políticas de SELECT, INSERT y UPDATE con la forma exacta de la 001 (criterio 132) y ninguna de DELETE ni ALL', async () => {
    await exigirTabla();

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
          WHERE n.nspname = 'public' AND c.relname = 'usuarios'`,
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

describe('criterio 2: privilegios exactos de aquagestion_app sobre usuarios', () => {
  const ROL = 'aquagestion_app';

  it('criterio 2: sobre la tabla tiene exactamente SELECT e INSERT (sin UPDATE de tabla entera, DELETE, TRUNCATE, REFERENCES ni TRIGGER)', async () => {
    await exigirTabla();

    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT pg_catalog.has_table_privilege($1::name, 'public.usuarios', 'SELECT') AS "SELECT",
              pg_catalog.has_table_privilege($1::name, 'public.usuarios', 'INSERT') AS "INSERT",
              pg_catalog.has_table_privilege($1::name, 'public.usuarios', 'UPDATE') AS "UPDATE",
              pg_catalog.has_table_privilege($1::name, 'public.usuarios', 'DELETE') AS "DELETE",
              pg_catalog.has_table_privilege($1::name, 'public.usuarios', 'TRUNCATE') AS "TRUNCATE",
              pg_catalog.has_table_privilege($1::name, 'public.usuarios', 'REFERENCES') AS "REFERENCES",
              pg_catalog.has_table_privilege($1::name, 'public.usuarios', 'TRIGGER') AS "TRIGGER"`,
      [ROL],
    );

    expect(rows).toEqual([
      { SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false },
    ]);
  });

  it('criterio 2: UPDATE solo de clave_hash, debe_cambiar_clave, estado, version_token, intentos_fallidos, bloqueado_hasta, ultimo_acceso y actualizado_en', async () => {
    await exigirTabla();

    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT a.attname AS columna,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'UPDATE') AS puede,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'REFERENCES') AS referencia
         FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        WHERE c.oid = 'public.usuarios'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attname`,
      [ROL],
    );
    const filas = rows as { columna: string; puede: boolean; referencia: boolean }[];

    expect(filas.filter((fila) => fila.puede).map((fila) => fila.columna)).toEqual(COLUMNAS_UPDATE_DE_LA_APP);
    expect(filas.filter((fila) => fila.referencia)).toEqual([]);
  });

  it('criterio 2: no puede cambiar el dni, el rol, los nombres ni la academia_id, ni borrar filas (42501)', async () => {
    await exigirTabla();
    await limpiarBase();
    const A = await crearAcademiaDePrueba();
    const B = await crearAcademiaDePrueba();
    const usuario = await crearUsuarioDePrueba({ academiaId: A.id, rol: 'SECRETARIA' });

    const intentos: [string, string, unknown[]][] = [
      ['dni', 'UPDATE usuarios SET dni = $2 WHERE id = $1::uuid', [usuario.id, dniInventado()]],
      ['rol', "UPDATE usuarios SET rol = 'ADMIN' WHERE id = $1::uuid", [usuario.id]],
      ['nombres', "UPDATE usuarios SET nombres = 'Otro' WHERE id = $1::uuid", [usuario.id]],
      ['apellidos', "UPDATE usuarios SET apellidos = 'Otro' WHERE id = $1::uuid", [usuario.id]],
      ['academia_id', 'UPDATE usuarios SET academia_id = $2::uuid WHERE id = $1::uuid', [usuario.id, B.id]],
      ['id', 'UPDATE usuarios SET id = gen_random_uuid() WHERE id = $1::uuid', [usuario.id]],
      ['creado_en', 'UPDATE usuarios SET creado_en = now() WHERE id = $1::uuid', [usuario.id]],
      ['DELETE', 'DELETE FROM usuarios WHERE id = $1::uuid', [usuario.id]],
      ['TRUNCATE', 'TRUNCATE usuarios', []],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(ejecutarComo('app', sql, parametros, { academiaId: A.id }), nombre).rejects.toMatchObject({
        code: '42501',
      });
    }
    expect(await leerUsuario(A.id, usuario.id)).toMatchObject({ dni: usuario.dni, rol: 'SECRETARIA' });
  });

  it('criterio 2: sí puede cambiar las columnas permitidas y crear usuarios de su academia', async () => {
    await exigirTabla();
    await limpiarBase();
    const A = await crearAcademiaDePrueba();
    const usuario = await crearUsuarioDePrueba({ academiaId: A.id, rol: 'ENTRENADOR' });
    const hash = await hashDeClave('otra-clave-de-prueba');

    await ejecutarComo(
      'app',
      `UPDATE usuarios SET clave_hash = $2, debe_cambiar_clave = true, estado = 'INACTIVO', version_token = version_token + 1,
              intentos_fallidos = 2, bloqueado_hasta = now(), ultimo_acceso = now(), actualizado_en = now()
        WHERE id = $1::uuid`,
      [usuario.id, hash],
      { academiaId: A.id },
    );
    const nuevoDni = dniInventado();
    await ejecutarComo(
      'app',
      `INSERT INTO usuarios (academia_id, dni, nombres, apellidos, rol, clave_hash, creado_en, actualizado_en)
       VALUES ($1::uuid, $2, 'Nuevo', 'Usuario', 'ADMIN', $3, now(), now())`,
      [A.id, nuevoDni, hash],
      { academiaId: A.id },
    );

    expect(await leerUsuario(A.id, usuario.id)).toMatchObject({
      clave_hash: hash,
      debe_cambiar_clave: true,
      estado: 'INACTIVO',
      version_token: 1,
      intentos_fallidos: 2,
    });
    const { rows } = await ejecutarComo(
      'app',
      'SELECT dni, debe_cambiar_clave, estado, version_token FROM usuarios WHERE dni = $1',
      [nuevoDni],
      {
        academiaId: A.id,
      },
    );
    expect(rows).toEqual([{ dni: nuevoDni, debe_cambiar_clave: true, estado: 'ACTIVO', version_token: 0 }]);
  });
});

describe('criterio 2: la API sigue atendiendo con los privilegios nuevos', () => {
  it('criterio 2: PRIVILEGIOS_APP incluye los de usuarios: la API no se niega a atender datos por "privilegios de más" (criterio 102 de la 001)', async () => {
    await exigirTabla();
    await limpiarBase();
    await crearAcademiaDePrueba({ nombreCorto: 'academia-a', nombre: 'Academia A' });
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      const respuesta = await request(app.getHttpServer()).get('/api/a/academia-a');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({ nombreCorto: 'academia-a', nombre: 'Academia A' });
    } finally {
      await app.close();
    }
  });
});

describe('criterio 4: aislamiento por RLS (como el rol de la app)', () => {
  let A: AcademiaDePrueba;
  let B: AcademiaDePrueba;
  let idsA: string[];
  let idsB: string[];

  beforeEach(async () => {
    await limpiarBase();
    await exigirTabla();
    A = await crearAcademiaDePrueba();
    B = await crearAcademiaDePrueba();
    idsA = [
      (await crearUsuarioDePrueba({ academiaId: A.id, rol: 'ADMIN' })).id,
      (await crearUsuarioDePrueba({ academiaId: A.id, rol: 'ALUMNO' })).id,
    ];
    idsB = [
      (await crearUsuarioDePrueba({ academiaId: B.id, rol: 'ADMIN' })).id,
      (await crearUsuarioDePrueba({ academiaId: B.id, rol: 'SECRETARIA' })).id,
      (await crearUsuarioDePrueba({ academiaId: B.id, rol: 'ALUMNO' })).id,
    ];
  });

  const ids = async (contexto: { academiaId?: string; plataforma?: boolean | string }): Promise<string[]> => {
    const { rows } = await ejecutarComo('app', 'SELECT id FROM usuarios ORDER BY id', [], contexto);
    return (rows as { id: string }[]).map((fila) => fila.id).sort();
  };

  it('criterio 4: en contexto de A, usuarios devuelve solo los de A; en el de B, solo los de B', async () => {
    expect(await ids({ academiaId: A.id })).toEqual([...idsA].sort());
    expect(await ids({ academiaId: B.id })).toEqual([...idsB].sort());
  });

  it('criterio 4: en contexto de plataforma, sin contexto o con la academia vacía devuelve 0 filas', async () => {
    expect(await ids({ plataforma: true })).toEqual([]);
    expect(await ids({})).toEqual([]);
    expect(await ids({ academiaId: '' })).toEqual([]);
  });

  it('criterio 4: en contexto de plataforma y de A a la vez solo se ven las de A (la marca de plataforma no abre nada)', async () => {
    expect(await ids({ plataforma: true, academiaId: A.id })).toEqual([...idsA].sort());
  });

  it('criterio 4: un INSERT con la academia_id de B en contexto de A falla con 42501', async () => {
    const sql = `INSERT INTO usuarios (academia_id, dni, nombres, apellidos, rol, clave_hash, creado_en, actualizado_en)
                 VALUES ($1::uuid, $2, 'Intruso', 'De B', 'ADMIN', 'x', now(), now())`;

    await expect(ejecutarComo('app', sql, [B.id, dniInventado()], { academiaId: A.id })).rejects.toMatchObject({
      code: '42501',
    });
    expect(await ids({ academiaId: B.id })).toEqual([...idsB].sort());
  });

  it('criterio 4: en contexto de plataforma o sin contexto, un INSERT falla (con la academia de A o de B)', async () => {
    const sql = `INSERT INTO usuarios (academia_id, dni, nombres, apellidos, rol, clave_hash, creado_en, actualizado_en)
                 VALUES ($1::uuid, $2, 'Intruso', 'Sin contexto', 'ADMIN', 'x', now(), now())`;

    for (const contexto of [{ plataforma: true }, {}] as const) {
      for (const academia of [A, B]) {
        await expect(
          ejecutarComo('app', sql, [academia.id, dniInventado()], contexto),
          JSON.stringify(contexto),
        ).rejects.toMatchObject({ code: '42501' });
      }
    }
  });

  it('criterio 4: un UPDATE que cambia una fila de A a B falla con 42501 y la fila sigue en A', async () => {
    const sql = 'UPDATE usuarios SET academia_id = $2::uuid WHERE id = $1::uuid';

    await expect(ejecutarComo('app', sql, [idsA[0], B.id], { academiaId: A.id })).rejects.toMatchObject({
      code: '42501',
    });

    expect(await ids({ academiaId: A.id })).toEqual([...idsA].sort());
  });

  it('criterio 4: un UPDATE permitido sobre filas de B desde el contexto de A no cambia ninguna (0 filas)', async () => {
    const resultado = await ejecutarComo(
      'app',
      'UPDATE usuarios SET intentos_fallidos = 9, actualizado_en = now() WHERE id = ANY($1::uuid[])',
      [idsB],
      { academiaId: A.id },
    );

    expect(resultado.rowCount).toBe(0);
    for (const id of idsB) expect((await leerUsuario(B.id, id))?.intentos_fallidos).toBe(0);
  });

  it('criterio 4: un UPDATE sin contexto o en contexto de plataforma no cambia ninguna fila', async () => {
    for (const contexto of [{}, { plataforma: true }] as const) {
      const resultado = await ejecutarComo(
        'app',
        'UPDATE usuarios SET intentos_fallidos = 9, actualizado_en = now()',
        [],
        contexto,
      );
      expect(resultado.rowCount, JSON.stringify(contexto)).toBe(0);
    }
  });
});
