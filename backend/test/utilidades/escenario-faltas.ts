// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { expect } from 'vitest';
import { ejecutarComo, type RolPruebas } from './base-datos';
import { leerCajas } from './caja';
import { type AppCarnet, cambiarAlumno } from './escenario-carnet';
import {
  abrirCajaDelDia,
  cambiarMatricula,
  type AlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  instantaneaDeAsistencia,
  prepararEscenarioDeAsistencia,
} from './escenario-asistencia';
import { cookiesDePagos, cuerpoCobro, rutaCobro, sembrarCobrable, type EscenarioPagos } from './escenario-pagos';
import { rutaAprobacion, sembrarEnVerificacion } from './escenario-pagos-007b';
import { fechaEnLima, type Objeto, type RespuestaApi } from './inscripciones';
import { rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 009b (faltas, registro posterior y consulta del mes). Solo usan SQL, HTTP y los contratos públicos
 * (`FaltasService.registrarFaltas(ahora)` del criterio 23, que las pruebas llaman directamente con `TAREAS_PROGRAMADAS` apagada, DT-9): no leen la
 * implementación interna. Reutilizan el escenario de la 009a (`escenario-asistencia.ts`), el del carnet y el de la 007. Lo que todavía no existe (la tabla
 * `inasistencias`, las dos rutas nuevas y el servicio de faltas) se exige con un mensaje claro: ninguna prueba pasa por casualidad con una ruta inexistente.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Lo que la 009b agrega: la tabla, las rutas y el servicio
// ---------------------------------------------------------------------------------------------------------------------

export const RUTA_ASISTENCIA_POSTERIOR = '/api/asistencias/posterior';
export const rutaAsistenciasDelMes = (alumnoId: string, mes?: string): string =>
  `/api/alumnos/${alumnoId}/asistencias${mes === undefined ? '' : `?mes=${mes}`}`;

const RUTAS_DE_LA_009B: readonly RegExp[] = [
  /^POST \/api\/asistencias\/posterior$/,
  /^GET \/api\/alumnos\/:\w+\/asistencias$/,
];

/** Falla con un mensaje claro si las dos rutas de la 009b no están registradas (la funcionalidad no existe todavía). */
export function exigirRutasDe009b(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_009B) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 009b: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

/** Falla con un mensaje claro si la migración de la 009b todavía no creó `inasistencias`. */
export async function exigirTablaDeInasistencias(): Promise<void> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT pg_catalog.to_regclass('public.inasistencias') IS NOT NULL AS existe`,
  );
  expect(
    (rows[0] as { existe: boolean }).existe,
    'Falta la funcionalidad de la 009b: la migración de la tabla inasistencias no está aplicada',
  ).toBe(true);
}

const FALTA_LA_TABLA = new Set(['42P01', '42704']);

/** Convierte «no existe la tabla inasistencias» en un mensaje claro de funcionalidad pendiente. */
export async function conMensajeDeInasistencias<T>(trabajo: () => Promise<T>): Promise<T> {
  try {
    return await trabajo();
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    if (code !== undefined && FALTA_LA_TABLA.has(code) && /inasistencias/.test(message ?? '')) {
      throw new Error('Falta la funcionalidad de la 009b: la migración de la tabla inasistencias no está aplicada.', {
        cause: error,
      });
    }
    throw error;
  }
}

const RUTA_SRC = path.resolve(__dirname, '..', '..', 'src');

/** Lo que el contrato público de la tarea promete (criterio 23): `registrarFaltas(ahora)` se puede llamar directamente. */
export interface ServicioDeFaltas {
  registrarFaltas(ahora: Date): Promise<unknown>;
}

/** `FaltasService` de `backend/src/modulos/asistencia/faltas.service.ts` (plan, «Faltas»). Falla con un mensaje claro si todavía no existe. */
async function cargarClaseFaltas(): Promise<new (...argumentos: never[]) => ServicioDeFaltas> {
  const ruta = path.join(RUTA_SRC, 'modulos', 'asistencia', 'faltas.service.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 009b: no se pudo cargar "backend/src/modulos/asistencia/faltas.service.ts" (${motivo}).`,
      { cause: error },
    );
  }
  const clase = modulo['FaltasService'];
  if (typeof clase !== 'function') {
    throw new Error('Falta la funcionalidad de la 009b: "faltas.service.ts" no exporta FaltasService.');
  }
  return clase as new (...argumentos: never[]) => ServicioDeFaltas;
}

