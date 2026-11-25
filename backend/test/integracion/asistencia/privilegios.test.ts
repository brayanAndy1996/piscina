// spec: 009-asistencia (pruebas protegidas)
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo } from '../../utilidades/base-datos';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import {
  exigirTablaDeAsistencias,
  filaAsistenciaValida,
  insertarAsistencia,
  leerAsistencias,
} from '../../utilidades/escenario-asistencia';
import { leerMatriculas, sembrarSolicitud, type SolicitudSembrada } from '../../utilidades/inscripciones';

// Criterio 1 (crítico, D-23, RN-16; «Cambio de privilegio aprobado» del 25/11/2026): privilegios mínimos de `aquagestion_app`:
//   - en `asistencias`: SELECT e INSERT y nada más: ni UPDATE (de tabla ni de ninguna columna), ni DELETE, ni TRUNCATE, ni REFERENCES, ni TRIGGER. Una asistencia no se corrige ni se borra (42501);
//   - en `matriculas`: gana `UPDATE (clases_usadas)` y sigue sin poder cambiar el precio, los montos de la matrícula, las clases totales, el año, el mes, el alumno, el plan ni la `academia_id`. Con el
//     descuento por encima de `clases_totales`, el CHECK de la 005 falla con 23514.
// `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` se amplían igual (las pruebas protegidas de la 001 que comparan la lista exacta y la de la 005 se actualizaron en este mismo cambio) y la API sigue
// atendiendo (criterio 102 de la 001).

const ROL = 'aquagestion_app';

