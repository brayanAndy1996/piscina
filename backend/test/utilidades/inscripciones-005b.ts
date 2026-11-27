// spec: 005-inscripcion-publica (pruebas protegidas)
// Ajuste por el criterio 34 de 010-mensualidades (trigger de matricula_clases), consecuencia directa de A2, decidido por el orquestador el 27/11/2026: los sembradores
// de matrículas cerradas (`sembrarSolicitud`; `sembrarEnMasa` en la 005b; `sembrarAlumno` en escenario-cierre) siembran la matrícula abierta (`VIGENTE`), insertan sus clases y
// después la pasan a su estado final (mismas columnas y valores que antes).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { ejecutarComo } from './base-datos';
import {
  type AppInscripciones,
  cargarFuncionalidad005,
  codigoAleatorio,
  crearAppInscripciones,
  leerAlumnos,
  type Objeto,
  type OpcionesAppInscripciones,
  type RespuestaApi,
  rutaPublica,
} from './inscripciones';
import { crearAppConIpPorCabecera } from './inscripciones-ronda1';
import { dniInventado } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 005b (foto y panel de solicitudes). Solo usan HTTP, SQL, el sistema de archivos y los
 * contratos públicos: no importan nada de la implementación de la 005b. Lo que viene de producción (`AlmacenArchivosDisco`, el token
 * `ALMACEN_ARCHIVOS`, `sharp`) se carga con importación dinámica y, si falta, la prueba falla con un mensaje claro.
 *
 * - `subirFoto`: un `PUT …/solicitudes/foto` crudo (cuerpo binario, cualquier cabecera, con o sin `Content-Length`).
 * - `png`, `jpeg`: imágenes de prueba generadas aquí (el PNG a mano con `node:zlib`; el JPEG con `sharp`, al que se le agregan a mano
 *   segmentos EXIF con GPS, comentario y XMP, y datos después del final de la imagen).
 * - `AlmacenDeFallosDePrueba`: un `AlmacenArchivos` que envuelve a otro y falla donde la prueba diga.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Directorio temporal del almacén
// ---------------------------------------------------------------------------------------------------------------------

/** Un directorio temporal nuevo y vacío (con la ruta real, sin enlaces). */
export function directorioTemporal(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-almacen-')));
}

