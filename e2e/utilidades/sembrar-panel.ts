import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

// Sembrador mínimo de la E2E del panel del alumno (historia 011, criterio 20). Escribe por SQL, como dueño de las tablas, en la base de pruebas
// (la misma de `global-setup.ts`; nunca la de desarrollo): una academia propia, dos hermanos con su cuenta `ALUMNO` (clave inicial igual al DNI y
// cambio obligatorio) y el mismo apoderado, un plan, una clase, la matrícula `VIGENTE` del mes en curso de Lima y una asistencia con su hora en
// un día pasado. Todo con datos inventados y con nombres únicos por corrida: no depende de la semilla, del orden de las pruebas ni de la hora a la
// que corre. Las filas respetan las restricciones y la seguridad a nivel de fila: cada escritura corre con `app.academia_id` de la academia nueva.

export interface DatosDelPanelSembrado {
  nombreCorto: string;
  nombreAcademia: string;
  alumno: { dni: string; nombres: string; apellidos: string };
  hermano: { dni: string; nombres: string; apellidos: string };
  /** El mes en curso de Lima (`AAAA-MM`) y el último día de su mensualidad (`DD/MM/AAAA`, como lo muestra la web). */
  mesEnCurso: string;
  venceElTexto: string;
  planNombre: string;
  /** «Martes 18:00 a 19:00»: el día de la asistencia sembrada. */
  claseTexto: string;
  /** El mes de la asistencia sembrada: el mes en curso, salvo el día 1, que no tiene un día pasado en el mes y usa el mes anterior. */
  mesDeLaAsistencia: string;
  /** La fecha de la asistencia sembrada para el alumno (`DD/MM/AAAA`) y sus horas de llegada (la del hermano es otra: no debe verse). */
  fechaDeLaAsistenciaTexto: string;
  horaDeLlegada: string;
  horaDeLlegadaDelHermano: string;
}

const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const;
const FORMATO_DIA_LIMA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** La fecha `AAAA-MM-DD` de hoy en America/Lima, sin depender de la zona del equipo. */
export function hoyEnLima(instante: Date = new Date()): string {
  return FORMATO_DIA_LIMA.format(instante);
}

const dos = (n: number) => String(n).padStart(2, '0');
const fechaTexto = (anio: number, mes: number, dia: number) => `${anio}-${dos(mes)}-${dos(dia)}`;
const aDiaMesAnio = (fecha: string) => fecha.split('-').reverse().join('/');
/** Último día del mes `mes` (1 a 12) de `anio`. */
const ultimoDia = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();
/** Día de la semana de 1 (lunes) a 7 (domingo) de una fecha de calendario. */
function diaIso(anio: number, mes: number, dia: number): number {
  const js = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return js === 0 ? 7 : js;
}

function dniInventado(): string {
  return String(randomInt(30_000_000, 99_999_999));
}

function urlDelDueno(): string {
  const url = process.env['DATABASE_URL_PRUEBAS'];
  if (!url) throw new Error('Falta DATABASE_URL_PRUEBAS: las pruebas E2E usan solo la base de pruebas.');
  return url;
}

/**
 * Siembra el escenario y devuelve lo que la prueba necesita para entrar y comprobar la pantalla. `hoy` (`AAAA-MM-DD` de Lima) solo se cambia
 * para probar el sembrador en un borde del mes; la E2E usa el de hoy.
 */
