import type { EstadoSolicitud } from '@aquagestion/contratos';

/** El estado visible de una solicitud en palabras y el color de su insignia: lo comparten el seguimiento público y el panel de solicitudes. */
export const ESTADO_EN_PALABRAS: Readonly<Record<EstadoSolicitud, { titulo: string; color: 'ambar' | 'gris' }>> = {
  PENDIENTE_PAGO: { titulo: 'Pendiente de pago', color: 'ambar' },
  VENCIDA: { titulo: 'Vencida', color: 'gris' },
  CANCELADA: { titulo: 'Cancelada', color: 'gris' },
};
