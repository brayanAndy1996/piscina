import { respuestaTicketSchema } from '@aquagestion/contratos';
import { pedirJson } from '../../api/cliente';

/** Llamadas de los pagos. La academia sale de la sesión: ninguna ruta la lleva (criterio 9 de 007). */

/** Los datos del ticket interno de un pago confirmado (criterio 26). No genera archivos: la página los imprime. */
export async function obtenerTicket(pagoId: string) {
  return (await pedirJson(`/api/pagos/${encodeURIComponent(pagoId)}/ticket`, respuestaTicketSchema)).datos.ticket;
}