/** El `FaltasService` de la aplicación de pruebas. */
export async function servicioDeFaltas(app: NestExpressApplication): Promise<ServicioDeFaltas> {
  const clase = await cargarClaseFaltas();
  let servicio: ServicioDeFaltas;
  try {
    servicio = app.get<ServicioDeFaltas>(clase);
  } catch (error) {
    throw new Error('Falta la funcionalidad de la 009b: FaltasService no está registrado en la aplicación.', {
      cause: error,
    });
  }
  expect(typeof servicio.registrarFaltas, 'FaltasService.registrarFaltas(ahora)').toBe('function');
  return servicio;
}

/** Una vuelta de la tarea de faltas con el instante `ahora` (la tarea se llama directamente, sin esperar al `@Cron`). */
export async function ejecutarFaltas(ctx: Pick<AppCarnet, 'app'>, ahora: Date): Promise<void> {
  await (await servicioDeFaltas(ctx.app)).registrarFaltas(ahora);
}

/**
 * El escenario de la 009a más la comprobación de que la tabla, el servicio de faltas y (salvo con `rutas: false`, para las pruebas que solo usan la tarea) las rutas
 * de la 009b existen.
 */
export async function prepararEscenarioDe009b(
  ctx: AppCarnet,
  opciones: { rutas?: boolean } = {},
): Promise<EscenarioDeAsistencia> {
  const esc = await prepararEscenarioDeAsistencia(ctx);
  if (opciones.rutas !== false) exigirRutasDe009b(ctx.app);
  await exigirTablaDeInasistencias();
  await servicioDeFaltas(ctx.app);
  return esc;
}

// ---------------------------------------------------------------------------------------------------------------------
// Peticiones
// ---------------------------------------------------------------------------------------------------------------------

/** Un cuerpo válido de `registrarAsistenciaPosteriorSchema` con una clave nueva; `sobre` cambia o agrega campos (`undefined` quita el campo). */
export function cuerpoPosterior(alumnoId: string, fecha: string, horaLlegada: string, sobre: Objeto = {}): Objeto {
  const cuerpo: Objeto = {
    alumnoId,
    fecha,
    horaLlegada,
    motivo: 'La secretaria no estaba en la entrada',
    claveIdempotencia: randomUUID(),
    ...sobre,
  };
  for (const [clave, valor] of Object.entries(cuerpo)) if (valor === undefined) delete cuerpo[clave];
  return cuerpo;
}

export function registrarPosterior(
  ctx: Pick<AppCarnet, 'http'>,
  cookie: string | undefined,
  alumnoId: string,
  fecha: string,
  horaLlegada: string,
  sobre: Objeto = {},
): Promise<RespuestaApi> {
  return ctx.http.post(RUTA_ASISTENCIA_POSTERIOR, cuerpoPosterior(alumnoId, fecha, horaLlegada, sobre), { cookie });
}