export function borrarDirectorio(ruta: string): void {
  fs.rmSync(ruta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Los archivos (no las carpetas) bajo `base`, como rutas relativas con `/`, ordenadas. Sin carpeta: lista vacía. */
export function archivosBajo(base: string): string[] {
  const resultado: string[] = [];
  const recorrer = (carpeta: string, prefijo: string): void => {
    if (!fs.existsSync(carpeta)) return;
    for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
      const relativa = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
      if (entrada.isDirectory()) recorrer(path.join(carpeta, entrada.name), relativa);
      else resultado.push(relativa);
    }
  };
  recorrer(base, '');
  return resultado.sort();
}

/** Los archivos de un alumno en el almacén (`academias/{academiaId}/alumnos/{alumnoId}/…`), relativos a la raíz. */
export function archivosDelAlumno(raiz: string, academiaId: string, alumnoId: string): string[] {
  const prefijo = `academias/${academiaId}/alumnos/${alumnoId}`;
  return archivosBajo(path.join(raiz, ...prefijo.split('/'))).map((archivo) => `${prefijo}/${archivo}`);
}

/** Los bytes del archivo de una clave del almacén en disco (la clave es la de `alumnos.foto_clave`). */
export function leerArchivoDeClave(raiz: string, clave: string): Buffer {
  return fs.readFileSync(path.join(raiz, ...clave.split('/')));
}

export function existeArchivoDeClave(raiz: string, clave: string): boolean {
  return fs.existsSync(path.join(raiz, ...clave.split('/')));
}

/** `alumnos.foto_clave` de un alumno (como dueño de las tablas). */
export async function fotoClaveDe(academiaId: string, alumnoId: string): Promise<string | null> {
  const alumno = (await leerAlumnos(academiaId)).find((fila) => fila.id === alumnoId);
  if (!alumno) throw new Error(`El alumno ${alumnoId} no existe en la academia ${academiaId}.`);
  return alumno.foto_clave;
}

// ---------------------------------------------------------------------------------------------------------------------
// Módulo del almacén (se carga con importación dinámica)
// ---------------------------------------------------------------------------------------------------------------------

export interface AlmacenArchivosPrueba {
  guardar(academiaId: string, clave: string, contenido: Buffer, tipo: 'image/jpeg' | 'image/png'): Promise<void>;
  leer(academiaId: string, clave: string): Promise<Buffer>;
  borrar(academiaId: string, clave: string): Promise<void>;
}

export interface ModuloAlmacen {
  ALMACEN_ARCHIVOS: symbol;
  AlmacenArchivosDisco: new (raiz: string) => AlmacenArchivosPrueba;
}

/** `backend/src/infraestructura/almacen-archivos/index.ts` (PB7). Falla con un mensaje claro si todavía no existe. */
export function cargarAlmacen(): Promise<ModuloAlmacen> {
  return cargarFuncionalidad005<ModuloAlmacen>('infraestructura/almacen-archivos/index.ts', [
    'ALMACEN_ARCHIVOS',
    'AlmacenArchivosDisco',
  ]);
}

export interface AppConAlmacen extends AppInscripciones {
  /** El directorio temporal del almacén (la raíz de `AlmacenArchivosDisco`). */
  raiz: string;
  /** El `AlmacenArchivos` que usa la aplicación (el de disco o el que lo envuelve). Falta si el módulo de la 005b no existe todavía. */
  almacen?: AlmacenArchivosPrueba;
  /** Por qué falta el almacén (el módulo de la 005b no existe). Cada prueba lo lanza con `exigirAlmacen`. */
  errorDeAlmacen?: Error;
  /** Cierra la aplicación y borra el directorio. */
  cerrarTodo(): Promise<void>;
  /** Vacía el directorio del almacén (entre pruebas). */
  vaciarAlmacen(): void;
}

export interface OpcionesAppConAlmacen extends Omit<OpcionesAppInscripciones, 'almacen'> {
  /** Envuelve al almacén de disco (por ejemplo, con `AlmacenDeFallosDePrueba`). */
  envolver?: (real: AlmacenArchivosPrueba) => AlmacenArchivosPrueba;
  /** `true`: la IP de cada petición sale de `X-Forwarded-For` (como `crearAppConIpPorCabecera`). */
  ipPorCabecera?: boolean;
}

/**
 * La aplicación de la 005 con su `AlmacenArchivos` reemplazado por un `AlmacenArchivosDisco` sobre un directorio temporal (la
 * implementación real no escribe en el repositorio). Si el módulo de la 005b no existe, la aplicación se crea igual con su almacén y
 * `errorDeAlmacen` dice por qué: no se lanza aquí (rompería el `beforeAll` y dejaría las pruebas omitidas).
 */
export async function crearAppConAlmacen(opciones: OpcionesAppConAlmacen = {}): Promise<AppConAlmacen> {
  const raiz = directorioTemporal();
  let almacen: AlmacenArchivosPrueba | undefined;
  let errorDeAlmacen: Error | undefined;
  try {
    const modulo = await cargarAlmacen();
    const disco = new modulo.AlmacenArchivosDisco(raiz);
    almacen = opciones.envolver ? opciones.envolver(disco) : disco;
  } catch (error) {
    errorDeAlmacen = error instanceof Error ? error : new Error(String(error));
  }
  const { ipPorCabecera, ...resto } = opciones;
  delete (resto as { envolver?: unknown }).envolver;
  const crear = ipPorCabecera ? crearAppConIpPorCabecera : crearAppInscripciones;
  const ctx = await crear({ ...resto, almacen });
  return {
    ...ctx,
    raiz,
    almacen,
    errorDeAlmacen,
    async cerrarTodo() {
      await ctx.http.cerrar();
      borrarDirectorio(raiz);
    },
    vaciarAlmacen() {
      borrarDirectorio(raiz);
      fs.mkdirSync(raiz, { recursive: true });
    },
  };
}

/** Falla (por sí misma, en cada prueba) si el módulo del almacén de la 005b no existe. */
export function exigirAlmacen(ctx: Pick<AppConAlmacen, 'errorDeAlmacen'>): void {
  if (ctx.errorDeAlmacen) throw ctx.errorDeAlmacen;
}

/** Un error de la prueba con un mensaje que lleva una "ruta": el registro técnico nunca debe copiarlo (criterio 37). */
export class ErrorDeAlmacenDePrueba extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'NombrePropioQueNoSeRegistra';
  }
}
export const TEXTO_DE_RUTA_EN_EL_ERROR = 'RUTA-INTERNA-DEL-ALMACEN-005B';

