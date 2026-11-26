// spec: 005-inscripcion-publica (pruebas protegidas)
// Actualizada por la 007 (spec 007-pagos, criterio 2 y DT-18): `UPDATE_EXACTO` suma `estado` y `usuario_id` en `alumnos`, y `monto_ajustado` y
// `motivo_ajuste` en `matriculas` (la confirmación del pago y el ajuste del administrador los necesitan). CAMBIO APROBADO POR EL ORQUESTADOR (no
// solo suma, DT-18): se quitan los tres intentos que esperaban 42501 en `alumnos.estado`, `alumnos.usuario_id` y `matriculas.monto_ajustado`, y «el
// estado» del título de la prueba de `alumnos`. El DNI, la `academia_id`, el `id` y `creado_en` siguen prohibidos y comprobados; el nuevo
// `UPDATE_EXACTO` sigue fijando los privilegios exactos.
// Actualizada por la 008 (spec 008-carnet-qr, criterio 1): `UPDATE_EXACTO` suma `qr_token`, `qr_generado_en` y `qr_clave_idempotencia` en `alumnos`. No se quitó ni se cambió nada más.
// Actualizada por la 009 (spec 009-asistencia, criterio 1 e «Impacto en especificaciones anteriores»; CAMBIO APROBADO POR BRYAN el 25/11/2026): `UPDATE_EXACTO` suma `clases_usadas` en `matriculas` (cada asistencia descuenta una clase en la misma
// transacción del marcado). Se quita el intento de `clases_usadas` que esperaba 42501 y se agrega, en su lugar, que la app sí puede subirla y que el CHECK de la 005 sigue impidiendo pasar de `clases_totales` (23514). El precio, los montos, las clases
// totales, el año, el mes, el alumno, el plan y la `academia_id` siguen prohibidos y comprobados; el nuevo `UPDATE_EXACTO` sigue fijando los privilegios exactos.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import {
  actualizarFilas,
  exigirTablasDeInscripcion,
  filaValida,
  leerAlumnos,
  leerApoderados,
  leerMatriculas,
  leerSolicitudes,
  sembrarSolicitud,
  TABLAS_005,
  type SolicitudSembrada,
  type Tabla005,
} from '../../utilidades/inscripciones';
import { crearClaseDePrueba, crearEntrenadorDePrueba, crearPlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 2 (crítico, D-23, Ley 29733): privilegios mínimos de `aquagestion_app` en las siete tablas: SELECT e INSERT; UPDATE solo de
// las columnas de "Cambios al modelo de datos"; DELETE solo en `apoderados`; nunca TRUNCATE, REFERENCES ni TRIGGER. No puede cambiar el
// DNI de un alumno, el código ni el token de una solicitud, ni la `academia_id` de ninguna fila, ni borrar consentimientos,
// solicitudes ni matrículas. PRIVILEGIOS_APP y scripts/lib/rol-app.mjs se amplían igual (las pruebas protegidas de la 001 que comparan la
// lista exacta se actualizaron en este mismo cambio) y la API sigue atendiendo (criterio 102 de la 001).
// P4: el rol no tiene UPDATE sobre `creado_en` de `apoderados` ni de `fichas_medicas`.

const ROL = 'aquagestion_app';

const UPDATE_EXACTO: Record<Tabla005, string[]> = {
  alumnos: [
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
  ],
  solicitudes_inscripcion: ['actualizado_en', 'estado'],
  matriculas: ['actualizado_en', 'clases_usadas', 'estado', 'monto_ajustado', 'motivo_ajuste', 'reserva_vence_en'],
  consentimientos: [],
  matricula_clases: [],
  apoderados: ['actualizado_en', 'apellidos', 'correo', 'dni', 'nombres', 'parentesco', 'telefono'],
  fichas_medicas: [
    'actualizado_en',
    'alergias',
    'contacto_emergencia_nombre',
    'contacto_emergencia_telefono',
    'enfermedades',
    'medicamentos',
    'seguro',
    'tipo_sangre',
  ],
};

describe.each(TABLAS_005)('criterio 2: privilegios exactos de aquagestion_app sobre %s', (tabla) => {
  beforeEach(exigirTablasDeInscripcion);

  it('criterio 2: sobre la tabla tiene SELECT e INSERT, DELETE solo en apoderados, y ni UPDATE de tabla entera, TRUNCATE, REFERENCES ni TRIGGER', async () => {
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
      {
        SELECT: true,
        INSERT: true,
        UPDATE: false,
        DELETE: tabla === 'apoderados',
        TRUNCATE: false,
        REFERENCES: false,
        TRIGGER: false,
      },
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
    const conUpdate = filas.filter((fila) => fila.puede).map((fila) => fila.columna);

    expect(conUpdate).toEqual(UPDATE_EXACTO[tabla]);
    expect(conUpdate, 'P4: sin UPDATE sobre creado_en').not.toContain('creado_en');
    expect(filas.filter((fila) => fila.referencia)).toEqual([]);
  });
});

describe('criterio 2: lo que el rol de la app puede y no puede escribir', () => {
  let A: { id: string };
  let B: { id: string };
  let cliente: SolicitudSembrada;
  let planId: string;
  let claseId: string;

  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    B = await crearAcademiaDePrueba();
    const entrenador = await crearEntrenadorDePrueba(A.id);
    planId = (await crearPlanDePrueba(A.id)).id;
    claseId = (await crearClaseDePrueba(A.id, entrenador.id)).id;
    cliente = await sembrarSolicitud(A.id, { planId, claseIds: [claseId], conApoderado: true });
  });

  const comoApp = (sql: string, parametros: unknown[] = []) =>
    ejecutarComo('app', sql, parametros, { academiaId: A.id });

  it('criterio 2: no puede cambiar el DNI, la academia_id, el id ni creado_en de un alumno, ni borrarlo (42501)', async () => {
    const intentos: [string, string, unknown[]][] = [
      ['dni', "UPDATE alumnos SET dni = '99999999' WHERE id = $1::uuid", [cliente.alumnoId]],
      ['academia_id', 'UPDATE alumnos SET academia_id = $2::uuid WHERE id = $1::uuid', [cliente.alumnoId, B.id]],
      ['id', 'UPDATE alumnos SET id = gen_random_uuid() WHERE id = $1::uuid', [cliente.alumnoId]],
      ['creado_en', 'UPDATE alumnos SET creado_en = now() WHERE id = $1::uuid', [cliente.alumnoId]],
      ['DELETE', 'DELETE FROM alumnos WHERE id = $1::uuid', [cliente.alumnoId]],
      ['TRUNCATE', 'TRUNCATE alumnos', []],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(comoApp(sql, parametros), nombre).rejects.toMatchObject({ code: '42501' });
    }
    expect((await leerAlumnos(A.id))[0]).toMatchObject({ dni: cliente.dni, estado: 'CLIENTE', usuario_id: null });
  });

  it('criterio 2: no puede cambiar el código, el hash del token, la clave de idempotencia, el alumno ni la academia_id de una solicitud, ni borrarla (42501)', async () => {
    const intentos: [string, string, unknown[]][] = [
      ['codigo', "UPDATE solicitudes_inscripcion SET codigo = 'AQ-AAAAAA' WHERE id = $1::uuid", [cliente.solicitudId]],
      [
        'token_hash',
        "UPDATE solicitudes_inscripcion SET token_hash = decode(repeat('ab', 32), 'hex') WHERE id = $1::uuid",
        [cliente.solicitudId],
      ],
      [
        'clave_idempotencia',
        'UPDATE solicitudes_inscripcion SET clave_idempotencia = gen_random_uuid() WHERE id = $1::uuid',
        [cliente.solicitudId],
      ],
      [
        'alumno_id',
        'UPDATE solicitudes_inscripcion SET alumno_id = gen_random_uuid() WHERE id = $1::uuid',
        [cliente.solicitudId],
      ],
      [
        'ip_origen',
        "UPDATE solicitudes_inscripcion SET ip_origen = '203.0.113.1' WHERE id = $1::uuid",
        [cliente.solicitudId],
      ],
      [
        'academia_id',
        'UPDATE solicitudes_inscripcion SET academia_id = $2::uuid WHERE id = $1::uuid',
        [cliente.solicitudId, B.id],
      ],
      ['DELETE', 'DELETE FROM solicitudes_inscripcion WHERE id = $1::uuid', [cliente.solicitudId]],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(comoApp(sql, parametros), nombre).rejects.toMatchObject({ code: '42501' });
    }
    expect((await leerSolicitudes(A.id))[0]).toMatchObject({ codigo: cliente.codigo, estado: 'PENDIENTE_PAGO' });
  });

  it('criterio 2: no puede cambiar el precio, los montos, las clases ni la academia_id de una matrícula, ni borrarla; no puede tocar ni borrar consentimientos ni matricula_clases (42501)', async () => {
    const intentos: [string, string, unknown[]][] = [
      ['precio_plan', 'UPDATE matriculas SET precio_plan = 1 WHERE id = $1::uuid', [cliente.matriculaId]],
      ['monto_calculado', 'UPDATE matriculas SET monto_calculado = 1 WHERE id = $1::uuid', [cliente.matriculaId]],
      ['clases_totales', 'UPDATE matriculas SET clases_totales = 1 WHERE id = $1::uuid', [cliente.matriculaId]],
      ['anio', 'UPDATE matriculas SET anio = 2027 WHERE id = $1::uuid', [cliente.matriculaId]],
      ['mes', 'UPDATE matriculas SET mes = 12 WHERE id = $1::uuid', [cliente.matriculaId]],
      ['alumno_id', 'UPDATE matriculas SET alumno_id = gen_random_uuid() WHERE id = $1::uuid', [cliente.matriculaId]],
      ['plan_id', 'UPDATE matriculas SET plan_id = gen_random_uuid() WHERE id = $1::uuid', [cliente.matriculaId]],
      ['academia_id', 'UPDATE matriculas SET academia_id = $2::uuid WHERE id = $1::uuid', [cliente.matriculaId, B.id]],
      ['DELETE matriculas', 'DELETE FROM matriculas WHERE id = $1::uuid', [cliente.matriculaId]],
      [
        'UPDATE consentimientos',
        "UPDATE consentimientos SET version = 'otra' WHERE alumno_id = $1::uuid",
        [cliente.alumnoId],
      ],
      ['DELETE consentimientos', 'DELETE FROM consentimientos WHERE alumno_id = $1::uuid', [cliente.alumnoId]],
      [
        'UPDATE matricula_clases',
        'UPDATE matricula_clases SET clase_id = gen_random_uuid() WHERE matricula_id = $1::uuid',
        [cliente.matriculaId],
      ],
      ['DELETE matricula_clases', 'DELETE FROM matricula_clases WHERE matricula_id = $1::uuid', [cliente.matriculaId]],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(comoApp(sql, parametros), nombre).rejects.toMatchObject({ code: '42501' });
    }
    expect((await leerMatriculas(A.id))[0]).toMatchObject({ precio_plan: '120.00', estado: 'RESERVADA' });
  });

  it('criterio 2: no puede cambiar la academia_id, el alumno ni creado_en de una ficha o de un apoderado (42501)', async () => {
    const intentos: [string, string, unknown[]][] = [
      [
        'ficha academia_id',
        'UPDATE fichas_medicas SET academia_id = $2::uuid WHERE alumno_id = $1::uuid',
        [cliente.alumnoId, B.id],
      ],
      [
        'ficha alumno_id',
        'UPDATE fichas_medicas SET alumno_id = gen_random_uuid() WHERE alumno_id = $1::uuid',
        [cliente.alumnoId],
      ],
      [
        'apoderado academia_id',
        'UPDATE apoderados SET academia_id = $2::uuid WHERE alumno_id = $1::uuid',
        [cliente.alumnoId, B.id],
      ],
      [
        'apoderado alumno_id',
        'UPDATE apoderados SET alumno_id = gen_random_uuid() WHERE alumno_id = $1::uuid',
        [cliente.alumnoId],
      ],
      ['DELETE ficha', 'DELETE FROM fichas_medicas WHERE alumno_id = $1::uuid', [cliente.alumnoId]],
      [
        'ficha creado_en (P4)',
        'UPDATE fichas_medicas SET creado_en = now() WHERE alumno_id = $1::uuid',
        [cliente.alumnoId],
      ],
      [
        'apoderado creado_en (P4)',
        'UPDATE apoderados SET creado_en = now() WHERE alumno_id = $1::uuid',
        [cliente.alumnoId],
      ],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(comoApp(sql, parametros), nombre).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('criterio 2: sí puede cambiar las columnas permitidas de un alumno, de su ficha y de su apoderado', async () => {
    const filas = await actualizarFilas(
      'app',
      'alumnos',
      A.id,
      { id: cliente.alumnoId },
      {
        nombres: 'Nuevo',
        apellidos: 'Apellido Nuevo',
        fecha_nacimiento: '1990-02-02',
        telefono: '911111111',
        correo: 'nuevo@ejemplo.test',
        direccion: 'Jr. Ejemplo 123',
        nivel: 'AVANZADO',
        foto_clave: 'academias/x/alumnos/y/foto-z.jpg',
        actualizado_en: '2026-02-02T00:00:00.000Z',
      },
    );

    expect(filas).toBe(1);
    expect((await leerAlumnos(A.id))[0]).toMatchObject({
      nombres: 'Nuevo',
      nivel: 'AVANZADO',
      correo: 'nuevo@ejemplo.test',
      foto_clave: 'academias/x/alumnos/y/foto-z.jpg',
      dni: cliente.dni,
    });
    await comoApp(
      `UPDATE fichas_medicas SET enfermedades = 'ninguna', contacto_emergencia_nombre = 'Otra persona', actualizado_en = now()
        WHERE alumno_id = $1::uuid`,
      [cliente.alumnoId],
    );
    await comoApp(
      `UPDATE apoderados SET nombres = 'Otro', dni = '11112222', parentesco = parentesco, correo = 'a@ejemplo.test',
              actualizado_en = now() WHERE alumno_id = $1::uuid`,
      [cliente.alumnoId],
    );
    expect((await leerApoderados(A.id))[0]).toMatchObject({ nombres: 'Otro', dni: '11112222' });
  });

  it('criterio 2 (009): sí puede subir clases_usadas de una matrícula, pero no por encima de clases_totales (23514)', async () => {
    await comoApp(
      'UPDATE matriculas SET clases_usadas = clases_usadas + 1, actualizado_en = now() WHERE id = $1::uuid',
      [cliente.matriculaId],
    );

    expect((await leerMatriculas(A.id))[0]).toMatchObject({ clases_usadas: 1 });
    await expect(
      comoApp('UPDATE matriculas SET clases_usadas = clases_totales + 1 WHERE id = $1::uuid', [cliente.matriculaId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('criterio 2: sí puede cambiar el estado de una solicitud y de una matrícula y el vencimiento de la reserva', async () => {
    await comoApp(`UPDATE solicitudes_inscripcion SET estado = 'VENCIDA', actualizado_en = now() WHERE id = $1::uuid`, [
      cliente.solicitudId,
    ]);
    await comoApp(
      `UPDATE matriculas SET estado = 'CANCELADA', reserva_vence_en = NULL, actualizado_en = now() WHERE id = $1::uuid`,
      [cliente.matriculaId],
    );

    expect((await leerSolicitudes(A.id))[0]?.estado).toBe('VENCIDA');
    expect((await leerMatriculas(A.id))[0]).toMatchObject({ estado: 'CANCELADA', reserva_vence_en: null });
  });

  it('criterio 2: sí puede borrar al apoderado (el único DELETE) y crear filas de su academia', async () => {
    const borrados = await comoApp('DELETE FROM apoderados WHERE alumno_id = $1::uuid', [cliente.alumnoId]);

    expect(borrados.rowCount).toBe(1);
    expect(await leerApoderados(A.id)).toEqual([]);
    const nuevo = await filaValida('alumnos', {});
    await ejecutarComo(
      'app',
      `INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, creado_en, actualizado_en)
       VALUES ($1::uuid, $2::uuid, $3, 'Creado', 'Por la app', '2000-01-15', '987654321', 'BASICO', 'CLIENTE', now(), now())`,
      [nuevo['id'], A.id, nuevo['dni']],
      { academiaId: A.id },
    );
    expect((await leerAlumnos(A.id)).map((fila) => fila.dni)).toContain(nuevo['dni']);
  });
});

describe('criterio 2: la API sigue atendiendo con los privilegios nuevos', () => {
  it('criterio 2: PRIVILEGIOS_APP incluye los de las siete tablas: la API no se niega a atender datos por "privilegios de más" (criterio 102 de la 001)', async () => {
    await exigirTablasDeInscripcion();
    await limpiarBase();
    await crearAcademiaDePrueba({ nombreCorto: 'academia-a', nombre: 'Academia A' });
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      const respuesta = await request(app.getHttpServer()).get('/api/a/academia-a');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({ nombreCorto: 'academia-a', nombre: 'Academia A', telefono: null });
    } finally {
      await app.close();
    }
  });
});
