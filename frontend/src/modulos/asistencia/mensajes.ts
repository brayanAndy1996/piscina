import type {
  CodigoRechazoAsistencia,
  EstadoLlegada,
  MetodoAsistencia,
  RechazoAsistencia,
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
