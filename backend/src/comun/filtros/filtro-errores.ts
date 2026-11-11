import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorApi } from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { ErrorNegocio } from '../errores';
import { detallesDeZod, MENSAJE_SOLICITUD_INVALIDA } from '../validacion';

const PRIMER_ESTADO_DE_SERVIDOR = 500;
const MENSAJE_ERROR_INTERNO = 'Ocurrió un error inesperado. Intenta de nuevo más tarde.';

/** Respuesta 404 de la API; también la usa el manejador de rutas que Nest no atiende (fuera de `/api`). */
export const ERROR_NO_ENCONTRADO: ErrorApi = {
  codigo: 'NO_ENCONTRADO',
  mensaje: 'No se encontró el recurso solicitado.',
};

/** Código y mensaje (en español, para mostrar al usuario) de los estados HTTP conocidos. */
const ERRORES_POR_ESTADO: Readonly<Record<number, ErrorApi>> = {
  [HttpStatus.BAD_REQUEST]: { codigo: 'SOLICITUD_INVALIDA', mensaje: 'La solicitud no es válida.' },
  [HttpStatus.UNAUTHORIZED]: { codigo: 'NO_AUTENTICADO', mensaje: 'Debes iniciar sesión para continuar.' },
  [HttpStatus.FORBIDDEN]: { codigo: 'PROHIBIDO', mensaje: 'No tienes permiso para realizar esta acción.' },
  [HttpStatus.NOT_FOUND]: ERROR_NO_ENCONTRADO,
  [HttpStatus.CONFLICT]: { codigo: 'CONFLICTO', mensaje: 'La solicitud entra en conflicto con el estado actual.' },
  [HttpStatus.PAYLOAD_TOO_LARGE]: { codigo: 'CARGA_EXCESIVA', mensaje: 'El contenido enviado es demasiado grande.' },
  [HttpStatus.UNPROCESSABLE_ENTITY]: { codigo: 'ENTIDAD_NO_PROCESABLE', mensaje: 'No se pudo procesar la solicitud.' },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    codigo: 'DEMASIADAS_SOLICITUDES',
    mensaje: 'Hiciste demasiadas solicitudes. Espera un momento e intenta de nuevo.',
  },
};

const ERROR_GENERICO_CLIENTE: ErrorApi = { codigo: 'SOLICITUD_INVALIDA', mensaje: 'La solicitud no es válida.' };
const ERROR_INTERNO: ErrorApi = { codigo: 'ERROR_INTERNO', mensaje: MENSAJE_ERROR_INTERNO };

/**
 * Filtro global: convierte cualquier excepción en el formato `ErrorApi`. Nunca devuelve el mensaje ni la traza
 * originales; los errores del servidor se registran en el log con su traza.
 *
 * - `ErrorNegocio` de 4xx: se responde con su estado, código, mensaje y detalles propios.
 * - `ZodError` (validación): 400 `SOLICITUD_INVALIDA` con `detalles: { errores: [{ campo, mensaje }] }`.
 * - Cualquier 5xx (incluido un `ErrorNegocio` de 5xx): `ERROR_INTERNO` sin detalles, y se registra.
 */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  constructor(private readonly registro: PinoLogger) {}

  catch(excepcion: unknown, host: ArgumentsHost): void {
    const respuesta = host.switchToHttp().getResponse<Response>();
    const { estado, cuerpo } = this.convertir(excepcion);
    respuesta.status(estado).json(cuerpo);
  }

  private convertir(excepcion: unknown): { estado: number; cuerpo: ErrorApi } {
    if (excepcion instanceof ZodError) {
      return {
        estado: HttpStatus.BAD_REQUEST,
        cuerpo: {
          codigo: 'SOLICITUD_INVALIDA',
          mensaje: MENSAJE_SOLICITUD_INVALIDA,
          detalles: detallesDeZod(excepcion),
        },
      };
    }
    if (excepcion instanceof ErrorNegocio && excepcion.estado < PRIMER_ESTADO_DE_SERVIDOR) {
      const cuerpo: ErrorApi = { codigo: excepcion.codigo, mensaje: excepcion.mensaje };
      if (excepcion.detalles !== undefined) cuerpo.detalles = excepcion.detalles;
      return { estado: excepcion.estado, cuerpo };
    }
    if (excepcion instanceof HttpException) {
      const estado = excepcion.getStatus();
      if (estado < PRIMER_ESTADO_DE_SERVIDOR) {
        return { estado, cuerpo: ERRORES_POR_ESTADO[estado] ?? ERROR_GENERICO_CLIENTE };
      }
      this.registro.error({ err: excepcion }, 'Error del servidor');
      return { estado, cuerpo: ERROR_INTERNO };
    }
    this.registro.error({ err: excepcion }, 'Error no controlado');
    return { estado: HttpStatus.INTERNAL_SERVER_ERROR, cuerpo: ERROR_INTERNO };
  }
}