export async function sembrarPanelDelAlumno(hoy: string = hoyEnLima()): Promise<DatosDelPanelSembrado> {
  const [anio = 0, mes = 1, diaDeHoy = 1] = hoy.split('-').map(Number);
  const sufijo = randomBytes(4).toString('hex');
  const nombreCorto = `e2e-${sufijo}`;
  const nombreAcademia = `Academia E2E ${nombreCorto}`;
  const alumno = { dni: dniInventado(), nombres: 'Camila Sofía', apellidos: 'Prado Quispe' };
  let hermano = { dni: dniInventado(), nombres: 'Mateo Andrés', apellidos: 'Prado Quispe' };
  while (hermano.dni === alumno.dni) hermano = { ...hermano, dni: dniInventado() };
  const dniEntrenador = (() => {
    let dni = dniInventado();
    while (dni === alumno.dni || dni === hermano.dni) dni = dniInventado();
    return dni;
  })();

  // El día 1 no hay un día pasado dentro del mes en curso: la asistencia va en el mes anterior (con su matrícula `FINALIZADA`).
  const asistenciaEnElMesAnterior = diaDeHoy === 1;
  const [anioAsistencia, mesAsistencia] = asistenciaEnElMesAnterior
    ? mes === 1
      ? [anio - 1, 12]
      : [anio, mes - 1]
    : [anio, mes];
  const diaAsistencia = asistenciaEnElMesAnterior ? 15 : diaDeHoy - 1;
  const fechaAsistencia = fechaTexto(anioAsistencia, mesAsistencia, diaAsistencia);
  const diaDeLaClase = diaIso(anioAsistencia, mesAsistencia, diaAsistencia);
  const horaDeLlegada = '18:05';
  const horaDeLlegadaDelHermano = '18:07';

  const hashes = {
    alumno: await hash(alumno.dni),
    hermano: await hash(hermano.dni),
    entrenador: await hash(dniEntrenador),
  };

  const cliente = new pg.Client({ connectionString: urlDelDueno() });
  await cliente.connect();
  try {
    await cliente.query('BEGIN');
    // El dueño de las tablas también pasa por la seguridad a nivel de fila: crear la academia es de la plataforma y el resto es de la academia.
    await cliente.query("SELECT set_config('app.plataforma', 'si', true)");
    const academia = await cliente.query<{ id: string }>(
      'INSERT INTO academias (nombre, nombre_corto) VALUES ($1, $2) RETURNING id::text AS id',
      [nombreAcademia, nombreCorto],
    );
    const academiaId = academia.rows[0]?.id;
    if (!academiaId) throw new Error('No se pudo crear la academia de la E2E.');
    await cliente.query("SELECT set_config('app.academia_id', $1, true)", [academiaId]);

    const usuario = async (
      dni: string,
      nombres: string,
      apellidos: string,
      rol: string,
      claveHash: string,
      debeCambiar: boolean,
    ) =>
      (
        await cliente.query<{ id: string }>(
          `INSERT INTO usuarios (academia_id, dni, nombres, apellidos, rol, clave_hash, debe_cambiar_clave)
           VALUES ($1::uuid, $2, $3, $4, $5::rol_usuario, $6, $7) RETURNING id::text AS id`,
          [academiaId, dni, nombres, apellidos, rol, claveHash, debeCambiar],
        )
      ).rows[0]?.id as string;

    const entrenadorId = await usuario(dniEntrenador, 'Rosa', 'Quispe Mamani', 'ENTRENADOR', hashes.entrenador, false);
    const usuarioAlumno = await usuario(alumno.dni, alumno.nombres, alumno.apellidos, 'ALUMNO', hashes.alumno, true);
    const usuarioHermano = await usuario(
      hermano.dni,
      hermano.nombres,
      hermano.apellidos,
      'ALUMNO',
      hashes.hermano,
      true,
    );

    const plan = await cliente.query<{ id: string }>(
      `INSERT INTO planes (academia_id, nombre, veces_por_semana, clases_por_mes, precio, dias_permitidos, franjas_permitidas, niveles_aplicables)
       VALUES ($1::uuid, 'Plan E2E 2 veces', 2, 8, 80.00, $2::smallint[], ARRAY['18:00']::time(0)[], ARRAY['BASICO']::nivel_natacion[])
       RETURNING id::text AS id`,
      [academiaId, [diaDeLaClase, (diaDeLaClase % 7) + 1]],
    );
    const planId = plan.rows[0]?.id as string;
    const clase = await cliente.query<{ id: string }>(
      `INSERT INTO clases (academia_id, nivel, dia_semana, hora_inicio, hora_fin, entrenador_id, aforo)
       VALUES ($1::uuid, 'BASICO', $2, '18:00', '19:00', $3::uuid, 20) RETURNING id::text AS id`,
      [academiaId, diaDeLaClase, entrenadorId],
    );
    const claseId = clase.rows[0]?.id as string;

    async function matricular(
      alumnoId: string,
      a: number,
      m: number,
      estado: 'VIGENTE' | 'FINALIZADA',
      usadas: number,
    ) {
      const id = (
        await cliente.query<{ id: string }>(
          `INSERT INTO matriculas (academia_id, alumno_id, plan_id, anio, mes, fecha_inicio, fecha_fin, clases_totales, clases_usadas,
                                   es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::date, $7::date, 8, $8, false, 80.00, 8, 80.00, 'VIGENTE')
           RETURNING id::text AS id`,
          [academiaId, alumnoId, planId, a, m, fechaTexto(a, m, 1), fechaTexto(a, m, ultimoDia(a, m)), usadas],
        )
      ).rows[0]?.id as string;
      // Las clases de una matrícula solo cambian mientras está abierta: se agregan antes de finalizarla.
      await cliente.query(
        'INSERT INTO matricula_clases (academia_id, matricula_id, clase_id) VALUES ($1::uuid, $2::uuid, $3::uuid)',
        [academiaId, id, claseId],
      );
      if (estado === 'FINALIZADA') {
        await cliente.query(
          "UPDATE matriculas SET estado = 'FINALIZADA' WHERE academia_id = $1::uuid AND id = $2::uuid",
          [academiaId, id],
        );
      }
      return id;
    }

    async function asistir(alumnoId: string, matriculaId: string, hora: string) {
      await cliente.query(
        `INSERT INTO asistencias (academia_id, alumno_id, matricula_id, clase_id, fecha, llegada_en, registrado_en, metodo, estado_llegada,
                                  registrado_por, clave_idempotencia)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::date, (($5::date + $6::time) AT TIME ZONE 'America/Lima'),
                 (($5::date + $6::time) AT TIME ZONE 'America/Lima'), 'QR', 'PUNTUAL', $7::uuid, $8::uuid)`,
        [academiaId, alumnoId, matriculaId, claseId, fechaAsistencia, hora, entrenadorId, randomUUID()],
      );
    }

    const apoderado = {
      nombres: 'Elena',
      apellidos: 'Quispe Rojas',
      dni: dniInventado(),
      telefono: '999111222',
    };
    for (const [datos, usuarioId, nacimiento, horaAsistencia] of [
      [alumno, usuarioAlumno, '2016-03-14', horaDeLlegada],
      [hermano, usuarioHermano, '2014-08-02', horaDeLlegadaDelHermano],
    ] as const) {
      const alumnoId = (
        await cliente.query<{ id: string }>(
          `INSERT INTO alumnos (academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, usuario_id)
           VALUES ($1::uuid, $2, $3, $4, $5::date, $6, 'BASICO', 'ALUMNO_ACTIVO', $7::uuid) RETURNING id::text AS id`,
          [academiaId, datos.dni, datos.nombres, datos.apellidos, nacimiento, apoderado.telefono, usuarioId],
        )
      ).rows[0]?.id as string;
      await cliente.query(
        `INSERT INTO apoderados (academia_id, alumno_id, nombres, apellidos, dni, telefono, parentesco)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'MADRE')`,
        [academiaId, alumnoId, apoderado.nombres, apoderado.apellidos, apoderado.dni, apoderado.telefono],
      );
      const matriculaDelMesAsistido = asistenciaEnElMesAnterior
        ? await matricular(alumnoId, anioAsistencia, mesAsistencia, 'FINALIZADA', 1)
        : null;
      const matriculaDelMes = await matricular(alumnoId, anio, mes, 'VIGENTE', asistenciaEnElMesAnterior ? 0 : 1);
      await asistir(alumnoId, matriculaDelMesAsistido ?? matriculaDelMes, horaAsistencia);
    }
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await cliente.end().catch(() => undefined);
  }

  return {
    nombreCorto,
    nombreAcademia,
    alumno,
    hermano,
    mesEnCurso: `${anio}-${dos(mes)}`,
    venceElTexto: aDiaMesAnio(fechaTexto(anio, mes, ultimoDia(anio, mes))),
    planNombre: 'Plan E2E 2 veces',
    claseTexto: `${NOMBRES_DIA[diaDeLaClase % 7]} 18:00 a 19:00`,
    mesDeLaAsistencia: `${anioAsistencia}-${dos(mesAsistencia)}`,
    fechaDeLaAsistenciaTexto: aDiaMesAnio(fechaAsistencia),
    horaDeLlegada,
    horaDeLlegadaDelHermano,
  };
}
