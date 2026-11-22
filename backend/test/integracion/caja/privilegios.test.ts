// spec: 006-caja (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  cerrarCajaDePrueba,
  type EscenarioCaja,
  exigirTablasDeCaja,
  TABLAS_006,
  type Tabla006,
} from '../../utilidades/caja';

// Criterio 2 (crítico, D-23, RN-22): privilegios mínimos de `aquagestion_app` en las tres tablas: en `cajas`, SELECT, INSERT y UPDATE de
// `estado` y `actualizado_en`; en `movimientos_caja`, SELECT e INSERT (sin UPDATE: los movimientos no cambian); en `cierres_caja`, SELECT,
// INSERT y UPDATE de `reabierto_por`, `reabierto_en` y `motivo_reapertura`. Nunca DELETE, TRUNCATE, REFERENCES ni TRIGGER, ni UPDATE de
// tabla entera. No puede cambiar la fecha, el monto inicial, quién abrió ni la `academia_id` de una caja, ni ningún monto de un cierre.
// `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` se amplían igual (las pruebas protegidas de la 001 que comparan la lista exacta se
// actualizaron en este mismo cambio) y la API sigue atendiendo (criterio 102 de la 001).

const ROL = 'aquagestion_app';

const UPDATE_EXACTO: Record<Tabla006, string[]> = {
  cajas: ['actualizado_en', 'estado'],
  movimientos_caja: [],
  cierres_caja: ['motivo_reapertura', 'reabierto_en', 'reabierto_por'],
};

describe.each(TABLAS_006)('criterio 2: privilegios exactos de aquagestion_app sobre %s', (tabla) => {
  beforeEach(exigirTablasDeCaja);

  it('criterio 2: sobre la tabla tiene SELECT e INSERT y ni UPDATE de tabla entera, DELETE, TRUNCATE, REFERENCES ni TRIGGER', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT pg_catalog.has_table_privilege($1::name, $2, 'SELECT') AS "SELECT",
              pg_catalog.has_table_privilege($1::name, $2, 'INSERT') AS "INSERT",
              pg_catalog.has_table_privilege($1::name, $2, 'UPDATE') AS "UPDATE",
              pg_catalog.has_table_privilege($1::name, $2, 'DELETE') AS "DELETE",
              pg_catalog.has_table_privilege($1::name, $2, 'TRUNCATE') AS "TRUNCATE",
              pg_catalog.has_table_privilege($1::name, $2, 'REFERENCES') AS "REFERENCES",
              pg_catalog.has_table_privilege($1::name, $2, 'TRIGGER') AS "TRIGGER"`,
      [ROL, `public.${tabla}`],
    );

    expect(rows).toEqual([
      { SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false },
    ]);
  });

  it('criterio 2: UPDATE solo de las columnas indicadas, y ninguna columna con REFERENCES', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT a.attname AS columna,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'UPDATE') AS puede,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'REFERENCES') AS referencia
         FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        WHERE c.oid = ('public.' || $2)::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attname`,
      [ROL, tabla],
    );
    const filas = rows as { columna: string; puede: boolean; referencia: boolean }[];

    expect(filas.filter((fila) => fila.puede).map((fila) => fila.columna)).toEqual(UPDATE_EXACTO[tabla]);
    expect(filas.filter((fila) => fila.referencia)).toEqual([]);
  });
});

