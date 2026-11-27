// spec: 010-mensualidades (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { expect } from 'vitest';
import { ejecutarComo } from './base-datos';
import { enLima } from './caja';
import { type AppCarnet } from './escenario-carnet';
import {
  type AlumnoDeAsistencia,
  cambiarMatricula,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  type OpcionesAlumnoDeAsistencia,
} from './escenario-asistencia';
import { instantaneaDeFaltas, prepararEscenarioDe009b } from './escenario-faltas';
import { crearAlumnoDeNoviembre } from './escenario-renovacion';
import type { Objeto, RespuestaApi } from './inscripciones';
import { crearClaseDePrueba, crearPlanDePrueba, type ClaseDePrueba, type PlanDePrueba } from './planes-clases';
import { rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 010c (cambio de horario de una matrícula). Solo usan SQL, HTTP y los contratos públicos: no importan nada de la
 * implementación interna. Reutilizan el escenario de la 009b (A y B con sus usuarios, el plan de S/ 120.00 con 12 clases, las clases de los lunes, miércoles y
 * viernes a las 18:00 con aforo 20, el lunes de 17:00 y de 19:00, el martes de 08:00 y la caja de hoy, más la tarea de faltas) y le suman lo que el cambio necesita:
 * un plan de una clase por semana (para probar un cambio con una sola clase por matrícula) y las clases del martes y el miércoles a las 10:00, el miércoles a las
 * 19:00 y el sábado a las 17:00. Lo que todavía no existe (la ruta y los esquemas de `@aquagestion/contratos`) se exige con un mensaje claro: ninguna prueba pasa
 * por casualidad con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */

// ---------------------------------------------------------------------------------------------------------------------
// La ruta y los contratos
// ---------------------------------------------------------------------------------------------------------------------

export const ACCION_HORARIO = 'MATRICULA_HORARIO_CAMBIADO';
export const MOTIVO_POR_DEFECTO = 'El alumno pidió otro horario';

export const rutaHorario = (matriculaId: string): string => `/api/matriculas/${matriculaId}/horario`;

const RUTAS_DE_LA_010C: readonly RegExp[] = [/^POST \/api\/matriculas\/:\w+\/horario$/];

/** Falla con un mensaje claro si la ruta de la 010c no está registrada (la funcionalidad no existe todavía). */
export function exigirRutasDe010c(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_010C) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 010c: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

interface EsquemaDePrueba {
  safeParse(valor: unknown): { success: boolean; error?: unknown };
}

export interface ContratosDe010c {
  cambiarHorarioSchema: EsquemaDePrueba;
  respuestaCambioHorarioSchema: EsquemaDePrueba;
}

/** Los esquemas de `@aquagestion/contratos` que agrega la 010c (criterio 35). Falla con un mensaje claro si faltan. */
export async function cargarContratosDe010c(): Promise<ContratosDe010c> {
  const modulo = (await import('@aquagestion/contratos')) as Record<string, unknown>;
  for (const nombre of ['cambiarHorarioSchema', 'respuestaCambioHorarioSchema']) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 010c: @aquagestion/contratos no exporta ${nombre}.`);
    }
  }
  return modulo as unknown as ContratosDe010c;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instantes de Lima (el 17/11/2026 es martes; el 26/11, jueves; el 30/11, lunes; el 1/12, martes)
// ---------------------------------------------------------------------------------------------------------------------

export const HORARIOS = {
  /** Martes 17/11 a las 10:30 (la clase del martes de las 10:00 está en curso). */
  martes17a10_30: enLima('2026-11-17', '10:30'),
  martes17a10_45: enLima('2026-11-17', '10:45'),
  /** Martes 17/11 a las 15:00 (la clase de las 10:00 ya terminó). */
  martes17a15: enLima('2026-11-17', '15:00'),
  martes17a15_05: enLima('2026-11-17', '15:05'),
  miercoles18a10_30: enLima('2026-11-18', '10:30'),
  miercoles18a11_05: enLima('2026-11-18', '11:05'),
  /** Lunes 23/11: la clase de las 17:00 y la de las 19:00. */
  lunes23a17_05: enLima('2026-11-23', '17:05'),
  lunes23a17_30: enLima('2026-11-23', '17:30'),
  lunes23a19_05: enLima('2026-11-23', '19:05'),
  lunes23a20_05: enLima('2026-11-23', '20:05'),
  martes24a10_30: enLima('2026-11-24', '10:30'),
  martes24a11_05: enLima('2026-11-24', '11:05'),
  /** Lunes 30/11, el último día de noviembre. */
  lunes30a18_05: enLima('2026-11-30', '18:05'),
  lunes30a19_05: enLima('2026-11-30', '19:05'),
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------------------------------------------------

export interface EscenarioDeHorario extends EscenarioDeAsistencia {
  /** Plan de A de una clase por semana (4 al mes, S/ 40.00): lunes, martes, miércoles, viernes y sábado; franjas de 10:00, 17:00, 18:00 y 19:00. */
  planUnDia: PlanDePrueba;
  martes10: ClaseDePrueba;
  miercoles10: ClaseDePrueba;
  miercoles19: ClaseDePrueba;
  sabado17: ClaseDePrueba;
}

/**
 * Le suma al escenario de la 009b (ya preparado) el plan de una clase por semana y las clases del martes y el miércoles a las 10:00, el miércoles a las 19:00 y el
 * sábado a las 17:00 de A, y comprueba que la ruta y los esquemas de la 010c existen.
 */
export async function ampliarEscenarioDeHorario(
  ctx: Pick<AppCarnet, 'app'>,
  esc: EscenarioDeAsistencia,
): Promise<EscenarioDeHorario> {
  exigirRutasDe010c(ctx.app);
  await cargarContratosDe010c();
  const { e } = esc;
  const planUnDia = await crearPlanDePrueba(e.A.id, {
    nombre: 'Plan de una clase por semana',
    veces_por_semana: 1,
    clases_por_mes: 4,
    precio: '40.00',
    dias_permitidos: [1, 2, 3, 5, 6],
    franjas_permitidas: ['10:00', '17:00', '18:00', '19:00'],
    niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
  });
  const clase = (dia: number, hora: string) =>
    crearClaseDePrueba(e.A.id, e.entrenadorA.id, { nivel: 'BASICO', dia_semana: dia, hora_inicio: hora, aforo: 20 });
  return {
    ...esc,
    planUnDia,
    martes10: await clase(2, '10:00'),
    miercoles10: await clase(3, '10:00'),
    miercoles19: await clase(3, '19:00'),
    sabado17: await clase(6, '17:00'),
  };
}

/** El escenario de la 009b (A y B con sus usuarios, el plan, las clases, la caja de hoy y la tarea de faltas) ampliado para la 010c. */
export async function prepararEscenarioDeHorario(ctx: AppCarnet): Promise<EscenarioDeHorario> {
  exigirRutasDe010c(ctx.app);
  const esc = await prepararEscenarioDe009b(ctx, { rutas: false });
  return ampliarEscenarioDeHorario(ctx, esc);
}

// ---------------------------------------------------------------------------------------------------------------------
// Alumnos
// ---------------------------------------------------------------------------------------------------------------------

export interface OpcionesAlumnoDeHorario extends OpcionesAlumnoDeAsistencia {
  /** El plan de la matrícula (por defecto, el de A de 3 por semana). */
  plan?: Pick<PlanDePrueba, 'id'>;
  /** El mes de la matrícula (por defecto, noviembre de 2026). */
  mes?: { anio: number; mes: number };
}

/**
 * Un alumno de A con su matrícula `VIGENTE` sembrada como dueño (sin pagos, con cuenta y QR) y, si se pide, con otro plan. Por defecto, noviembre de 2026, 12
 * clases, ninguna usada, `creado_en` el 11/11 y las clases de los lunes, miércoles y viernes a las 18:00.
 */
export async function crearAlumnoDeHorario(
  ctx: unknown,
  esc: Pick<EscenarioDeAsistencia, 'e'>,
  opciones: OpcionesAlumnoDeHorario = {},
): Promise<AlumnoDeAsistencia> {
  const { plan, ...resto } = opciones;
  const alumno = await crearAlumnoDeNoviembre(ctx, esc, resto);
  if (plan) await cambiarMatricula(alumno.academiaId, alumno.matriculaId, { plan_id: plan.id });
  return alumno;
}

/**
 * Un alumno de A creado como lo hace el sistema (con un pago en efectivo confirmado por la API, el 11/11), con la matrícula de noviembre `VIGENTE` y, si se pide,
 * con otro plan. La tarea de faltas solo registra faltas a quien tiene un pago confirmado (criterio 24 de 009), así que las pruebas de faltas usan a este.
 */
export async function crearAlumnoPagadoDeHorario(
  ctx: AppCarnet,
  esc: EscenarioDeAsistencia,
  opciones: Omit<OpcionesAlumnoDeHorario, 'mes'> = {},
): Promise<AlumnoDeAsistencia> {
  const { plan, ...resto } = opciones;
  const alumno = await crearAlumnoDeAsistencia(ctx, esc, resto);
  if (plan) await cambiarMatricula(alumno.academiaId, alumno.matriculaId, { plan_id: plan.id });
  return alumno;
}

// ---------------------------------------------------------------------------------------------------------------------
// Peticiones y respuestas
// ---------------------------------------------------------------------------------------------------------------------

/** Lo que las peticiones necesitan de la aplicación de la prueba. */
interface ClienteDe {
  http: {
    post(ruta: string, cuerpo?: unknown, opciones?: { cookie?: string }): Promise<RespuestaApi>;
  };
}

/** Un cuerpo válido de `cambiarHorarioSchema`; `sobre` cambia o agrega campos (`undefined` quita el campo). */
export function cuerpoHorario(claseIds: readonly string[], sobre: Objeto = {}): Objeto {
  const cuerpo: Objeto = { claseIds: [...claseIds], motivo: MOTIVO_POR_DEFECTO, ...sobre };
  for (const [clave, valor] of Object.entries(cuerpo)) if (valor === undefined) delete cuerpo[clave];
  return cuerpo;
}

/** `POST /api/matriculas/{id}/horario` con un cuerpo válido (con los cambios de `sobre`). */
export function cambiarHorario(
  ctx: ClienteDe,
  cookie: string | undefined,
  matriculaId: string,
  claseIds: readonly string[],
  sobre: Objeto = {},
): Promise<RespuestaApi> {
  return ctx.http.post(rutaHorario(matriculaId), cuerpoHorario(claseIds, sobre), { cookie });
}

export const CLAVES_DE_LA_RESPUESTA = ['matricula'];
export const CLAVES_DE_LA_MATRICULA = ['clases', 'clasesTotales', 'clasesUsadas', 'id', 'mes', 'ocurrenciasRestantes'];

export interface RespuestaDelCambio {
  matricula: {
    id: string;
    mes: string;
    clases: unknown[];
    clasesTotales: number;
    clasesUsadas: number;
    ocurrenciasRestantes: number;
  };
}

/** La respuesta 200 del cambio; si no lo es, falla con el estado y el cuerpo recibidos. */
export function cambioDe(respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>, estado = 200): RespuestaDelCambio {
  expect(
    respuesta.status,
    `se esperaba ${estado} y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 500)}`,
  ).toBe(estado);
  expect(respuesta.body, 'la respuesta no es un objeto JSON').toBeTruthy();
  return respuesta.body as unknown as RespuestaDelCambio;
}

/** Los ids de las clases de la respuesta (cada clase puede venir como `{ id, … }` o como el id solo), ordenados. */
export function idsDeClases(clases: readonly unknown[]): string[] {
  return clases.map((clase) => (typeof clase === 'string' ? clase : String((clase as { id?: unknown }).id))).sort();
}

export function codigoDeRespuesta(respuesta: Pick<RespuestaApi, 'body'>): string | undefined {
  const codigo = respuesta.body?.['codigo'];
  return typeof codigo === 'string' ? codigo : undefined;
}

/** `[estado HTTP, código]` de una respuesta (para comparar un rechazo con `toEqual([409, 'SIN_CUPO'])`). */
export const resumen = (respuesta: Pick<RespuestaApi, 'status' | 'body'>): [number, string | undefined] => [
  respuesta.status,
  codigoDeRespuesta(respuesta),
];

export function detallesDe(respuesta: Pick<RespuestaApi, 'body'>): Objeto {
  const detalles = respuesta.body?.['detalles'];
  return detalles !== null && typeof detalles === 'object' ? (detalles as Objeto) : {};
}

/** Los ids de las clases sin cupo que informa un 409 `SIN_CUPO` (`detalles.claseIds`), ordenados. */
export function clasesSinCupo(respuesta: Pick<RespuestaApi, 'body'>): string[] {
  const ids = detallesDe(respuesta)['claseIds'];
  return Array.isArray(ids) ? ids.map(String).sort() : [];
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------------------------------------------------

export interface FilaDeClase {
  clase_id: string;
  agregada_en: Date | null;
}

/** Las filas de `matricula_clases` de una matrícula con su `agregada_en`, ordenadas por clase. */
export async function filasDeClases(academiaId: string, matriculaId: string): Promise<FilaDeClase[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT clase_id, agregada_en FROM matricula_clases WHERE academia_id = $1::uuid AND matricula_id = $2::uuid ORDER BY clase_id`,
    [academiaId, matriculaId],
    { academiaId },
  );
  return rows as FilaDeClase[];
}

