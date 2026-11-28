import { expect, test } from '@playwright/test';
import pg from 'pg';
import { sembrarPanelDelAlumno } from '../utilidades/sembrar-panel';

// El sembrador de la E2E del panel (011) tiene una rama para el día 1 del mes, que la E2E del navegador solo recorre ese día: aquí se prueba con
// una fecha de hoy fingida, sin navegador, contra la base de pruebas. El reloj del servidor no importa: el sembrador solo escribe por SQL.

interface FilaSembrada {
  alumno_dni: string;
  matricula_anio_mes: string;
  matricula_estado: string;
  asistencia_mes: string | null;
  asistencia_hora: string | null;
}

async function leerLoSembrado(nombreCorto: string): Promise<FilaSembrada[]> {
  const url = process.env['DATABASE_URL_PRUEBAS'];
  if (!url) throw new Error('Falta DATABASE_URL_PRUEBAS.');
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('app.plataforma', 'si', true)");
    const academia = await cliente.query<{ id: string }>(
      'SELECT id::text AS id FROM academias WHERE nombre_corto = $1',
      [nombreCorto],
    );
    const id = academia.rows[0]?.id;
    if (!id) throw new Error('No se sembró la academia.');
    await cliente.query("SELECT set_config('app.academia_id', $1, true)", [id]);
    const { rows } = await cliente.query<FilaSembrada>(
      `SELECT al.dni AS alumno_dni,
              to_char(make_date(m.anio::int, m.mes::int, 1), 'YYYY-MM') AS matricula_anio_mes,
              m.estado::text AS matricula_estado,
              to_char(a.fecha, 'YYYY-MM') AS asistencia_mes,
              to_char(a.llegada_en AT TIME ZONE 'America/Lima', 'HH24:MI') AS asistencia_hora
         FROM alumnos al
         JOIN matriculas m ON m.academia_id = al.academia_id AND m.alumno_id = al.id
         LEFT JOIN asistencias a ON a.academia_id = m.academia_id AND a.matricula_id = m.id
        ORDER BY al.dni, matricula_anio_mes`,
    );
    await cliente.query('ROLLBACK');
    return rows;
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

for (const [hoy, mesEnCurso, mesAnterior] of [
  ['2026-12-01', '2026-12', '2026-11'],
  ['2027-01-01', '2027-01', '2026-12'],
  ['2026-11-28', '2026-11', null],
] as const) {
  test(`siembra bien con hoy = ${hoy}${mesAnterior ? ' (día 1: la asistencia va en el mes anterior)' : ''}`, async () => {
    const datos = await sembrarPanelDelAlumno(hoy);
    expect(datos.mesEnCurso).toBe(mesEnCurso);
    expect(datos.mesDeLaAsistencia).toBe(mesAnterior ?? mesEnCurso);

    const filas = await leerLoSembrado(datos.nombreCorto);
    for (const dni of [datos.alumno.dni, datos.hermano.dni]) {
      const propias = filas.filter((f) => f.alumno_dni === dni);
      const esperadas = mesAnterior
        ? [
            { matricula_anio_mes: mesAnterior, matricula_estado: 'FINALIZADA', asistencia_mes: mesAnterior },
            { matricula_anio_mes: mesEnCurso, matricula_estado: 'VIGENTE', asistencia_mes: null },
          ]
        : [{ matricula_anio_mes: mesEnCurso, matricula_estado: 'VIGENTE', asistencia_mes: mesEnCurso }];
      expect(
        propias.map(({ matricula_anio_mes, matricula_estado, asistencia_mes }) => ({
          matricula_anio_mes,
          matricula_estado,
          asistencia_mes,
        })),
      ).toEqual(esperadas);
    }
    const horas = filas.filter((f) => f.asistencia_hora !== null);
    expect(horas.map((f) => [f.alumno_dni, f.asistencia_hora]).sort()).toEqual(
      [
        [datos.alumno.dni, datos.horaDeLlegada],
        [datos.hermano.dni, datos.horaDeLlegadaDelHermano],
      ].sort(),
    );
  });
}
