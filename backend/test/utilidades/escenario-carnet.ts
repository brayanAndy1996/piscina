// spec: 008-carnet-qr (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { DestinationStream } from 'pino';
import { expect } from 'vitest';
import type { RelojFijo } from '../../src/infraestructura/reloj';
import { ejecutarComo, urlAppPruebas } from './base-datos';
import { crearCajaDePrueba } from './caja';
import { escucharAplicacion } from './carreras';
import {
  abrirCajaDeHoy,
  AHORA_007,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  instantaneaDeLaAcademia,
  rutaCobro,
  sembrarCobrable,
} from './escenario-pagos';
import { rutaAprobacion, sembrarEnVerificacion } from './escenario-pagos-007b';
import { type AlmacenArchivosPrueba, borrarDirectorio, cargarAlmacen, directorioTemporal } from './inscripciones-005b';
import {
  cargarFuncionalidad005,
  EnviadorDePrueba,
  type Objeto,
  type OpcionesSembrado,
  type RespuestaApi,
  sembrarSolicitud,
} from './inscripciones';
import { abrirRetenedor, conLimite, observar } from './planes-clases';
import { actualizarUsuario, cookieDeUsuario, crearAppConReloj, leerUsuarioPorDni, rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 008a (carnet digital y QR). Solo usan SQL, HTTP y los contratos públicos: no importan nada de la
 * implementación interna. Reutilizan el escenario de la 007 (`escenario-pagos.ts`, `escenario-pagos-007b.ts`): los alumnos se crean confirmando
 * un pago por la API (cobro en efectivo o aprobación de un Yape), como dice la spec. Lo que viene de producción y todavía no existe (el token
 * `GENERADOR_PDF_CARNET` del módulo `alumnos`) se carga con importación dinámica: si falta, cada prueba falla con un mensaje claro.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Rutas y cuerpos
// ---------------------------------------------------------------------------------------------------------------------

export const PREFIJO = 'AQ1:';
export const FORMATO_TOKEN_QR = /^[A-Za-z0-9_-]{43}$/;
export const FORMATO_CONTENIDO_QR = /^AQ1:[A-Za-z0-9_-]{43}$/;

export const RUTA_BUSCAR = '/api/alumnos/buscar';
export const RUTA_MI_CARNET = '/api/mi-carnet';
export const RUTA_MI_CARNET_PDF = '/api/mi-carnet/pdf';
export const rutaCarnet = (alumnoId: string): string => `/api/alumnos/${alumnoId}/carnet`;
export const rutaCarnetPdf = (alumnoId: string): string => `/api/alumnos/${alumnoId}/carnet/pdf`;
export const rutaRegenerarQr = (alumnoId: string): string => `/api/alumnos/${alumnoId}/carnet/qr`;

const RUTAS_DE_LA_008A: readonly RegExp[] = [
  /^GET \/api\/alumnos\/:\w+\/carnet$/,
  /^GET \/api\/alumnos\/:\w+\/carnet\/pdf$/,
  /^POST \/api\/alumnos\/:\w+\/carnet\/qr$/,
  /^POST \/api\/alumnos\/buscar$/,
  /^GET \/api\/mi-carnet$/,
  /^GET \/api\/mi-carnet\/pdf$/,
];

/**
 * Falla con un mensaje claro si las seis rutas de la 008a no están registradas (la funcionalidad no existe todavía). Evita que una prueba pase
 * por casualidad con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */
export function exigirRutasDe008a(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_008A) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 008a: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

/** Un cuerpo válido de `regenerarQrSchema` con una clave nueva; `sobre` cambia o agrega campos. */
export const cuerpoRegenerar = (sobre: Objeto = {}): Objeto => ({
  claveIdempotencia: randomUUID(),
  motivo: 'El alumno perdió su carnet',
  ...sobre,
});

/** Un cuerpo de `buscarAlumnosSchema`. */
export const cuerpoBuscar = (texto: string, sobre: Objeto = {}): Objeto => ({ texto, ...sobre });

// ---------------------------------------------------------------------------------------------------------------------
// Lo que devuelve el carnet
// ---------------------------------------------------------------------------------------------------------------------

export interface CarnetApi {
  academia: { nombre: string };
  alumno: { id: string; nombres: string; apellidos: string; dni: string; nivel: string; estado: string };
  foto: string | null;
  matricula: {
    plan: string;
    clases: { diaSemana: number; horaInicio: string; horaFin: string }[];
    desde: string;
    hasta: string;
    vigenteHoy: boolean;
  } | null;
  qr: { contenido: string; generadoEn: string } | null;
}

export const CLAVES_DEL_CARNET = ['academia', 'alumno', 'foto', 'matricula', 'qr'];
export const CLAVES_DEL_ALUMNO_EN_EL_CARNET = ['apellidos', 'dni', 'estado', 'id', 'nivel', 'nombres'];
export const CLAVES_DE_LA_MATRICULA_EN_EL_CARNET = ['clases', 'desde', 'hasta', 'plan', 'vigenteHoy'];
export const CLAVES_DEL_QR_EN_EL_CARNET = ['contenido', 'generadoEn'];

/** El carnet de una respuesta 200 (si no lo es, falla con el estado y el cuerpo recibidos). */
export function carnetDe(respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>): CarnetApi {
  expect(respuesta.status, `se esperaba 200 y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 400)}`).toBe(
    200,
  );
  expect(respuesta.body, 'la respuesta no es un objeto JSON').toBeTruthy();
  return respuesta.body as unknown as CarnetApi;
}

/** El token que lleva el contenido de un carnet (`AQ1:` + token). */
export function tokenDelCarnet(carnet: CarnetApi): string {
  expect(carnet.qr, 'el carnet no trae QR').not.toBeNull();
  const contenido = (carnet.qr as { contenido: string }).contenido;
  expect(contenido).toMatch(FORMATO_CONTENIDO_QR);
  return contenido.slice(PREFIJO.length);
}

export function codigoDeRespuesta(respuesta: Pick<RespuestaApi, 'body'>): string | undefined {
  const codigo = respuesta.body?.['codigo'];
  return typeof codigo === 'string' ? codigo : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Generador del PDF y almacén observables
// ---------------------------------------------------------------------------------------------------------------------

/** Un PDF mínimo y bien formado, para las pruebas que no miran el dibujo. */
export const PDF_FALSO = Buffer.from('%PDF-1.4\n% generador falso del carnet (prueba)\n%%EOF\n', 'latin1');

/**
 * Lo que se instala con `overrideProvider(GENERADOR_PDF_CARNET).useValue(generador.proveedor)` (criterio 12): registra los datos de cada llamada
 * y cuántas transacciones de la API había abiertas al llamarlo (criterio 11: los datos se leen en una transacción corta que termina antes de
 * dibujar). `datos.contenidoQr` es lo que la spec dice que recibe.
 */
export class GeneradorDeCarnetDePrueba {
  modo: 'falso' | 'rechaza' | 'lanza' = 'falso';
  readonly llamadas: Record<string, unknown>[] = [];
  /** Cuántas transacciones de la API estaban abiertas en cada llamada (debe ser 0). */
  readonly transaccionesAbiertas: number[] = [];

  readonly proveedor = {
    generar: (datos: unknown): Promise<Buffer> => {
      this.llamadas.push(datos as Record<string, unknown>);
      // `lanza`: la excepción sale al llamarlo, sin devolver ninguna promesa.
      if (this.modo === 'lanza')
        throw new Error('Falla simulada del generador del PDF del carnet (excepción al llamarlo).');
      return (async () => {
        this.transaccionesAbiertas.push(await transaccionesAbiertasDeLaApp());
        if (this.modo === 'rechaza')
          throw new Error('Falla simulada del generador del PDF del carnet (promesa rechazada).');
        return PDF_FALSO;
      })();
    },
  };

  /** El `contenidoQr` que recibió la llamada `indice` (la última por defecto). */
  contenidoRecibido(indice = this.llamadas.length - 1): string {
    const llamada = this.llamadas[indice];
    expect(llamada, `el generador no recibió la llamada ${indice}`).toBeTruthy();
    const contenido = (llamada as Record<string, unknown>)['contenidoQr'];
    expect(typeof contenido, 'el generador debe recibir `contenidoQr` (criterio 12)').toBe('string');
    return contenido as string;
  }
}

/** Cuántas conexiones de la API (el usuario `aquagestion_app`) tienen una transacción abierta ahora mismo. */
export async function transaccionesAbiertasDeLaApp(): Promise<number> {
  const usuario = decodeURIComponent(new URL(urlAppPruebas()).username);
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE usename = $1 AND datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL`,
    [usuario],
  );
  return (rows[0] as { n: number }).n;
}

/** Un `AlmacenArchivos` que envuelve a otro y registra cada lectura (con las transacciones de la API abiertas en ese instante). */
export class AlmacenObservableDePrueba implements AlmacenArchivosPrueba {
  readonly lecturas: { academiaId: string; clave: string; transaccionesAbiertas: number }[] = [];

  constructor(private readonly real: AlmacenArchivosPrueba) {}

  guardar(academiaId: string, clave: string, contenido: Buffer, tipo: 'image/jpeg' | 'image/png'): Promise<void> {
    return this.real.guardar(academiaId, clave, contenido, tipo);
  }

  async leer(academiaId: string, clave: string): Promise<Buffer> {
    this.lecturas.push({ academiaId, clave, transaccionesAbiertas: await transaccionesAbiertasDeLaApp() });
    return this.real.leer(academiaId, clave);
  }

  borrar(academiaId: string, clave: string): Promise<void> {
    return this.real.borrar(academiaId, clave);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// La aplicación de pruebas
// ---------------------------------------------------------------------------------------------------------------------

export interface RespuestaCarnet extends RespuestaApi {
  /** Los bytes del cuerpo (el PDF no se puede leer como texto). */
  cuerpo: Buffer;
}

export interface OpcionesPeticionCarnet {
  cookie?: string;
  headers?: Record<string, string>;
  /** Cuerpo JSON (se serializa). */
  cuerpo?: unknown;
}

export interface ClienteCarnet {
  enviar(metodo: string, ruta: string, opciones?: OpcionesPeticionCarnet): Promise<RespuestaCarnet>;
  get(ruta: string, opciones?: OpcionesPeticionCarnet): Promise<RespuestaCarnet>;
  post(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticionCarnet): Promise<RespuestaCarnet>;
  cerrar(): Promise<void>;
}

export interface OpcionesAppCarnet {
  ahora?: Date;
  nivelRegistro?: string;
  destinoRegistro?: DestinationStream;
  /** Reemplaza al generador del PDF (`GENERADOR_PDF_CARNET`). Sin esto, la API usa el suyo. */
  generador?: GeneradorDeCarnetDePrueba;
  /** Envuelve al almacén de disco (por ejemplo, con `AlmacenObservableDePrueba`). */
  envolverAlmacen?: (real: AlmacenArchivosPrueba) => AlmacenArchivosPrueba;
}

export interface AppCarnet {
  app: NestExpressApplication;
  reloj: RelojFijo;
  http: ClienteCarnet;
  /** El directorio temporal del almacén. */
  raiz: string;
  almacen: AlmacenArchivosPrueba;
  /** El enviador de correo de la aplicación (registra cada mensaje). */
  correo: EnviadorDePrueba;
  cerrarTodo(): Promise<void>;
  vaciarAlmacen(): void;
}

function leerJsonObjeto(texto: string): Objeto | null {
  if (!texto) return null;
  try {
    const valor: unknown = JSON.parse(texto);
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Objeto) : null;
  } catch {
    return null;
  }
}

const almacenSinLimites = {
  increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

const RAIZ_SRC = path.resolve(__dirname, '..', '..', 'src');

/** El token `GENERADOR_PDF_CARNET` del módulo `alumnos` (008a, interfaces del backend). Falla con un mensaje claro si todavía no existe. */
async function cargarTokenDelGenerador(): Promise<symbol> {
  const ruta = path.join(RAIZ_SRC, 'modulos', 'alumnos', 'index.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 008a: no se pudo cargar "backend/src/modulos/alumnos/index.ts" (${motivo}).`,
      {
        cause: error,
      },
    );
  }
  const token = modulo['GENERADOR_PDF_CARNET'];
  if (token === undefined) {
    throw new Error(
      'Falta la funcionalidad de la 008a: "backend/src/modulos/alumnos/index.ts" no exporta GENERADOR_PDF_CARNET.',
    );
  }
  return token as symbol;
}