describe('criterio 1: privilegios exactos de aquagestion_app sobre asistencias', () => {
  beforeEach(exigirTablaDeAsistencias);

  it('criterio 1: tiene SELECT e INSERT, y ni UPDATE de tabla entera, DELETE, TRUNCATE, REFERENCES ni TRIGGER', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT pg_catalog.has_table_privilege($1::name, 'public.asistencias', 'SELECT') AS "SELECT",
              pg_catalog.has_table_privilege($1::name, 'public.asistencias', 'INSERT') AS "INSERT",
              pg_catalog.has_table_privilege($1::name, 'public.asistencias', 'UPDATE') AS "UPDATE",
              pg_catalog.has_table_privilege($1::name, 'public.asistencias', 'DELETE') AS "DELETE",
              pg_catalog.has_table_privilege($1::name, 'public.asistencias', 'TRUNCATE') AS "TRUNCATE",
              pg_catalog.has_table_privilege($1::name, 'public.asistencias', 'REFERENCES') AS "REFERENCES",
              pg_catalog.has_table_privilege($1::name, 'public.asistencias', 'TRIGGER') AS "TRIGGER"`,
      [ROL],
    );

    expect(rows).toEqual([
      { SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false },
    ]);
  });

  it('criterio 1: ninguna columna de asistencias tiene UPDATE ni REFERENCES para la app', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT a.attname AS columna,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'UPDATE') AS puede,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'REFERENCES') AS referencia
         FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        WHERE c.oid = 'public.asistencias'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attname`,
      [ROL],
    );
    const filas = rows as { columna: string; puede: boolean; referencia: boolean }[];

    expect(filas.length).toBeGreaterThanOrEqual(15);
    expect(filas.filter((fila) => fila.puede)).toEqual([]);
    expect(filas.filter((fila) => fila.referencia)).toEqual([]);
  });

  it('criterio 1: en matriculas, la app puede cambiar exactamente actualizado_en, clases_usadas, estado, monto_ajustado, motivo_ajuste y reserva_vence_en', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT a.attname AS columna, pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'UPDATE') AS puede
         FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        WHERE c.oid = 'public.matriculas'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attname`,
      [ROL],
    );

    expect(
      (rows as { columna: string; puede: boolean }[]).filter((fila) => fila.puede).map((fila) => fila.columna),
    ).toEqual(['actualizado_en', 'clases_usadas', 'estado', 'monto_ajustado', 'motivo_ajuste', 'reserva_vence_en']);
  });
});

describe('criterio 1: lo que el rol de la app puede y no puede escribir', () => {
  let e: EscenarioPagos;
  let cliente: SolicitudSembrada;
  let asistenciaId: string;

  beforeEach(async () => {
    await exigirTablaDeAsistencias();
    e = await crearEscenarioDePagos();
    cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], clasesTotales: 12 });
    const fila = filaAsistenciaValida({
      alumnoId: cliente.alumnoId,
      matriculaId: cliente.matriculaId,
      claseId: e.lunes.id,
      usuarioId: e.secretariaA.id,
    });
    await insertarAsistencia('propietario', e.A.id, fila);
    asistenciaId = fila['id'] as string;
  });

  const comoApp = (sql: string, parametros: unknown[] = []) =>
    ejecutarComo('app', sql, parametros, { academiaId: e.A.id });

  it('criterio 1: no puede corregir ni borrar una asistencia: UPDATE de cualquier columna, DELETE y TRUNCATE fallan con 42501', async () => {
    const intentos: [string, string, unknown[]][] = [
      ['estado_llegada', "UPDATE asistencias SET estado_llegada = 'TARDE' WHERE id = $1::uuid", [asistenciaId]],
      ['metodo', "UPDATE asistencias SET metodo = 'MANUAL' WHERE id = $1::uuid", [asistenciaId]],
      ['tipo', "UPDATE asistencias SET tipo = 'RECUPERACION' WHERE id = $1::uuid", [asistenciaId]],
      ['motivo', "UPDATE asistencias SET motivo = 'otro' WHERE id = $1::uuid", [asistenciaId]],
      ['fecha', "UPDATE asistencias SET fecha = DATE '2026-11-23' WHERE id = $1::uuid", [asistenciaId]],
      ['llegada_en', 'UPDATE asistencias SET llegada_en = now() WHERE id = $1::uuid', [asistenciaId]],
      ['clase_id', 'UPDATE asistencias SET clase_id = $2::uuid WHERE id = $1::uuid', [asistenciaId, e.miercoles.id]],
      ['academia_id', 'UPDATE asistencias SET academia_id = $2::uuid WHERE id = $1::uuid', [asistenciaId, e.B.id]],
      ['DELETE', 'DELETE FROM asistencias WHERE id = $1::uuid', [asistenciaId]],
      ['TRUNCATE', 'TRUNCATE asistencias', []],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(comoApp(sql, parametros), nombre).rejects.toMatchObject({ code: '42501' });
    }
    expect(await leerAsistencias(e.A.id)).toHaveLength(1);
    expect((await leerAsistencias(e.A.id))[0]).toMatchObject({
      estado_llegada: 'PUNTUAL',
      metodo: 'QR',
      tipo: 'NORMAL',
    });
  });

  it('criterio 1: sí puede subir clases_usadas de una matrícula de su academia y actualizar su actualizado_en (el descuento de cada asistencia)', async () => {
    const resultado = await comoApp(
      'UPDATE matriculas SET clases_usadas = clases_usadas + 1, actualizado_en = $2::timestamptz WHERE id = $1::uuid',
      [cliente.matriculaId, '2026-11-16T23:05:00.000Z'],
    );

    expect(resultado.rowCount).toBe(1);
    expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)).toMatchObject({
      clases_usadas: 1,
      clases_totales: 12,
    });
  });

  it('criterio 1: clases_usadas mayor que clases_totales falla con 23514 y la matrícula no cambia', async () => {
    await expect(
      comoApp('UPDATE matriculas SET clases_usadas = clases_totales + 1 WHERE id = $1::uuid', [cliente.matriculaId]),
    ).rejects.toMatchObject({ code: '23514' });

    expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)?.clases_usadas).toBe(0);
  });

  it('criterio 1: sigue sin poder cambiar el precio, los montos, las clases totales, el año, el mes, el alumno, el plan ni la academia_id de una matrícula (42501)', async () => {
    const intentos: [string, string, unknown[]][] = [
      ['precio_plan', 'UPDATE matriculas SET precio_plan = 1 WHERE id = $1::uuid', [cliente.matriculaId]],
      ['monto_calculado', 'UPDATE matriculas SET monto_calculado = 1 WHERE id = $1::uuid', [cliente.matriculaId]],
      ['clases_totales', 'UPDATE matriculas SET clases_totales = 1 WHERE id = $1::uuid', [cliente.matriculaId]],
      ['anio', 'UPDATE matriculas SET anio = 2027 WHERE id = $1::uuid', [cliente.matriculaId]],
      ['mes', 'UPDATE matriculas SET mes = 12 WHERE id = $1::uuid', [cliente.matriculaId]],
      [
        'fecha_inicio',
        "UPDATE matriculas SET fecha_inicio = DATE '2026-11-02' WHERE id = $1::uuid",
        [cliente.matriculaId],
      ],
      ['creado_en', 'UPDATE matriculas SET creado_en = now() WHERE id = $1::uuid', [cliente.matriculaId]],
      ['alumno_id', 'UPDATE matriculas SET alumno_id = gen_random_uuid() WHERE id = $1::uuid', [cliente.matriculaId]],
      ['plan_id', 'UPDATE matriculas SET plan_id = gen_random_uuid() WHERE id = $1::uuid', [cliente.matriculaId]],
      [
        'academia_id',
        'UPDATE matriculas SET academia_id = $2::uuid WHERE id = $1::uuid',
        [cliente.matriculaId, e.B.id],
      ],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(comoApp(sql, parametros), nombre).rejects.toMatchObject({ code: '42501' });
    }
  });
});

describe('criterio 1: la API sigue atendiendo con los privilegios nuevos', () => {
  it('criterio 1: PRIVILEGIOS_APP incluye los de asistencias y clases_usadas: la API no se niega a atender datos por «privilegios de más» (criterio 102 de la 001)', async () => {
    await exigirTablaDeAsistencias();
    const e = await crearEscenarioDePagos();
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      const respuesta = await request(app.getHttpServer()).get('/api/a/academia-a');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({ nombreCorto: 'academia-a', nombre: e.A.nombre, telefono: null });
    } finally {
      await app.close();
    }
  });
});
