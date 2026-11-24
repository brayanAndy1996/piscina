import type { EstadoPago, EstadoSolicitud } from '@aquagestion/contratos';

/** El estado visible de una solicitud en palabras y el color de su insignia: lo comparten el seguimiento público y el panel de solicitudes. */
export const ESTADO_EN_PALABRAS: Readonly<
  Record<EstadoSolicitud, { titulo: string; color: 'ambar' | 'gris' | 'verde' | 'azul' }>
> = {
  PENDIENTE_PAGO: { titulo: 'Pendiente de pago', color: 'ambar' },
  VENCIDA: { titulo: 'Vencida', color: 'gris' },
  CANCELADA: { titulo: 'Cancelada', color: 'gris' },
  CONFIRMADA: { titulo: 'Pago confirmado', color: 'verde' },
  EN_VERIFICACION: { titulo: 'Comprobante en revisión', color: 'azul' },
  PAGO_RECHAZADO: { titulo: 'Pago rechazado', color: 'ambar' },
};

/** El estado de un pago en palabras (panel de solicitudes). */
export const ESTADO_DE_PAGO_EN_PALABRAS: Readonly<Record<EstadoPago, string>> = {
  PENDIENTE_VERIFICACION: 'En verificación',
  CONFIRMADO: 'Confirmado',
  RECHAZADO: 'Rechazado',
};