/** `AlmacenArchivos` que envuelve a otro y rechaza `guardar` o `borrar` cuando la prueba lo pide; registra las llamadas. */
export class AlmacenDeFallosDePrueba implements AlmacenArchivosPrueba {
  fallarGuardar = false;
  fallarBorrar = false;
  readonly llamadas: { operacion: 'guardar' | 'leer' | 'borrar'; academiaId: string; clave: string }[] = [];
  /** Se ejecuta al recibir `guardar`, antes de delegar o de fallar (por ejemplo, para mirar la base en ese instante). */
  alGuardar?: (academiaId: string, clave: string) => Promise<void>;
  /** Se ejecuta al recibir `borrar`, antes de delegar o de fallar. */
  alBorrar?: (academiaId: string, clave: string) => Promise<void>;

  constructor(private readonly real: AlmacenArchivosPrueba) {}

  async guardar(academiaId: string, clave: string, contenido: Buffer, tipo: 'image/jpeg' | 'image/png'): Promise<void> {
    this.llamadas.push({ operacion: 'guardar', academiaId, clave });
    if (this.alGuardar) await this.alGuardar(academiaId, clave);
    if (this.fallarGuardar)
      throw new ErrorDeAlmacenDePrueba(`No se pudo guardar ${TEXTO_DE_RUTA_EN_EL_ERROR}/${clave}`);
    await this.real.guardar(academiaId, clave, contenido, tipo);
  }

  leer(academiaId: string, clave: string): Promise<Buffer> {
    this.llamadas.push({ operacion: 'leer', academiaId, clave });
    return this.real.leer(academiaId, clave);
  }

