// spec: 007-pagos (pruebas protegidas)
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo } from '../../utilidades/base-datos';
import { crearEscenarioDePagos, type EscenarioPagos, sembrarCobrable } from '../../utilidades/escenario-pagos';
import { type SolicitudSembrada, leerAlumnos, leerMatriculas, leerSolicitudes } from '../../utilidades/inscripciones';
import { exigirTablaDePagos, filaPagoValida, insertarPago, leerPagos } from '../../utilidades/pagos';

// Criterio 2 (crítico, D-23, RN-22): privilegios mínimos de `aquagestion_app` en `pagos`: SELECT, INSERT y UPDATE solo de `estado`, `verificado_por`,
// `verificado_en`, `motivo_rechazo`, `numero_ticket` y `actualizado_en`; sin DELETE, TRUNCATE, REFERENCES ni TRIGGER. No puede cambiar el monto, el
// método, el número de operación, el comprobante, la fecha de operación, la matrícula ni el alumno de un pago, ni la `academia_id` de ninguna fila.
// Suma UPDATE de `alumnos.estado` y `alumnos.usuario_id`, y de `matriculas.monto_ajustado` y `matriculas.motivo_ajuste`; `solicitudes_inscripcion.registrada_por`
// solo se escribe al insertar. `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` se amplían igual (las pruebas protegidas de la 001 que comparan la lista exacta se
// actualizaron en este mismo cambio) y la API sigue atendiendo (criterio 102 de la 001).

const ROL = 'aquagestion_app';

