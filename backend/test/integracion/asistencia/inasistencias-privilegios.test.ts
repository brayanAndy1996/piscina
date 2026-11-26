// spec: 009-asistencia (pruebas protegidas)
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo } from '../../utilidades/base-datos';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import { filaAsistenciaValida, insertarAsistencia } from '../../utilidades/escenario-asistencia';
import {
  actualizarInasistencia,
  exigirTablaDeInasistencias,
  filaInasistenciaValida,
  insertarInasistencia,
  leerInasistencias,
} from '../../utilidades/escenario-faltas';
import { sembrarSolicitud, type SolicitudSembrada } from '../../utilidades/inscripciones';

// Criterio 22 (crítico, D-23, D-08), parte de los privilegios: `aquagestion_app` tiene `SELECT`, `INSERT` y `UPDATE (asistencia_id, cubierta_en)` sobre `inasistencias` y nada más: ni `UPDATE` de tabla entera ni de ninguna otra
// columna, ni `DELETE`, ni `TRUNCATE`, ni `REFERENCES`, ni `TRIGGER`. Una falta no se borra ni se corrige (42501); solo se cubre, una vez, con la asistencia del día. `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` se amplían igual
// (las pruebas protegidas de la 001 que comparan la lista exacta se actualizaron en este mismo cambio: `privilegios-app.test.ts` y `rol-app-ronda3.test.mjs`) y la API sigue atendiendo (criterio 102 de la 001).

const ROL = 'aquagestion_app';

describe('criterio 22: privilegios exactos de aquagestion_app sobre inasistencias', () => {
  beforeEach(exigirTablaDeInasistencias);

  it('criterio 22: tiene SELECT e INSERT, y ni UPDATE de tabla entera, DELETE, TRUNCATE, REFERENCES ni TRIGGER', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT pg_catalog.has_table_privilege($1::name, 'public.inasistencias', 'SELECT') AS "SELECT",
              pg_catalog.has_table_privilege($1::name, 'public.inasistencias', 'INSERT') AS "INSERT",
              pg_catalog.has_table_privilege($1::name, 'public.inasistencias', 'UPDATE') AS "UPDATE",
              pg_catalog.has_table_privilege($1::name, 'public.inasistencias', 'DELETE') AS "DELETE",
              pg_catalog.has_table_privilege($1::name, 'public.inasistencias', 'TRUNCATE') AS "TRUNCATE",
              pg_catalog.has_table_privilege($1::name, 'public.inasistencias', 'REFERENCES') AS "REFERENCES",
              pg_catalog.has_table_privilege($1::name, 'public.inasistencias', 'TRIGGER') AS "TRIGGER"`,
      [ROL],
    );

    expect(rows).toEqual([
      { SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false },
    ]);
  });

  it('criterio 22: la app puede cambiar exactamente asistencia_id y cubierta_en (UPDATE por columna) y no tiene REFERENCES en ninguna', async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT a.attname AS columna,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'UPDATE') AS puede,
              pg_catalog.has_column_privilege($1::name, c.oid, a.attnum, 'REFERENCES') AS referencia
         FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        WHERE c.oid = 'public.inasistencias'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attname`,
      [ROL],
    );
    const filas = rows as { columna: string; puede: boolean; referencia: boolean }[];

    expect(filas.length).toBeGreaterThanOrEqual(9);
    expect(filas.filter((fila) => fila.puede).map((fila) => fila.columna)).toEqual(['asistencia_id', 'cubierta_en']);
    expect(filas.filter((fila) => fila.referencia)).toEqual([]);
  });
});

describe('criterio 22: lo que el rol de la app puede y no puede escribir en inasistencias', () => {
  let e: EscenarioPagos;
  let cliente: SolicitudSembrada;
  let faltaId: string;

  beforeEach(async () => {
    await exigirTablaDeInasistencias();
    e = await crearEscenarioDePagos();
    cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], clasesTotales: 12 });
    const fila = filaInasistenciaValida({
      alumnoId: cliente.alumnoId,
      matriculaId: cliente.matriculaId,
      claseId: e.lunes.id,
    });
    await insertarInasistencia('propietario', e.A.id, fila);
    faltaId = fila['id'] as string;
  });

  const comoApp = (sql: string, parametros: unknown[] = []) =>
    ejecutarComo('app', sql, parametros, { academiaId: e.A.id });

  it('criterio 22: no puede borrar una falta ni corregir sus otras columnas: DELETE, TRUNCATE y UPDATE de la fecha, la clase, la matrícula, el alumno, la hora de registro y la academia fallan con 42501', async () => {
    const intentos: [string, string, unknown[]][] = [
      ['fecha', "UPDATE inasistencias SET fecha = DATE '2026-11-23' WHERE id = $1::uuid", [faltaId]],
      ['registrada_en', 'UPDATE inasistencias SET registrada_en = now() WHERE id = $1::uuid', [faltaId]],
      ['clase_id', 'UPDATE inasistencias SET clase_id = $2::uuid WHERE id = $1::uuid', [faltaId, e.miercoles.id]],
      ['matricula_id', 'UPDATE inasistencias SET matricula_id = gen_random_uuid() WHERE id = $1::uuid', [faltaId]],
      ['alumno_id', 'UPDATE inasistencias SET alumno_id = gen_random_uuid() WHERE id = $1::uuid', [faltaId]],
      ['id', 'UPDATE inasistencias SET id = gen_random_uuid() WHERE id = $1::uuid', [faltaId]],
      ['academia_id', 'UPDATE inasistencias SET academia_id = $2::uuid WHERE id = $1::uuid', [faltaId, e.B.id]],
      ['DELETE', 'DELETE FROM inasistencias WHERE id = $1::uuid', [faltaId]],
      ['TRUNCATE', 'TRUNCATE inasistencias', []],
    ];
    for (const [nombre, sql, parametros] of intentos) {
      await expect(comoApp(sql, parametros), nombre).rejects.toMatchObject({ code: '42501' });
    }

    const faltas = await leerInasistencias(e.A.id);
    expect(faltas).toHaveLength(1);
    expect(faltas[0]).toMatchObject({ id: faltaId, fecha: '2026-11-16', clase_id: e.lunes.id, asistencia_id: null });
  });

  it('criterio 22: sí puede cubrir una falta de su academia con asistencia_id y cubierta_en (como lo hace el registro posterior)', async () => {
    const antes = (await leerInasistencias(e.A.id))[0];
    expect(antes?.asistencia_id).toBeNull();
    // La asistencia del mismo alumno y día que la cubre (la llave compuesta exige alumno y fecha iguales).
    const asistencia = filaAsistenciaValida({
      alumnoId: cliente.alumnoId,
      matriculaId: cliente.matriculaId,
      claseId: e.lunes.id,
      usuarioId: e.secretariaA.id,
    });
    await insertarAsistencia('propietario', e.A.id, asistencia);

    const afectadas = await actualizarInasistencia('app', e.A.id, faltaId, {
      asistencia_id: asistencia['id'],
      cubierta_en: new Date('2026-11-17T01:00:00.000Z'),
    });

    expect(afectadas).toBe(1);
    expect((await leerInasistencias(e.A.id))[0]).toMatchObject({ id: faltaId, asistencia_id: asistencia['id'] });
  });
});

describe('criterio 22: la API sigue atendiendo con los privilegios nuevos', () => {
  it('criterio 22: PRIVILEGIOS_APP incluye los de inasistencias: la API no se niega a atender datos por «privilegios de más» (criterio 102 de la 001)', async () => {
    await exigirTablaDeInasistencias();
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