  async borrar(academiaId: string, clave: string): Promise<void> {
    this.llamadas.push({ operacion: 'borrar', academiaId, clave });
    if (this.alBorrar) await this.alBorrar(academiaId, clave);
    if (this.fallarBorrar) throw new ErrorDeAlmacenDePrueba(`No se pudo borrar ${TEXTO_DE_RUTA_EN_EL_ERROR}/${clave}`);
    await this.real.borrar(academiaId, clave);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Petición cruda de la foto
// ---------------------------------------------------------------------------------------------------------------------

export const RUTA_FOTO = '/solicitudes/foto';

export interface OpcionesSubida {
  /** El token de `X-Token-Solicitud`. Un arreglo manda la cabecera repetida; `null` o sin él, no manda la cabecera. */
  token?: string | readonly string[] | null;
  /** `Content-Type`. Por defecto `image/png`; `null` no lo manda. */
  tipo?: string | null;
  /** `Content-Encoding` (sin él, no se manda). */
  codificacion?: string;
  /** El cuerpo. Por defecto, vacío. */
  cuerpo?: Buffer;
  /** Un `Content-Length` distinto del largo real (para declarar un cuerpo grande sin enviarlo). */
  largoDeclarado?: number;
  /** Sin `Content-Length`: el cuerpo se envía troceado (`Transfer-Encoding: chunked`). */
  troceado?: boolean;
  /** Más cabeceras (por ejemplo `x-forwarded-for` o `referer`). */
  headers?: Record<string, string>;
  metodo?: string;
  /** La ruta completa, si no es la de la foto de `nombreCorto`. */
  ruta?: string;
  /** Tiempo máximo de la petición (ms): la API no debe quedarse esperando un cuerpo que no va a leer. */
  plazoMs?: number;
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

/**
 * `PUT /api/a/{nombreCorto}/solicitudes/foto` crudo contra la aplicación que escucha. Devuelve la respuesta en cuanto llega, aunque la
 * API corte la conexión sin leer el resto del cuerpo (413 con `Content-Length` grande).
 */
export function subirFoto(
  ctx: Pick<AppInscripciones, 'app'>,
  nombreCorto: string,
  opciones: OpcionesSubida = {},
): Promise<RespuestaApi> {
  const { port } = ctx.app.getHttpServer().address() as { port: number };
  const cuerpo = opciones.cuerpo ?? Buffer.alloc(0);
  const headers: Record<string, string | string[]> = { ...opciones.headers };
  if (opciones.tipo !== null) headers['content-type'] = opciones.tipo ?? 'image/png';
  if (opciones.codificacion !== undefined) headers['content-encoding'] = opciones.codificacion;
  if (opciones.token !== undefined && opciones.token !== null) {
    headers['x-token-solicitud'] = typeof opciones.token === 'string' ? opciones.token : [...opciones.token];
  }
  if (!opciones.troceado) headers['content-length'] = String(opciones.largoDeclarado ?? cuerpo.length);
  const ruta = opciones.ruta ?? rutaPublica(nombreCorto, RUTA_FOTO);
  const plazo = opciones.plazoMs ?? 15_000;

  return new Promise<RespuestaApi>((resolver, rechazar) => {
    let respondida = false;
    const temporizador = setTimeout(() => {
      peticion.destroy();
      rechazar(
        new Error(
          `La API no respondió en ${plazo} ms a ${opciones.metodo ?? 'PUT'} ${ruta} (¿espera un cuerpo que no debe leer?).`,
        ),
      );
    }, plazo);
    const peticion = http.request(
      { host: '127.0.0.1', port, method: opciones.metodo ?? 'PUT', path: ruta, headers, agent: false },
      (respuesta) => {
        const trozos: Buffer[] = [];
        respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
        respuesta.on('error', () => undefined);
        respuesta.on('end', () => {
          respondida = true;
          clearTimeout(temporizador);
          const texto = Buffer.concat(trozos).toString('utf8');
          const cabeceras = new Headers();
          for (const [nombre, valor] of Object.entries(respuesta.headers)) {
            if (Array.isArray(valor)) for (const v of valor) cabeceras.append(nombre, v);
            else if (valor !== undefined) cabeceras.set(nombre, valor);
          }
          resolver({
            status: respuesta.statusCode ?? 0,
            body: leerJsonObjeto(texto),
            texto,
            headers: cabeceras,
            cacheControl: cabeceras.get('cache-control'),
          });
          // Si la API respondió sin leer todo el cuerpo, no se sigue enviando.
          peticion.destroy();
        });
      },
    );
    peticion.on('error', (error) => {
      if (respondida) return;
      clearTimeout(temporizador);
      rechazar(error);
    });
    // Si la API responde antes de que el cuerpo termine de salir, el resto del envío puede fallar: no importa.
    if (opciones.troceado) {
      const tamano = 64 * 1024;
      for (let i = 0; i < cuerpo.length; i += tamano) peticion.write(cuerpo.subarray(i, i + tamano));
      peticion.end();
    } else {
      peticion.end(cuerpo);
    }
  });
}

/** Una petición `PUT` con un token y una imagen válida corta de PNG (100 × 100), para las pruebas que no miran la imagen. */
export function subirFotoValida(
  ctx: Pick<AppInscripciones, 'app'>,
  nombreCorto: string,
  token: string,
  extra: OpcionesSubida = {},
): Promise<RespuestaApi> {
  return subirFoto(ctx, nombreCorto, { token, cuerpo: png(100, 100), ...extra });
}

// ---------------------------------------------------------------------------------------------------------------------
// Imágenes de prueba
// ---------------------------------------------------------------------------------------------------------------------

export const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const FIRMA_JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/** El texto marcado que las pruebas buscan en lo guardado y en el registro técnico. */
export const TEXTO_MARCADO = 'SECRETO-005B';

function trozoPng(tipo: string, datos: Buffer): Buffer {
  const cabeza = Buffer.alloc(4);
  cabeza.writeUInt32BE(datos.length, 0);
  const tipoYDatos = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(tipoYDatos), 0);
  return Buffer.concat([cabeza, tipoYDatos, crc]);
}

export interface OpcionesPng {
  /** Bits por píxel (escala de grises): 8 por defecto; 1 para imágenes enormes que ocupan poco. */
  profundidad?: 1 | 8;
  /** Un trozo `tEXt` con este texto (después del encabezado). */
  texto?: string;
  /** Bytes pegados después de `IEND` (un archivo poliglota). */
  despues?: Buffer;
}

/** Un PNG de escala de grises, negro, de `ancho` × `alto`, escrito a mano (válido y decodificable). */
export function png(ancho: number, alto: number, opciones: OpcionesPng = {}): Buffer {
  const profundidad = opciones.profundidad ?? 8;
  const bytesPorFila = profundidad === 8 ? ancho : Math.ceil(ancho / 8);
  const crudo = Buffer.alloc((bytesPorFila + 1) * alto); // por fila: filtro 0 y los píxeles en 0 (negro)
  const encabezado = Buffer.alloc(13);
  encabezado.writeUInt32BE(ancho, 0);
  encabezado.writeUInt32BE(alto, 4);
  encabezado[8] = profundidad;
  encabezado[9] = 0; // escala de grises
  const partes = [FIRMA_PNG, trozoPng('IHDR', encabezado)];
  if (opciones.texto !== undefined) {
    partes.push(
      trozoPng('tEXt', Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from(opciones.texto, 'latin1')])),
    );
  }
  partes.push(trozoPng('IDAT', zlib.deflateSync(crudo, { level: 1 })), trozoPng('IEND', Buffer.alloc(0)));
  if (opciones.despues) partes.push(opciones.despues);
  return Buffer.concat(partes);
}

