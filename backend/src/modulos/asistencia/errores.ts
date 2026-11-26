import { type CodigoRechazoAsistencia, type RechazoAsistencia } from '@aquagestion/contratos';
import { ErrorNegocio } from '../../comun/errores';

/**
 * El 404 de un QR que no es de un alumno de la academia (spec 009a, criterio 3): el mismo para un texto vacío, sin el prefijo, de otra
 * academia, ya regenerado o inventado. El mensaje y el cuerpo no repiten el contenido recibido ni llevan `detalles`.
 */
export function qrNoReconocido(): ErrorNegocio {
  return new ErrorNegocio(404, 'QR_NO_RECONOCIDO', 'El QR no corresponde a ningún alumno de esta academia');
}

/** 409: la clave de idempotencia ya registró una asistencia de otro alumno (criterio 13). Sin datos de la asistencia ajena. */
export function claveYaUsada(): ErrorNegocio {
  return new ErrorNegocio(409, 'CLAVE_YA_USADA', 'La clave de este intento ya se usó en otro registro.');
}

const MENSAJES_DE_RECHAZO: Readonly<Record<CodigoRechazoAsistencia, string>> = {
  ALUMNO_INACTIVO: 'El alumno está inactivo.',
  ASISTENCIA_YA_REGISTRADA: 'El alumno ya registró su asistencia de hoy.',
  PAGO_EN_VERIFICACION: 'El pago de su mensualidad está en verificación.',
  MENSUALIDAD_NO_VIGENTE: 'El alumno no tiene una mensualidad vigente.',
  SIN_CLASES_RESTANTES: 'El alumno no tiene clases restantes en su mensualidad.',
  FUERA_DE_HORARIO: 'El alumno está fuera del horario de su clase.',
  CLASE_NO_INCLUIDA: 'La clase de hoy no está incluida en la mensualidad del alumno.',
  FECHA_NO_PERMITIDA: 'La fecha debe ser de este mes y no puede ser posterior a hoy.',
  CLASE_NO_TERMINADA: 'La clase todavía no terminó.',
  HORA_FUERA_DE_LA_CLASE: 'La hora de llegada no está dentro de la clase.',
};

/** Un rechazo de negocio del marcado (criterio 7): 409 con el código y los `detalles` de `rechazoAsistenciaSchema`. */
export function rechazoDeAsistencia(codigo: CodigoRechazoAsistencia, detalles?: RechazoAsistencia): ErrorNegocio {
  return new ErrorNegocio(409, codigo, MENSAJES_DE_RECHAZO[codigo], detalles);
}
