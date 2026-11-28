// spec: 011-panel-alumno (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase, type RolPruebas, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { crearEscenarioInscripcion, type EscenarioInscripcion } from '../../utilidades/inscripciones';
import { crearUsuarioDePrueba, dniInventado } from '../../utilidades/usuarios';

// Criterio 1 (crítico, RN-29, D-28): la migración `<marca>_panel_alumno` crea el índice único `alumnos_academia_id_usuario_id_key` sobre `alumnos (academia_id, usuario_id)` (y `@@unique([academiaId, usuarioId])` en `schema.prisma`). No cambia
// privilegios ni políticas. Prueba como app y como dueño de las tablas: unir un segundo alumno de la misma academia al `usuario_id` de otro responde `23505`; varios alumnos con `usuario_id` nulo (clientes) se aceptan.
// Lecturas estrictas elegidas: el índice es un índice único (no una restricción), completo (sin condición ni columnas INCLUDE) y con las dos columnas en ese orden; «unir» se prueba con un `UPDATE` de `usuario_id` (la app solo tiene ese privilegio de columna sobre `usuario_id`,
// 007) y, solo como dueño, también con un `INSERT`; la migración se prueba aplicando su SQL sobre una base sin el índice, dentro de una transacción que se revierte.

const ROLES: readonly RolPruebas[] = ['propietario', 'app'];
const INDICE = 'alumnos_academia_id_usuario_id_key';
const AHORA = new Date('2026-11-11T15:00:00.000Z');

// Antes de la migración, estas pruebas dejan en la base alumnos con la misma cuenta; se vacía la base al terminar para que la migración se pueda aplicar después sobre una base limpia.
afterAll(async () => {
  await limpiarBase();
});

const comoError = async (operacion: () => Promise<unknown>): Promise<{ codigo?: string; restriccion?: string }> => {
  try {
    await operacion();
    return {};
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string };
    return { codigo: code, restriccion: constraint };
  }
};

