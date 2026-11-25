import { z } from 'zod';
import { esErrorDeApi } from '../../api/cliente';
import { formatearSoles } from '../../lib/dinero';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario } from '../../lib/fechas';

/** Lo que se dice ante una cancelación que no se pudo hacer (criterio 46 de 005). */
export function mensajeDeCancelacion(error: unknown): string {
  if (esErrorDeApi(error, 409, 'SOLICITUD_NO_CANCELABLE')) {
    return 'Esta solicitud ya no se puede cancelar: ya no está esperando el pago. Actualizamos la lista.';
  }
  if (esErrorDeApi(error, 404)) return 'La solicitud ya no existe o no es de tu academia. Actualizamos la lista.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para cancelar solicitudes.';
  return mensajeGeneral(error);
}

/** Una cancelación a la que no tiene sentido volver a pedir: la solicitud ya no se puede cancelar o no existe. */
export function esCancelacionSinSalida(error: unknown): boolean {
  return esErrorDeApi(error, 409, 'SOLICITUD_NO_CANCELABLE') || esErrorDeApi(error, 404);
}

const detallesDelCobroSchema = z.looseObject({
  total: z.string().optional(),
  fecha: z.string().optional(),
  estado: z.string().optional(),
});

function detallesDe(error: unknown): z.infer<typeof detallesDelCobroSchema> {
  if (!esErrorDeApi(error, 409)) return {};
  const detalles = detallesDelCobroSchema.safeParse(error.detalles);
  return detalles.success ? detalles.data : {};
}

/** El total nuevo que trae un 409 `MONTO_CAMBIO` (criterio 16), o `null` si el error es otro. */
export function totalDelCambioDeMonto(error: unknown): string | null {
  if (!esErrorDeApi(error, 409, 'MONTO_CAMBIO')) return null;
  return detallesDe(error).total ?? null;
}

/** Los 409 que dicen que la caja no está lista: el cobro se puede reintentar cuando quien cobra la abra. */
export function esErrorDeCajaAlCobrar(error: unknown): boolean {
  return esErrorDeApi(error, 409, 'SIN_CAJA_ABIERTA') || esErrorDeApi(error, 409, 'CAJA_DE_OTRO_DIA');
}

/**
 * Lo que se dice ante cada error del cobro en efectivo (criterios 14 a 18, 20 y 22 de 007). Los textos van en español y sin códigos. Un
 * `MONTO_CAMBIO` no se explica aquí con el total: el diálogo lo muestra aparte, para que quien cobra lo vea antes de volver a confirmar.
 */
export function mensajeDeCobro(error: unknown): string {
  const { total, fecha } = detallesDe(error);
  if (esErrorDeApi(error, 409, 'SIN_CAJA_ABIERTA')) return 'Abre la caja antes de cobrar.';
  if (esErrorDeApi(error, 409, 'CAJA_DE_OTRO_DIA')) {
    return fecha
      ? `La caja abierta es del ${formatearFechaCalendario(fecha)}. Ciérrala y abre la de hoy antes de cobrar.`
      : 'La caja abierta es de otro día. Ciérrala y abre la de hoy antes de cobrar.';
  }
  if (esErrorDeApi(error, 409, 'MONTO_CAMBIO')) {
    return total
      ? `El monto cambió desde que lo viste: ahora es ${formatearSoles(total)}. Revísalo y vuelve a cobrar.`
      : 'El monto cambió desde que lo viste. Revísalo y vuelve a cobrar.';
  }
  if (esErrorDeApi(error, 409, 'SOLICITUD_NO_COBRABLE')) {
    return 'Esta solicitud ya no se puede cobrar: venció o se canceló. La persona debe volver a inscribirse. Actualizamos la lista.';
  }
  if (esErrorDeApi(error, 409, 'SOLICITUD_YA_PAGADA')) {
    return 'Esta solicitud ya está pagada. Actualizamos la lista.';
  }
  if (esErrorDeApi(error, 409, 'PAGO_EN_VERIFICACION')) {
    return 'Hay un comprobante en revisión: apruébalo o recházalo antes de cobrar. Actualizamos la lista.';
  }
  if (esErrorDeApi(error, 409, 'SIN_CUPO')) {
    return 'Ya no hay cupo en alguna de las clases de esta solicitud. Actualizamos la lista.';
  }
  if (esErrorDeApi(error, 409, 'DNI_DEL_PERSONAL')) {
    return 'Ya existe un usuario de la academia con el DNI de esta persona. Consulta con el administrador antes de cobrar.';
  }
  if (esErrorDeApi(error, 409, 'CLAVE_YA_USADA')) {
    return 'Ese cobro ya se había registrado con otros datos. Actualizamos la lista: revisa cómo quedó.';
  }
  if (esErrorDeApi(error, 404)) return 'La solicitud ya no existe o no es de tu academia. Actualizamos la lista.';
  if (esErrorDeApi(error, 403)) return 'No tienes permiso para cobrar.';
  return mensajeGeneral(error);
}

/** Un cobro al que no tiene sentido volver a pedir desde el mismo diálogo: la solicitud ya no es cobrable o no existe. */
export function esCobroSinSalida(error: unknown): boolean {
  return (
    esErrorDeApi(error, 404) ||
    esErrorDeApi(error, 403) ||
    [
      'SOLICITUD_NO_COBRABLE',
      'SOLICITUD_YA_PAGADA',
      'PAGO_EN_VERIFICACION',
      'SIN_CUPO',
      'DNI_DEL_PERSONAL',
      'CLAVE_YA_USADA',
    ].some((codigo) => esErrorDeApi(error, 409, codigo))
  );
}

/** Lo que se dice ante un ajuste de monto que no se pudo hacer (criterio 11 de 007). */
export function mensajeDeAjuste(error: unknown): string {
  if (esErrorDeApi(error, 409, 'SOLICITUD_NO_AJUSTABLE')) {
    return 'El monto de esta solicitud ya no se puede ajustar: ya no está esperando el pago. Actualizamos la lista.';
  }
  if (esErrorDeApi(error, 404)) return 'La solicitud ya no existe o no es de tu academia. Actualizamos la lista.';
  if (esErrorDeApi(error, 403)) return 'Solo el administrador puede ajustar el monto.';
  return mensajeGeneral(error);
}

/** Un ajuste al que no tiene sentido volver a pedir: la solicitud ya no es ajustable o no existe. */
export function esAjusteSinSalida(error: unknown): boolean {
  return esErrorDeApi(error, 409, 'SOLICITUD_NO_AJUSTABLE') || esErrorDeApi(error, 404) || esErrorDeApi(error, 403);
}