/** Lo que las pruebas usan de `sharp` (sin importar sus tipos: la dependencia llega con la 005b). */
export interface MetadatosSharp {
  format?: string;
  width?: number;
  height?: number;
  orientation?: number;
  exif?: Buffer;
  icc?: Buffer;
  iptc?: Buffer;
  xmp?: Buffer;
}
export interface InstanciaSharp {
  jpeg(opciones?: Record<string, unknown>): InstanciaSharp;
  withIccProfile(perfil: string): InstanciaSharp;
  toBuffer(): Promise<Buffer>;
  metadata(): Promise<MetadatosSharp>;
  stats(): Promise<{ channels: { mean: number }[] }>;
}
export type FabricaSharp = (entrada?: unknown, opciones?: Record<string, unknown>) => InstanciaSharp;

let sharpCargado: FabricaSharp | undefined;
/** `sharp`, con importación dinámica: si la dependencia todavía no está instalada, falla con un mensaje claro. */
export async function cargarSharp(): Promise<FabricaSharp> {
  if (sharpCargado) return sharpCargado;
  const nombre = 'sharp';
  try {
    const modulo = (await import(/* @vite-ignore */ nombre)) as { default?: unknown };
    sharpCargado = (modulo.default ?? modulo) as FabricaSharp;
    return sharpCargado;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`Falta la dependencia de la 005b: no se pudo cargar "sharp" (${motivo}).`, { cause: error });
  }
}

export async function metadatosDe(imagen: Buffer): Promise<MetadatosSharp> {
  const sharp = await cargarSharp();
  return sharp(imagen).metadata();
}

/** Un segmento de JPEG: `FF` + marcador + largo (2 bytes, incluye los suyos) + datos. */
function segmentoJpeg(marcador: number, datos: Buffer): Buffer {
  const cabeza = Buffer.alloc(4);
  cabeza[0] = 0xff;
  cabeza[1] = marcador;
  cabeza.writeUInt16BE(datos.length + 2, 2);
  return Buffer.concat([cabeza, datos]);
}

