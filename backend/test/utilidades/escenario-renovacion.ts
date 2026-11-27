// spec: 010-mensualidades (pruebas protegidas)
import { randomBytes, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { expect } from 'vitest';
import { ejecutarComo } from './base-datos';
import { enLima, leerMovimientos } from './caja';
import { type AppCarnet, cambiarAlumno, fijarQr } from './escenario-carnet';
import {
  abrirCajaDelDia,
  type AlumnoDeAsistencia,
  cambiarMatricula,
  type EscenarioDeAsistencia,
  instantaneaDeAsistencia,
  type OpcionesAlumnoDeAsistencia,
  prepararEscenarioDeAsistencia,
} from './escenario-asistencia';
import { jsonAscii } from './escenario-pagos-007b';
import {
  actualizarFilas,
  fechaEnLima,
  leerAlumnos,
  leerMatriculaClases,
  leerMatriculas,
  type Libre,
  type Objeto,
  type RespuestaApi,
  sembrarSolicitud,
} from './inscripciones';
import { archivosBajo, type OpcionesSubida, png, subirFoto } from './inscripciones-005b';
import { numeroDeOperacionInventado } from './pagos';
import type { Retenedor } from './planes-clases';
import { AHORA_007 } from './escenario-pagos';
import { CLAVE_COMUN, cookieDeUsuario, crearUsuarioDePrueba, dniInventado, rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 010a (renovación con prioridad de horario). Solo usan SQL, HTTP y los contratos públicos: no importan
 * nada de la implementación interna. Reutilizan el escenario de la 009 (`escenario-asistencia.ts`, que a su vez usa el del carnet, el de la 008b y el
 * de la 007): A y B, un plan de S/ 120.00 de 12 clases, las clases de los lunes, miércoles y viernes a las 18:00 con aforo 20, el lunes de 19:00, el
 * martes de 08:00 y la caja de hoy. Lo que todavía no existe (las cuatro rutas de la renovación y los esquemas de `@aquagestion/contratos`) se exige con
 * un mensaje claro: ninguna prueba pasa por casualidad con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------------------------------------------------

export const ACCION_RENOVACION = 'RENOVACION_REGISTRADA';
/** La cabecera con los datos del comprobante de la renovación (criterio 7): JSON ASCII de hasta 2048 bytes. */
export const CABECERA_DATOS_RENOVACION = 'x-renovacion-datos';
export const LARGO_MAXIMO_DE_LA_CABECERA = 2048;

export const rutaOferta = (alumnoId: string, mes?: string): string =>
  `/api/alumnos/${alumnoId}/renovacion${mes === undefined ? '' : `?mes=${mes}`}`;
export const rutaCotizacionRenovacion = (alumnoId: string): string => `/api/alumnos/${alumnoId}/renovacion/cotizacion`;
export const rutaRenovacionEfectivo = (alumnoId: string): string => `/api/alumnos/${alumnoId}/renovacion/efectivo`;
export const rutaRenovacionComprobante = (alumnoId: string): string =>
  `/api/alumnos/${alumnoId}/renovacion/comprobante`;

const RUTAS_DE_LA_010A: readonly RegExp[] = [
  /^GET \/api\/alumnos\/:\w+\/renovacion$/,
  /^POST \/api\/alumnos\/:\w+\/renovacion\/cotizacion$/,
  /^POST \/api\/alumnos\/:\w+\/renovacion\/efectivo$/,
  /^PUT \/api\/alumnos\/:\w+\/renovacion\/comprobante$/,
];

/** Falla con un mensaje claro si las cuatro rutas de la 010a no están registradas (la funcionalidad no existe todavía). */
export function exigirRutasDe010a(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_010A) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 010a: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

interface EsquemaDePrueba {
  safeParse(valor: unknown): { success: boolean; error?: unknown };
}

export interface ContratosDe010a {
  respuestaRenovacionSchema: EsquemaDePrueba;
  ofertaRenovacionSchema: EsquemaDePrueba;
  pagoPendienteSchema: EsquemaDePrueba;
  CABECERA_DATOS_RENOVACION: string;
}

/** Los esquemas de `@aquagestion/contratos` que agrega la 010a (criterios 2, 7, 11 y 14). Falla con un mensaje claro si faltan. */
export async function cargarContratosDe010a(): Promise<ContratosDe010a> {
  const modulo = (await import('@aquagestion/contratos')) as Record<string, unknown>;
  for (const nombre of [
    'respuestaRenovacionSchema',
    'ofertaRenovacionSchema',
    'cotizarRenovacionSchema',
    'renovarEnEfectivoSchema',
    'datosRenovacionComprobanteSchema',
    'CABECERA_DATOS_RENOVACION',
  ]) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 010a: @aquagestion/contratos no exporta ${nombre}.`);
    }
  }
  return modulo as unknown as ContratosDe010a;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instantes de Lima y meses (el 26/11/2026 es jueves; el 1/12/2026, martes)
// ---------------------------------------------------------------------------------------------------------------------

export const NOVIEMBRE = { anio: 2026, mes: 11 } as const;
export const DICIEMBRE = { anio: 2026, mes: 12 } as const;
export const MES_NOVIEMBRE = '2026-11';
export const MES_DICIEMBRE = '2026-12';
export const MES_ENERO = '2027-01';

/** Con `diasPrioridadRenovacion` = 5 (el valor por defecto), la ventana de diciembre es del 26/11 al 30/11. */
export const INSTANTES = {
  /** 23:59:59.999 del 25/11: todavía no se puede renovar diciembre. */
  ultimoAntesDeLaVentana: enLima('2026-11-25', '23:59:59.999'),
  primeroDeLaVentana: enLima('2026-11-26', '00:00:00.000'),
  /** El jueves 26/11 a las 10:00 (las clases de las 18:00 que quedan: viernes 27 y lunes 30). */
  jueves26: enLima('2026-11-26', '10:00'),
  viernes27: enLima('2026-11-27', '10:00'),
  sabado28: enLima('2026-11-28', '10:00'),
  ultimoDeLaVentana: enLima('2026-11-30', '23:59:59.999'),
  primeroDeDiciembre: enLima('2026-12-01', '00:00:00.000'),
} as const;

/** El día de Lima (`AAAA-MM-DD`) de un instante. */
export const diaDeLima = (instante: Date): string => fechaEnLima(instante).texto;

// ---------------------------------------------------------------------------------------------------------------------
// Peticiones
// ---------------------------------------------------------------------------------------------------------------------

export type Via = 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA';
export const VIAS_CON_COMPROBANTE: readonly Via[] = ['YAPE', 'TRANSFERENCIA'];

export interface SeleccionDeRenovacion {
  mes: string;
  planId: string;
  claseIds: string[];
}

/** Diciembre con el plan de A (3 por semana, S/ 120.00) y las clases de los lunes, miércoles y viernes a las 18:00: 13 ocurrencias, tope 12. */
export function seleccionDeDiciembre(
  esc: Pick<EscenarioDeAsistencia, 'e'>,
  sobre: Partial<SeleccionDeRenovacion> = {},
): SeleccionDeRenovacion {
  return {
    mes: MES_DICIEMBRE,
    planId: esc.e.plan.id,
    claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
    ...sobre,
  };
}

/** Un cuerpo de `cotizarRenovacionSchema`. */
export const cuerpoCotizacionRenovacion = (sel: SeleccionDeRenovacion, sobre: Objeto = {}): Objeto =>
  quitarIndefinidos({ mes: sel.mes, planId: sel.planId, claseIds: sel.claseIds, ...sobre });

/** Un cuerpo de `renovarEnEfectivoSchema` con una clave nueva. */
export const cuerpoEfectivoRenovacion = (
  sel: SeleccionDeRenovacion,
  montoMostrado: string,
  sobre: Objeto = {},
): Objeto =>
  quitarIndefinidos({
    claveIdempotencia: randomUUID(),
    mes: sel.mes,
    planId: sel.planId,
    claseIds: sel.claseIds,
    montoMostrado,
    ...sobre,
  });

/** Los datos de `datosRenovacionComprobanteSchema` con una clave nueva y un número de operación que no se repite. */
export const datosComprobanteRenovacion = (
  sel: SeleccionDeRenovacion,
  monto: string,
  fechaOperacion: string,
  sobre: Objeto = {},
): Objeto =>
  quitarIndefinidos({
    claveIdempotencia: randomUUID(),
    mes: sel.mes,
    planId: sel.planId,
    claseIds: sel.claseIds,
    metodo: 'YAPE',
    numeroOperacion: numeroDeOperacionInventado(),
    monto,
    fechaOperacion,
    ...sobre,
  });

function quitarIndefinidos(cuerpo: Objeto): Objeto {
  for (const [clave, valor] of Object.entries(cuerpo)) if (valor === undefined) delete cuerpo[clave];
  return cuerpo;
}

/** Lo que las peticiones necesitan de la aplicación de la prueba (la del carnet y la de la 005b sirven las dos). */
interface ClienteDe {
  app: NestExpressApplication;
  http: {
    get(ruta: string, opciones?: { cookie?: string }): Promise<RespuestaApi>;
    post(ruta: string, cuerpo?: unknown, opciones?: { cookie?: string }): Promise<RespuestaApi>;
  };
}

export const pedirOferta = (ctx: ClienteDe, cookie: string | undefined, alumnoId: string, mes?: string) =>
  ctx.http.get(rutaOferta(alumnoId, mes), { cookie });

export const cotizarRenovacion = (ctx: ClienteDe, cookie: string | undefined, alumnoId: string, cuerpo: Objeto) =>
  ctx.http.post(rutaCotizacionRenovacion(alumnoId), cuerpo, { cookie });

export const renovarEnEfectivo = (ctx: ClienteDe, cookie: string | undefined, alumnoId: string, cuerpo: Objeto) =>
  ctx.http.post(rutaRenovacionEfectivo(alumnoId), cuerpo, { cookie });

export interface OpcionesDelComprobante extends Omit<OpcionesSubida, 'token'> {
  /** La cookie de la sesión (sin ella, la petición va sin sesión). */
  cookie?: string;
  /** Los datos de `X-Renovacion-Datos`: un objeto (se manda como JSON ASCII), un texto tal cual, una lista (cabecera repetida) o `null` para no mandar la cabecera. */
  datos?: Objeto | string | readonly string[] | null;
}

/**
 * `PUT /api/alumnos/{id}/renovacion/comprobante` crudo (la imagen como cuerpo binario y los datos en `X-Renovacion-Datos`). Sin `cuerpo`, un PNG
 * válido de 100 × 100 y, sin `tipo`, `image/png`. Devuelve la respuesta en cuanto llega, aunque la API no lea el cuerpo (401, 403 y 413 no lo leen).
 */
export function renovarConComprobante(
  ctx: Pick<AppCarnet, 'app'>,
  alumnoId: string,
  opciones: OpcionesDelComprobante = {},
): Promise<RespuestaApi> {
  const { cookie, datos, headers, cuerpo, ruta, ...resto } = opciones;
  const todas: Record<string, string> = { ...headers };
  if (cookie) todas['cookie'] = cookie;
  if (datos !== null && datos !== undefined) {
    // Una lista manda la cabecera repetida (Node la escribe en dos líneas); `subirFoto` solo declara cadenas.
    todas[CABECERA_DATOS_RENOVACION] = (
      typeof datos === 'string' || Array.isArray(datos) ? datos : jsonAscii(datos)
    ) as string;
  }
  return subirFoto(ctx, 'sin-uso', {
    ...resto,
    cuerpo: cuerpo ?? png(100, 100),
    ruta: ruta ?? rutaRenovacionComprobante(alumnoId),
    headers: todas,
  });
}

export interface OpcionesDeRegistro {
  /** Cambios sobre la selección por defecto (diciembre, el plan de A y las clases de los lunes, miércoles y viernes). */
  seleccion?: Partial<SeleccionDeRenovacion>;
  /** El total que se declara (`montoMostrado` del efectivo, `monto` del comprobante). Por defecto, `120.00`. */
  total?: string;
  /** `fechaOperacion` del comprobante (por defecto, el primer día de la ventana: `2026-11-26`). */
  fechaOperacion?: string;
  /** Cambios sobre el cuerpo o los datos (`undefined` quita el campo). */
  sobre?: Objeto;
  /** Solo el comprobante: la imagen, el tipo y las demás opciones de la petición. */
  imagen?: Omit<OpcionesDelComprobante, 'cookie' | 'datos'> & { datos?: OpcionesDelComprobante['datos'] };
}

/** Lo que se envió, para que la prueba pueda repetirlo o compararlo. */
export interface Registro {
  cuerpo: Objeto;
  respuesta: RespuestaApi;
}

/** El registro de una renovación por cualquiera de las dos rutas (efectivo, Yape o transferencia) con valores por defecto válidos. */
export async function registrarRenovacion(
  ctx: ClienteDe,
  esc: EscenarioDeAsistencia,
  via: Via,
  cookie: string | undefined,
  alumnoId: string,
  opciones: OpcionesDeRegistro = {},
): Promise<Registro> {
  const sel = seleccionDeDiciembre(esc, opciones.seleccion);
  const total = opciones.total ?? '120.00';
  if (via === 'EFECTIVO') {
    const cuerpo = cuerpoEfectivoRenovacion(sel, total, opciones.sobre);
    return { cuerpo, respuesta: await renovarEnEfectivo(ctx, cookie, alumnoId, cuerpo) };
  }
  const datos = datosComprobanteRenovacion(sel, total, opciones.fechaOperacion ?? '2026-11-26', {
    metodo: via,
    ...opciones.sobre,
  });
  const { datos: datosPropios, ...imagen } = opciones.imagen ?? {};
  const respuesta = await renovarConComprobante(ctx, alumnoId, {
    cookie,
    ...imagen,
    datos: datosPropios === undefined ? datos : datosPropios,
  });
  return { cuerpo: datos, respuesta };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo que devuelve la API
// ---------------------------------------------------------------------------------------------------------------------

export const CLAVES_DE_LA_RESPUESTA = ['pago', 'renovacion', 'repetida'];
export const CLAVES_DE_LA_RENOVACION = [
  'clases',
  'clasesTotales',
  'conPrioridad',
  'estado',
  'fechaFin',
  'fechaInicio',
  'matriculaId',
  'mes',
  'plan',
  'total',
];

export interface RespuestaDeRenovacion {
  renovacion: {
    matriculaId: string;
    mes: string;
    estado: 'VIGENTE' | 'EN_VERIFICACION';
    plan: { id: string; nombre: string };
    clases: { id: string; diaSemana: number; horaInicio: string; horaFin: string }[];
    fechaInicio: string;
    fechaFin: string;
    clasesTotales: number;
    total: string;
    conPrioridad: string[];
  };
  pago: {
    id: string;
    estado: string;
    metodo: string;
    concepto: string;
    monto: string;
    numeroOperacion: string | null;
    fechaOperacion: string | null;
    numeroTicket: number | null;
  };
  repetida: boolean;
}

/** La respuesta 201 (o 200 si `repetida`) del registro; si no lo es, falla con el estado y el cuerpo recibidos. */
export function renovacionDe(
  respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>,
  estado = 201,
): RespuestaDeRenovacion {
  expect(
    respuesta.status,
    `se esperaba ${estado} y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 500)}`,
  ).toBe(estado);
  expect(respuesta.body, 'la respuesta no es un objeto JSON').toBeTruthy();
  return respuesta.body as unknown as RespuestaDeRenovacion;
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

/** Ninguna respuesta es un error del servidor (5xx) ni menciona un interbloqueo (`40P01`, `deadlock`). */
export function sinErroresDelServidor(respuestas: readonly Pick<RespuestaApi, 'status' | 'texto'>[]): void {
  for (const respuesta of respuestas) {
    expect(respuesta.status, `HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 300)}`).toBeLessThan(500);
    expect(respuesta.texto).not.toMatch(/40P01|deadlock|interbloqueo/i);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Escenario y alumnos
// ---------------------------------------------------------------------------------------------------------------------

/** El escenario de la 009 (A y B con sus usuarios, el plan, las clases y la caja de hoy) y la comprobación de que las rutas de la 010a existen. */
export async function prepararEscenarioDeRenovacion(ctx: AppCarnet): Promise<EscenarioDeAsistencia> {
  const esc = await prepararEscenarioDeAsistencia(ctx);
  exigirRutasDe010a(ctx.app);
  return esc;
}

/** Cierra la caja abierta de A y abre la del día de Lima de `instante` (el efectivo exige la caja abierta de hoy). */
export function abrirCajaPara(esc: EscenarioDeAsistencia, instante: Date): Promise<void> {
  return abrirCajaDelDia(esc, diaDeLima(instante));
}

/**
 * Un alumno de A (`ALUMNO_ACTIVO`, no `CLIENTE`) con su matrícula de noviembre `VIGENTE` y las clases de los lunes, miércoles y viernes a las 18:00:
 * es titular de prioridad en esas tres clases durante la ventana. Con `academia: 'B'`, el de B con las suyas.
 *
 * Se siembra como dueño de las tablas (el estado al que llega un alumno confirmado: solicitud `CONFIRMADA`, matrícula `VIGENTE` sin vencimiento,
 * cuenta de `ALUMNO` con su contraseña inicial ya cambiada y QR con su token) y no con el cobro de la 007a: ese cobro necesita la caja del 11/11 y las
 * pruebas de la renovación cambian la caja al día que prueban (una sola por día y una sola abierta). `ctx` se conserva para que los llamadores no cambien.
 */
export async function crearAlumnoDeNoviembre(
  _ctx: unknown,
  esc: Pick<EscenarioDeAsistencia, 'e'>,
  opciones: OpcionesAlumnoDeAsistencia = {},
): Promise<AlumnoDeAsistencia> {
  const {
    clasesTotales = 12,
    clasesUsadas = 0,
    matriculaCreadaEn,
    fechaInicio,
    estadoDelAlumno,
    claseIds,
    academia = 'A',
    ...delAlumno
  } = opciones;
  const { e } = esc;
  const esB = academia === 'B';
  const academiaId = esB ? e.B.id : e.A.id;
  const planId = esB ? e.planB.id : e.plan.id;
  const clases =
    claseIds ?? (esB ? [e.lunesB.id, e.miercolesB.id, e.viernesB.id] : [e.lunes.id, e.miercoles.id, e.viernes.id]);
  const cliente = await sembrarSolicitud(academiaId, {
    planId,
    claseIds: clases,
    reservaVenceEn: null,
    clasesTotales,
    clasesPorMesPlan: 12,
    precioPlan: '120.00',
    monto: '120.00',
    ahora: AHORA_007,
    ...delAlumno,
    estadoAlumno: 'ALUMNO_ACTIVO',
  });
  await actualizarFilas(
    'propietario',
    'solicitudes_inscripcion',
    academiaId,
    { id: cliente.solicitudId },
    { estado: 'CONFIRMADA' },
  );
  const cambios: Libre = { estado: 'VIGENTE', reserva_vence_en: null, clases_usadas: clasesUsadas };
  if (matriculaCreadaEn) {
    cambios['creado_en'] = matriculaCreadaEn;
    cambios['actualizado_en'] = matriculaCreadaEn;
  }
  if (fechaInicio) cambios['fecha_inicio'] = fechaInicio;
  await actualizarFilas('propietario', 'matriculas', academiaId, { id: cliente.matriculaId }, cambios);
  const usuario = await crearUsuarioDePrueba({ academiaId, rol: 'ALUMNO', dni: cliente.dni, clave: CLAVE_COMUN });
  const token = randomBytes(32).toString('base64url');
  await cambiarAlumno(academiaId, cliente.alumnoId, {
    usuario_id: usuario.id,
    estado: estadoDelAlumno ?? 'ALUMNO_ACTIVO',
  });
  await fijarQr(academiaId, cliente.alumnoId, { token });
  return {
    academiaId,
    alumnoId: cliente.alumnoId,
    dni: cliente.dni,
    solicitudId: cliente.solicitudId,
    matriculaId: cliente.matriculaId,
    codigoSolicitud: cliente.codigo,
    tokenSeguimiento: cliente.token,
    usuarioId: usuario.id,
    cookie: cookieDeUsuario({ id: usuario.id, academiaId, rol: 'ALUMNO' }, AHORA_007),
    token,
    contenido: `AQ1:${token}`,
    claseId: clases[0] as string,
  };
}

/**
 * Un alumno `ALUMNO_VENCIDO` sin matrícula de noviembre: su única matrícula es de octubre y está `FINALIZADA`. No es titular de prioridad en ninguna clase
 * y puede renovar noviembre (renovación tardía, DR-4) o, dentro de la ventana, diciembre.
 */
export async function crearAlumnoVencido(
  ctx: unknown,
  esc: Pick<EscenarioDeAsistencia, 'e'>,
  opciones: OpcionesAlumnoDeAsistencia = {},
): Promise<AlumnoDeAsistencia> {
  const alumno = await crearAlumnoDeNoviembre(ctx, esc, opciones);
  await cambiarMatricula(alumno.academiaId, alumno.matriculaId, {
    anio: 2026,
    mes: 10,
    fecha_inicio: '2026-10-01',
    fecha_fin: '2026-10-31',
    estado: 'FINALIZADA',
  });
  await cambiarAlumno(alumno.academiaId, alumno.alumnoId, { estado: 'ALUMNO_VENCIDO' });
  return alumno;
}

export interface OpcionesDeTitulares {
  /** Las clases de cada matrícula (todas las filas llevan las mismas). */
  claseIds: readonly string[];
  /** El mes de las matrículas (por defecto, noviembre de 2026). */
  mes?: { anio: number; mes: number };
  /** `VIGENTE` (por defecto) o `RESERVADA` sin vencimiento (un pago en verificación: ocupa cupo en su mes y, desde la 010a ronda 2 (DR-12), no da prioridad para el mes siguiente). */
  estado?: 'VIGENTE' | 'RESERVADA';
  /** `ALUMNO_ACTIVO` (por defecto) o el estado que pida el caso (un `CLIENTE` no es titular de prioridad). */
  estadoAlumno?: 'ALUMNO_ACTIVO' | 'ALUMNO_VENCIDO' | 'CLIENTE';
}

/**
 * Siembra, como dueño y en una sola sentencia, `cantidad` alumnos de A que no son `CLIENTE` cada uno con una matrícula del mes sin solicitud ni
 * vencimiento (como las que deja la renovación) en las clases dadas. Devuelve los ids de los alumnos, en el orden de creación.
 */
export async function sembrarTitulares(
  academiaId: string,
  planId: string,
  cantidad: number,
  opciones: OpcionesDeTitulares,
): Promise<string[]> {
  const mes = opciones.mes ?? NOVIEMBRE;
  const ids = Array.from({ length: cantidad }, () => randomUUID());
  await sembrarAlumnosYMatriculas(academiaId, planId, ids, mes, opciones);
  return ids;
}

async function sembrarAlumnosYMatriculas(
  academiaId: string,
  planId: string,
  ids: readonly string[],
  mes: { anio: number; mes: number },
  opciones: OpcionesDeTitulares,
): Promise<void> {
  const dos = (n: number) => String(n).padStart(2, '0');
  const ultimo = new Date(Date.UTC(mes.anio, mes.mes, 0)).getUTCDate();
  await ejecutarComo(
    'propietario',
    `WITH a AS (
       INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, creado_en, actualizado_en)
       SELECT d.id, $1::uuid, d.dni, 'Titular', 'De la prioridad', DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion,
              $2::estado_alumno, now(), now()
         FROM unnest($3::uuid[], $4::text[]) AS d(id, dni)
       RETURNING id),
     m AS (
       INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, anio, mes, fecha_inicio, fecha_fin, clases_totales, clases_usadas,
                               es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado, reserva_vence_en,
                               creado_en, actualizado_en)
       SELECT gen_random_uuid(), $1::uuid, a.id, $5::uuid, $6::smallint, $7::smallint, $8::date, $9::date, 12, 0,
              false, 120.00, 12, 120.00, $10::estado_matricula, NULL, now(), now()
         FROM a
       RETURNING id)
     INSERT INTO matricula_clases (academia_id, matricula_id, clase_id)
     SELECT $1::uuid, m.id, c FROM m CROSS JOIN unnest($11::uuid[]) AS c`,
    [
      academiaId,
      opciones.estadoAlumno ?? 'ALUMNO_ACTIVO',
      [...ids],
      ids.map(() => dniInventado()),
      planId,
      mes.anio,
      mes.mes,
      `${mes.anio}-${dos(mes.mes)}-01`,
      `${mes.anio}-${dos(mes.mes)}-${dos(ultimo)}`,
      opciones.estado ?? 'VIGENTE',
      [...opciones.claseIds],
    ],
    { academiaId },
  );
}

/** Le agrega a alumnos que ya existen una matrícula (sin solicitud ni vencimiento) de otro mes, por ejemplo la de diciembre que ya renovaron. */
export async function sembrarMatriculaDelMes(
  academiaId: string,
  planId: string,
  alumnoIds: readonly string[],
  claseIds: readonly string[],
  mes: { anio: number; mes: number },
  estado: 'VIGENTE' | 'RESERVADA' = 'VIGENTE',
): Promise<void> {
  if (alumnoIds.length === 0) return;
  const dos = (n: number) => String(n).padStart(2, '0');
  const ultimo = new Date(Date.UTC(mes.anio, mes.mes, 0)).getUTCDate();
  await ejecutarComo(
    'propietario',
    `WITH m AS (
       INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, anio, mes, fecha_inicio, fecha_fin, clases_totales, clases_usadas,
                               es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado, reserva_vence_en,
                               creado_en, actualizado_en)
       SELECT gen_random_uuid(), $1::uuid, a, $2::uuid, $3::smallint, $4::smallint, $5::date, $6::date, 12, 0,
              false, 120.00, 12, 120.00, $7::estado_matricula, NULL, now(), now()
         FROM unnest($8::uuid[]) AS a
       RETURNING id)
     INSERT INTO matricula_clases (academia_id, matricula_id, clase_id)
     SELECT $1::uuid, m.id, c FROM m CROSS JOIN unnest($9::uuid[]) AS c`,
    [
      academiaId,
      planId,
      mes.anio,
      mes.mes,
      `${mes.anio}-${dos(mes.mes)}-01`,
      `${mes.anio}-${dos(mes.mes)}-${dos(ultimo)}`,
      estado,
      [...alumnoIds],
      [...claseIds],
    ],
    { academiaId },
  );
}

/** Cambia el aforo de una clase como dueño (el administrador lo bajó por debajo de los inscritos, DR-5 de 004). */
export async function fijarAforo(academiaId: string, claseId: string, aforo: number): Promise<void> {
  await ejecutarComo(
    'propietario',
    'UPDATE clases SET aforo = $3 WHERE academia_id = $1::uuid AND id = $2::uuid',
    [academiaId, claseId, aforo],
    { academiaId },
  );
}

/** Cambia el correo de un alumno y, si tiene, el de su apoderado (para los correos de la renovación). */
export async function ponerCorreos(
  academiaId: string,
  alumnoId: string,
  correos: { alumno?: string | null; apoderado?: string | null },
): Promise<void> {
  if (correos.alumno !== undefined) {
    await ejecutarComo(
      'propietario',
      'UPDATE alumnos SET correo = $3 WHERE academia_id = $1::uuid AND id = $2::uuid',
      [academiaId, alumnoId, correos.alumno],
      { academiaId },
    );
  }
  if (correos.apoderado !== undefined) {
    await ejecutarComo(
      'propietario',
      'UPDATE apoderados SET correo = $3 WHERE academia_id = $1::uuid AND alumno_id = $2::uuid',
      [academiaId, alumnoId, correos.apoderado],
      { academiaId },
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------------------------------------------------

/** La matrícula de un alumno de un mes (falla si no hay), con sus clases. */
export async function matriculaDelMes(academiaId: string, alumnoId: string, mes: { anio: number; mes: number }) {
  const fila = (await leerMatriculas(academiaId)).find(
    (m) => m.alumno_id === alumnoId && m.anio === mes.anio && m.mes === mes.mes,
  );
  expect(fila, `el alumno ${alumnoId} debía tener una matrícula de ${mes.anio}-${mes.mes}`).toBeTruthy();
  const matricula = fila as NonNullable<typeof fila>;
  const clases = (await leerMatriculaClases(academiaId))
    .filter((c) => c.matricula_id === matricula.id)
    .map((c) => c.clase_id)
    .sort();
  return { ...matricula, clases };
}

/** Cuántas matrículas tiene un alumno de un mes (de cualquier estado). */
export async function cuantasDelMes(academiaId: string, alumnoId: string, mes: { anio: number; mes: number }) {
  return (await leerMatriculas(academiaId)).filter(
    (m) => m.alumno_id === alumnoId && m.anio === mes.anio && m.mes === mes.mes,
  ).length;
}

export async function estadoDelAlumno(academiaId: string, alumnoId: string): Promise<string | undefined> {
  return (await leerAlumnos(academiaId)).find((a) => a.id === alumnoId)?.estado;
}

/** Los movimientos de caja de A (para comprobar cuánto entró y por qué método). */
export const movimientosDeA = (esc: EscenarioDeAsistencia) => leerMovimientos(esc.e.A.id);

/**
 * Todo lo que un rechazo no puede cambiar: las dos academias, el QR, las asistencias, la caja, los usuarios, la auditoría y los archivos del
 * almacén. Un texto para compararlo antes y después.
 */
export async function instantaneaDeRenovacion(
  ctx: Pick<AppCarnet, 'raiz'>,
  esc: EscenarioDeAsistencia,
): Promise<string> {
  return JSON.stringify({ academias: await instantaneaDeAsistencia(esc.e), archivos: archivosBajo(ctx.raiz) });
}

// ---------------------------------------------------------------------------------------------------------------------
// Retenciones para las carreras deterministas (se usan con `conRetencion` de `inscripciones.ts`)
// ---------------------------------------------------------------------------------------------------------------------

/** Retiene la fila del alumno (`SELECT … FOR UPDATE`): quien la pida bloqueada (la renovación, el marcado, la regeneración del QR, la foto) queda esperando. */
export function retenerAlumno(academiaId: string, alumnoId: string) {
  return async (retenedor: Retenedor): Promise<void> => {
    await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
      academiaId,
      alumnoId,
    ]);
  };
}

/** Retiene las matrículas del alumno (`SELECT … FOR UPDATE`, en el orden de `id`): quien las pida bloqueadas queda esperando después de la fila del alumno. */
export function retenerMatriculasDe(academiaId: string, alumnoId: string) {
  return async (retenedor: Retenedor): Promise<void> => {
    await retenedor.consultar(
      'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND alumno_id = $2::uuid ORDER BY id FOR UPDATE',
      [academiaId, alumnoId],
    );
  };
}