/** Los ids de las clases de una matrícula, ordenados. */
export async function clasesDeLaMatricula(academiaId: string, matriculaId: string): Promise<string[]> {
  return (await filasDeClases(academiaId, matriculaId)).map((fila) => fila.clase_id).sort();
}

/** Los ids dados, ordenados (para comparar conjuntos de clases). */
export const ordenados = (ids: readonly string[]): string[] => [...ids].sort();

/**
 * Todo lo que un rechazo, un 404, un 401 o un cambio sin diferencias no pueden cambiar: lo de la 009b (las dos academias con pagos, caja, matrículas, usuarios,
 * auditoría, asistencias y faltas) y las clases de cada matrícula con su `agregada_en`.
 */
export async function instantaneaDeHorario(esc: Pick<EscenarioDeAsistencia, 'e'>): Promise<string> {
  const clases: Record<string, unknown> = {};
  for (const academia of [esc.e.A.id, esc.e.B.id]) {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT matricula_id, clase_id, agregada_en FROM matricula_clases WHERE academia_id = $1::uuid ORDER BY matricula_id, clase_id`,
      [academia],
      { academiaId: academia },
    );
    clases[academia] = rows;
  }
  return JSON.stringify({ base: await instantaneaDeFaltas(esc.e), clases });
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectura del horario para el cambio (criterio 46, DT-38): `GET /api/alumnos/{id}/horario`
// ---------------------------------------------------------------------------------------------------------------------

export const rutaLecturaHorario = (alumnoId: string): string => `/api/alumnos/${alumnoId}/horario`;

const RUTA_DE_LA_LECTURA = /^GET \/api\/alumnos\/:\w+\/horario$/;

/**
 * Falla con un mensaje claro si la ruta de la lectura no está registrada. Aparte de `exigirRutasDe010c` a propósito: las pruebas del cambio no dependen de la lectura
 * (sin la ruta, un 401 sin sesión lo da igual el guardia global y una prueba pasaría por casualidad).
 */
export function exigirLecturaDeHorario(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  if (!registradas.some((ruta) => RUTA_DE_LA_LECTURA.test(ruta))) {
    throw new Error(
      `Falta la funcionalidad de la 010c: ninguna ruta registrada coincide con ${String(RUTA_DE_LA_LECTURA)} (lectura del horario, criterio 46).`,
    );
  }
}

export interface ContratoDeLectura {
  horarioDelAlumnoSchema: EsquemaDePrueba;
}

/** `horarioDelAlumnoSchema` de `@aquagestion/contratos` (criterio 46). Falla con un mensaje claro si falta. */
export async function cargarContratoDeLectura(): Promise<ContratoDeLectura> {
  const modulo = (await import('@aquagestion/contratos')) as Record<string, unknown>;
  if (modulo['horarioDelAlumnoSchema'] === undefined) {
    throw new Error('Falta la funcionalidad de la 010c: @aquagestion/contratos no exporta horarioDelAlumnoSchema.');
  }
  return modulo as unknown as ContratoDeLectura;
}

/** El escenario del cambio de horario, con la comprobación de que la ruta y el esquema de la lectura existen. */
export async function prepararEscenarioDeLectura(ctx: AppCarnet): Promise<EscenarioDeHorario> {
  exigirLecturaDeHorario(ctx.app);
  await cargarContratoDeLectura();
  return prepararEscenarioDeHorario(ctx);
}

export const CLAVES_DE_LA_LECTURA = ['alumno', 'matriculas'];
export const CLAVES_DEL_ALUMNO_DE_LA_LECTURA = ['id', 'nivel'];
export const CLAVES_DE_LA_MATRICULA_DE_LA_LECTURA = [
  'clases',
  'clasesDelPlan',
  'clasesTotales',
  'clasesUsadas',
  'estado',
  'id',
  'mes',
  'plan',
];
export const CLAVES_DEL_PLAN_DE_LA_LECTURA = ['diasPermitidos', 'franjasPermitidas', 'id', 'nombre', 'vecesPorSemana'];
export const CLAVES_DE_LA_CLASE_ACTUAL = ['diaSemana', 'horaFin', 'horaInicio', 'id'];
export const CLAVES_DE_LA_CLASE_DEL_PLAN = [
  'conPrioridad',
  'cuposRestantes',
  'diaSemana',
  'horaFin',
  'horaInicio',
  'id',
  'nivel',
];

export interface ClaseDeLaLectura {
  id: string;
  nivel: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  cuposRestantes: number;
  conPrioridad: boolean;
}

export interface MatriculaDeLaLectura {
  id: string;
  mes: string;
  estado: string;
  plan: { id: string; nombre: string; vecesPorSemana: number; diasPermitidos: number[]; franjasPermitidas: string[] };
  clases: { id: string; diaSemana: number; horaInicio: string; horaFin: string }[];
  clasesTotales: number;
  clasesUsadas: number;
  clasesDelPlan: ClaseDeLaLectura[];
}

export interface LecturaDelHorario {
  alumno: { id: string; nivel: string };
  matriculas: MatriculaDeLaLectura[];
}

/** `GET /api/alumnos/{id}/horario` (con `consulta` opcional, por ejemplo `?academiaId=…`). */
export function leerHorario(
  ctx: { http: { get(ruta: string, opciones?: { cookie?: string }): Promise<RespuestaApi> } },
  cookie: string | undefined,
  alumnoId: string,
  consulta = '',
): Promise<RespuestaApi> {
  return ctx.http.get(`${rutaLecturaHorario(alumnoId)}${consulta}`, { cookie });
}

/** La lectura 200; si no lo es, falla con el estado y el cuerpo recibidos. */
export function lecturaDe(respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>, estado = 200): LecturaDelHorario {
  expect(
    respuesta.status,
    `se esperaba ${estado} y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 500)}`,
  ).toBe(estado);
  expect(respuesta.body, 'la respuesta no es un objeto JSON').toBeTruthy();
  return respuesta.body as unknown as LecturaDelHorario;
}

/** Los `cuposRestantes` de las `clasesDelPlan` de una matrícula, por id de clase. */
export function cuposPorClase(matricula: Pick<MatriculaDeLaLectura, 'clasesDelPlan'>): Record<string, number> {
  return Object.fromEntries(matricula.clasesDelPlan.map((clase) => [clase.id, clase.cuposRestantes]));
}

/** Los ids de las `clasesDelPlan` con `conPrioridad` en `true`, ordenados. */
export function clasesConPrioridad(matricula: Pick<MatriculaDeLaLectura, 'clasesDelPlan'>): string[] {
  return matricula.clasesDelPlan
    .filter((clase) => clase.conPrioridad)
    .map((clase) => clase.id)
    .sort();
}
