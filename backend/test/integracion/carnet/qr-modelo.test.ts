// spec: 008-carnet-qr (pruebas protegidas)
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComo, type RolPruebas, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { codigoDeError } from '../../utilidades/escenario-carnet';
import { crearEscenarioInscripcion, type EscenarioInscripcion } from '../../utilidades/inscripciones';
import { dniInventado } from '../../utilidades/usuarios';

// Criterio 1 (crítico, RN-05, RN-06, D-23): la migración `<marca>_carnet_qr` agrega a `alumnos` `qr_token` (`text`, nulo), `qr_generado_en` (`timestamptz(3)`, nulo) y `qr_clave_idempotencia` (`uuid`, nulo); el índice
// único `alumnos_academia_id_qr_token_key` sobre (`academia_id`, `qr_token`); y tres `CHECK` que valen también para el dueño de las tablas: `alumnos_qr_formato` (token nulo o `~ '^[A-Za-z0-9_-]{43}$'`), `alumnos_qr_con_fecha`
// (token y fecha, nulos a la vez o no nulos a la vez) y `alumnos_cliente_sin_qr` (un `CLIENTE` no tiene token). `aquagestion_app` gana `UPDATE` de esas tres columnas y nada más. La migración da un token a cada alumno que ya
// no está en `CLIENTE` (cada uno distinto, con la forma de la definición y al menos 240 bits al azar). Prueba: un `UPDATE` o un `INSERT` que deja un `CLIENTE` con token, un token de 42 o 44 caracteres, uno con `+`, `/` o `=`,
// un token sin fecha o dos alumnos de la misma academia con el mismo token responden `23514` o `23505`, como app y como dueño; el mismo token en dos academias distintas se acepta.

const ROLES: readonly RolPruebas[] = ['propietario', 'app'];
const TOKEN_VALIDO = (): string => randomBytes(32).toString('base64url');
const AHORA = new Date('2026-11-11T15:00:00.000Z');

describe('criterio 1: las columnas, el índice y los privilegios existen', () => {
  it('criterio 1: alumnos tiene qr_token (text), qr_generado_en (timestamptz(3)) y qr_clave_idempotencia (uuid), los tres con valores nulos permitidos', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT column_name, data_type, datetime_precision, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'alumnos' AND column_name IN ('qr_token', 'qr_generado_en', 'qr_clave_idempotencia')
        ORDER BY column_name`,
    );

    expect(rows).toEqual([
      { column_name: 'qr_clave_idempotencia', data_type: 'uuid', datetime_precision: null, is_nullable: 'YES' },
      {
        column_name: 'qr_generado_en',
        data_type: 'timestamp with time zone',
        datetime_precision: 3,
        is_nullable: 'YES',
      },
      { column_name: 'qr_token', data_type: 'text', datetime_precision: null, is_nullable: 'YES' },
    ]);
  });

  it('criterio 1: existe el índice único alumnos_academia_id_qr_token_key sobre (academia_id, qr_token), en ese orden', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT i.relname AS indice, x.indisunique AS unico,
              array_agg(a.attname::text ORDER BY k.ord) AS columnas
         FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_class t ON t.oid = x.indrelid
         CROSS JOIN LATERAL unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE t.oid = 'public.alumnos'::regclass AND i.relname = 'alumnos_academia_id_qr_token_key'
        GROUP BY i.relname, x.indisunique`,
    );

    expect(rows).toEqual([
      { indice: 'alumnos_academia_id_qr_token_key', unico: true, columnas: ['academia_id', 'qr_token'] },
    ]);
  });

  it('criterio 1: existen los tres CHECK con sus nombres', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT conname, contype::text AS tipo FROM pg_constraint
        WHERE conrelid = 'public.alumnos'::regclass AND conname IN ('alumnos_qr_formato', 'alumnos_qr_con_fecha', 'alumnos_cliente_sin_qr')
        ORDER BY conname`,
    );

    expect(rows).toEqual([
      { conname: 'alumnos_cliente_sin_qr', tipo: 'c' },
      { conname: 'alumnos_qr_con_fecha', tipo: 'c' },
      { conname: 'alumnos_qr_formato', tipo: 'c' },
    ]);
  });

  it('criterio 1: aquagestion_app puede hacer UPDATE de las tres columnas del QR y de las doce que ya tenía, y de ninguna otra (ni el DNI, ni la academia, ni el id)', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT a.attname::text AS columna
         FROM pg_attribute a
        WHERE a.attrelid = 'public.alumnos'::regclass AND a.attnum > 0 AND NOT a.attisdropped
          AND pg_catalog.has_column_privilege('aquagestion_app'::name, a.attrelid, a.attnum, 'UPDATE')
        ORDER BY a.attname`,
    );

    expect((rows as { columna: string }[]).map((fila) => fila.columna)).toEqual([
      'actualizado_en',
      'apellidos',
      'correo',
      'direccion',
      'estado',
      'fecha_nacimiento',
      'foto_clave',
      'grado_colegio',
      'nivel',
      'nombres',
      'qr_clave_idempotencia',
      'qr_generado_en',
      'qr_token',
      'telefono',
      'usuario_id',
    ]);
  });
});

