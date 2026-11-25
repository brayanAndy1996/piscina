import type { EstadoLlegada } from '@aquagestion/contratos';

const MS_POR_MINUTO = 60_000;

/**
 * El estado de llegada (spec 009a, criterio 10; D-11, DT-3): `PUNTUAL` si la llegada, truncada al minuto, no pasa de `inicio` más la tolerancia
 * de la academia; `TARDE` si pasa. Se compara por minuto para que la hora que se muestra (`HH:MM`) nunca contradiga el estado: con 10 minutos y la
 * clase de las 18:00, 18:10:59.999 es puntual («18:10») y 18:11:00.000 es tarde («18:11»). Una llegada antes del inicio es puntual.
 */
export function estadoDeLlegada(llegada: Date, inicio: Date, toleranciaMinutos: number): EstadoLlegada {
  const alMinuto = Math.floor(llegada.getTime() / MS_POR_MINUTO) * MS_POR_MINUTO;
  return alMinuto <= inicio.getTime() + toleranciaMinutos * MS_POR_MINUTO ? 'PUNTUAL' : 'TARDE';
}
