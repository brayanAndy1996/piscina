import {
  type RechazarPago,
  respuestaPagoSchema,
  respuestaPagosPendientesSchema,
  respuestaTicketSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirArchivo, pedirJson } from '../../api/cliente';

/** Llamadas de los pagos. La academia sale de la sesión: ninguna ruta la lleva (criterio 9 de 007). */

/** Los datos del ticket interno de un pago confirmado (criterio 26). No genera archivos: la página los imprime. */
export async function obtenerTicket(pagoId: string) {
  return (await pedirJson(`/api/pagos/${encodeURIComponent(pagoId)}/ticket`, respuestaTicketSchema)).datos.ticket;
}

/** La bandeja de verificación (criterio 45 de 007b): los pagos `PENDIENTE_VERIFICACION`, del más antiguo al más nuevo. */
export async function listarPagosPendientes() {
  return (await pedirJson('/api/pagos/pendientes', respuestaPagosPendientesSchema)).datos.pagos;
}

/** La imagen del comprobante (criterio 46 de 007b), pedida con la sesión: nunca es una dirección que se pueda abrir sin ella. */
export async function pedirComprobante(pagoId: string, senal?: AbortSignal): Promise<Blob> {
  return pedirArchivo(`/api/pagos/${encodeURIComponent(pagoId)}/comprobante`, 'image/jpeg', senal);
}

/** Aprueba un pago (criterio 47): 200 con el pago confirmado; 200 también si ya lo estaba (criterio 48). El cuerpo es `{}`. */
export async function aprobarPago(pagoId: string) {
  const ruta = `/api/pagos/${encodeURIComponent(pagoId)}/aprobacion`;
  return (await enviarJson('POST', ruta, {}, respuestaPagoSchema, [200])).datos.pago;
}

/** Rechaza un pago con un motivo que verá la persona (criterio 49): 200 con el pago rechazado; 200 también si ya lo estaba. */
export async function rechazarPago({ id, datos }: { id: string; datos: RechazarPago }) {
  const ruta = `/api/pagos/${encodeURIComponent(id)}/rechazo`;
  return (await enviarJson('POST', ruta, datos, respuestaPagoSchema, [200])).datos.pago;
}