/** Un EXIF (TIFF little-endian) con la orientación y/o unas coordenadas GPS (12°2'46" S, 77°1'54" O). */
function exifDe(orientacion: number | undefined, gps: boolean): Buffer {
  const entradaIfd = (etiqueta: number, tipo: number, cuenta: number, valor: Buffer): Buffer => {
    const entrada = Buffer.alloc(12);
    entrada.writeUInt16LE(etiqueta, 0);
    entrada.writeUInt16LE(tipo, 2);
    entrada.writeUInt32LE(cuenta, 4);
    valor.copy(entrada, 8);
    return entrada;
  };
  const u16 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt16LE(n, 0);
    return b;
  };
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    return b;
  };
  const entradas0: Buffer[] = [];
  const numeroDeEntradas0 = (orientacion === undefined ? 0 : 1) + (gps ? 1 : 0);
  const inicioGps = 8 + 2 + numeroDeEntradas0 * 12 + 4;
  if (orientacion !== undefined) entradas0.push(entradaIfd(0x0112, 3, 1, u16(orientacion)));
  if (gps) entradas0.push(entradaIfd(0x8825, 4, 1, u32(inicioGps)));
  const cabecera = Buffer.concat([Buffer.from('II*\0', 'latin1'), u32(8)]);
  const ifd0 = Buffer.concat([u16(numeroDeEntradas0).subarray(0, 2), ...entradas0, u32(0)]);
  const partes = [cabecera, ifd0];
  if (gps) {
    const inicioDatos = inicioGps + 2 + 4 * 12 + 4;
    const racionales = (a: number, b: number, c: number): Buffer => {
      const buffer = Buffer.alloc(24);
      [a, 1, b, 1, c, 1].forEach((valor, indice) => buffer.writeUInt32LE(valor, indice * 4));
      return buffer;
    };
    const latitud = racionales(12, 2, 46);
    const longitud = racionales(77, 1, 54);
    const gpsIfd = Buffer.concat([
      u16(4).subarray(0, 2),
      entradaIfd(0x0001, 2, 2, Buffer.from('S\0', 'latin1')),
      entradaIfd(0x0002, 5, 3, u32(inicioDatos)),
      entradaIfd(0x0003, 2, 2, Buffer.from('W\0', 'latin1')),
      entradaIfd(0x0004, 5, 3, u32(inicioDatos + 24)),
      u32(0),
      latitud,
      longitud,
    ]);
    partes.push(gpsIfd);
  }
  return Buffer.concat(partes);
}

export interface OpcionesJpeg {
  /** Orientación EXIF (1 a 8). */
  orientacion?: number;
  /** Coordenadas GPS en el EXIF. */
  gps?: boolean;
  /** Un segmento de comentario (`COM`) con este texto. */
  comentario?: string;
  /** Un segmento XMP con este texto dentro. */
  xmp?: string;
  /** Un perfil de color ICC dentro. */
  icc?: boolean;
  /** Bytes pegados después del final de la imagen (`FF D9`). */
  despues?: Buffer;
  /** Color de fondo (por defecto, un azul). */
  color?: { r: number; g: number; b: number };
}

