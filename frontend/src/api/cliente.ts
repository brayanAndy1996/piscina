import { errorApiSchema } from '@aquagestion/contratos';
import type { ErrorApi } from '@aquagestion/contratos';
import type { ZodType } from 'zod';

/** El servidor no respondió, o respondió algo que no cumple lo esperado. */
export class ErrorDeRespuesta extends Error {}

/**
 * La API respondió con un error que cumple `errorApiSchema` (`{ codigo, mensaje, detalles? }`): lleva el código HTTP y
 * el error ya validado, para que la interfaz decida qué mostrar según `estado` y `codigo`.
 */
export class ErrorDeApi extends ErrorDeRespuesta {
  readonly estado: number;
  readonly codigo: string;
  readonly detalles: unknown;

  constructor(estado: number, error: ErrorApi) {
    super(error.mensaje);
    this.estado = estado;
    this.codigo = error.codigo;
    this.detalles = error.detalles;
  }
}

/** Dice si `error` es un error de la API con ese código HTTP (y, si se indica, ese código de error). */
export function esErrorDeApi(error: unknown, estado: number, codigo?: string): error is ErrorDeApi {
  return error instanceof ErrorDeApi && error.estado === estado && (codigo === undefined || error.codigo === codigo);
}

export interface RespuestaJson<T> {
  /** Código HTTP de la respuesta. */
  estado: number;
  /** Cuerpo validado con el esquema. */
  datos: T;
}

type MetodoConCuerpo = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function solicitar(
  metodo: 'GET' | MetodoConCuerpo,
  ruta: string,
  cuerpo: unknown,
  estadosAceptados: readonly number[],
): Promise<{ respuesta: Response; texto: string }> {
  const encabezados: Record<string, string> = { Accept: 'application/json' };
  const opciones: RequestInit = { method: metodo, headers: encabezados, credentials: 'same-origin' };
  if (cuerpo !== undefined) {
    encabezados['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  let respuesta: Response;
  let texto: string;
  try {
    respuesta = await fetch(ruta, opciones);
    texto = await respuesta.text();
  } catch {
    throw new ErrorDeRespuesta('No se pudo contactar al servidor.');
  }
  if (!estadosAceptados.includes(respuesta.status)) {
    const error = leerErrorApi(texto);
    if (error) throw new ErrorDeApi(respuesta.status, error);
    throw new ErrorDeRespuesta(`Respuesta inesperada del servidor (${respuesta.status}).`);
  }
  return { respuesta, texto };
}

function leerErrorApi(texto: string): ErrorApi | null {
  try {
    const resultado = errorApiSchema.safeParse(JSON.parse(texto));
    return resultado.success ? resultado.data : null;
  } catch {
    return null;
  }
}

function validarCuerpo<T>(texto: string, esquema: ZodType<T>): T {
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    throw new ErrorDeRespuesta('La respuesta del servidor no es JSON.');
  }
  const resultado = esquema.safeParse(cuerpo);
  if (!resultado.success) throw new ErrorDeRespuesta('La respuesta del servidor no tiene el formato esperado.');
  return resultado.data;
}

/**
 * Pide `ruta` (debe empezar por `/api`) y valida el cuerpo JSON con `esquema` (contratos compartidos).
 * Lanza `ErrorDeApi` si la API responde con un error de su formato (por ejemplo, 401), y `ErrorDeRespuesta` si la red
 * falla, si el código no está en `estadosAceptados` o si el cuerpo no cumple el esquema. Un código aceptado distinto
 * de 200 (por ejemplo, el 503 de salud) se devuelve en `estado`.
 */
export async function pedirJson<T>(
  ruta: string,
  esquema: ZodType<T>,
  estadosAceptados: readonly number[] = [200],
): Promise<RespuestaJson<T>> {
  const { respuesta, texto } = await solicitar('GET', ruta, undefined, estadosAceptados);
  return { estado: respuesta.status, datos: validarCuerpo(texto, esquema) };
}

/**
 * Envía `cuerpo` como JSON con `metodo` (las cookies del mismo dominio viajan solas) y valida la respuesta con
 * `esquema`. Los errores son los mismos que los de `pedirJson`.
 */
export async function enviarJson<T>(
  metodo: MetodoConCuerpo,
  ruta: string,
  cuerpo: unknown,
  esquema: ZodType<T>,
  estadosAceptados: readonly number[] = [200, 201],
): Promise<RespuestaJson<T>> {
  const { respuesta, texto } = await solicitar(metodo, ruta, cuerpo, estadosAceptados);
  return { estado: respuesta.status, datos: validarCuerpo(texto, esquema) };
}

/** Envía una petición cuya respuesta correcta no tiene cuerpo (204), por ejemplo `DELETE`. */
export async function enviarSinRespuesta(metodo: MetodoConCuerpo, ruta: string, cuerpo?: unknown): Promise<void> {
  await solicitar(metodo, ruta, cuerpo, [200, 204]);
}
