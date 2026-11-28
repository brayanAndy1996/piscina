import { ejecutarComo } from './base-datos';
import type { AlumnoDeAsistencia } from './escenario-asistencia';
import { type AppCarnet } from './escenario-carnet';
import { pedirCrudo, type RespuestaCruda, RUTA_MI_PANEL, rutaMiAsistencia } from './escenario-panel';
import { cookieDeUsuario } from './usuarios';

/**
 * Ayudas de las pruebas no protegidas de la 011 (T15: criterios 7, 9, 10, 11, 13 y 16): piden el panel con la sesión de un alumno firmada para el instante que
 * prueban (la cookie del alumno dura poco y estas pruebas se mueven por todo el fin de mes).
 */

export const cookieDelAlumnoEn = (
  alumno: Pick<AlumnoDeAsistencia, 'usuarioId' | 'academiaId'>,
  instante: Date,
): string => cookieDeUsuario({ id: alumno.usuarioId, academiaId: alumno.academiaId, rol: 'ALUMNO' }, instante);

/** `GET /api/mi-panel` con el reloj de la aplicación en `instante`. */
export function resumenEn(
  ctx: Pick<AppCarnet, 'app' | 'reloj'>,
  alumno: Pick<AlumnoDeAsistencia, 'usuarioId' | 'academiaId'>,
  instante: Date,
): Promise<RespuestaCruda> {
  ctx.reloj.fijar(instante);
  return pedirCrudo(ctx.app, 'GET', RUTA_MI_PANEL, { cookie: cookieDelAlumnoEn(alumno, instante) });
}

/** `GET /api/mi-panel/asistencias[?mes=]` con el reloj de la aplicación en `instante`. */
export function asistenciaEn(
  ctx: Pick<AppCarnet, 'app' | 'reloj'>,
  alumno: Pick<AlumnoDeAsistencia, 'usuarioId' | 'academiaId'>,
  instante: Date,
  mes?: string,
): Promise<RespuestaCruda> {
  ctx.reloj.fijar(instante);
  return pedirCrudo(ctx.app, 'GET', rutaMiAsistencia(mes), { cookie: cookieDelAlumnoEn(alumno, instante) });
}

/** Cambia la fecha de nacimiento de un alumno (como dueño de las tablas). */
export async function fijarNacimiento(academiaId: string, alumnoId: string, fecha: string): Promise<void> {
  await ejecutarComo(
    'propietario',
    'UPDATE alumnos SET fecha_nacimiento = $3::date WHERE academia_id = $1::uuid AND id = $2::uuid',
    [academiaId, alumnoId, fecha],
    { academiaId },
  );
}