describe('criterio 2: privilegios exactos de aquagestion_app sobre pagos', () => {
  beforeEach(exigirTablaDePagos);

  it('criterio 2: tiene SELECT e INSERT, y ni UPDATE de tabla entera, DELETE, TRUNCATE, REFERENCES ni TRIGGER', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT pg_catalog.has_table_privilege($1::name, 'public.pagos', 'SELECT') AS "SELECT",
              pg_catalog.has_table_privilege($1::name, 'public.pagos', 'INSERT') AS "INSERT",
              pg_catalog.has_table_privilege($1::name, 'public.pagos', 'UPDATE') AS "UPDATE",
              pg_catalog.has_table_privilege($1::name, 'public.pagos', 'DELETE') AS "DELETE",
              pg_catalog.has_table_privilege($1::name, 'public.pagos', 'TRUNCATE') AS "TRUNCATE",
              pg_catalog.has_table_privilege($1::name, 'public.pagos', 'REFERENCES') AS "REFERENCES",
              pg_catalog.has_table_privilege($1::name, 'public.pagos', 'TRIGGER') AS "TRIGGER"`,
      [ROL],
    );

    expect(rows).toEqual([
      { SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false },
    ]);
  });

  it('criterio 2: UPDATE solo de estado, verificado_por, verificado_en, motivo_rechazo, numero_ticket y actualizado_en, y ninguna columna con REFERENCES', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT a.attname AS columna,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'UPDATE') AS puede,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'REFERENCES') AS referencia
         FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        WHERE c.oid = 'public.pagos'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attname`,
      [ROL],
    );
    const filas = rows as { columna: string; puede: boolean; referencia: boolean }[];

    expect(filas.filter((fila) => fila.puede).map((fila) => fila.columna)).toEqual([
      'actualizado_en',
      'estado',
      'motivo_rechazo',
      'numero_ticket',
      'verificado_en',
      'verificado_por',
    ]);
    expect(filas.filter((fila) => fila.referencia)).toEqual([]);
  });

  it('criterio 2: los privilegios nuevos sobre otras tablas son exactamente los pedidos: alumnos (estado, usuario_id), matriculas (monto_ajustado, motivo_ajuste) y ninguno sobre solicitudes_inscripcion.registrada_por', async () => {
    const puede = async (tabla: string, columna: string): Promise<boolean> => {
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT pg_catalog.has_column_privilege($1::name, ('public.' || $2)::regclass, $3::name, 'UPDATE') AS puede`,
        [ROL, tabla, columna],
      );
      return (rows[0] as { puede: boolean }).puede;
    };

    expect(await puede('alumnos', 'estado')).toBe(true);
    expect(await puede('alumnos', 'usuario_id')).toBe(true);
    expect(await puede('matriculas', 'monto_ajustado')).toBe(true);
    expect(await puede('matriculas', 'motivo_ajuste')).toBe(true);
    expect(await puede('solicitudes_inscripcion', 'registrada_por'), 'registrada_por solo se escribe al insertar').toBe(
      false,
    );
    for (const [tabla, columna] of [
      ['alumnos', 'dni'],
      ['alumnos', 'academia_id'],
      ['matriculas', 'precio_plan'],
      ['matriculas', 'monto_calculado'],
      ['matriculas', 'clases_totales'],
      ['matriculas', 'academia_id'],
      ['solicitudes_inscripcion', 'academia_id'],
    ] as const) {
      expect(await puede(tabla, columna), `${tabla}.${columna} sigue sin UPDATE`).toBe(false);
    }
  });
});

describe('criterio 2: lo que el rol de la app puede y no puede escribir en pagos', () => {
  let e: EscenarioPagos;
  let cliente: SolicitudSembrada;
  let pagoId: string;

  beforeEach(async () => {
    e = await crearEscenarioDePagos();
    cliente = await sembrarCobrable(e);
    const fila = filaPagoValida(e.A.id, { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId });
    await insertarPago('propietario', e.A.id, fila);
    pagoId = fila['id'] as string;
  });

  const comoApp = (sql: string, parametros: unknown[] = []) =>
    ejecutarComo('app', sql, parametros, { academiaId: e.A.id });

  it('criterio 2: no puede cambiar el monto, el método, el concepto, el número de operación, el comprobante, la fecha de operación, la matrícula, el alumno ni la academia_id de un pago (42501)', async () => {
    const intentos: [string, string, unknown[]][] = [
      ['monto', 'UPDATE pagos SET monto = 1 WHERE id = $1::uuid', [pagoId]],
      ['metodo', "UPDATE pagos SET metodo = 'TRANSFERENCIA' WHERE id = $1::uuid", [pagoId]],
      ['concepto', "UPDATE pagos SET concepto = 'MENSUALIDAD' WHERE id = $1::uuid", [pagoId]],
      ['numero_operacion', "UPDATE pagos SET numero_operacion = '99999' WHERE id = $1::uuid", [pagoId]],
      [
        'numero_operacion_normalizado',
        "UPDATE pagos SET numero_operacion_normalizado = '99999' WHERE id = $1::uuid",
        [pagoId],
      ],
      ['comprobante_clave', "UPDATE pagos SET comprobante_clave = 'otra' WHERE id = $1::uuid", [pagoId]],
      ['fecha_operacion', "UPDATE pagos SET fecha_operacion = '2026-11-01' WHERE id = $1::uuid", [pagoId]],
      ['ip_origen', "UPDATE pagos SET ip_origen = '198.51.100.1' WHERE id = $1::uuid", [pagoId]],
      ['matricula_id', 'UPDATE pagos SET matricula_id = gen_random_uuid() WHERE id = $1::uuid', [pagoId]],
      ['alumno_id', 'UPDATE pagos SET alumno_id = gen_random_uuid() WHERE id = $1::uuid', [pagoId]],
      ['registrado_por', 'UPDATE pagos SET registrado_por = $2::uuid WHERE id = $1::uuid', [pagoId, e.secretariaA.id]],
      ['registrado_en', 'UPDATE pagos SET registrado_en = now() WHERE id = $1::uuid', [pagoId]],
      ['clave_idempotencia', 'UPDATE pagos SET clave_idempotencia = gen_random_uuid() WHERE id = $1::uuid', [pagoId]],
      ['id', 'UPDATE pagos SET id = gen_random_uuid() WHERE id = $1::uuid', [pagoId]],
      ['creado_en', 'UPDATE pagos SET creado_en = now() WHERE id = $1::uuid', [pagoId]],
      ['academia_id', 'UPDATE pagos SET academia_id = $2::uuid WHERE id = $1::uuid', [pagoId, e.B.id]],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(comoApp(sql, parametros), nombre).rejects.toMatchObject({ code: '42501' });
    }
    expect((await leerPagos(e.A.id))[0]).toMatchObject({
      monto: '42.00',
      metodo: 'YAPE',
      estado: 'PENDIENTE_VERIFICACION',
      matricula_id: cliente.matriculaId,
      alumno_id: cliente.alumnoId,
    });
  });

  it('criterio 2: no puede borrar ni vaciar pagos (42501)', async () => {
    await expect(comoApp('DELETE FROM pagos WHERE id = $1::uuid', [pagoId])).rejects.toMatchObject({ code: '42501' });
    await expect(comoApp('TRUNCATE pagos')).rejects.toMatchObject({ code: '42501' });
    expect(await leerPagos(e.A.id)).toHaveLength(1);
  });

  it('criterio 2: sí puede resolver un pago pendiente (estado, verificado_por, verificado_en, motivo_rechazo y actualizado_en)', async () => {
    const resultado = await comoApp(
      `UPDATE pagos SET estado = 'RECHAZADO', verificado_por = $2::uuid, verificado_en = $3::timestamptz,
              motivo_rechazo = 'La imagen no se lee', actualizado_en = $3::timestamptz WHERE id = $1::uuid`,
      [pagoId, e.secretariaA.id, '2026-11-11T14:50:00.000Z'],
    );

    expect(resultado.rowCount).toBe(1);
    expect((await leerPagos(e.A.id))[0]).toMatchObject({
      estado: 'RECHAZADO',
      verificado_por: e.secretariaA.id,
      motivo_rechazo: 'La imagen no se lee',
    });
  });

  it('criterio 2: sí puede insertar pagos de su academia, también el de otra solicitud (control)', async () => {
    const otro = await sembrarCobrable(e);

    await insertarPago(
      'app',
      e.A.id,
      filaPagoValida(e.A.id, { alumnoId: otro.alumnoId, matriculaId: otro.matriculaId }),
    );

    expect(await leerPagos(e.A.id)).toHaveLength(2);
  });

  it('criterio 2: sí puede cambiar alumnos.estado y alumnos.usuario_id, y matriculas.monto_ajustado y matriculas.motivo_ajuste; no el DNI ni la academia_id', async () => {
    await comoApp(
      `UPDATE alumnos SET estado = 'ALUMNO_ACTIVO', usuario_id = $2::uuid, actualizado_en = now() WHERE id = $1::uuid`,
      [cliente.alumnoId, e.alumnoA.id],
    );
    await comoApp(
      `UPDATE matriculas SET monto_ajustado = 35, motivo_ajuste = 'Descuento autorizado', actualizado_en = now() WHERE id = $1::uuid`,
      [cliente.matriculaId],
    );

    expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)).toMatchObject({
      estado: 'ALUMNO_ACTIVO',
      usuario_id: e.alumnoA.id,
      dni: cliente.dni,
    });
    expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)).toMatchObject({
      monto_ajustado: '35.00',
      motivo_ajuste: 'Descuento autorizado',
      precio_plan: '100.00',
    });
    await expect(
      comoApp("UPDATE alumnos SET dni = '99999999' WHERE id = $1::uuid", [cliente.alumnoId]),
    ).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      comoApp('UPDATE matriculas SET academia_id = $2::uuid WHERE id = $1::uuid', [cliente.matriculaId, e.B.id]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('criterio 2 y 7: registrada_por se escribe al insertar la solicitud, pero la app no puede cambiarlo después (42501)', async () => {
    await expect(
      comoApp('UPDATE solicitudes_inscripcion SET registrada_por = $2::uuid WHERE id = $1::uuid', [
        cliente.solicitudId,
        e.secretariaA.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    expect((await leerSolicitudes(e.A.id)).find((s) => s.id === cliente.solicitudId)?.estado).toBe('PENDIENTE_PAGO');
  });
});

describe('criterio 2: la API sigue atendiendo con los privilegios nuevos', () => {
  it('criterio 2: PRIVILEGIOS_APP incluye los de pagos: la API no se niega a atender datos por «privilegios de más» (criterio 102 de la 001)', async () => {
    await exigirTablaDePagos();
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
