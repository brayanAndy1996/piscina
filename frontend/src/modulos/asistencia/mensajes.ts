import {
  CODIGOS_RECHAZO_ASISTENCIA,
  type CodigoRechazoAsistencia,
  type EstadoLlegada,
  type MetodoAsistencia,
  type RechazoAsistencia,
} from '@aquagestion/contratos';
import { ErrorDeApi, esErrorDeApi } from '../../api/cliente';
import { mensajeGeneral } from '../../lib/errores';
import { esErrorDeCambioDeSesion } from '../sesion/hooks';

/** Textos de la pantalla de asistencia (spec 009a, criterios 7 y 19). Todo en español y sin códigos. */

export const ETIQUETA_ESTADO_LLEGADA: Readonly<Record<EstadoLlegada, string>> = {
  PUNTUAL: 'Puntual',
  TARDE: 'Tarde',
};

export const ETIQUETA_METODO: Readonly<Record<MetodoAsistencia, string>> = {
  QR: 'con el QR',
  MANUAL: 'de forma manual',
};

/** El motivo de cada rechazo (criterio 7): lo que lee la persona de recepción debajo de «No puede ingresar» o en el aviso amarillo. */
export const MOTIVO_DE_RECHAZO: Readonly<Record<CodigoRechazoAsistencia, string>> = {
  ALUMNO_INACTIVO: 'El alumno está inactivo.',
  PAGO_EN_VERIFICACION: 'El pago de su mensualidad está en verificación.',
  MENSUALIDAD_NO_VIGENTE: 'No tiene una mensualidad vigente.',
  SIN_CLASES_RESTANTES: 'No le quedan clases en su mensualidad.',
  FUERA_DE_HORARIO: 'Está fuera del horario de su clase.',
  CLASE_NO_INCLUIDA: 'La clase de hoy no está incluida en su mensualidad.',
  ASISTENCIA_YA_REGISTRADA: 'Ya registró su asistencia de hoy.',
  // Los tres del registro posterior (009b, criterio 28): los usa el diálogo de la sección «Asistencia» del alumno.
  FECHA_NO_PERMITIDA: 'La fecha debe ser de este mes y no puede ser posterior a hoy.',
  CLASE_NO_TERMINADA: 'La clase todavía no terminó: durante la clase se marca con el QR o de forma manual.',
  HORA_FUERA_DE_LA_CLASE: 'La hora de llegada debe estar dentro de la clase.',
};

/**
 * El detalle de un rechazo amarillo: la clase de hoy o la asistencia ya registrada. `horaLocal` es la hora de Lima del equipo, solo para decir si
 * la clase todavía no empezó o ya terminó; quien decide si puede marcar es siempre la API.
 */
export function detalleDeRechazo(
  codigo: CodigoRechazoAsistencia,
  rechazo: RechazoAsistencia,
  horaLocal: string,
): string | null {
  if (codigo === 'ASISTENCIA_YA_REGISTRADA') {
    const previa = rechazo.asistenciaDeHoy;
    return previa
      ? `Marcó a las ${previa.horaLlegada} (${ETIQUETA_ESTADO_LLEGADA[previa.estadoLlegada]}, ${ETIQUETA_METODO[previa.metodo]}).`
      : null;
  }
  if (codigo === 'FUERA_DE_HORARIO' || codigo === 'CLASE_NO_INCLUIDA') {
    const clase = rechazo.claseDeHoy;
    if (!clase) return 'Hoy no tiene clase.';
    if (codigo === 'CLASE_NO_INCLUIDA') return `Su clase de hoy es de ${clase.horaInicio} a ${clase.horaFin}.`;
    if (horaLocal < clase.horaInicio) return `Su clase empieza a las ${clase.horaInicio}.`;
    if (horaLocal >= clase.horaFin) return `Su clase de hoy fue de ${clase.horaInicio} a ${clase.horaFin}.`;
    return `Su clase de hoy es de ${clase.horaInicio} a ${clase.horaFin}.`;
  }
  return null;
}

export function mensajeDeMarcado(error: unknown): string {
  if (esErrorDeApi(error, 404, 'QR_NO_RECONOCIDO')) return 'El QR no corresponde a ningún alumno de esta academia.';
  if (esErrorDeApi(error, 404)) return 'No encontramos a este alumno. Puede que ya no esté en tu academia.';
  if (esErrorDeApi(error, 403, 'SIN_PERMISO')) return 'No tienes permiso para registrar asistencias.';
  return mensajeGeneral(error);
}

/** Un fallo al que sirve volver a pedir con la misma clave: la red o el servidor, no una respuesta de la API (4xx) que no va a cambiar. */
export function esMarcadoReintentable(error: unknown): boolean {
  if (esErrorDeCambioDeSesion(error)) return false;
  return !(error instanceof ErrorDeApi && error.estado < 500);
}

/** Los textos de la consulta del mes de un alumno (009b, criterio 31). */
export function mensajeDeAsistenciaDelMes(error: unknown): string {
  if (esErrorDeApi(error, 404)) return 'No encontramos a este alumno. Puede que ya no esté en tu academia.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para ver la asistencia de este alumno.';
  return mensajeGeneral(error);
}

export const ETIQUETA_REGISTRO = {
  PUNTUAL: 'Puntual',
  TARDE: 'Tarde',
  FALTA: 'Falta',
} as const;

/**
 * El motivo de un rechazo del registro posterior (009b, criterio 28). Los que en la pantalla de recepción hablan de «hoy» se dicen aquí del día
 * elegido; el resto son los de `MOTIVO_DE_RECHAZO`.
 */
const MOTIVO_DE_RECHAZO_POSTERIOR: Readonly<Partial<Record<CodigoRechazoAsistencia, string>>> = {
  ASISTENCIA_YA_REGISTRADA: 'El alumno ya tiene su asistencia registrada ese día.',
  MENSUALIDAD_NO_VIGENTE: 'El alumno no tenía una mensualidad vigente ese día.',
  FUERA_DE_HORARIO: 'El alumno no tiene clase ese día.',
  CLASE_NO_INCLUIDA: 'La clase de ese día no está incluida en su mensualidad.',
};

/** El campo del diálogo al que pertenece un rechazo: la fecha, la hora o ninguno (se muestra arriba, para todo el diálogo). */
export function campoDeRechazoPosterior(codigo: CodigoRechazoAsistencia): 'fecha' | 'horaLlegada' | null {
  if (codigo === 'FECHA_NO_PERMITIDA' || codigo === 'FUERA_DE_HORARIO' || codigo === 'CLASE_NO_TERMINADA')
    return 'fecha';
  if (codigo === 'HORA_FUERA_DE_LA_CLASE') return 'horaLlegada';
  return null;
}

/** El código de un 409 del registro posterior, o `null` si el error es otro (la red, un 403, un 404…). */
export function codigoDeRechazoPosterior(error: unknown): CodigoRechazoAsistencia | null {
  if (!(error instanceof ErrorDeApi) || error.estado !== 409) return null;
  return Object.hasOwn(CODIGOS_RECHAZO_ASISTENCIA, error.codigo) ? (error.codigo as CodigoRechazoAsistencia) : null;
}

export function mensajeDeRegistroPosterior(error: unknown): string {
  const codigo = codigoDeRechazoPosterior(error);
  if (codigo) return MOTIVO_DE_RECHAZO_POSTERIOR[codigo] ?? MOTIVO_DE_RECHAZO[codigo];
  if (esErrorDeApi(error, 404)) return 'No encontramos a este alumno. Puede que ya no esté en tu academia.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para registrar asistencias.';
  return mensajeGeneral(error);
}
