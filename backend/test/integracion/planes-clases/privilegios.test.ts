// spec: 004-planes-clases-aforo (pruebas protegidas)
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import {
  actualizarFila,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  crearPlanDePrueba,
  exigirTablasDePlanesYClases,
  leerClase,
  leerPlan,
} from '../../utilidades/planes-clases';

// Criterio 2 (crítico, D-23): privilegios mínimos del rol aquagestion_app sobre las tablas nuevas. En `planes`: SELECT, INSERT y UPDATE de
// nombre, veces_por_semana, clases_por_mes, duracion_minutos, precio, dias_permitidos, franjas_permitidas, niveles_aplicables,
// vigencia_inicio, vigencia_fin, activo y actualizado_en. En `clases`: SELECT, INSERT y UPDATE de entrenador_id, aforo, activo y
// actualizado_en (no puede cambiar el nivel, el día ni la hora de una clase, ni la academia_id de ninguna fila). Sin DELETE, TRUNCATE,
// REFERENCES ni TRIGGER. PRIVILEGIOS_APP y scripts/lib/rol-app.mjs se amplían igual (las pruebas protegidas de la 001 que comparan la
// lista exacta se actualizaron en este mismo cambio) y la API sigue atendiendo (criterio 102 de la 001).

const ROL = 'aquagestion_app';

const UPDATE_DE_PLANES = [
  'activo',
  'actualizado_en',
  'clases_por_mes',
  'dias_permitidos',
  'duracion_minutos',
  'franjas_permitidas',
  'niveles_aplicables',
  'nombre',
  'precio',
  'veces_por_semana',
  'vigencia_fin',
  'vigencia_inicio',
];
const UPDATE_DE_CLASES = ['activo', 'actualizado_en', 'aforo', 'entrenador_id'];

describe.each([
  ['planes', UPDATE_DE_PLANES],
  ['clases', UPDATE_DE_CLASES],
] as const)('criterio 2: privilegios exactos de aquagestion_app sobre %s', (tabla, columnasConUpdate) => {
  beforeAll(exigirTablasDePlanesYClases);

  it('criterio 2: sobre la tabla tiene exactamente SELECT e INSERT (sin UPDATE de tabla entera, DELETE, TRUNCATE, REFERENCES ni TRIGGER)', async () => {
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

    expect(filas.filter((fila) => fila.puede).map((fila) => fila.columna)).toEqual([...columnasConUpdate]);
    expect(filas.filter((fila) => fila.referencia)).toEqual([]);
  });
});