/** Un JPEG plano de `ancho` × `alto`, con los metadatos y datos finales que pida la prueba (necesita `sharp`). */
export async function jpeg(ancho: number, alto: number, opciones: OpcionesJpeg = {}): Promise<Buffer> {
  const sharp = await cargarSharp();
  let instancia = sharp({
    create: { width: ancho, height: alto, channels: 3, background: opciones.color ?? { r: 20, g: 90, b: 160 } },
  }).jpeg({ quality: 80 });
  if (opciones.icc) instancia = instancia.withIccProfile('srgb');
  const base = await instancia.toBuffer();
  const segmentos: Buffer[] = [];
  if (opciones.orientacion !== undefined || opciones.gps) {
    segmentos.push(
      segmentoJpeg(
        0xe1,
        Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifDe(opciones.orientacion, opciones.gps ?? false)]),
      ),
    );
  }
  if (opciones.xmp !== undefined) {
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description dc:description="${opciones.xmp}"/></rdf:RDF></x:xmpmeta>`;
    segmentos.push(
      segmentoJpeg(
        0xe1,
        Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xml, 'latin1')]),
      ),
    );
  }
  if (opciones.comentario !== undefined) segmentos.push(segmentoJpeg(0xfe, Buffer.from(opciones.comentario, 'latin1')));
  const conSegmentos = Buffer.concat([base.subarray(0, 2), ...segmentos, base.subarray(2)]);
  return opciones.despues ? Buffer.concat([conSegmentos, opciones.despues]) : conSegmentos;
}

/** Los objetos JSON de las líneas del registro técnico (las líneas que no son JSON se ignoran). */
export function lineasJson(lineas: readonly string[]): Record<string, unknown>[] {
  const objetos: Record<string, unknown>[] = [];
  for (const linea of lineas) {
    try {
      const valor: unknown = JSON.parse(linea);
      if (valor !== null && typeof valor === 'object' && !Array.isArray(valor))
        objetos.push(valor as Record<string, unknown>);
    } catch {
      // No es una línea JSON.
    }
  }
  return objetos;
}

// ---------------------------------------------------------------------------------------------------------------------
// Solicitudes en masa (el tope de 200 de la lista)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Siembra, como dueño y con una sola sentencia, `cantidad` clientes con su solicitud y su matrícula del mes de `base` (en una clase),
 * `PENDIENTE_PAGO` con la reserva vigente o `CANCELADA`. La solicitud número `n` (de 0 a `cantidad − 1`) se crea `n` segundos después
 * de `base`. Devuelve los ids de las solicitudes, de la más vieja a la más nueva.
 */
export async function sembrarEnMasa(
  academiaId: string,
  opciones: {
    planId: string;
    claseId: string;
    cantidad: number;
    estado: 'PENDIENTE_PAGO' | 'CANCELADA';
    base: Date;
    reservaVenceEn: Date;
  },
): Promise<string[]> {
  const n = opciones.cantidad;
  const alumnos = Array.from({ length: n }, () => randomUUID());
  const solicitudes = Array.from({ length: n }, () => randomUUID());
  const matriculas = Array.from({ length: n }, () => randomUUID());
  const dnis = new Set<string>();
  const codigos = new Set<string>();
  while (dnis.size < n) dnis.add(dniInventado());
  while (codigos.size < n) codigos.add(codigoAleatorio());
  const desplazamientos = Array.from({ length: n }, (_, i) => i);
  const activa = opciones.estado === 'PENDIENTE_PAGO';
  await ejecutarComo(
    'propietario',
    `WITH a AS (
       INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, creado_en, actualizado_en)
       SELECT x.alumno, $1::uuid, x.dni, 'Masivo', 'De Prueba', DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion,
              'CLIENTE'::estado_alumno, $8::timestamptz + make_interval(secs => x.n), $8::timestamptz + make_interval(secs => x.n)
         FROM unnest($2::uuid[], $3::text[], $6::int[]) AS x(alumno, dni, n)
       RETURNING id),
     s AS (
       INSERT INTO solicitudes_inscripcion (id, academia_id, alumno_id, codigo, token_hash, clave_idempotencia, estado, ip_origen, creado_en, actualizado_en)
       SELECT x.solicitud, $1::uuid, x.alumno, x.codigo, decode(md5(x.codigo) || md5(x.solicitud::text), 'hex'), gen_random_uuid(),
              $9::estado_solicitud, '198.51.100.9'::inet, $8::timestamptz + make_interval(secs => x.n), $8::timestamptz + make_interval(secs => x.n)
         FROM unnest($2::uuid[], $4::uuid[], $5::text[], $6::int[]) AS x(alumno, solicitud, codigo, n)
       RETURNING id),
     m AS (
       INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, solicitud_id, anio, mes, fecha_inicio, fecha_fin, clases_totales, clases_usadas,
                               es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado, reserva_vence_en, creado_en, actualizado_en)
       SELECT x.matricula, $1::uuid, x.alumno, $10::uuid, x.solicitud, 2026, 11, DATE '2026-11-01', DATE '2026-11-30', 12, 0,
              false, 120.00, 12, 120.00, CASE WHEN $9::text = 'PENDIENTE_PAGO' THEN 'RESERVADA' ELSE 'VIGENTE' END::estado_matricula,
              CASE WHEN $9::text = 'PENDIENTE_PAGO' THEN $12::timestamptz ELSE NULL END,
              $8::timestamptz + make_interval(secs => x.n), $8::timestamptz + make_interval(secs => x.n)
         FROM unnest($2::uuid[], $4::uuid[], $7::uuid[], $6::int[]) AS x(alumno, solicitud, matricula, n)
       RETURNING id)
     INSERT INTO matricula_clases (academia_id, matricula_id, clase_id)
     SELECT $1::uuid, m.id, $11::uuid FROM m`,
    [
      academiaId,
      alumnos,
      [...dnis],
      solicitudes,
      [...codigos],
      desplazamientos,
      matriculas,
      opciones.base,
      activa ? 'PENDIENTE_PAGO' : 'CANCELADA',
      opciones.planId,
      opciones.claseId,
      opciones.reservaVenceEn,
    ],
    { academiaId },
  );
  if (!activa) {
    // 010c (criterio 34): las clases de una matrícula cerrada no se insertan; la matrícula se siembra abierta y después se cancela.
    await ejecutarComo(
      'propietario',
      `UPDATE matriculas SET estado = 'CANCELADA'::estado_matricula WHERE academia_id = $1::uuid AND id = ANY($2::uuid[])`,
      [academiaId, matriculas],
      { academiaId },
    );
  }
  return solicitudes;
}