describe('criterio 2: lo que el rol de la app puede y no puede escribir', () => {
  let e: EscenarioCaja;
  let cajaId: string;
  let cierreId: string;
  let movimientoId: string;

  beforeEach(async () => {
    e = await crearEscenarioDeCaja();
    const alumno = await crearAlumnoDeCaja(e.A.id);
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
    cajaId = caja.id;
    movimientoId = (await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id)).id;
    await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id);
    cierreId = (await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id)).id;
  });

  const comoApp = (sql: string, parametros: unknown[] = []) =>
    ejecutarComo('app', sql, parametros, { academiaId: e.A.id });

  it.each([
    ['fecha', "UPDATE cajas SET fecha = '2026-01-01' WHERE id = $1::uuid"],
    ['monto_inicial', 'UPDATE cajas SET monto_inicial = 999 WHERE id = $1::uuid'],
    ['abierta_por', 'UPDATE cajas SET abierta_por = gen_random_uuid() WHERE id = $1::uuid'],
    ['abierta_en', 'UPDATE cajas SET abierta_en = now() WHERE id = $1::uuid'],
    ['clave_idempotencia', 'UPDATE cajas SET clave_idempotencia = gen_random_uuid() WHERE id = $1::uuid'],
    ['id', 'UPDATE cajas SET id = gen_random_uuid() WHERE id = $1::uuid'],
    ['creado_en', 'UPDATE cajas SET creado_en = now() WHERE id = $1::uuid'],
    ['DELETE', 'DELETE FROM cajas WHERE id = $1::uuid'],
  ])('criterio 2: no puede cambiar %s de una caja ni borrarla (42501)', async (_campo, sql) => {
    await expect(comoApp(sql, [cajaId])).rejects.toMatchObject({ code: '42501' });
  });

  it('criterio 2: no puede cambiar la academia_id de una caja, ni siquiera hacia otra academia (42501)', async () => {
    await expect(
      comoApp('UPDATE cajas SET academia_id = $2::uuid WHERE id = $1::uuid', [cajaId, e.B.id]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('criterio 2: sí puede cambiar el estado y actualizado_en de una caja (control; la coherencia con el cierre la cuida el servicio)', async () => {
    const resultado = await comoApp("UPDATE cajas SET estado = 'ABIERTA', actualizado_en = now() WHERE id = $1::uuid", [
      cajaId,
    ]);

    expect(resultado.rowCount).toBe(1);
  });

  it.each([
    ['monto', 'UPDATE movimientos_caja SET monto = 1 WHERE id = $1::uuid'],
    ['descripcion', "UPDATE movimientos_caja SET descripcion = 'otra' WHERE id = $1::uuid"],
    ['numero', 'UPDATE movimientos_caja SET numero = 99 WHERE id = $1::uuid'],
    ['caja_id', 'UPDATE movimientos_caja SET caja_id = gen_random_uuid() WHERE id = $1::uuid'],
    ['registrado_por', 'UPDATE movimientos_caja SET registrado_por = gen_random_uuid() WHERE id = $1::uuid'],
    ['academia_id', 'UPDATE movimientos_caja SET academia_id = gen_random_uuid() WHERE id = $1::uuid'],
    ['DELETE', 'DELETE FROM movimientos_caja WHERE id = $1::uuid'],
  ])('criterio 2: los movimientos no cambian: %s (42501)', async (_campo, sql) => {
    await expect(comoApp(sql, [movimientoId])).rejects.toMatchObject({ code: '42501' });
  });

  it.each([
    ['monto_declarado', 'UPDATE cierres_caja SET monto_declarado = 1 WHERE id = $1::uuid'],
    ['diferencia', 'UPDATE cierres_caja SET diferencia = 0 WHERE id = $1::uuid'],
    ['esperado_efectivo', 'UPDATE cierres_caja SET esperado_efectivo = 1 WHERE id = $1::uuid'],
    ['ingresos_yape', 'UPDATE cierres_caja SET ingresos_yape = 1 WHERE id = $1::uuid'],
    ['observacion', "UPDATE cierres_caja SET observacion = 'otra' WHERE id = $1::uuid"],
    ['tardio', 'UPDATE cierres_caja SET tardio = true WHERE id = $1::uuid'],
    ['cerrado_por', 'UPDATE cierres_caja SET cerrado_por = gen_random_uuid() WHERE id = $1::uuid'],
    ['cerrado_en', 'UPDATE cierres_caja SET cerrado_en = now() WHERE id = $1::uuid'],
    ['movimientos_hasta', 'UPDATE cierres_caja SET movimientos_hasta = 0 WHERE id = $1::uuid'],
    ['numero', 'UPDATE cierres_caja SET numero = 9 WHERE id = $1::uuid'],
    ['academia_id', 'UPDATE cierres_caja SET academia_id = gen_random_uuid() WHERE id = $1::uuid'],
    ['DELETE', 'DELETE FROM cierres_caja WHERE id = $1::uuid'],
  ])('criterio 2: un cierre no cambia sus montos ni se borra: %s (42501)', async (_campo, sql) => {
    await expect(comoApp(sql, [cierreId])).rejects.toMatchObject({ code: '42501' });
  });

  it('criterio 2: sí puede registrar la reapertura de un cierre (reabierto_por, reabierto_en y motivo_reapertura)', async () => {
    const resultado = await comoApp(
      `UPDATE cierres_caja SET reabierto_por = $2::uuid, reabierto_en = now() + interval '1 minute',
              motivo_reapertura = 'Se cerró por error' WHERE id = $1::uuid`,
      [cierreId, e.adminA.id],
    );

    expect(resultado.rowCount).toBe(1);
  });

  it.each(TABLAS_006)('criterio 2: TRUNCATE de %s falla con 42501', async (tabla) => {
    await expect(comoApp(`TRUNCATE ${tabla}`)).rejects.toMatchObject({ code: '42501' });
  });
});