describe('criterio 2: lo que el rol de la app puede y no puede escribir', () => {
  beforeAll(exigirTablasDePlanesYClases);

  it('criterio 2: no puede cambiar la academia_id, el id ni creado_en de un plan, ni borrarlo (42501)', async () => {
    await limpiarBase();
    const A = await crearAcademiaDePrueba();
    const B = await crearAcademiaDePrueba();
    const plan = await crearPlanDePrueba(A.id);

    const intentos: [string, string, unknown[]][] = [
      ['academia_id', 'UPDATE planes SET academia_id = $2::uuid WHERE id = $1::uuid', [plan.id, B.id]],
      ['id', 'UPDATE planes SET id = gen_random_uuid() WHERE id = $1::uuid', [plan.id]],
      ['creado_en', 'UPDATE planes SET creado_en = now() WHERE id = $1::uuid', [plan.id]],
      ['DELETE', 'DELETE FROM planes WHERE id = $1::uuid', [plan.id]],
      ['TRUNCATE', 'TRUNCATE planes', []],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(ejecutarComo('app', sql, parametros, { academiaId: A.id }), nombre).rejects.toMatchObject({
        code: '42501',
      });
    }
    expect(await leerPlan(A.id, plan.id)).toMatchObject({ nombre: plan.nombre, precio: '120.00' });
  });

  it('criterio 2: no puede cambiar el nivel, el día, la hora ni la academia_id de una clase, ni borrarla (42501)', async () => {
    await limpiarBase();
    const A = await crearAcademiaDePrueba();
    const B = await crearAcademiaDePrueba();
    const entrenador = await crearEntrenadorDePrueba(A.id);
    const clase = await crearClaseDePrueba(A.id, entrenador.id);

    const intentos: [string, string, unknown[]][] = [
      ['nivel', "UPDATE clases SET nivel = 'AVANZADO' WHERE id = $1::uuid", [clase.id]],
      ['dia_semana', 'UPDATE clases SET dia_semana = 2 WHERE id = $1::uuid', [clase.id]],
      ['hora_inicio', "UPDATE clases SET hora_inicio = '09:00', hora_fin = '10:00' WHERE id = $1::uuid", [clase.id]],
      ['hora_fin', "UPDATE clases SET hora_fin = '09:00' WHERE id = $1::uuid", [clase.id]],
      ['academia_id', 'UPDATE clases SET academia_id = $2::uuid WHERE id = $1::uuid', [clase.id, B.id]],
      ['id', 'UPDATE clases SET id = gen_random_uuid() WHERE id = $1::uuid', [clase.id]],
      ['creado_en', 'UPDATE clases SET creado_en = now() WHERE id = $1::uuid', [clase.id]],
      ['DELETE', 'DELETE FROM clases WHERE id = $1::uuid', [clase.id]],
      ['TRUNCATE', 'TRUNCATE clases', []],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(ejecutarComo('app', sql, parametros, { academiaId: A.id }), nombre).rejects.toMatchObject({
        code: '42501',
      });
    }
    expect(await leerClase(A.id, clase.id)).toMatchObject({
      nivel: 'BASICO',
      dia_semana: 1,
      hora_inicio: '08:00',
      hora_fin: '09:00',
    });
  });

  it('criterio 2: sí puede cambiar las columnas permitidas de un plan y crear planes de su academia', async () => {
    await limpiarBase();
    const A = await crearAcademiaDePrueba();
    const plan = await crearPlanDePrueba(A.id, { nombre: 'Plan original' });

    const filas = await actualizarFila(
      'app',
      'planes',
      A.id,
      plan.id,
      {
        nombre: 'Plan nuevo',
        veces_por_semana: 2,
        clases_por_mes: 8,
        duracion_minutos: 45,
        precio: '90.50',
        dias_permitidos: [2, 4],
        franjas_permitidas: ['10:00'],
        niveles_aplicables: ['AVANZADO'],
        vigencia_inicio: '2026-01-01',
        vigencia_fin: '2026-03-31',
        activo: false,
        actualizado_en: '2026-02-02T00:00:00.000Z',
      },
      {},
    );

    expect(filas).toBe(1);
    expect(await leerPlan(A.id, plan.id)).toMatchObject({
      nombre: 'Plan nuevo',
      veces_por_semana: 2,
      clases_por_mes: 8,
      duracion_minutos: 45,
      precio: '90.50',
      dias_permitidos: [2, 4],
      franjas_permitidas: ['10:00'],
      niveles_aplicables: ['AVANZADO'],
      vigencia_inicio: '2026-01-01',
      vigencia_fin: '2026-03-31',
      activo: false,
    });
    await ejecutarComo(
      'app',
      `INSERT INTO planes (academia_id, nombre, veces_por_semana, clases_por_mes, precio, dias_permitidos, franjas_permitidas,
                          niveles_aplicables, creado_en, actualizado_en)
       VALUES ($1::uuid, 'Plan creado por la app', 1, 4, 40, '{1}', '{08:00}', '{BASICO}', now(), now())`,
      [A.id],
      { academiaId: A.id },
    );
    const { rows } = await ejecutarComo(
      'app',
      "SELECT duracion_minutos, activo FROM planes WHERE nombre = 'Plan creado por la app'",
      [],
      {
        academiaId: A.id,
      },
    );
    expect(rows).toEqual([{ duracion_minutos: 60, activo: true }]);
  });

  it('criterio 2: sí puede cambiar el entrenador, el aforo y el estado de una clase y crear clases de su academia', async () => {
    await limpiarBase();
    const A = await crearAcademiaDePrueba();
    const uno = await crearEntrenadorDePrueba(A.id);
    const otro = await crearEntrenadorDePrueba(A.id);
    const clase = await crearClaseDePrueba(A.id, uno.id);

    const filas = await actualizarFila(
      'app',
      'clases',
      A.id,
      clase.id,
      { entrenador_id: otro.id, aforo: 45, activo: false, actualizado_en: '2026-02-02T00:00:00.000Z' },
      {},
    );

    expect(filas).toBe(1);
    expect(await leerClase(A.id, clase.id)).toMatchObject({ entrenador_id: otro.id, aforo: 45, activo: false });
    await ejecutarComo(
      'app',
      `INSERT INTO clases (academia_id, nivel, dia_semana, hora_inicio, hora_fin, entrenador_id, aforo, creado_en, actualizado_en)
       VALUES ($1::uuid, 'INTERMEDIO', 3, '19:00', '20:00', $2::uuid, 20, now(), now())`,
      [A.id, uno.id],
      { academiaId: A.id },
    );
    const { rows } = await ejecutarComo(
      'app',
      'SELECT hora_fin::text AS hora_fin, activo FROM clases WHERE dia_semana = 3',
      [],
      {
        academiaId: A.id,
      },
    );
    expect(rows).toEqual([{ hora_fin: '20:00:00', activo: true }]);
  });
});

describe('criterio 2: la API sigue atendiendo con los privilegios nuevos', () => {
  it('criterio 2: PRIVILEGIOS_APP incluye los de planes y clases: la API no se niega a atender datos por "privilegios de más" (criterio 102 de la 001)', async () => {
    await exigirTablasDePlanesYClases();
    await limpiarBase();
    await crearAcademiaDePrueba({ nombreCorto: 'academia-a', nombre: 'Academia A' });
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      const respuesta = await request(app.getHttpServer()).get('/api/a/academia-a');

      expect(respuesta.status).toBe(200);
      // Historia 005, criterio 5: la respuesta pública suma `telefono` (null si la academia no lo configuró).
      expect(respuesta.body).toEqual({ nombreCorto: 'academia-a', nombre: 'Academia A', telefono: null });
    } finally {
      await app.close();
    }
  });
});