describe.each(ROLES)('criterio 1: los CHECK y el índice único rechazan lo inválido, como %s', (rol) => {
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    e = await crearEscenarioInscripcion();
  });

  /** `INSERT` de un alumno con el estado, el token y la fecha dados (cualquier valor), con el contexto de su academia. */
  function insertar(
    academiaId: string,
    columnas: { estado: string; token: string | null; generadoEn: Date | null; id?: string },
  ) {
    return ejecutarComo(
      rol,
      `INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, creado_en, actualizado_en, qr_token, qr_generado_en)
       VALUES ($1::uuid, $2::uuid, $3, 'Alumno', 'De Prueba', DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion, $4::estado_alumno, $7::timestamptz, $7::timestamptz, $5, $6::timestamptz)`,
      [
        columnas.id ?? randomUUID(),
        academiaId,
        dniInventado(),
        columnas.estado,
        columnas.token,
        columnas.generadoEn,
        AHORA,
      ],
      { academiaId },
    );
  }

  /** Un alumno ya guardado (como dueño, sin QR) y su `UPDATE` con el rol de la prueba. */
  async function alumnoExistente(estado: string): Promise<string> {
    const id = randomUUID();
    await ejecutarComo(
      'propietario',
      `INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, creado_en, actualizado_en)
       VALUES ($1::uuid, $2::uuid, $3, 'Alumno', 'De Prueba', DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion, $4::estado_alumno, $5::timestamptz, $5::timestamptz)`,
      [id, e.A.id, dniInventado(), estado, AHORA],
      { academiaId: e.A.id },
    );
    return id;
  }

  function actualizarQr(alumnoId: string, token: string | null, generadoEn: Date | null) {
    return ejecutarComo(
      rol,
      'UPDATE alumnos SET qr_token = $2, qr_generado_en = $3::timestamptz WHERE id = $1::uuid',
      [alumnoId, token, generadoEn],
      { academiaId: e.A.id },
    );
  }

  const comoError = async (operacion: () => Promise<unknown>) => {
    try {
      await operacion();
      return { codigo: undefined, restriccion: undefined };
    } catch (error) {
      const { code, constraint } = error as { code?: string; constraint?: string };
      return { codigo: code, restriccion: constraint };
    }
  };

  describe('un token válido con su fecha', () => {
    it.each(['ALUMNO_ACTIVO', 'ALUMNO_VENCIDO', 'INACTIVO'])(
      'criterio 1: se acepta en un INSERT de un alumno %s',
      async (estado) => {
        await insertar(e.A.id, { estado, token: TOKEN_VALIDO(), generadoEn: AHORA });
      },
    );

    it('criterio 1: se acepta en un UPDATE de un alumno activo, y también el UPDATE de qr_clave_idempotencia', async () => {
      const id = await alumnoExistente('ALUMNO_ACTIVO');

      await actualizarQr(id, TOKEN_VALIDO(), AHORA);
      await ejecutarComo(
        rol,
        'UPDATE alumnos SET qr_clave_idempotencia = $2::uuid WHERE id = $1::uuid',
        [id, randomUUID()],
        { academiaId: e.A.id },
      );
    });

    it('criterio 1: un alumno activo sin token (filas escritas fuera de la API) también se acepta: el CHECK no exige token (criterio 10)', async () => {
      await insertar(e.A.id, { estado: 'ALUMNO_ACTIVO', token: null, generadoEn: null });
    });

    it('criterio 1: un CLIENTE sin token se acepta', async () => {
      await insertar(e.A.id, { estado: 'CLIENTE', token: null, generadoEn: null });
    });
  });

  describe('alumnos_cliente_sin_qr: un CLIENTE no tiene token', () => {
    it('criterio 1: un INSERT de un CLIENTE con token (y fecha) responde 23514 por alumnos_cliente_sin_qr', async () => {
      const error = await comoError(() =>
        insertar(e.A.id, { estado: 'CLIENTE', token: TOKEN_VALIDO(), generadoEn: AHORA }),
      );

      expect(error).toEqual({ codigo: '23514', restriccion: 'alumnos_cliente_sin_qr' });
    });

    it('criterio 1: un UPDATE que le pone token a un CLIENTE responde 23514 por alumnos_cliente_sin_qr', async () => {
      const id = await alumnoExistente('CLIENTE');

      const error = await comoError(() => actualizarQr(id, TOKEN_VALIDO(), AHORA));

      expect(error).toEqual({ codigo: '23514', restriccion: 'alumnos_cliente_sin_qr' });
    });

    it('criterio 1: un UPDATE que devuelve a CLIENTE a un alumno que ya tiene token también responde 23514', async () => {
      const id = await alumnoExistente('ALUMNO_ACTIVO');
      await actualizarQr(id, TOKEN_VALIDO(), AHORA);

      const codigo = await codigoDeError(() =>
        ejecutarComo(rol, "UPDATE alumnos SET estado = 'CLIENTE'::estado_alumno WHERE id = $1::uuid", [id], {
          academiaId: e.A.id,
        }),
      );

      expect(codigo).toBe('23514');
    });
  });

  describe('alumnos_qr_formato: 43 caracteres de base64url', () => {
    const base = TOKEN_VALIDO();
    it.each([
      ['de 42 caracteres', base.slice(0, 42)],
      ['de 44 caracteres', `${base}A`],
      ['vacío', ''],
      ['con +', `${base.slice(0, 42)}+`],
      ['con /', `${base.slice(0, 42)}/`],
      ['con =', `${base.slice(0, 42)}=`],
      ['con relleno de base64 estándar', `${base.slice(0, 41)}==`],
      ['con un espacio', `${base.slice(0, 42)} `],
      ['con un salto de línea', `${base.slice(0, 42)}\n`],
      ['con una letra con tilde', `${base.slice(0, 42)}á`],
      ['con el prefijo del contenido del QR', `AQ1:${base.slice(0, 39)}`],
    ])('criterio 1: un INSERT con un token %s responde 23514 por alumnos_qr_formato', async (_nombre, token) => {
      const error = await comoError(() => insertar(e.A.id, { estado: 'ALUMNO_ACTIVO', token, generadoEn: AHORA }));

      expect(error).toEqual({ codigo: '23514', restriccion: 'alumnos_qr_formato' });
    });

    it.each([
      ['de 42 caracteres', base.slice(0, 42)],
      ['de 44 caracteres', `${base}A`],
      ['con +', `${base.slice(0, 42)}+`],
      ['con /', `${base.slice(0, 42)}/`],
      ['con =', `${base.slice(0, 42)}=`],
    ])('criterio 1: un UPDATE con un token %s responde 23514 por alumnos_qr_formato', async (_nombre, token) => {
      const id = await alumnoExistente('ALUMNO_ACTIVO');

      const error = await comoError(() => actualizarQr(id, token, AHORA));

      expect(error).toEqual({ codigo: '23514', restriccion: 'alumnos_qr_formato' });
    });
  });

  describe('alumnos_qr_con_fecha: token y fecha, los dos o ninguno', () => {
    it('criterio 1: un INSERT con token y sin fecha responde 23514 por alumnos_qr_con_fecha', async () => {
      const error = await comoError(() =>
        insertar(e.A.id, { estado: 'ALUMNO_ACTIVO', token: TOKEN_VALIDO(), generadoEn: null }),
      );

      expect(error).toEqual({ codigo: '23514', restriccion: 'alumnos_qr_con_fecha' });
    });

    it('criterio 1: un INSERT con fecha y sin token responde 23514 por alumnos_qr_con_fecha', async () => {
      const error = await comoError(() =>
        insertar(e.A.id, { estado: 'ALUMNO_ACTIVO', token: null, generadoEn: AHORA }),
      );

      expect(error).toEqual({ codigo: '23514', restriccion: 'alumnos_qr_con_fecha' });
    });

    it('criterio 1: un UPDATE que deja el token sin fecha, o la fecha sin token, responde 23514 por alumnos_qr_con_fecha', async () => {
      const id = await alumnoExistente('ALUMNO_ACTIVO');
      await actualizarQr(id, TOKEN_VALIDO(), AHORA);

      const sinFecha = await comoError(() =>
        ejecutarComo(rol, 'UPDATE alumnos SET qr_generado_en = NULL WHERE id = $1::uuid', [id], { academiaId: e.A.id }),
      );
      const sinToken = await comoError(() =>
        ejecutarComo(rol, 'UPDATE alumnos SET qr_token = NULL WHERE id = $1::uuid', [id], { academiaId: e.A.id }),
      );

      expect(sinFecha).toEqual({ codigo: '23514', restriccion: 'alumnos_qr_con_fecha' });
      expect(sinToken).toEqual({ codigo: '23514', restriccion: 'alumnos_qr_con_fecha' });
    });
  });

  describe('alumnos_academia_id_qr_token_key: el token es único por academia', () => {
    it('criterio 1: dos alumnos de la misma academia con el mismo token responden 23505 por el índice único, en un INSERT y en un UPDATE', async () => {
      const token = TOKEN_VALIDO();
      await insertar(e.A.id, { estado: 'ALUMNO_ACTIVO', token, generadoEn: AHORA });

      const alInsertar = await comoError(() => insertar(e.A.id, { estado: 'ALUMNO_ACTIVO', token, generadoEn: AHORA }));
      const otro = await alumnoExistente('ALUMNO_ACTIVO');
      const alActualizar = await comoError(() => actualizarQr(otro, token, AHORA));

      expect(alInsertar).toEqual({ codigo: '23505', restriccion: 'alumnos_academia_id_qr_token_key' });
      expect(alActualizar).toEqual({ codigo: '23505', restriccion: 'alumnos_academia_id_qr_token_key' });
    });

    it('criterio 1: el mismo token en dos academias distintas se acepta', async () => {
      const token = TOKEN_VALIDO();

      await insertar(e.A.id, { estado: 'ALUMNO_ACTIVO', token, generadoEn: AHORA });
      await insertar(e.B.id, { estado: 'ALUMNO_ACTIVO', token, generadoEn: AHORA });

      for (const academiaId of [e.A.id, e.B.id]) {
        const { rows } = await ejecutarComo(
          'propietario',
          'SELECT id FROM alumnos WHERE academia_id = $2::uuid AND qr_token = $1',
          [token, academiaId],
          { academiaId },
        );
        expect(rows as unknown[], 'cada academia guarda su fila con ese mismo token').toHaveLength(1);
      }
    });

    it('criterio 1: varios alumnos sin token en la misma academia no chocan (los nulos no cuentan)', async () => {
      await insertar(e.A.id, { estado: 'ALUMNO_ACTIVO', token: null, generadoEn: null });
      await insertar(e.A.id, { estado: 'ALUMNO_ACTIVO', token: null, generadoEn: null });
      await insertar(e.A.id, { estado: 'CLIENTE', token: null, generadoEn: null });
    });
  });
});

