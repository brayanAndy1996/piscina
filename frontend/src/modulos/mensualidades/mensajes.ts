import { z } from 'zod';
import { esErrorDeApi } from '../../api/cliente';
import { formatearSoles } from '../../lib/dinero';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario, formatearMes } from '../../lib/fechas';
import { detallesDeError, esErrorDeCajaAlCobrar } from '../solicitudes/mensajes';

/** Lo que se dice ante cada error de la renovación (criterios 3, 4, 6, 7, 8 y 12 de 010). Textos en español y sin códigos. */

const detallesSchema = z.looseObject({
  mesesPermitidos: z.array(z.string()).optional(),
  claseIds: z.array(z.string()).optional(),
});

function detallesDelRegistro(error: unknown): z.infer<typeof detallesSchema> {
  if (!esErrorDeApi(error, 409)) return {};
  const detalles = detallesSchema.safeParse(error.detalles);
  return detalles.success ? detalles.data : {};
}

/** Las clases sin lugar que trae un 409 `SIN_CUPO` (criterio 8), o una lista vacía. */
export function clasesSinCupo(error: unknown): string[] {
  return esErrorDeApi(error, 409, 'SIN_CUPO') ? (detallesDelRegistro(error).claseIds ?? []) : [];
}

/** El total nuevo de un 409 `MONTO_CAMBIO` (efectivo) o `MONTO_DISTINTO` (comprobante), o `null` si el error es otro. */
export function totalDeLaRenovacion(error: unknown): string | null {
  if (!esErrorDeApi(error, 409, 'MONTO_CAMBIO') && !esErrorDeApi(error, 409, 'MONTO_DISTINTO')) return null;
  return detallesDeError(error).total ?? null;
}

export { esErrorDeCajaAlCobrar as esErrorDeCajaAlRenovar };

/** Un `MONTO_CAMBIO` o `MONTO_DISTINTO`: se muestra aparte, con el total nuevo, para que quien cobra lo lea antes de volver a confirmar. */
export function esCambioDeMonto(error: unknown): boolean {
  return esErrorDeApi(error, 409, 'MONTO_CAMBIO') || esErrorDeApi(error, 409, 'MONTO_DISTINTO');
}

/** Los errores que se muestran dentro de un campo del formulario del comprobante y no aparte. */
export function esErrorDeCampoDelComprobante(error: unknown): boolean {
  return esErrorDeApi(error, 409, 'NUMERO_OPERACION_YA_USADO') || esErrorDeApi(error, 409, 'FECHA_OPERACION_NO_VALIDA');
}

export function mensajeDeRenovacion(error: unknown): string {
  if (esErrorDeApi(error, 409, 'SIN_CAJA_ABIERTA')) return 'Abre la caja antes de cobrar.';
  if (esErrorDeApi(error, 409, 'CAJA_DE_OTRO_DIA')) {
    const { fecha } = detallesDeError(error);
    return fecha
      ? `La caja abierta es del ${formatearFechaCalendario(fecha)}. Ciérrala y abre la de hoy antes de cobrar.`
      : 'La caja abierta es de otro día. Ciérrala y abre la de hoy antes de cobrar.';
  }
  if (esCambioDeMonto(error)) {
    const total = totalDeLaRenovacion(error);
    return total
      ? `El monto cambió desde que lo viste: ahora es ${formatearSoles(total)}. Revísalo y vuelve a confirmar.`
      : 'El monto cambió desde que lo viste. Revísalo y vuelve a confirmar.';
  }
  if (esErrorDeApi(error, 409, 'SIN_CUPO')) {
    return 'Alguna de las clases elegidas se llenó mientras elegías. Quitamos esas clases: elige otra opción.';
  }
  if (esErrorDeApi(error, 409, 'MENSUALIDAD_YA_REGISTRADA')) {
    return 'El alumno ya tiene la mensualidad de ese mes, pagada o por verificar. Actualizamos la sección.';
  }
  if (esErrorDeApi(error, 409, 'CLAVE_YA_USADA')) {
    return 'Ese cobro ya se había registrado con otros datos. Cierra este diálogo y revisa cómo quedó la mensualidad.';
  }
  if (esErrorDeApi(error, 409, 'MES_NO_PERMITIDO')) {
    const meses = detallesDelRegistro(error).mesesPermitidos ?? [];
    return meses.length > 0
      ? `Ese mes no se puede renovar ahora. Se puede renovar: ${meses.map(formatearMes).join(' o ')}.`
      : 'Ese mes no se puede renovar ahora.';
  }
  if (esErrorDeApi(error, 409, 'ALUMNO_INACTIVO')) return 'El alumno está inactivo y no puede renovar.';
  if (esErrorDeApi(error, 409, 'PLAN_NO_DISPONIBLE')) {
    return 'Ese plan ya no está disponible para este alumno en ese mes. Actualizamos la oferta: elige otro.';
  }
  if (esErrorDeApi(error, 409, 'SELECCION_NO_VALIDA')) {
    return 'Las clases elegidas no sirven para este plan y nivel. Revisa que sean una por día y de los horarios del plan.';
  }
  if (esErrorDeApi(error, 409, 'SIN_CLASES_EN_EL_MES')) {
    return 'Ya no quedan clases este mes con las clases elegidas. Elige otras o renueva el mes siguiente cuando se abra.';
  }
  if (esErrorDeApi(error, 409, 'NUMERO_OPERACION_YA_USADO')) {
    return 'Ese número de operación ya se registró. Revisa el número del comprobante.';
  }
  if (esErrorDeApi(error, 409, 'FECHA_OPERACION_NO_VALIDA')) {
    return 'La fecha de la operación no puede ser posterior a hoy ni anterior al inicio de la renovación.';
  }
  if (esErrorDeApi(error, 400, 'IMAGEN_NO_VALIDA')) {
    return 'No pudimos usar esa imagen. Elige una foto o captura JPG o PNG del comprobante, de entre 100 y 8000 píxeles por lado.';
  }
  if (esErrorDeApi(error, 413)) return 'La imagen pesa más de 5 MB. Elige una más liviana.';
  if (esErrorDeApi(error, 404)) return 'El alumno ya no existe o no es de tu academia. Actualizamos la página.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para registrar renovaciones.';
  return mensajeGeneral(error);
}

