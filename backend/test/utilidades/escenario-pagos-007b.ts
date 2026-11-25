// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type EscenarioPagos, HOY_007, instantaneaDeLaAcademia, sembrarCobrable } from './escenario-pagos';
import {
  actualizarFilas,
  type AppInscripciones,
  type Objeto,
  type OpcionesSembrado,
  type RespuestaApi,
  rutaPublica,
  type SolicitudSembrada,
} from './inscripciones';
import { type AppConAlmacen, archivosBajo, jpeg, type OpcionesSubida, png, subirFoto } from './inscripciones-005b';
import { filaPagoValida, insertarPago, type MetodoDePago, numeroDeOperacionInventado, T_PAGO } from './pagos';
import { rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 007b (Yape y transferencia: comprobante y bandeja de verificación). Solo usan SQL, HTTP y los
 * contratos públicos: no importan nada de la implementación. Reutilizan el escenario de la 007a (`escenario-pagos.ts`) y la subida cruda
 * de la foto de la 005b (`subirFoto`), que ya sabe mandar cualquier cabecera y cualquier cuerpo binario.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------------------------------------------------

export const RUTA_COMPROBANTE = '/solicitudes/comprobante';
export const RUTA_PENDIENTES = '/api/pagos/pendientes';
export const rutaComprobante = (pagoId: string): string => `/api/pagos/${pagoId}/comprobante`;
export const rutaAprobacion = (pagoId: string): string => `/api/pagos/${pagoId}/aprobacion`;
export const rutaRechazo = (pagoId: string): string => `/api/pagos/${pagoId}/rechazo`;

const RUTAS_DE_LA_007B: readonly RegExp[] = [
  /^PUT \/api\/a\/:[^/]+\/solicitudes\/comprobante$/,
  /^GET \/api\/pagos\/pendientes$/,
  /^GET \/api\/pagos\/:\w+\/comprobante$/,
  /^POST \/api\/pagos\/:\w+\/aprobacion$/,
  /^POST \/api\/pagos\/:\w+\/rechazo$/,
];

/**
 * Falla con un mensaje claro si las cinco rutas nuevas de la 007b no están registradas (la funcionalidad no existe todavía). Evita que una
 * prueba pase por casualidad con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */
export function exigirRutasDe007b(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_007B) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 007b: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Datos del comprobante (cabecera X-Pago-Datos: JSON ASCII de hasta 1024 bytes)
// ---------------------------------------------------------------------------------------------------------------------

/** `JSON.stringify` con todo lo que no es ASCII escapado como `\uXXXX`: una cabecera HTTP solo lleva ASCII (criterio 36). */
export function jsonAscii(valor: unknown): string {
  return JSON.stringify(valor).replaceAll(
    /[\u0080-\uffff]/g,
    (caracter) => `\\u${caracter.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Los datos válidos de un comprobante de Yape (`datosComprobanteSchema`) con una clave nueva; `sobre` los cambia (`undefined` quita el campo). */
export function datosDeComprobante(sobre: Objeto = {}): Objeto {
  const datos: Objeto = {
    claveIdempotencia: randomUUID(),
    metodo: 'YAPE',
    numeroOperacion: numeroDeOperacionInventado(),
    monto: '42.00',
    fechaOperacion: HOY_007,
    ...sobre,
  };
  for (const [clave, valor] of Object.entries(datos)) if (valor === undefined) delete datos[clave];
  return datos;
}

export interface OpcionesComprobante extends OpcionesSubida {
  /** Los datos de `X-Pago-Datos`: un objeto (se manda como JSON ASCII), un texto tal cual, o `null` para no mandar la cabecera. */
  datos?: Objeto | string | null;
}

/**
 * `PUT /api/a/{nombreCorto}/solicitudes/comprobante` crudo (la imagen como cuerpo binario, el token en `X-Token-Solicitud` y los datos en
 * `X-Pago-Datos`). Por defecto, un PNG de 100 × 100 y datos válidos de un Yape de S/ 42.00 de hoy con una clave nueva.
 */
export function subirComprobante(
  ctx: Pick<AppInscripciones, 'app'>,
  nombreCorto: string,
  opciones: OpcionesComprobante = {},
): Promise<RespuestaApi> {
  const { datos, ...resto } = opciones;
  const headers: Record<string, string> = { ...resto.headers };
  if (datos !== null) {
    headers['x-pago-datos'] =
      datos === undefined ? jsonAscii(datosDeComprobante()) : typeof datos === 'string' ? datos : jsonAscii(datos);
  }
  return subirFoto(ctx, nombreCorto, {
    cuerpo: png(100, 100),
    tipo: 'image/png',
    ...resto,
    headers,
    ruta: resto.ruta ?? rutaPublica(nombreCorto, RUTA_COMPROBANTE),
  });
}

/** Sube el comprobante de una solicitud sembrada de A (el token es el de la solicitud). */
export function comprobanteDe(
  ctx: Pick<AppInscripciones, 'app'>,
  cliente: Pick<SolicitudSembrada, 'token'>,
  datos: Objeto = {},
  extra: OpcionesComprobante = {},
): Promise<RespuestaApi> {
  return subirComprobante(ctx, 'academia-a', {
    token: cliente.token,
    datos: datosDeComprobante(datos),
    ...extra,
  });
}

/** El número de operación normalizado, escrito aquí a partir de la definición de la spec (independiente de la implementación). */
export function normalizadoDeReferencia(escrito: string): string {
  const limpio = escrito.normalize('NFKC').replaceAll(/[\p{White_Space}\p{Z}\-./_]/gu, '');
  const sinCeros = limpio.toUpperCase().replace(/^0+/, '');
  return sinCeros === '' ? '0' : sinCeros;
}

// ---------------------------------------------------------------------------------------------------------------------
// Solicitudes sembradas con pagos
// ---------------------------------------------------------------------------------------------------------------------

export interface OpcionesDePagoSembrado {
  metodo?: Exclude<MetodoDePago, 'EFECTIVO'>;
  /** Lo que escribió la persona (por defecto, un número inventado). */
  numeroOperacion?: string;
  fechaOperacion?: string;
  registradoEn?: Date;
  /** Cambios sobre las columnas de la fila del pago (cualquier valor). */
  sobrePago?: Record<string, unknown>;
}

export interface SolicitudConPago extends SolicitudSembrada {
  pagoId: string;
  comprobanteClave: string;
  numeroOperacion: string;
  registradoEn: Date;
}

/**
 * Una solicitud con un comprobante en revisión: la matrícula `RESERVADA` sin vencimiento (RN-28) y un pago `PENDIENTE_VERIFICACION` de Yape (o
 * transferencia) por el total de la matrícula. Todo escrito como dueño de las tablas. Estado visible: `EN_VERIFICACION`. Por defecto, la
 * matrícula de S/ 42.00 que usa `sembrarCobrable` y el pago por los mismos S/ 42.00.
 */
export async function sembrarEnVerificacion(
  e: EscenarioPagos,
  opciones: Partial<OpcionesSembrado> & OpcionesDePagoSembrado = {},
): Promise<SolicitudConPago> {
  const { metodo, numeroOperacion, fechaOperacion, registradoEn, sobrePago, ...sembrado } = opciones;
  const cliente = await sembrarCobrable(e, { reservaVenceEn: null, ...sembrado });
  const escrito = numeroOperacion ?? numeroDeOperacionInventado();
  const instante = registradoEn ?? T_PAGO;
  const fila = filaPagoValida(
    e.A.id,
    { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId },
    { metodo: metodo ?? 'YAPE', estado: 'PENDIENTE_VERIFICACION', monto: sembrado.monto ?? '42.00' },
    {
      numero_operacion: escrito,
      numero_operacion_normalizado: normalizadoDeReferencia(escrito),
      fecha_operacion: fechaOperacion ?? '2026-11-10',
      registrado_en: instante,
      creado_en: instante,
      actualizado_en: instante,
      ...sobrePago,
    },
  );
  await insertarPago('propietario', e.A.id, fila);
  return {
    ...cliente,
    pagoId: fila['id'] as string,
    comprobanteClave: fila['comprobante_clave'] as string,
    numeroOperacion: escrito,
    registradoEn: instante,
  };
}

export interface OpcionesRechazada extends OpcionesDePagoSembrado {
  motivo?: string;
  verificadoEn?: Date;
}

/**
 * Una solicitud con su comprobante rechazado: la solicitud sigue `PENDIENTE_PAGO` en la fila, la matrícula está `CANCELADA` sin vencimiento y
 * el único pago es `RECHAZADO` con su motivo. Estado visible dentro del mes de la matrícula: `PAGO_RECHAZADO` (DT-5).
 */
export async function sembrarRechazada(
  e: EscenarioPagos,
  opciones: Partial<OpcionesSembrado> & OpcionesRechazada = {},
): Promise<SolicitudConPago> {
  const { metodo, numeroOperacion, fechaOperacion, registradoEn, sobrePago, motivo, verificadoEn, ...sembrado } =
    opciones;
  const cliente = await sembrarCobrable(e, sembrado);
  await actualizarFilas(
    'propietario',
    'matriculas',
    e.A.id,
    { id: cliente.matriculaId },
    { estado: 'CANCELADA', reserva_vence_en: null },
  );
  const escrito = numeroOperacion ?? numeroDeOperacionInventado();
  const instante = registradoEn ?? T_PAGO;
  const fila = filaPagoValida(
    e.A.id,
    { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId, usuarioId: e.secretariaA.id },
    { metodo: metodo ?? 'YAPE', estado: 'RECHAZADO', monto: sembrado.monto ?? '42.00' },
    {
      numero_operacion: escrito,
      numero_operacion_normalizado: normalizadoDeReferencia(escrito),
      fecha_operacion: fechaOperacion ?? '2026-11-10',
      motivo_rechazo: motivo ?? 'La imagen no se lee',
      registrado_en: instante,
      verificado_en: verificadoEn ?? new Date(instante.getTime() + 15 * 60 * 1000),
      creado_en: instante,
      actualizado_en: instante,
      ...sobrePago,
    },
  );
  await insertarPago('propietario', e.A.id, fila);
  return {
    ...cliente,
    pagoId: fila['id'] as string,
    comprobanteClave: fila['comprobante_clave'] as string,
    numeroOperacion: escrito,
    registradoEn: instante,
  };
}

/** Un JPEG cualquiera guardado en el almacén de la prueba con la clave de un pago sembrado (el archivo que la bandeja muestra). */
export async function guardarComprobanteSembrado(
  ctx: AppConAlmacen,
  academiaId: string,
  clave: string,
  imagen?: Buffer,
): Promise<Buffer> {
  if (!ctx.almacen) throw new Error('La aplicación de la prueba no tiene almacén de archivos.');
  const contenido = imagen ?? (await jpeg(300, 200));
  await ctx.almacen.guardar(academiaId, clave, contenido, 'image/jpeg');
  return contenido;
}

// ---------------------------------------------------------------------------------------------------------------------
// Respuestas y lecturas
// ---------------------------------------------------------------------------------------------------------------------

/** La `solicitud` (vista de seguimiento) de una respuesta `{ solicitud }` o `{ academia, solicitud }`. */
export function vistaDeRespuesta(respuesta: Pick<RespuestaApi, 'body' | 'status'>): Objeto {
  const vista = respuesta.body?.['solicitud'];
  if (vista === null || typeof vista !== 'object') {
    throw new Error(`La respuesta (HTTP ${respuesta.status}) no trae "solicitud": ${JSON.stringify(respuesta.body)}`);
  }
  return vista as Objeto;
}

/** La consulta pública de seguimiento por token. */
export const consultarPorToken = (
  ctx: AppInscripciones,
  token: string,
  nombreCorto = 'academia-a',
): Promise<RespuestaApi> => ctx.http.post(rutaPublica(nombreCorto, '/solicitudes/consulta'), { token });

/** La consulta pública de seguimiento por código y DNI. */
export const consultarPorCodigo = (
  ctx: AppInscripciones,
  codigo: string,
  dni: string,
  nombreCorto = 'academia-a',
): Promise<RespuestaApi> => ctx.http.post(rutaPublica(nombreCorto, '/solicitudes/consulta'), { codigo, dni });

/** El estado visible de una solicitud, tal como lo ve el cliente en su enlace. */
export async function estadoVisibleDe(ctx: AppInscripciones, token: string): Promise<string> {
  const respuesta = await consultarPorToken(ctx, token);
  return String(vistaDeRespuesta(respuesta)['estado']);
}

/** Todo lo que un rechazo no puede cambiar: las tablas de las dos academias, la caja, los usuarios, la auditoría y los archivos del almacén. */
export async function instantaneaConArchivos(ctx: Pick<AppConAlmacen, 'raiz'>, e: EscenarioPagos): Promise<string> {
  return JSON.stringify({
    a: await instantaneaDeLaAcademia(e.A.id),
    b: await instantaneaDeLaAcademia(e.B.id),
    archivos: archivosBajo(ctx.raiz),
  });
}

/** Un elemento de `GET /api/pagos/pendientes`. */
export interface PagoPendienteApi {
  id: string;
  metodo: string;
  monto: string;
  numeroOperacion: string;
  fechaOperacion: string;
  enviadoEn: string;
  solicitud: { id: string; codigo: string };
  cliente: { nombres: string; apellidos: string; dni: string };
  mes: string;
  mesTerminado: boolean;
  [clave: string]: unknown;
}

export function pagosPendientesDe(respuesta: Pick<RespuestaApi, 'body' | 'status' | 'texto'>): PagoPendienteApi[] {
  const pagos = respuesta.body?.['pagos'];
  if (!Array.isArray(pagos)) {
    throw new Error(`La respuesta (HTTP ${respuesta.status}) no trae "pagos": ${respuesta.texto.slice(0, 300)}`);
  }
  return pagos as PagoPendienteApi[];
}

/** Una respuesta con el cuerpo en bytes (la imagen del comprobante no se puede leer como texto). */
export interface RespuestaBinaria {
  status: number;
  headers: Headers;
  cuerpo: Buffer;
}

/** Una petición HTTP cruda (cualquier método) que devuelve el cuerpo como bytes. */
export function pedirBinario(
  ctx: Pick<AppInscripciones, 'app'>,
  metodo: string,
  ruta: string,
  cookie?: string,
): Promise<RespuestaBinaria> {
  const { port } = ctx.app.getHttpServer().address() as { port: number };
  const headers: Record<string, string> = cookie ? { cookie } : {};
  return new Promise<RespuestaBinaria>((resolver, rechazar) => {
    const peticion = http.request(
      { host: '127.0.0.1', port, method: metodo, path: ruta, headers, agent: false },
      (respuesta) => {
        const trozos: Buffer[] = [];
        respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
        respuesta.on('error', rechazar);
        respuesta.on('end', () => {
          const cabeceras = new Headers();
          for (const [nombre, valor] of Object.entries(respuesta.headers)) {
            if (Array.isArray(valor)) for (const v of valor) cabeceras.append(nombre, v);
            else if (valor !== undefined) cabeceras.set(nombre, valor);
          }
          resolver({ status: respuesta.statusCode ?? 0, headers: cabeceras, cuerpo: Buffer.concat(trozos) });
        });
      },
    );
    peticion.on('error', rechazar);
    peticion.end();
  });
}