/**
 * La aplicación completa con `RELOJ` fijo, un almacén de disco temporal, un enviador de correo de prueba y, si se pide, el generador del PDF del
 * carnet reemplazado; escuchando en un puerto efímero. Si lo que se reemplaza todavía no existe, la aplicación se crea igual y cada petición
 * falla con el motivo (no se lanza aquí: rompería el `beforeAll` y dejaría las pruebas omitidas).
 */
export async function crearAppCarnet(opciones: OpcionesAppCarnet = {}): Promise<AppCarnet> {
  const raiz = directorioTemporal();
  const correo = new EnviadorDePrueba();
  let error: Error | undefined;
  let almacen: AlmacenArchivosPrueba | undefined;
  let tokenAlmacen: symbol | undefined;
  let tokenCorreo: symbol | undefined;
  let tokenGenerador: symbol | undefined;
  try {
    const modulo = await cargarAlmacen();
    tokenAlmacen = modulo.ALMACEN_ARCHIVOS;
    const disco = new modulo.AlmacenArchivosDisco(raiz);
    almacen = opciones.envolverAlmacen ? opciones.envolverAlmacen(disco) : disco;
    tokenCorreo = (
      await cargarFuncionalidad005<{ ENVIADOR_CORREO: symbol }>('infraestructura/correo/index.ts', ['ENVIADOR_CORREO'])
    ).ENVIADOR_CORREO;
    if (opciones.generador) tokenGenerador = await cargarTokenDelGenerador();
  } catch (causa) {
    error = causa instanceof Error ? causa : new Error(String(causa));
  }
  const { app, reloj } = await crearAppConReloj(opciones.ahora ?? AHORA_007, {
    nivelRegistro: opciones.nivelRegistro ?? 'silent',
    destinoRegistro: opciones.destinoRegistro,
    ajustar: (constructor) => {
      let ajustado = constructor.overrideProvider(ThrottlerStorage).useValue(almacenSinLimites);
      if (tokenAlmacen && almacen) ajustado = ajustado.overrideProvider(tokenAlmacen).useValue(almacen);
      if (tokenCorreo) ajustado = ajustado.overrideProvider(tokenCorreo).useValue(correo);
      if (tokenGenerador && opciones.generador) {
        ajustado = ajustado.overrideProvider(tokenGenerador).useValue(opciones.generador.proveedor);
      }
      return ajustado;
    },
  });
  const escuchando = await escucharAplicacion(app);
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

  async function enviar(metodo: string, ruta: string, op: OpcionesPeticionCarnet = {}): Promise<RespuestaCarnet> {
    if (error) throw error;
    const headers: Record<string, string> = { ...op.headers };
    if (op.cookie) headers['cookie'] = op.cookie;
    let body: string | undefined;
    if (op.cuerpo !== undefined) {
      body = JSON.stringify(op.cuerpo);
      headers['content-type'] = 'application/json';
    }
    const respuesta = await fetch(`${base}${ruta}`, { method: metodo, headers, body });
    const cuerpo = Buffer.from(await respuesta.arrayBuffer());
    const texto = cuerpo.toString('utf8');
    return {
      status: respuesta.status,
      body: leerJsonObjeto(texto),
      texto,
      headers: respuesta.headers,
      cacheControl: respuesta.headers.get('cache-control'),
      cuerpo,
    };
  }

  return {
    app,
    reloj,
    raiz,
    almacen: almacen as AlmacenArchivosPrueba,
    correo,
    http: {
      enviar,
      get: (ruta, op) => enviar('GET', ruta, op),
      post: (ruta, cuerpo, op) => enviar('POST', ruta, { ...op, cuerpo }),
      cerrar: () => escuchando.cerrar(),
    },
    async cerrarTodo() {
      await escuchando.cerrar();
      borrarDirectorio(raiz);
    },
    vaciarAlmacen() {
      borrarDirectorio(raiz);
      fs.mkdirSync(raiz, { recursive: true });
    },
  };
}