/** Un registro al que no tiene sentido volver a pedir desde el mismo diálogo: lo que se veía ya no es lo que hay. */
export function esRenovacionSinSalida(error: unknown): boolean {
  return (
    esErrorDeApi(error, 404) ||
    esErrorDeApi(error, 403) ||
    ['MENSUALIDAD_YA_REGISTRADA', 'CLAVE_YA_USADA', 'ALUMNO_INACTIVO'].some((codigo) =>
      esErrorDeApi(error, 409, codigo),
    )
  );
}

/** Lo que se dice si la oferta o la cotización no cargaron. */
export function mensajeDeOferta(error: unknown): string {
  if (esErrorDeApi(error, 404)) return 'El alumno ya no existe o no es de tu academia.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para ver la mensualidad.';
  return `No pudimos cargar la mensualidad. ${mensajeGeneral(error)}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 010c · Cambio de horario
// ---------------------------------------------------------------------------------------------------------------------------------

/** Lo que se dice ante cada error del cambio de horario (criterios 35, 36 y 41 de 010). */
export function mensajeDeCambioDeHorario(error: unknown): string {
  if (esErrorDeApi(error, 409, 'MATRICULA_NO_MODIFICABLE')) {
    return 'Esta mensualidad ya no se puede cambiar: terminó, se canceló o no es del mes en curso ni del siguiente. Actualizamos la sección.';
  }
  if (esErrorDeApi(error, 409, 'SIN_CUPO')) {
    return 'Alguna de las clases elegidas se llenó mientras elegías. Las marcamos «Sin cupo» y las quitamos de lo elegido: elige otra opción.';
  }
  if (esErrorDeApi(error, 409, 'SELECCION_NO_VALIDA')) {
    return 'Las clases elegidas no sirven para este plan y nivel. Revisa que sean una por día y de los horarios del plan.';
  }
  if (esErrorDeApi(error, 409, 'PLAN_NO_DISPONIBLE')) {
    return 'El plan de esta mensualidad ya no está disponible, así que no se puede cambiar el horario.';
  }
  if (esErrorDeApi(error, 404)) return 'La mensualidad ya no existe o no es de tu academia. Actualizamos la sección.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para cambiar el horario de un alumno.';
  return mensajeGeneral(error);
}

/** Un cambio al que no tiene sentido volver a enviar desde el mismo diálogo: lo que se veía ya no es lo que hay. */
export function esCambioDeHorarioSinSalida(error: unknown): boolean {
  return (
    esErrorDeApi(error, 404) ||
    esErrorDeApi(error, 403) ||
    esErrorDeApi(error, 409, 'MATRICULA_NO_MODIFICABLE') ||
    esErrorDeApi(error, 409, 'PLAN_NO_DISPONIBLE')
  );
}

/** Lo que se dice si la lectura del horario no cargó. */
export function mensajeDeHorario(error: unknown): string {
  if (esErrorDeApi(error, 404)) return 'El alumno ya no existe o no es de tu academia.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para cambiar el horario de un alumno.';
  return `No pudimos cargar el horario. ${mensajeGeneral(error)}`;
}