describe('criterio 1: el índice único existe', () => {
  it('criterio 1: existe alumnos_academia_id_usuario_id_key, único, completo y sobre (academia_id, usuario_id) en ese orden', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT i.relname AS indice, x.indisunique AS unico, x.indnkeyatts::int AS columnas_clave, x.indnatts::int AS columnas_totales,
              (x.indpred IS NULL) AS completo, (x.indexprs IS NULL) AS sin_expresiones,
              (SELECT count(*)::int FROM pg_constraint c WHERE c.conindid = x.indexrelid) AS restricciones,
              array_agg(a.attname::text ORDER BY k.ord) AS columnas
         FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_class t ON t.oid = x.indrelid
         CROSS JOIN LATERAL unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE t.oid = 'public.alumnos'::regclass AND i.relname = $1
        GROUP BY i.relname, x.indisunique, x.indnkeyatts, x.indnatts, x.indpred, x.indexprs, x.indexrelid`,
      [INDICE],
    );

    expect(rows, `falta el índice ${INDICE} en alumnos (la migración <marca>_panel_alumno)`).toEqual([
      {
        indice: INDICE,
        unico: true,
        columnas_clave: 2,
        columnas_totales: 2,
        completo: true,
        sin_expresiones: true,
        restricciones: 0,
        columnas: ['academia_id', 'usuario_id'],
      },
    ]);
  });

  it('criterio 1: schema.prisma declara @@unique([academiaId, usuarioId]) en el modelo Alumno', () => {
    const esquema = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'), 'utf8');
    const modelo = /model Alumno \{[\s\S]*?\n\}/.exec(esquema)?.[0] ?? '';

    expect(modelo, 'no se encontró el modelo Alumno').not.toBe('');
    expect(modelo).toMatch(/@@unique\(\[academiaId, usuarioId\]\)/);
  });
});

describe.each(ROLES)('criterio 1: una cuenta no se une a dos alumnos de la misma academia, como %s', (rol) => {
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    e = await crearEscenarioInscripcion();
  });

  /** Un alumno de la academia dada, sin cuenta, escrito como dueño (el estado y la cuenta se ponen después). */
  async function alumno(
    academiaId: string,
    usuarioId: string | null = null,
    estado = 'ALUMNO_ACTIVO',
  ): Promise<string> {
    const id = randomUUID();
    await ejecutarComo(
      'propietario',
      `INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, usuario_id, creado_en, actualizado_en)
       VALUES ($1::uuid, $2::uuid, $3, 'Alumno', 'De Prueba', DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion, $4::estado_alumno, $5::uuid, $6::timestamptz, $6::timestamptz)`,
      [id, academiaId, dniInventado(), estado, usuarioId, AHORA],
      { academiaId },
    );
    return id;
  }

  const cuenta = (academiaId: string) => crearUsuarioDePrueba({ academiaId, rol: 'ALUMNO' });

  /** `UPDATE alumnos SET usuario_id` con el rol de la prueba. */
  const unir = (academiaId: string, alumnoId: string, usuarioId: string | null) =>
    ejecutarComo(
      rol,
      'UPDATE alumnos SET usuario_id = $3::uuid WHERE academia_id = $1::uuid AND id = $2::uuid',
      [academiaId, alumnoId, usuarioId],
      { academiaId },
    );

  it('criterio 1: unir un segundo alumno de la misma academia al usuario_id de otro responde 23505 por el índice, y el segundo alumno sigue sin cuenta', async () => {
    const usuario = await cuenta(e.A.id);
    await alumno(e.A.id, usuario.id);
    const segundo = await alumno(e.A.id);

    const error = await comoError(() => unir(e.A.id, segundo, usuario.id));

    expect(error).toEqual({ codigo: '23505', restriccion: INDICE });
    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT usuario_id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid',
      [e.A.id, segundo],
      { academiaId: e.A.id },
    );
    expect(rows).toEqual([{ usuario_id: null }]);
  });

  it('criterio 1: el segundo alumno puede ser un CLIENTE, un ALUMNO_VENCIDO o un INACTIVO: la cuenta sigue siendo de un solo alumno', async () => {
    const usuario = await cuenta(e.A.id);
    await alumno(e.A.id, usuario.id);

    for (const estado of ['CLIENTE', 'ALUMNO_VENCIDO', 'INACTIVO']) {
      const otro = await alumno(e.A.id, null, estado);
      expect(await comoError(() => unir(e.A.id, otro, usuario.id)), estado).toEqual({
        codigo: '23505',
        restriccion: INDICE,
      });
    }
  });

  it('criterio 1: cambiar la cuenta de un alumno por la de otro alumno también responde 23505, pero reponer la suya o pasarla a una cuenta libre se acepta', async () => {
    const primera = await cuenta(e.A.id);
    const segunda = await cuenta(e.A.id);
    const libre = await cuenta(e.A.id);
    const alumnoUno = await alumno(e.A.id, primera.id);
    await alumno(e.A.id, segunda.id);

    expect(await comoError(() => unir(e.A.id, alumnoUno, segunda.id))).toEqual({
      codigo: '23505',
      restriccion: INDICE,
    });
    await unir(e.A.id, alumnoUno, primera.id);
    await unir(e.A.id, alumnoUno, libre.id);
  });

  it('criterio 1: varios alumnos de la misma academia sin cuenta (clientes con usuario_id nulo) se aceptan, y desligar la cuenta de un alumno también', async () => {
    const usuario = await cuenta(e.A.id);
    const conCuenta = await alumno(e.A.id, usuario.id);

    await alumno(e.A.id, null, 'CLIENTE');
    await alumno(e.A.id, null, 'CLIENTE');
    await alumno(e.A.id, null, 'ALUMNO_VENCIDO');
    await unir(e.A.id, conCuenta, null);
    const otro = await alumno(e.A.id);
    await unir(e.A.id, otro, null);
  });

  it('criterio 1: alumnos de academias distintas tienen cuentas distintas y no chocan: cada academia lleva su propio índice por cuenta', async () => {
    const deA = await cuenta(e.A.id);
    const deB = await cuenta(e.B.id);

    await alumno(e.A.id, deA.id);
    await alumno(e.B.id, deB.id);
    const segundoDeB = await alumno(e.B.id);

    expect(await comoError(() => unir(e.B.id, segundoDeB, deB.id))).toEqual({ codigo: '23505', restriccion: INDICE });
  });
});

describe('criterio 1: un INSERT que une una segunda ficha a la cuenta de otra responde 23505 (como dueño de las tablas)', () => {
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    e = await crearEscenarioInscripcion();
  });

  it('criterio 1: INSERT de un alumno con el usuario_id de otro alumno de la misma academia responde 23505 por el índice; con el de otra cuenta, se acepta', async () => {
    const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ALUMNO' });
    const otra = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ALUMNO' });
    const insertar = (usuarioId: string) =>
      ejecutarComo(
        'propietario',
        `INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, usuario_id, creado_en, actualizado_en)
         VALUES ($1::uuid, $2::uuid, $3, 'Alumno', 'De Prueba', DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion, 'ALUMNO_ACTIVO'::estado_alumno, $4::uuid, $5::timestamptz, $5::timestamptz)`,
        [randomUUID(), e.A.id, dniInventado(), usuarioId, AHORA],
        { academiaId: e.A.id },
      );

    await insertar(usuario.id);
    const repetido = await comoError(() => insertar(usuario.id));
    await insertar(otra.id);

    expect(repetido).toEqual({ codigo: '23505', restriccion: INDICE });
  });
});

describe('criterio 1: la migración <marca>_panel_alumno', () => {
  /** El SQL de la migración `<marca>_panel_alumno` (falla con un mensaje claro si todavía no existe). */
  function sqlDeLaMigracion(): string {
    const carpeta = path.resolve(__dirname, '..', '..', '..', 'prisma', 'migrations');
    const nombre = fs.readdirSync(carpeta).find((entrada) => /^\d+_panel_alumno$/.test(entrada));
    if (!nombre) {
      throw new Error(
        'Falta la funcionalidad de la 011: no existe la migración backend/prisma/migrations/<marca>_panel_alumno.',
      );
    }
    return fs.readFileSync(path.join(carpeta, nombre, 'migration.sql'), 'utf8');
  }

  /** Las políticas de RLS y los privilegios de tabla y de columna de `public`, como texto, para ver que la migración no los toca. */
  const SQL_POLITICAS_Y_PRIVILEGIOS = `
    SELECT tipo, nombre, detalle FROM (
      SELECT 'politica' AS tipo, schemaname || '.' || tablename || '.' || policyname AS nombre,
             cmd::text || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') AS detalle
        FROM pg_policies WHERE schemaname = 'public'
      UNION ALL
      SELECT 'tabla', grantee::text || ' ' || table_name::text, privilege_type::text
        FROM information_schema.table_privileges WHERE table_schema = 'public'
      UNION ALL
      SELECT 'columna', grantee::text || ' ' || table_name::text || '.' || column_name::text, privilege_type::text
        FROM information_schema.column_privileges WHERE table_schema = 'public'
      UNION ALL
      SELECT 'rls', c.relname::text, c.relrowsecurity::text || ' ' || c.relforcerowsecurity::text
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
    ) t ORDER BY 1, 2, 3`;

  it('criterio 1: aplicada sobre una base sin el índice (en una transacción que se revierte) crea el índice único sobre (academia_id, usuario_id) y no cambia ninguna política ni privilegio', async () => {
    const sql = sqlDeLaMigracion();
    const cliente = new pg.Client({ connectionString: urlPropietarioPruebas() });
    await cliente.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(`DROP INDEX IF EXISTS "${INDICE}"`);
      const antes = await cliente.query(SQL_POLITICAS_Y_PRIVILEGIOS);
      const sinIndice = await cliente.query("SELECT 1 FROM pg_indexes WHERE tablename = 'alumnos' AND indexname = $1", [
        INDICE,
      ]);
      expect(sinIndice.rows, 'antes de la migración el índice no existe').toHaveLength(0);

      await cliente.query(sql);

      const despues = await cliente.query(SQL_POLITICAS_Y_PRIVILEGIOS);
      const definicion = await cliente.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE tablename = 'alumnos' AND indexname = $1",
        [INDICE],
      );
      expect(definicion.rows).toHaveLength(1);
      expect(definicion.rows[0]?.indexdef).toMatch(
        /CREATE UNIQUE INDEX .* ON public\.alumnos USING btree \(academia_id, usuario_id\)$/,
      );
      expect(despues.rows, 'la migración no cambia privilegios ni políticas').toEqual(antes.rows);
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined);
      await cliente.end().catch(() => undefined);
    }
  });
});