/** Falla con el motivo si la aplicación no pudo prepararse (el almacén, el correo o el generador no existen). */
export async function exigirAppCarnet(ctx: AppCarnet): Promise<void> {
  await ctx.http.get('/api/salud');
}

// ---------------------------------------------------------------------------------------------------------------------
// Escenario y alumnos creados confirmando un pago
// ---------------------------------------------------------------------------------------------------------------------

export type CookiesDelEscenario = ReturnType<typeof cookiesDePagos>;

export interface EscenarioDelCarnet {
  e: EscenarioPagos;
  cookies: CookiesDelEscenario;
  /** La caja de hoy de A (abierta). */
  cajaA: string;
}

/**
 * Deja la aplicación y la base listas para una prueba: el reloj en `AHORA_007`, el almacén y los correos vacíos, el escenario de la 007 (A y B
 * con sus usuarios, un plan y clases), las rutas de la 008a registradas y la caja de hoy abierta en A y en B.
 */
export async function prepararEscenarioDelCarnet(ctx: AppCarnet): Promise<EscenarioDelCarnet> {
  await exigirAppCarnet(ctx);
  ctx.reloj.fijar(AHORA_007);
  ctx.vaciarAlmacen();
  ctx.correo.mensajes.length = 0;
  const e = await crearEscenarioDePagos();
  exigirRutasDePagos(ctx.app);
  exigirRutasDe008a(ctx.app);
  const cajaA = (await abrirCajaDeHoy(e)).id;
  await crearCajaDePrueba(e.B.id, e.secretariaB.id, { monto_inicial: '100.00' });
  return { e, cookies: cookiesDePagos(e), cajaA };
}

