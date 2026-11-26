// spec: 009-asistencia (pruebas protegidas)
import { randomBytes, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { expect } from 'vitest';
import { ejecutarComo, type RolPruebas } from './base-datos';
import { crearCajaDePrueba, cerrarCajaDePrueba, enLima, leerCajas } from './caja';
import {
  type AlumnoConQr,
  type AppCarnet,
  cambiarAlumno,
  crearAlumnoPorPago,
  type EscenarioDelCarnet,
  fijarQr,
  instantaneaDelCarnet,
  leerQr,
  type OpcionesAlumnoPorPago,
  prepararEscenarioDelCarnet,
} from './escenario-carnet';
import { AHORA_007, cookiesDePagos, type EscenarioPagos } from './escenario-pagos';
import { sembrarEnVerificacion } from './escenario-pagos-007b';
import {
  insertarFila,
  leerMatriculas,
  type Libre,
  type Objeto,
  type RespuestaApi,
  actualizarFilas,
} from './inscripciones';
import { filaPagoValida, insertarPago } from './pagos';
import { crearClaseDePrueba, type ClaseDePrueba } from './planes-clases';
import { rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 009a (marcado de asistencia por QR y manual). Solo usan SQL, HTTP y los contratos públicos: no importan nada de la
 * implementación interna. Reutilizan el escenario del carnet (`escenario-carnet.ts`), el de la 007 (`escenario-pagos.ts`) y las utilidades de la foto de la 008b: los
 * alumnos se crean confirmando un pago por la API, como dice la spec, y después se les ajusta la matrícula como dueño de las tablas (clases del plan, clases usadas,
 * estado, fechas) para armar cada caso. Lo que todavía no existe (las dos rutas y la tabla `asistencias`) se exige con un mensaje claro: ninguna prueba pasa por casualidad
 * con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Rutas, cuerpos y la tabla
// ---------------------------------------------------------------------------------------------------------------------

export const RUTA_ASISTENCIA_QR = '/api/asistencias/qr';
export const RUTA_ASISTENCIA_MANUAL = '/api/asistencias/manual';

const RUTAS_DE_LA_009A: readonly RegExp[] = [/^POST \/api\/asistencias\/qr$/, /^POST \/api\/asistencias\/manual$/];

/** Falla con un mensaje claro si las dos rutas de la 009a no están registradas (la funcionalidad no existe todavía). */
export function exigirRutasDe009a(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_009A) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 009a: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

/** Falla con un mensaje claro si la migración de la 009a todavía no creó `asistencias`. */
export async function exigirTablaDeAsistencias(): Promise<void> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT pg_catalog.to_regclass('public.asistencias') IS NOT NULL AS existe`,
  );
  expect(
    (rows[0] as { existe: boolean }).existe,
    'Falta la funcionalidad de la 009a: la migración de la tabla asistencias no está aplicada',
  ).toBe(true);
}

const FALTA_LA_TABLA = new Set(['42P01', '42704']);

/** Convierte «no existe la tabla asistencias» o «no existe el tipo» en un mensaje claro de funcionalidad pendiente. */
export async function conMensajeDeAsistencias<T>(trabajo: () => Promise<T>): Promise<T> {
  try {
    return await trabajo();
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    if (
      code !== undefined &&
      FALTA_LA_TABLA.has(code) &&
      /asistencias|metodo_asistencia|tipo_asistencia|estado_llegada/.test(message ?? '')
    ) {
      throw new Error('Falta la funcionalidad de la 009a: la migración de la tabla asistencias no está aplicada.', {
        cause: error,
      });
    }
    throw error;
  }
}

/** Un cuerpo válido de `registrarAsistenciaQrSchema` con una clave nueva; `sobre` cambia o agrega campos (`undefined` quita el campo). */
export function cuerpoQr(contenido: string, sobre: Objeto = {}): Objeto {
  return quitarIndefinidos({ contenido, claveIdempotencia: randomUUID(), ...sobre });
}

/** Un cuerpo válido de `registrarAsistenciaManualSchema` con una clave nueva. */
export function cuerpoManual(alumnoId: string, sobre: Objeto = {}): Objeto {
  return quitarIndefinidos({ alumnoId, claveIdempotencia: randomUUID(), ...sobre });
}

function quitarIndefinidos(cuerpo: Objeto): Objeto {
  for (const [clave, valor] of Object.entries(cuerpo)) if (valor === undefined) delete cuerpo[clave];
  return cuerpo;
}

// ---------------------------------------------------------------------------------------------------------------------
// Días, horas y sesiones
// ---------------------------------------------------------------------------------------------------------------------

/** Los lunes de noviembre de 2026 después de `AHORA_007` (miércoles 11/11). El 30/11 es el último día del mes. */
export const LUNES = '2026-11-16';
export const LUNES_SIGUIENTE = '2026-11-23';
export const ULTIMO_LUNES_DE_NOVIEMBRE = '2026-11-30';
export const MARTES = '2026-11-17';
export const PRIMERO_DE_DICIEMBRE = '2026-12-01';

export { enLima };

/**
 * Fija el reloj de la API en `instante` y devuelve las sesiones de todo el personal de A y de B firmadas para ese instante (la sesión del
 * personal dura 12 horas: la firmada en `AHORA_007` ya no valdría el lunes 16/11).
 */
export function en(ctx: Pick<AppCarnet, 'reloj'>, esc: EscenarioDelCarnet, instante: Date) {
  ctx.reloj.fijar(instante);
  return cookiesDePagos(esc.e, instante);
}

// ---------------------------------------------------------------------------------------------------------------------
// Peticiones
// ---------------------------------------------------------------------------------------------------------------------

export function marcarPorQr(
  ctx: Pick<AppCarnet, 'http'>,
  cookie: string | undefined,
  contenido: string,
  sobre: Objeto = {},
): Promise<RespuestaApi> {
  return ctx.http.post(RUTA_ASISTENCIA_QR, cuerpoQr(contenido, sobre), { cookie });
}

export function marcarManual(
  ctx: Pick<AppCarnet, 'http'>,
  cookie: string | undefined,
  alumnoId: string,
  sobre: Objeto = {},
): Promise<RespuestaApi> {
  return ctx.http.post(RUTA_ASISTENCIA_MANUAL, cuerpoManual(alumnoId, sobre), { cookie });
}

export type Via = 'QR' | 'MANUAL';

/** El mismo marcado por las dos vías: la manual lleva `alumnoId` y la del QR, el contenido del carnet del alumno. */
export function marcar(
  ctx: Pick<AppCarnet, 'http'>,
  via: Via,
  cookie: string | undefined,
  alumno: Pick<AlumnoDeAsistencia, 'alumnoId' | 'contenido'>,
  sobre: Objeto = {},
): Promise<RespuestaApi> {
  return via === 'QR'
    ? marcarPorQr(ctx, cookie, alumno.contenido, sobre)
    : marcarManual(ctx, cookie, alumno.alumnoId, sobre);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo que devuelve la API (criterio 15)
// ---------------------------------------------------------------------------------------------------------------------

export const CLAVES_DEL_RESULTADO = ['alumno', 'asistencia', 'clase', 'clases', 'repetida'];
export const CLAVES_DE_LA_ASISTENCIA = [
  'estadoLlegada',
  'fecha',
  'horaLlegada',
  'id',
  'llegadaEn',
  'metodo',
  'registroPosterior',
];
export const CLAVES_DEL_ALUMNO = ['apellidos', 'foto', 'id', 'nivel', 'nombres'];
export const CLAVES_DE_LA_CLASE = ['diaSemana', 'horaFin', 'horaInicio', 'id', 'nivel'];
export const CLAVES_DE_LAS_CLASES = ['restantes', 'totales', 'usadas'];
export const CLAVES_DEL_RECHAZO = ['alerta', 'alumno', 'asistenciaDeHoy', 'claseDeHoy', 'clases'];
export const CLAVES_DE_LA_CLASE_DE_HOY = ['horaFin', 'horaInicio'];
export const CLAVES_DE_LA_ASISTENCIA_DE_HOY = ['estadoLlegada', 'horaLlegada', 'metodo'];

export interface ResultadoApi {
  asistencia: {
    id: string;
    fecha: string;
    horaLlegada: string;
    llegadaEn: string;
    estadoLlegada: string;
    metodo: string;
    registroPosterior: boolean;
  };
  alumno: { id: string; nombres: string; apellidos: string; nivel: string; foto: string | null };
  clase: { id: string; nivel: string; diaSemana: number; horaInicio: string; horaFin: string };
  clases: { usadas: number; totales: number; restantes: number };
  repetida: boolean;
}

export interface RechazoApi {
  alerta: string;
  alumno: { id: string; nombres: string; apellidos: string; nivel: string; foto: string | null };
  claseDeHoy: { horaInicio: string; horaFin: string } | null;
  asistenciaDeHoy: { horaLlegada: string; estadoLlegada: string; metodo: string } | null;
  clases: { usadas: number; totales: number; restantes: number } | null;
}

export function codigoDeRespuesta(respuesta: Pick<RespuestaApi, 'body'>): string | undefined {
  const codigo = respuesta.body?.['codigo'];
  return typeof codigo === 'string' ? codigo : undefined;
}

/** El resultado de una respuesta 201 (o 200 si `repetida`); si no lo es, falla con el estado y el cuerpo recibidos. */
export function resultadoDe(respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>, estado = 201): ResultadoApi {
  expect(
    respuesta.status,
    `se esperaba ${estado} y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 500)}`,
  ).toBe(estado);
  expect(respuesta.body, 'la respuesta no es un objeto JSON').toBeTruthy();
  return respuesta.body as unknown as ResultadoApi;
}

/** Los `detalles` de un rechazo 409 con el código y la alerta esperados; si no lo es, falla con el estado y el cuerpo recibidos. */
export function rechazoDe(
  respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>,
  codigo: string,
  alerta: 'ROJA' | 'AMARILLA',
): RechazoApi {
  expect(
    [respuesta.status, codigoDeRespuesta(respuesta)],
    `se esperaba 409 ${codigo} y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 500)}`,
  ).toEqual([409, codigo]);
  const detalles = respuesta.body?.['detalles'];
  expect(detalles, 'el 409 debe llevar `detalles` (rechazoAsistenciaSchema)').toBeTruthy();
  expect((detalles as RechazoApi).alerta, `la alerta de ${codigo}`).toBe(alerta);
  return detalles as RechazoApi;
}

/** Ninguna respuesta es un error del servidor (5xx) ni menciona un interbloqueo (`40P01`, `deadlock`). */
export function comprobarSinErrores(respuestas: readonly Pick<RespuestaApi, 'status' | 'texto'>[]): void {
  for (const respuesta of respuestas) {
    expect(respuesta.status, `HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 300)}`).toBeLessThan(500);
    expect(respuesta.texto).not.toMatch(/40P01|deadlock|interbloqueo/i);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Escenario y alumnos
// ---------------------------------------------------------------------------------------------------------------------

export interface EscenarioDeAsistencia extends EscenarioDelCarnet {
  /** Lunes BASICO de A de 19:00 a 20:00 (la clase de la última hora del 30/11, que en UTC ya es el 1/12). */
  lunes19: ClaseDePrueba;
  /** Martes BASICO de A de 08:00 a 09:00 (otro día de Lima, aunque en UTC sea el mismo que el lunes de las 19:00). */
  martes08: ClaseDePrueba;
  /** Lunes BASICO de B de 19:00 a 20:00. */
  lunes19B: ClaseDePrueba;
}

/**
 * El escenario del carnet (A y B con sus usuarios, un plan, las clases y la caja de hoy abierta), la comprobación de que las dos rutas y la tabla de
 * la 009a existen, y tres clases más: el lunes de 19:00 a 20:00 y el martes de 08:00 a 09:00 de A, y el lunes de 19:00 a 20:00 de B.
 */
export async function prepararEscenarioDeAsistencia(ctx: AppCarnet): Promise<EscenarioDeAsistencia> {
  const esc = await prepararEscenarioDelCarnet(ctx);
  exigirRutasDe009a(ctx.app);
  await exigirTablaDeAsistencias();
  const { e } = esc;
  const clase = (academiaId: string, entrenadorId: string, dia: number, hora: string) =>
    crearClaseDePrueba(academiaId, entrenadorId, { nivel: 'BASICO', dia_semana: dia, hora_inicio: hora, aforo: 20 });
  return {
    ...esc,
    lunes19: await clase(e.A.id, e.entrenadorA.id, 1, '19:00'),
    martes08: await clase(e.A.id, e.entrenadorA.id, 2, '08:00'),
    lunes19B: await clase(e.B.id, e.lunesB.entrenador_id, 1, '19:00'),
  };
}

export interface AlumnoDeAsistencia extends AlumnoConQr {
  /** El token guardado y el contenido de su QR (`AQ1:` + token). */
  token: string;
  contenido: string;
  /** La clase principal de su matrícula. */
  claseId: string;
}

export interface OpcionesAlumnoDeAsistencia extends Omit<OpcionesAlumnoPorPago, 'claseIds'> {
  /** Las clases de su matrícula (por defecto, el lunes de las 18:00 de su academia). */
  claseIds?: readonly string[];
  /** `clases_totales` de la matrícula (por defecto 12: «Le quedan 7 de 12»). */
  clasesTotales?: number;
  /** `clases_usadas` de la matrícula (por defecto 0). */
  clasesUsadas?: number;
  /** `matriculas.creado_en` (por defecto, el del pago, `AHORA_007`). */
  matriculaCreadaEn?: Date;
  /** `matriculas.fecha_inicio` (por defecto, el 1/11). */
  fechaInicio?: string;
  /** Estado del alumno cuando se arma el caso (por defecto, el que le deja el pago: `ALUMNO_ACTIVO`). */
  estadoDelAlumno?: 'ALUMNO_ACTIVO' | 'ALUMNO_VENCIDO' | 'INACTIVO';
}

/**
 * Crea un alumno como lo hace el sistema (un pago confirmado por la API) y deja su matrícula como pide el caso (por defecto, `VIGENTE` de noviembre con 12 clases,
 * ninguna usada, la clase de los lunes a las 18:00 y `creado_en` el 11/11). Su QR queda con el token que le dio el pago.
 */
export async function crearAlumnoDeAsistencia(
  ctx: AppCarnet,
  esc: EscenarioDeAsistencia,
  opciones: OpcionesAlumnoDeAsistencia = {},
): Promise<AlumnoDeAsistencia> {
  const {
    clasesTotales = 12,
    clasesUsadas = 0,
    matriculaCreadaEn,
    fechaInicio,
    estadoDelAlumno,
    claseIds,
    ...delPago
  } = opciones;
  const esB = delPago.academia === 'B';
  const porDefecto = esB ? esc.e.lunesB.id : esc.e.lunes.id;
  // El pago usa las sesiones firmadas en `AHORA_007`: durante la creación el reloj vuelve a ese instante y después se restaura el que tenía la prueba.
  const relojDeLaPrueba = ctx.reloj.ahora();
  ctx.reloj.fijar(AHORA_007);
  let alumno: AlumnoConQr;
  try {
    alumno = await crearAlumnoPorPago(ctx, esc, {
      ...delPago,
      claseIds: claseIds ?? [porDefecto],
    });
  } finally {
    ctx.reloj.fijar(relojDeLaPrueba);
  }
  const cambios: Libre = { clases_totales: clasesTotales, clases_usadas: clasesUsadas };
  if (matriculaCreadaEn) {
    cambios['creado_en'] = matriculaCreadaEn;
    cambios['actualizado_en'] = matriculaCreadaEn;
  }
  if (fechaInicio) cambios['fecha_inicio'] = fechaInicio;
  await cambiarMatricula(alumno.academiaId, alumno.matriculaId, cambios);
  if (estadoDelAlumno && estadoDelAlumno !== 'ALUMNO_ACTIVO') {
    await cambiarAlumno(alumno.academiaId, alumno.alumnoId, { estado: estadoDelAlumno });
  }
  const token = await tokenDe(alumno.academiaId, alumno.alumnoId);
  return { ...alumno, token, contenido: `AQ1:${token}`, claseId: (claseIds ?? [porDefecto])[0] as string };
}

async function tokenDe(academiaId: string, alumnoId: string): Promise<string> {
  const fila = await leerQr(academiaId, alumnoId);
  expect(fila.qr_token, 'el alumno debía tener un token del QR tras su pago').not.toBeNull();
  return fila.qr_token as string;
}

/** `UPDATE` de columnas de una matrícula como dueño (estado, `clases_usadas`, `creado_en`, `fecha_inicio`, `anio`, `mes`, `fecha_fin`…). */
export async function cambiarMatricula(academiaId: string, matriculaId: string, cambios: Libre): Promise<void> {
  const filas = await actualizarFilas('propietario', 'matriculas', academiaId, { id: matriculaId }, cambios);
  expect(filas, `la matrícula ${matriculaId} debía existir`).toBe(1);
}

/** Cambia el estado de la clase (para probar que una clase desactivada no cuenta). */
export async function desactivarClase(academiaId: string, claseId: string): Promise<void> {
  await ejecutarComo(
    'propietario',
    'UPDATE clases SET activo = false WHERE academia_id = $1::uuid AND id = $2::uuid',
    [academiaId, claseId],
    { academiaId },
  );
}

/**
 * Un cliente de A con un Yape pendiente de verificación y su matrícula `RESERVADA` de noviembre (una renovación sin verificar: DR-3), ya pasado a `ALUMNO_ACTIVO` y con
 * su QR: no tiene ninguna matrícula `VIGENTE`. Todo escrito como dueño de las tablas.
 */
export async function crearAlumnoConPagoEnVerificacion(
  ctx: AppCarnet,
  esc: EscenarioDeAsistencia,
  sobre: { claseIds?: readonly string[] } = {},
): Promise<AlumnoDeAsistencia> {
  const claseIds = sobre.claseIds ?? [esc.e.lunes.id];
  const cliente = await sembrarEnVerificacion(esc.e, { claseIds });
  await cambiarAlumno(esc.e.A.id, cliente.alumnoId, { estado: 'ALUMNO_ACTIVO' });
  const token = randomBytes(32).toString('base64url');
  await fijarQr(esc.e.A.id, cliente.alumnoId, { token });
  return {
    academiaId: esc.e.A.id,
    alumnoId: cliente.alumnoId,
    dni: cliente.dni,
    solicitudId: cliente.solicitudId,
    matriculaId: cliente.matriculaId,
    codigoSolicitud: cliente.codigo,
    tokenSeguimiento: cliente.token,
    usuarioId: '',
    cookie: '',
    token,
    contenido: `AQ1:${token}`,
    claseId: claseIds[0] as string,
  };
}

/**
 * Pasa la matrícula `VIGENTE` del alumno a otro estado y le agrega, para el mismo mes, una `RESERVADA` con un Yape pendiente de verificación (la renovación por
 * Yape de la 010, antes de que la secretaria la apruebe): el alumno ya no tiene matrícula del día y sí un pago en verificación.
 */
export async function ponerPagoEnVerificacion(
  esc: EscenarioDeAsistencia,
  alumno: Pick<AlumnoDeAsistencia, 'academiaId' | 'alumnoId' | 'matriculaId' | 'claseId'>,
): Promise<{ matriculaId: string; pagoId: string }> {
  await cambiarMatricula(alumno.academiaId, alumno.matriculaId, { estado: 'FINALIZADA' });
  const matriculaId = randomUUID();
  const planId = esc.e.plan.id;
  await insertarFila('propietario', 'matriculas', alumno.academiaId, {
    id: matriculaId,
    alumno_id: alumno.alumnoId,
    plan_id: planId,
    anio: 2026,
    mes: 11,
    fecha_inicio: '2026-11-01',
    fecha_fin: '2026-11-30',
    clases_totales: 12,
    clases_usadas: 0,
    es_proporcional: false,
    precio_plan: '120.00',
    clases_por_mes_plan: 12,
    monto_calculado: '120.00',
    estado: 'RESERVADA',
    reserva_vence_en: null,
    creado_en: new Date('2026-11-11T15:00:00.000Z'),
    actualizado_en: new Date('2026-11-11T15:00:00.000Z'),
  });
  await insertarFila('propietario', 'matricula_clases', alumno.academiaId, {
    matricula_id: matriculaId,
    clase_id: alumno.claseId,
  });
  const pago = filaPagoValida(alumno.academiaId, { alumnoId: alumno.alumnoId, matriculaId }, { monto: '120.00' });
  await insertarPago('propietario', alumno.academiaId, pago);
  return { matriculaId, pagoId: pago['id'] as string };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas y escrituras directas de `asistencias` (como dueño, con el contexto de la academia)
// ---------------------------------------------------------------------------------------------------------------------

export interface FilaAsistencia {
  id: string;
  academia_id: string;
  alumno_id: string;
  matricula_id: string;
  clase_id: string;
  fecha: string;
  llegada_en: Date;
  registrado_en: Date;
  metodo: string;
  tipo: string;
  estado_llegada: string;
  registrado_por: string;
  registro_posterior: boolean;
  motivo: string | null;
  clave_idempotencia: string;
}

/** Las asistencias de una academia, de la más antigua a la más nueva. */
export async function leerAsistencias(academiaId: string): Promise<FilaAsistencia[]> {
  const { rows } = await conMensajeDeAsistencias(() =>
    ejecutarComo(
      'propietario',
      `SELECT id, academia_id, alumno_id, matricula_id, clase_id, fecha::text AS fecha, llegada_en, registrado_en, metodo::text AS metodo,
              tipo::text AS tipo, estado_llegada::text AS estado_llegada, registrado_por, registro_posterior, motivo, clave_idempotencia
         FROM asistencias WHERE academia_id = $1::uuid ORDER BY llegada_en, id`,
      [academiaId],
      { academiaId },
    ),
  );
  return rows as FilaAsistencia[];
}

export async function asistenciasDe(academiaId: string, alumnoId: string): Promise<FilaAsistencia[]> {
  return (await leerAsistencias(academiaId)).filter((fila) => fila.alumno_id === alumnoId);
}

/** `clases_usadas` de una matrícula. */
export async function clasesUsadasDe(academiaId: string, matriculaId: string): Promise<number> {
  const fila = (await leerMatriculas(academiaId)).find((matricula) => matricula.id === matriculaId);
  if (!fila) throw new Error(`La matrícula ${matriculaId} no existe en la academia ${academiaId}.`);
  return fila.clases_usadas;
}

const TIPO_DE_COLUMNA: Readonly<Record<string, string>> = {
  id: 'uuid',
  academia_id: 'uuid',
  alumno_id: 'uuid',
  matricula_id: 'uuid',
  clase_id: 'uuid',
  fecha: 'date',
  llegada_en: 'timestamptz',
  registrado_en: 'timestamptz',
  metodo: 'metodo_asistencia',
  tipo: 'tipo_asistencia',
  estado_llegada: 'estado_llegada',
  registrado_por: 'uuid',
  registro_posterior: 'boolean',
  motivo: 'text',
  clave_idempotencia: 'uuid',
};

function tipoDe(columna: string): string {
  const tipo = TIPO_DE_COLUMNA[columna];
  if (tipo === undefined) throw new Error(`Columna desconocida en la utilidad de pruebas de asistencias: ${columna}`);
  return tipo;
}

export type Columnas = Record<string, unknown>;

export interface PadresDeLaAsistencia {
  alumnoId: string;
  matriculaId: string;
  claseId: string;
  usuarioId: string;
}

/** Una asistencia válida: QR puntual del lunes 16/11 a las 18:05 de Lima (23:05 UTC), `tipo` y `registro_posterior` por su valor por defecto cuando se omiten. */
export function filaAsistenciaValida(padres: PadresDeLaAsistencia, sobre: Columnas = {}): Columnas {
  const llegada = new Date('2026-11-16T23:05:00.000Z');
  return quitarIndefinidos({
    id: randomUUID(),
    alumno_id: padres.alumnoId,
    matricula_id: padres.matriculaId,
    clase_id: padres.claseId,
    fecha: LUNES,
    llegada_en: llegada,
    registrado_en: llegada,
    metodo: 'QR',
    estado_llegada: 'PUNTUAL',
    registrado_por: padres.usuarioId,
    motivo: null,
    clave_idempotencia: randomUUID(),
    ...sobre,
  });
}

export interface OpcionesDeEscritura {
  contexto?: { academiaId?: string; plataforma?: boolean | string };
}

function contextoDe(academiaId: string, opciones: OpcionesDeEscritura) {
  return 'contexto' in opciones ? opciones.contexto : { academiaId };
}

/** `INSERT` directo en `asistencias` (con cualquier valor, también inválido); el error de PostgreSQL (con su `code` y su `constraint`) se propaga tal cual. */
export async function insertarAsistencia(
  rol: RolPruebas,
  academiaId: string,
  columnas: Columnas,
  opciones: OpcionesDeEscritura = {},
): Promise<void> {
  const todas: Columnas = { academia_id: academiaId, ...columnas };
  const nombres = Object.keys(todas);
  const marcas = nombres.map((nombre, i) => `$${i + 1}::${tipoDe(nombre)}`);
  await conMensajeDeAsistencias(() =>
    ejecutarComo(
      rol,
      `INSERT INTO asistencias (${nombres.join(', ')}) VALUES (${marcas.join(', ')})`,
      Object.values(todas),
      contextoDe(academiaId, opciones),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Instantáneas: lo que un rechazo no puede cambiar
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Todo lo que un marcado rechazado, un 404 o un 401 no pueden cambiar: las dos academias (pagos, las siete tablas de la 005 con las clases usadas, la caja, los usuarios
 * y la auditoría), las columnas del QR y las asistencias de A y de B.
 */
export async function instantaneaDeAsistencia(e: EscenarioPagos): Promise<string> {
  return JSON.stringify({
    carnet: await instantaneaDelCarnet(e),
    asistenciasA: await leerAsistencias(e.A.id),
    asistenciasB: await leerAsistencias(e.B.id),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// La caja de otro día (el cobro de la 007 exige la caja de hoy abierta)
// ---------------------------------------------------------------------------------------------------------------------

/** Cierra la caja abierta de A y abre otra con la fecha de `dia` (por ejemplo, `LUNES`): así un cobro en efectivo a esa hora tiene su caja. */
export async function abrirCajaDelDia(esc: EscenarioDeAsistencia, dia: string): Promise<void> {
  const { e } = esc;
  for (const caja of await leerCajas(e.A.id)) {
    if (caja.estado === 'ABIERTA') await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
  }
  await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: dia, monto_inicial: '100.00' });
}
