import type { EstadoConCarnet } from '@aquagestion/contratos';

/** El estado de un alumno tal como se muestra en la web, y el color de su insignia. */
export const ETIQUETA_ESTADO_ALUMNO: Readonly<Record<EstadoConCarnet, string>> = {
  ALUMNO_ACTIVO: 'Activo',
  ALUMNO_VENCIDO: 'Vencido',
  INACTIVO: 'Inactivo',
};

export const COLOR_ESTADO_ALUMNO: Readonly<Record<EstadoConCarnet, 'verde' | 'ambar' | 'gris'>> = {
  ALUMNO_ACTIVO: 'verde',
  ALUMNO_VENCIDO: 'ambar',
  INACTIVO: 'gris',
};