export interface AlumnoConQr {
  academiaId: string;
  alumnoId: string;
  dni: string;
  solicitudId: string;
  matriculaId: string;
  /** El código y el token de seguimiento de su solicitud (el token en claro, como lo tuvo el cliente). */
  codigoSolicitud: string;
  tokenSeguimiento: string;
  /** La cuenta del alumno (creada al confirmar el pago) y su sesión de `ALUMNO` (con el cambio de clave ya hecho). */
  usuarioId: string;
  cookie: string;
}

export interface OpcionesAlumnoPorPago extends Partial<OpcionesSembrado> {
  /** `EFECTIVO` (cobro en recepción, por defecto) o `YAPE` (comprobante en revisión y aprobación). */
  metodo?: 'EFECTIVO' | 'YAPE';
  /** La academia del alumno (por defecto, A). */
  academia?: 'A' | 'B';
}

/**
 * Crea un alumno como lo hace el sistema: una solicitud con su matrícula reservada y un pago confirmado por la API (`POST …/pago-efectivo` o
 * `POST /api/pagos/{id}/aprobacion`). Deja su sesión lista (la contraseña inicial es el DNI; aquí se marca el cambio como hecho para que
 * `/api/mi-carnet` no responda `CAMBIO_DE_CLAVE_OBLIGATORIO`).
 */
