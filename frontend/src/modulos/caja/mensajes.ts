import { esErrorDeApi } from '../../api/cliente';
import { formatearSoles } from '../../lib/dinero';
import { formatearFechaCalendario } from '../../lib/fechas';
import { DescargaCanceladaError } from '../../lib/descargas-en-curso';
import { mensajeGeneral } from '../../lib/errores';
import { esErrorDeCambioDeSesion } from '../sesion/hooks';
import { z } from 'zod';

/** Lo que se dice ante cada error de la caja (criterios 13 a 15, 19 a 22, 31, 34 y 36 de 006). Los textos van en español y sin códigos. */

const MENSAJE_CAJA_CAMBIO = 'Entró un movimiento nuevo: revisa el conteo.';

const detallesSchema = z.looseObject({
  fecha: z.string().optional(),
  disponible: z.string().optional(),
});

function detallesDe(error: unknown): { fecha?: string | undefined; disponible?: string | undefined } {
  if (!esErrorDeApi(error, 409)) return {};
  const detalles = detallesSchema.safeParse(error.detalles);
  return detalles.success ? detalles.data : {};
}

/** Los códigos 409 y 404 que dicen que la caja ya no está como se veía: la pantalla se actualiza y el diálogo se cierra. */
const CODIGOS_QUE_CAMBIAN_LA_CAJA = [
  'CLAVE_YA_USADA',
  'CAJA_YA_ABIERTA',
  'CAJA_PENDIENTE_DE_CIERRE',
  'CAJA_DEL_DIA_CERRADA',
  'CAJA_CERRADA',
  'CAJA_DE_OTRO_DIA',
  'HAY_OTRA_CAJA_ABIERTA',
] as const;

/**
 * Un error que ya no tiene salida desde el mismo diálogo: la caja cambió por otro lado (la cerró otra persona, pasó la medianoche, ya
 * estaba abierta) o ya no existe. La página vuelve a pedir la caja y muestra el mensaje; el diálogo se cierra.
 */
export function esErrorQueCambiaLaCaja(error: unknown): boolean {
  return esErrorDeApi(error, 404) || CODIGOS_QUE_CAMBIAN_LA_CAJA.some((codigo) => esErrorDeApi(error, 409, codigo));
}

export function mensajeDeCaja(error: unknown): string {
  const { fecha, disponible } = detallesDe(error);
  const dia = fecha ? formatearFechaCalendario(fecha) : null;
  if (esErrorDeApi(error, 409, 'CAJA_CAMBIO')) return MENSAJE_CAJA_CAMBIO;
  if (esErrorDeApi(error, 409, 'EFECTIVO_INSUFICIENTE')) {
    return disponible
      ? `No hay tanto efectivo en la caja: solo hay ${formatearSoles(disponible)}.`
      : 'No hay tanto efectivo en la caja.';
  }
  if (esErrorDeApi(error, 409, 'CLAVE_YA_USADA')) {
    return 'Ese envío ya se había registrado con otros datos. Actualizamos la caja: revisa cómo quedó.';
  }
  if (esErrorDeApi(error, 409, 'CAJA_YA_ABIERTA')) {
    return 'Ya hay una caja abierta. Actualizamos la pantalla.';
  }
  if (esErrorDeApi(error, 409, 'CAJA_PENDIENTE_DE_CIERRE')) {
    return dia
      ? `La caja del ${dia} sigue abierta. Ciérrala antes de abrir la de hoy.`
      : 'Hay una caja de otro día sin cerrar. Ciérrala antes de abrir la de hoy.';
  }
  if (esErrorDeApi(error, 409, 'CAJA_DEL_DIA_CERRADA')) {
    return 'La caja de hoy ya se cerró. Pide al administrador que la reabra para seguir cobrando.';
  }
  if (esErrorDeApi(error, 409, 'CAJA_CERRADA')) {
    return 'La caja ya está cerrada y no admite movimientos. Pide al administrador que la reabra.';
  }
  if (esErrorDeApi(error, 409, 'CAJA_DE_OTRO_DIA')) {
    return dia
      ? `La caja del ${dia} ya no admite egresos: solo se puede cerrar.`
      : 'Esa caja es de otro día y ya no admite egresos: solo se puede cerrar.';
  }
  if (esErrorDeApi(error, 409, 'HAY_OTRA_CAJA_ABIERTA')) {
    return dia
      ? `Hay otra caja abierta, la del ${dia}. Ciérrala antes de reabrir esta.`
      : 'Hay otra caja abierta. Ciérrala antes de reabrir esta.';
  }
  if (esErrorDeApi(error, 404)) return 'La caja ya no existe o no es de tu academia. Actualizamos la pantalla.';
  if (esErrorDeApi(error, 403, 'SIN_PERMISO')) return 'No tienes permiso para esta acción.';
  return mensajeGeneral(error);
}

export const MENSAJE_PDF_NO_ENCONTRADO = 'No se encontró el cierre';
export const MENSAJE_PDF_FALLIDO = 'No se pudo generar el PDF. Inténtalo de nuevo.';

/**
 * Lo que se dice cuando falla la descarga del PDF de un cierre (criterio 44, PQ12): un mensaje fijo para cada caso. Con 401 o con un cambio
 * de sesión no se dice nada aquí: la web ya lleva a la página que corresponde.
 */
export function mensajeDeDescargaDelPdf(error: unknown): string | null {
  if (
    error instanceof DescargaCanceladaError ||
    esErrorDeApi(error, 401) ||
    esErrorDeApi(error, 403, 'ACADEMIA_SUSPENDIDA') ||
    esErrorDeApi(error, 403, 'CAMBIO_DE_CLAVE_OBLIGATORIO') ||
    esErrorDeCambioDeSesion(error)
  ) {
    return null;
  }
  if (esErrorDeApi(error, 404)) return MENSAJE_PDF_NO_ENCONTRADO;
  return MENSAJE_PDF_FALLIDO;
}
