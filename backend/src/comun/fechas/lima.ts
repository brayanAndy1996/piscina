import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

/** Zona horaria de todas las fechas y horas de negocio (RNF-12). */
export const ZONA_LIMA = 'America/Lima';

/**
 * La fecha de calendario de `instante` en America/Lima, como `AAAA-MM-DD`, sin depender de la zona del proceso ni de la de la base
 * (la conexión trabaja en UTC: desde las 19:00 de Lima ya es otro día allí). Con `RELOJ.ahora()` da "hoy" para decidir el estado de
 * un plan, un vencimiento o una caja. Lanza `RangeError` con una fecha inválida.
 */
export function hoyEnLima(instante: Date): string {
  return format(new TZDate(instante, ZONA_LIMA), 'yyyy-MM-dd');
}