export async function crearAlumnoPorPago(
  ctx: AppCarnet,
  esc: EscenarioDelCarnet,
  opciones: OpcionesAlumnoPorPago = {},
): Promise<AlumnoConQr> {
  const { metodo = 'EFECTIVO', academia = 'A', ...sembrado } = opciones;
  const { e, cookies } = esc;
  const esB = academia === 'B';
  const academiaId = esB ? e.B.id : e.A.id;
  const staff = esB ? cookies.secretariaB : cookies.secretaria;
  let cliente: {
    alumnoId: string;
    dni: string;
    solicitudId: string;
    matriculaId: string;
    codigo: string;
    token: string;
  };
  if (metodo === 'YAPE') {
    if (esB) throw new Error('crearAlumnoPorPago: el Yape de B no está soportado por este ayudante.');
    const enRevision = await sembrarEnVerificacion(e, sembrado);
    const respuesta = await ctx.http.post(rutaAprobacion(enRevision.pagoId), {}, { cookie: staff });
    expect(respuesta.status, `aprobar el Yape: ${respuesta.texto.slice(0, 300)}`).toBe(200);
    cliente = enRevision;
  } else {
    cliente = esB
      ? await sembrarSolicitud(e.B.id, {
          planId: e.planB.id,
          claseIds: [e.lunesB.id],
          clasesTotales: 5,
          clasesPorMesPlan: 12,
          precioPlan: '100.00',
          monto: '42.00',
          nombres: 'Valeria',
          apellidos: 'Mendoza Salas',
          ...sembrado,
        })
      : await sembrarCobrable(e, sembrado);
    const respuesta = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie: staff });
    expect(respuesta.status, `cobrar en efectivo: ${respuesta.texto.slice(0, 300)}`).toBe(201);
  }
  const usuario = await leerUsuarioPorDni(academiaId, cliente.dni);
  expect(usuario, 'al confirmar el pago debía crearse la cuenta del alumno').toBeTruthy();
  const usuarioId = (usuario as { id: string }).id;
  await actualizarUsuario(academiaId, usuarioId, { debe_cambiar_clave: false });
  return {
    academiaId,
    alumnoId: cliente.alumnoId,
    dni: cliente.dni,
    solicitudId: cliente.solicitudId,
    matriculaId: cliente.matriculaId,
    codigoSolicitud: cliente.codigo,
    tokenSeguimiento: cliente.token,
    usuarioId,
    cookie: cookieDeUsuario({ id: usuarioId, academiaId, rol: 'ALUMNO' }, AHORA_007),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas y escrituras directas de las columnas del QR (como dueño)
// ---------------------------------------------------------------------------------------------------------------------

export interface FilaQr {
  id: string;
  dni: string;
  estado: string;
  qr_token: string | null;
  qr_generado_en: Date | null;
  qr_clave_idempotencia: string | null;
  actualizado_en: Date;
  foto_clave: string | null;
}

/** Las columnas del QR de los alumnos de una academia (con una conexión del dueño y su contexto). */
export async function leerQrs(academiaId: string): Promise<FilaQr[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT id, dni, estado::text AS estado, qr_token, qr_generado_en, qr_clave_idempotencia, actualizado_en, foto_clave
       FROM alumnos WHERE academia_id = $1::uuid ORDER BY dni, id`,
    [academiaId],
    { academiaId },
  );
  return rows as FilaQr[];
}

export async function leerQr(academiaId: string, alumnoId: string): Promise<FilaQr> {
  const fila = (await leerQrs(academiaId)).find((alumno) => alumno.id === alumnoId);
  if (!fila) throw new Error(`El alumno ${alumnoId} no existe en la academia ${academiaId}.`);
  return fila;
}

/** El token guardado de un alumno (falla si no tiene). */
export async function tokenGuardado(academiaId: string, alumnoId: string): Promise<string> {
  const fila = await leerQr(academiaId, alumnoId);
  expect(fila.qr_token, 'el alumno debía tener un token del QR').not.toBeNull();
  return fila.qr_token as string;
}

/** Escribe las columnas del QR de un alumno como dueño (para preparar casos: alumno sin QR, token conocido). */
export async function fijarQr(
  academiaId: string,
  alumnoId: string,
  qr: { token: string | null; generadoEn?: Date | null; clave?: string | null },
): Promise<void> {
  await ejecutarComo(
    'propietario',
    `UPDATE alumnos SET qr_token = $3, qr_generado_en = $4::timestamptz, qr_clave_idempotencia = $5::uuid
      WHERE academia_id = $1::uuid AND id = $2::uuid`,
    [academiaId, alumnoId, qr.token, qr.token === null ? null : (qr.generadoEn ?? AHORA_007), qr.clave ?? null],
    { academiaId },
  );
}

/** Cambia columnas de un alumno como dueño (por ejemplo `foto_clave`, `estado`, `nivel`). */
export async function cambiarAlumno(
  academiaId: string,
  alumnoId: string,
  cambios: Partial<{ foto_clave: string | null; estado: string; nivel: string; usuario_id: string | null }>,
): Promise<void> {
  const columnas = Object.keys(cambios);
  const tipos: Record<string, string> = { estado: '::estado_alumno', nivel: '::nivel_natacion', usuario_id: '::uuid' };
  const asignaciones = columnas.map((columna, i) => `${columna} = $${i + 3}${tipos[columna] ?? ''}`);
  await ejecutarComo(
    'propietario',
    `UPDATE alumnos SET ${asignaciones.join(', ')} WHERE academia_id = $1::uuid AND id = $2::uuid`,
    [academiaId, alumnoId, ...Object.values(cambios)],
    { academiaId },
  );
}

/** Todo lo que un rechazo o una lectura no pueden cambiar: las dos academias (007) y las columnas del QR de las dos. */
export async function instantaneaDelCarnet(e: EscenarioPagos): Promise<string> {
  return JSON.stringify({
    a: await instantaneaDeLaAcademia(e.A.id),
    b: await instantaneaDeLaAcademia(e.B.id),
    qrA: await leerQrs(e.A.id),
    qrB: await leerQrs(e.B.id),
  });
}

/** Todos los tokens guardados hoy en las dos academias. */
export async function todosLosTokens(e: EscenarioPagos): Promise<string[]> {
  return [...(await leerQrs(e.A.id)), ...(await leerQrs(e.B.id))]
    .map((fila) => fila.qr_token)
    .filter((token): token is string => token !== null);
}

// ---------------------------------------------------------------------------------------------------------------------
// El PDF
// ---------------------------------------------------------------------------------------------------------------------

/** El PDF sin el contenido de sus flujos (lo que queda: diccionarios, información del documento, fuentes). Texto latin1. */
export function pdfSinFlujos(pdf: Buffer): string {
  const texto = pdf.toString('latin1');
  let resultado = '';
  let posicion = 0;
  for (;;) {
    const inicio = texto.indexOf('stream', posicion);
    if (inicio === -1) break;
    if (texto.startsWith('end', inicio - 3)) {
      resultado += texto.slice(posicion, inicio + 'stream'.length);
      posicion = inicio + 'stream'.length;
      continue;
    }
    resultado += texto.slice(posicion, inicio);
    const fin = texto.indexOf('endstream', inicio);
    if (fin === -1) {
      posicion = texto.length;
      break;
    }
    posicion = fin + 'endstream'.length;
  }
  return resultado + texto.slice(posicion);
}

/** Los flujos del PDF descomprimidos (los que no se pueden descomprimir, tal cual), como texto latin1. */
export function flujosDelPdf(pdf: Buffer): string[] {
  const texto = pdf.toString('latin1');
  const flujos: string[] = [];
  let posicion = 0;
  for (;;) {
    const marca = texto.indexOf('stream', posicion);
    if (marca === -1) break;
    posicion = marca + 'stream'.length;
    if (texto.startsWith('end', marca - 3)) continue;
    let inicio = marca + 'stream'.length;
    if (texto.startsWith('\r\n', inicio)) inicio += 2;
    else if (texto.startsWith('\n', inicio)) inicio += 1;
    const fin = texto.indexOf('endstream', inicio);
    if (fin === -1) break;
    posicion = fin + 'endstream'.length;
    const crudo = pdf.subarray(inicio, fin);
    try {
      flujos.push(inflateSync(crudo).toString('latin1'));
    } catch {
      flujos.push(crudo.toString('latin1'));
    }
  }
  return flujos;
}

/** Las formas en que un texto puede estar escrito dentro de un PDF (literal, UTF-8, UTF-16BE y sus cadenas hexadecimales), en minúsculas. */
export function formasEnPdf(texto: string): string[] {
  const utf16 = Buffer.from(texto, 'utf16le').swap16();
  return [
    texto.toLowerCase(),
    Buffer.from(texto, 'utf8').toString('latin1').toLowerCase(),
    utf16.toString('latin1').toLowerCase(),
    Buffer.from(texto, 'latin1').toString('hex'),
    Buffer.from(texto, 'utf8').toString('hex'),
    utf16.toString('hex'),
  ];
}

/** `true` si el texto aparece en `contenido` (en cualquiera de las formas de `formasEnPdf`; mayúsculas y minúsculas valen igual). */
export function apareceEnPdf(contenido: string, texto: string): boolean {
  const minusculas = contenido.toLowerCase();
  return formasEnPdf(texto).some((forma) => minusculas.includes(forma));
}

/** Cuántas imágenes tiene el PDF (`/Subtype /Image`). */
export function contarImagenesDelPdf(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;
}

/** El código de error de PostgreSQL de una operación que debía fallar (`undefined` si no falló). */
export async function codigoDeError(operacion: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await operacion();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code ?? 'sin-codigo';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Carreras deterministas sobre la fila de un alumno (criterios 13 a 15)
// ---------------------------------------------------------------------------------------------------------------------

export interface ResultadoConAlumnoRetenido<T> {
  resultados: T[];
  /** `true` si, antes de soltar la fila, `pg_locks` mostró al menos `esperando` peticiones de la API esperando un bloqueo. */
  esperaron: boolean;
  /** La mayor cantidad de bloqueos sin conceder (`NOT granted`) de la API que se vio en `pg_locks`. */
  maximoEnEspera: number;
}

const SQL_BLOQUEOS_EN_ESPERA = `
  SELECT count(*)::int AS n
    FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
   WHERE NOT l.granted AND a.usename = $1 AND a.datname = current_database()`;

/**
 * Retiene la fila del alumno (`SELECT … FOR UPDATE`) en una transacción propia, envía las peticiones de `enviar` sin esperarlas, espera (con
 * `pg_locks`, sin esperas fijas) a que haya al menos `esperando` bloqueos sin conceder de la API (cada petición espera un solo bloqueo a la vez) o a
 * que alguna responda, suelta la fila (`COMMIT` o `ROLLBACK`) y devuelve las respuestas en el orden de `enviar`. Así las peticiones se cruzan
 * siempre, sin depender de tiempos.
 */
export async function conAlumnoRetenido<T>(opciones: {
  academiaId: string;
  alumnoId: string;
  enviar: readonly (() => Promise<T>)[];
  esperando: number;
  liberar?: 'COMMIT' | 'ROLLBACK';
}): Promise<ResultadoConAlumnoRetenido<T>> {
  const usuario = decodeURIComponent(new URL(urlAppPruebas()).username);
  const retenedor = await abrirRetenedor(opciones.academiaId);
  try {
    await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
      opciones.academiaId,
      opciones.alumnoId,
    ]);
    const peticiones = opciones.enviar.map((enviar) => observar(enviar()));
    let esperaron = false;
    let maximoEnEspera = 0;
    const limite = Date.now() + 15_000;
    while (!peticiones.some((peticion) => peticion.terminada())) {
      const [{ n }] = (await retenedor.consultar(SQL_BLOQUEOS_EN_ESPERA, [usuario])) as [{ n: number }];
      maximoEnEspera = Math.max(maximoEnEspera, n);
      if (n >= opciones.esperando) {
        esperaron = true;
        break;
      }
      if (Date.now() > limite) {
        await retenedor.liberar('ROLLBACK');
        throw new Error(
          `Límite de seguridad (15 s): las ${opciones.enviar.length} peticiones ni respondieron ni quedaron esperando (se vieron ${maximoEnEspera} bloqueos en espera en pg_locks).`,
        );
      }
      await new Promise((resolver) => setTimeout(resolver, 5));
    }
    await retenedor.liberar(opciones.liberar ?? 'COMMIT');
    const resultados = await conLimite(
      Promise.all(peticiones.map((peticion) => peticion.resultado)),
      'Límite de seguridad: las peticiones no respondieron tras soltar la fila del alumno.',
    );
    return { resultados, esperaron, maximoEnEspera };
  } finally {
    await retenedor.liberar('ROLLBACK');
  }
}
