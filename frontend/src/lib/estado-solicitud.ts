import type { EstadoSolicitud } from '@aquagestion/contratos';

/** El estado visible de una solicitud en palabras y el color de su insignia: lo comparten el seguimiento público y el panel de solicitudes. */
export const ESTADO_EN_PALABRAS: Readonly<Record<EstadoSolicitud, { titulo: string; color: 'ambar' | 'gris' }>> = {
  PENDIENTE_PAGO: { titulo: 'Pendiente de pago', color: 'ambar' },
  VENCIDA: { titulo: 'Vencida', color: 'gris' },
  CANCELADA: { titulo: 'Cancelada', color: 'gris' },
  // Los estados de la 007 (pagos); la web de la 007a los pinta mejor en sus tareas del frontend.
  CONFIRMADA: { titulo: 'Pago confirmado', color: 'gris' },
  EN_VERIFICACION: { titulo: 'Comprobante en revisión', color: 'ambar' },
  PAGO_RECHAZADO: { titulo: 'Pago rechazado', color: 'ambar' },
};
