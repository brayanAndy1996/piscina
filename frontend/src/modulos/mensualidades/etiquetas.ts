import type { EstadoMensualidad } from '@aquagestion/contratos';

/** El estado de una mensualidad tal como se muestra (HU-11) y el color de su insignia. El texto lleva el significado; el color solo lo refuerza. */
export const ETIQUETA_ESTADO_MENSUALIDAD: Readonly<Record<EstadoMensualidad, string>> = {
  AL_DIA: 'Al día',
  POR_VENCER: 'Por vencer',
  VENCIDO: 'Vencido',
  PENDIENTE_VERIFICACION: 'Pendiente de verificación',
};

export const COLOR_ESTADO_MENSUALIDAD: Readonly<Record<EstadoMensualidad, 'verde' | 'ambar' | 'rojo' | 'azul'>> = {
  AL_DIA: 'verde',
  POR_VENCER: 'ambar',
  VENCIDO: 'rojo',
  PENDIENTE_VERIFICACION: 'azul',
};

export function textoDeClasesUsadas(usadas: number, totales: number): string {
  return `Usó ${usadas} de ${totales} ${totales === 1 ? 'clase' : 'clases'}`;
}

/** «No usó N clases»: lo que se perdió al cerrar el mes (RN-23). */
export function textoDeClasesPerdidas(clases: number): string {
  return `No usó ${clases} ${clases === 1 ? 'clase' : 'clases'}`;
}