describe('criterio 1: la migración da un token a cada alumno que ya existe y no está en CLIENTE', () => {
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    e = await crearEscenarioInscripcion();
  });

  /** El SQL de la migración `<marca>_carnet_qr` (falla con un mensaje claro si todavía no existe). */
  function sqlDeLaMigracion(): string {
    const carpeta = path.resolve(__dirname, '..', '..', '..', 'prisma', 'migrations');
    const nombre = fs.readdirSync(carpeta).find((entrada) => /^\d+_carnet_qr$/.test(entrada));
    if (!nombre)
      throw new Error(
        'Falta la funcionalidad de la 008a: no existe la migración backend/prisma/migrations/<marca>_carnet_qr.',
      );
    return fs.readFileSync(path.join(carpeta, nombre, 'migration.sql'), 'utf8');
  }

  it('criterio 1: aplicada sobre una base con alumnos de antes (como dueño y con la RLS forzada), da un token distinto, de 43 caracteres de base64url y sin relación con el id ni el DNI, a cada alumno que no es CLIENTE; deja a los CLIENTE sin token', async () => {
    const sql = sqlDeLaMigracion();
    const cliente = new pg.Client({ connectionString: urlPropietarioPruebas() });
    await cliente.connect();
    try {
      await cliente.query('BEGIN');
      // Se vuelve al estado de antes de la migración (todo dentro de la transacción, que se revierte al final).
      await cliente.query(
        'ALTER TABLE alumnos DROP COLUMN qr_token, DROP COLUMN qr_generado_en, DROP COLUMN qr_clave_idempotencia',
      );
      const sembrar = async (
        academiaId: string,
        estado: string,
        cantidad: number,
      ): Promise<{ id: string; dni: string }[]> => {
        await cliente.query("SELECT set_config('app.academia_id', $1, true)", [academiaId]);
        const filas: { id: string; dni: string }[] = [];
        for (let i = 0; i < cantidad; i += 1) filas.push({ id: randomUUID(), dni: dniInventado() });
        for (const fila of filas) {
          await cliente.query(
            `INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, creado_en, actualizado_en)
             VALUES ($1::uuid, $2::uuid, $3, 'Alumno', 'Antiguo', DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion, $4::estado_alumno, $5::timestamptz, $5::timestamptz)`,
            [fila.id, academiaId, fila.dni, estado, AHORA],
          );
        }
        return filas;
      };
      const activos = await sembrar(e.A.id, 'ALUMNO_ACTIVO', 25);
      const vencidos = await sembrar(e.A.id, 'ALUMNO_VENCIDO', 3);
      const inactivos = await sembrar(e.A.id, 'INACTIVO', 2);
      const clientes = await sembrar(e.A.id, 'CLIENTE', 3);
      const activosDeB = await sembrar(e.B.id, 'ALUMNO_ACTIVO', 12);
      const clientesDeB = await sembrar(e.B.id, 'CLIENTE', 1);

      await cliente.query(sql);

      const leer = async (academiaId: string) => {
        await cliente.query("SELECT set_config('app.academia_id', $1, true)", [academiaId]);
        const { rows } = await cliente.query<{ id: string; qr_token: string | null; qr_generado_en: Date | null }>(
          'SELECT id, qr_token, qr_generado_en FROM alumnos WHERE academia_id = $1::uuid',
          [academiaId],
        );
        return new Map(rows.map((fila) => [fila.id, fila]));
      };
      const deA = await leer(e.A.id);
      const deB = await leer(e.B.id);
      const tokens: string[] = [];
      const conToken = [...activos, ...vencidos, ...inactivos]
        .map((f) => ({ ...f, fila: deA.get(f.id) }))
        .concat(activosDeB.map((f) => ({ ...f, fila: deB.get(f.id) })));
      for (const { id, dni, fila } of conToken) {
        expect(fila?.qr_token, `el alumno ${id} (no CLIENTE) debía recibir un token`).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(fila?.qr_generado_en, `el alumno ${id} debía recibir la fecha del token`).not.toBeNull();
        const token = fila?.qr_token as string;
        tokens.push(token);
        expect(token.toLowerCase(), 'el token no lleva el id').not.toContain(id.toLowerCase());
        expect(token.toLowerCase(), 'el token no lleva el id sin guiones').not.toContain(
          id.replaceAll('-', '').toLowerCase(),
        );
        expect(token, 'el token no lleva el DNI').not.toContain(dni);
        for (const derivado of [
          createHash('sha256').update(id).digest('base64url'),
          createHash('sha256').update(dni).digest('base64url'),
          createHash('sha256').update(`${dni}${id}`).digest('base64url'),
          Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url'),
        ]) {
          expect(token, 'el token no se deriva del id ni del DNI').not.toBe(derivado);
        }
        expect(Buffer.from(token, 'base64url'), 'son 32 bytes (256 bits)').toHaveLength(32);
      }
      expect(new Set(tokens).size, 'todos los tokens son distintos (también entre academias)').toBe(tokens.length);
      for (let posicion = 0; posicion < 42; posicion += 1) {
        const distintos = new Set(tokens.map((token) => token.charAt(posicion)));
        expect(
          distintos.size,
          `la posición ${posicion} de los tokens varía: no son constantes ni tienen un patrón fijo`,
        ).toBeGreaterThanOrEqual(3);
      }
      for (const { id } of [...clientes, ...clientesDeB]) {
        const fila = deA.get(id) ?? deB.get(id);
        expect(fila?.qr_token, 'un CLIENTE no recibe token (RN-05)').toBeNull();
        expect(fila?.qr_generado_en).toBeNull();
      }
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined);
      await cliente.end().catch(() => undefined);
    }
  });

  it('criterio 1: después de aplicar la migración sobre esa base quedan el índice único, los tres CHECK y el privilegio UPDATE de la app', async () => {
    const sql = sqlDeLaMigracion();
    const cliente = new pg.Client({ connectionString: urlPropietarioPruebas() });
    await cliente.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(
        'ALTER TABLE alumnos DROP COLUMN qr_token, DROP COLUMN qr_generado_en, DROP COLUMN qr_clave_idempotencia',
      );

      await cliente.query(sql);

      const { rows } = await cliente.query<{ nombre: string }>(
        `SELECT conname::text AS nombre FROM pg_constraint
          WHERE conrelid = 'public.alumnos'::regclass AND conname IN ('alumnos_qr_formato', 'alumnos_qr_con_fecha', 'alumnos_cliente_sin_qr')
         UNION ALL SELECT indexname::text FROM pg_indexes WHERE tablename = 'alumnos' AND indexname = 'alumnos_academia_id_qr_token_key'
         ORDER BY 1`,
      );
      expect(rows.map((fila) => fila.nombre)).toEqual([
        'alumnos_academia_id_qr_token_key',
        'alumnos_cliente_sin_qr',
        'alumnos_qr_con_fecha',
        'alumnos_qr_formato',
      ]);
      const privilegios = await cliente.query<{ columna: string; puede: boolean }>(
        `SELECT a.attname::text AS columna, pg_catalog.has_column_privilege('aquagestion_app'::name, a.attrelid, a.attnum, 'UPDATE') AS puede
           FROM pg_attribute a WHERE a.attrelid = 'public.alumnos'::regclass AND a.attname IN ('qr_token', 'qr_generado_en', 'qr_clave_idempotencia')
          ORDER BY a.attname`,
      );
      expect(privilegios.rows).toEqual([
        { columna: 'qr_clave_idempotencia', puede: true },
        { columna: 'qr_generado_en', puede: true },
        { columna: 'qr_token', puede: true },
      ]);
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined);
      await cliente.end().catch(() => undefined);
    }
  });
});