export function consultarMes(
  ctx: Pick<AppCarnet, 'http'>,
  cookie: string | undefined,
  alumnoId: string,
  mes?: string,
): Promise<RespuestaApi> {
  return ctx.http.get(rutaAsistenciasDelMes(alumnoId, mes), { cookie });
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo que devuelve la consulta del mes (criterio 31)
// ---------------------------------------------------------------------------------------------------------------------

export const CLAVES_DE_LA_CONSULTA = ['matricula', 'mes', 'registros'];
export const CLAVES_DE_LA_MATRICULA_DEL_MES = ['clasesRestantes', 'clasesTotales', 'clasesUsadas'];
export const CLAVES_DE_UN_REGISTRO_DE_ASISTENCIA = [
  'clase',
  'estadoLlegada',
  'faltaCubierta',
  'fecha',
  'horaLlegada',
  'metodo',
  'registroPosterior',
  'tipo',
];
export const CLAVES_DE_UN_REGISTRO_DE_FALTA = ['clase', 'fecha', 'tipo'];
export const CLAVES_DE_LA_CLASE_DEL_REGISTRO = ['horaFin', 'horaInicio'];

export interface RegistroAsistenciaApi {
  tipo: 'ASISTENCIA';
  fecha: string;
  clase: { horaInicio: string; horaFin: string };
  horaLlegada: string;
  estadoLlegada: string;
  metodo: string;
  registroPosterior: boolean;
  faltaCubierta: boolean;
}

export interface RegistroFaltaApi {
  tipo: 'FALTA';
  fecha: string;
  clase: { horaInicio: string; horaFin: string };
}

export interface ConsultaDelMesApi {
  mes: string;
  matricula: { clasesTotales: number; clasesUsadas: number; clasesRestantes: number } | null;
  registros: (RegistroAsistenciaApi | RegistroFaltaApi)[];
}

/** La consulta de una respuesta 200; si no lo es, falla con el estado y el cuerpo recibidos. */
export function consultaDe(respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>): ConsultaDelMesApi {
  expect(respuesta.status, `se esperaba 200 y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 500)}`).toBe(
    200,
  );
  expect(respuesta.body, 'la respuesta no es un objeto JSON').toBeTruthy();
  return respuesta.body as unknown as ConsultaDelMesApi;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas y escrituras directas de `inasistencias` (como dueño, con el contexto de la academia)
// ---------------------------------------------------------------------------------------------------------------------

export interface FilaInasistencia {
  id: string;
  academia_id: string;
  alumno_id: string;
  matricula_id: string;
  clase_id: string;
  fecha: string;
  registrada_en: Date;
  asistencia_id: string | null;
  cubierta_en: Date | null;
}

/** Las faltas de una academia, de la más antigua a la más nueva. */
export async function leerInasistencias(academiaId: string): Promise<FilaInasistencia[]> {
  const { rows } = await conMensajeDeInasistencias(() =>
    ejecutarComo(
      'propietario',
      `SELECT id, academia_id, alumno_id, matricula_id, clase_id, fecha::text AS fecha, registrada_en, asistencia_id, cubierta_en
         FROM inasistencias WHERE academia_id = $1::uuid ORDER BY fecha, registrada_en, id`,
      [academiaId],
      { academiaId },
    ),
  );
  return rows as FilaInasistencia[];
}

export async function inasistenciasDe(academiaId: string, alumnoId: string): Promise<FilaInasistencia[]> {
  return (await leerInasistencias(academiaId)).filter((fila) => fila.alumno_id === alumnoId);
}

const TIPO_DE_COLUMNA: Readonly<Record<string, string>> = {
  id: 'uuid',
  academia_id: 'uuid',
  alumno_id: 'uuid',
  matricula_id: 'uuid',
  clase_id: 'uuid',
  fecha: 'date',
  registrada_en: 'timestamptz',
  asistencia_id: 'uuid',
  cubierta_en: 'timestamptz',
};

function tipoDe(columna: string): string {
  const tipo = TIPO_DE_COLUMNA[columna];
  if (tipo === undefined) throw new Error(`Columna desconocida en la utilidad de pruebas de inasistencias: ${columna}`);
  return tipo;
}

export type Columnas = Record<string, unknown>;

export interface PadresDeLaInasistencia {
  alumnoId: string;
  matriculaId: string;
  claseId: string;
}

/** Una falta válida: la del lunes 16/11 cuya clase de 18:00 a 19:00 terminó, registrada a las 19:05 de Lima (00:05 UTC del 17/11), sin cubrir. */
export function filaInasistenciaValida(padres: PadresDeLaInasistencia, sobre: Columnas = {}): Columnas {
  const fila: Columnas = {
    id: randomUUID(),
    alumno_id: padres.alumnoId,
    matricula_id: padres.matriculaId,
    clase_id: padres.claseId,
    fecha: '2026-11-16',
    registrada_en: new Date('2026-11-17T00:05:00.000Z'),
    asistencia_id: null,
    cubierta_en: null,
    ...sobre,
  };
  for (const [clave, valor] of Object.entries(fila)) if (valor === undefined) delete fila[clave];
  return fila;
}

export interface OpcionesDeEscritura {
  contexto?: { academiaId?: string; plataforma?: boolean | string };
}

function contextoDe(academiaId: string, opciones: OpcionesDeEscritura) {
  return 'contexto' in opciones ? opciones.contexto : { academiaId };
}

/** `INSERT` directo en `inasistencias` (con cualquier valor, también inválido); el error de PostgreSQL (con su `code` y su `constraint`) se propaga tal cual. */
export async function insertarInasistencia(
  rol: RolPruebas,
  academiaId: string,
  columnas: Columnas,
  opciones: OpcionesDeEscritura = {},
): Promise<void> {
  const todas: Columnas = { academia_id: academiaId, ...columnas };
  const nombres = Object.keys(todas);
  const marcas = nombres.map((nombre, i) => `$${i + 1}::${tipoDe(nombre)}`);
  await conMensajeDeInasistencias(() =>
    ejecutarComo(
      rol,
      `INSERT INTO inasistencias (${nombres.join(', ')}) VALUES (${marcas.join(', ')})`,
      Object.values(todas),
      contextoDe(academiaId, opciones),
    ),
  );
}

/** `UPDATE` directo de una falta por su id; devuelve las filas afectadas. El error de PostgreSQL se propaga tal cual. */
export async function actualizarInasistencia(
  rol: RolPruebas,
  academiaId: string,
  id: string,
  cambios: Columnas,
  opciones: OpcionesDeEscritura = {},
): Promise<number> {
  const columnas = Object.keys(cambios);
  const asignaciones = columnas.map((columna, i) => `${columna} = $${i + 1}::${tipoDe(columna)}`);
  const resultado = await conMensajeDeInasistencias(() =>
    ejecutarComo(
      rol,
      `UPDATE inasistencias SET ${asignaciones.join(', ')} WHERE id = $${columnas.length + 1}::uuid`,
      [...Object.values(cambios), id],
      contextoDe(academiaId, opciones),
    ),
  );
  return resultado.rowCount ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instantáneas: lo que un rechazo no puede cambiar
// ---------------------------------------------------------------------------------------------------------------------

/** Todo lo que un rechazo, un 404 o un 401 no pueden cambiar: lo de la 009a más las faltas de A y de B. */
export async function instantaneaDeFaltas(e: EscenarioPagos): Promise<string> {
  return JSON.stringify({
    asistencia: await instantaneaDeAsistencia(e),
    faltasA: await leerInasistencias(e.A.id),
    faltasB: await leerInasistencias(e.B.id),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Alumnos pagados en un instante (la confirmación del pago decide si hay falta: criterio 24)
// ---------------------------------------------------------------------------------------------------------------------

/** Deja abierta la caja de A con la fecha `dia` (el cobro y la verificación de un Yape exigen la caja de ese día); no hace nada si ya está abierta. */
export async function asegurarCajaDelDia(esc: EscenarioDeAsistencia, dia: string): Promise<void> {
  const cajas = await leerCajas(esc.e.A.id);
  if (cajas.some((caja) => caja.estado === 'ABIERTA' && caja.fecha === dia)) return;
  await abrirCajaDelDia(esc, dia);
}

export interface OpcionesAlumnoPagadoEn {
  /** El instante en que se confirma el pago: el reloj de la API y las sesiones se fijan en él. */
  pagadoEn: Date;
  /** `EFECTIVO` (por defecto) o `YAPE` (verificación de un comprobante pendiente). */
  pago?: 'EFECTIVO' | 'YAPE';
  /** Las clases de su matrícula (por defecto, el lunes de las 18:00). */
  claseIds?: readonly string[];
  clasesTotales?: number;
  clasesUsadas?: number;
  /** `matriculas.creado_en` (por defecto, el del sembrado, el 11/11). */
  matriculaCreadaEn?: Date;
  fechaInicio?: string;
}

/**
 * Crea un alumno de A como lo hace el sistema (un pago confirmado por la API) pero con el pago confirmado en `pagadoEn`: la `verificado_en` del pago es ese
 * instante. La matrícula queda como pide el caso (por defecto `VIGENTE` de noviembre con 12 clases, ninguna usada, la clase de los lunes de las 18:00 y
 * `creado_en` el 11/11), de modo que la única condición que cambia es la fecha de confirmación. El reloj de la prueba queda como estaba.
 */
export async function crearAlumnoPagadoEn(
  ctx: AppCarnet,
  esc: EscenarioDeAsistencia,
  opciones: OpcionesAlumnoPagadoEn,
): Promise<AlumnoDeAsistencia> {
  const {
    pagadoEn,
    pago = 'EFECTIVO',
    clasesTotales = 12,
    clasesUsadas = 0,
    claseIds,
    matriculaCreadaEn,
    fechaInicio,
  } = opciones;
  const { e } = esc;
  const relojDeLaPrueba = ctx.reloj.ahora();
  ctx.reloj.fijar(pagadoEn);
  try {
    await asegurarCajaDelDia(esc, fechaEnLima(pagadoEn).texto);
    const cookies = cookiesDePagos(e, pagadoEn);
    const clases = claseIds ?? [e.lunes.id];
    let cliente: {
      alumnoId: string;
      dni: string;
      solicitudId: string;
      matriculaId: string;
      codigo: string;
      token: string;
    };
    if (pago === 'YAPE') {
      const enRevision = await sembrarEnVerificacion(e, { claseIds: clases });
      const respuesta = await ctx.http.post(rutaAprobacion(enRevision.pagoId), {}, { cookie: cookies.secretaria });
      expect(respuesta.status, `aprobar el Yape: ${respuesta.texto.slice(0, 300)}`).toBe(200);
      cliente = enRevision;
    } else {
      cliente = await sembrarCobrable(e, {
        claseIds: clases,
        reservaVenceEn: new Date(pagadoEn.getTime() + 24 * 60 * 60 * 1000),
      });
      const respuesta = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookies.secretaria,
      });
      expect(respuesta.status, `cobrar en efectivo: ${respuesta.texto.slice(0, 300)}`).toBe(201);
    }
    const cambios: Columnas = { clases_totales: clasesTotales, clases_usadas: clasesUsadas };
    if (matriculaCreadaEn) {
      cambios['creado_en'] = matriculaCreadaEn;
      cambios['actualizado_en'] = matriculaCreadaEn;
    }
    if (fechaInicio) cambios['fecha_inicio'] = fechaInicio;
    await cambiarMatricula(e.A.id, cliente.matriculaId, cambios);
    return {
      academiaId: e.A.id,
      alumnoId: cliente.alumnoId,
      dni: cliente.dni,
      solicitudId: cliente.solicitudId,
      matriculaId: cliente.matriculaId,
      codigoSolicitud: cliente.codigo,
      tokenSeguimiento: cliente.token,
      usuarioId: '',
      cookie: '',
      token: '',
      contenido: '',
      claseId: clases[0] as string,
    };
  } finally {
    ctx.reloj.fijar(relojDeLaPrueba);
  }
}

/** Una matrícula `VIGENTE` con un pago `PENDIENTE_VERIFICACION` y ningún pago confirmado: «sin pago confirmado no hay falta» (criterio 24). */
export async function crearAlumnoSinPagoConfirmado(
  esc: EscenarioDeAsistencia,
  sobre: { claseIds?: readonly string[] } = {},
): Promise<{ alumnoId: string; matriculaId: string }> {
  const cliente = await sembrarEnVerificacion(esc.e, { claseIds: sobre.claseIds ?? [esc.e.lunes.id] });
  await cambiarAlumno(esc.e.A.id, cliente.alumnoId, { estado: 'ALUMNO_ACTIVO' });
  await cambiarMatricula(esc.e.A.id, cliente.matriculaId, {
    estado: 'VIGENTE',
    reserva_vence_en: null,
    clases_totales: 12,
    clases_usadas: 0,
  });
  return { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId };
}

// ---------------------------------------------------------------------------------------------------------------------
// Fallas forzadas (la base falla al escribir las faltas de una academia)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Hace fallar (`P0001`) todo `INSERT` en `inasistencias` de la academia indicada, con un disparador temporal (se crea y se borra aquí, con el dueño de las
 * tablas). Devuelve la función que lo quita: la prueba la llama siempre, también si falla. Solo afecta a esa academia.
 */
export async function forzarFallaDeFaltasEn(academiaId: string): Promise<() => Promise<void>> {
  const sufijo = academiaId.replaceAll('-', '').slice(0, 12);
  const funcion = `zz_falla_faltas_${sufijo}`;
  await ejecutarComo(
    'propietario',
    `CREATE FUNCTION public.${funcion}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
     AS $$ BEGIN RAISE EXCEPTION 'Falla forzada por la prueba' USING ERRCODE = 'P0001'; END $$`,
  );
  await ejecutarComo('propietario', `REVOKE ALL ON FUNCTION public.${funcion}() FROM PUBLIC`);
  await ejecutarComo(
    'propietario',
    `CREATE TRIGGER ${funcion} BEFORE INSERT ON public.inasistencias FOR EACH ROW
       WHEN (NEW.academia_id = '${academiaId}'::uuid) EXECUTE FUNCTION public.${funcion}()`,
  );
  return async () => {
    await ejecutarComo('propietario', `DROP TRIGGER IF EXISTS ${funcion} ON public.inasistencias`);
    await ejecutarComo('propietario', `DROP FUNCTION IF EXISTS public.${funcion}()`);
  };
}
