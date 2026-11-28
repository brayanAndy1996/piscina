import { TZDate } from '@date-fns/tz';
import { ZONA_LIMA, anioYMesEnLima } from '../../../comun/fechas';

/**
 * Vencimiento de la reserva de una solicitud sin pagar (spec 005, criterio 54; RN-28, DR-1, DR-12): funciones puras, en America/Lima y
 * sin la zona del proceso. La reserva vence a las 24 horas o a las 23:59:59.999 del último día del mes en Lima, lo que ocurra primero:
 * nunca queda una reserva vigente de un mes ya cerrado (la base lo exige con `matriculas_reserva_dentro_del_mes`, criterio 56).
 */

/** Cuánto dura la reserva del cupo antes de pagar (DR-1 de 005, aprobado: 24 horas), sin contar el tope del fin de mes. */
export const RESERVA_SIN_PAGO_MS = 24 * 60 * 60 * 1000;

/** El último milisegundo del mes de Lima al que pertenece `ahora` (las 23:59:59.999 del último día del mes en America/Lima). */
export function finDelMesEnLima(ahora: Date): Date {
  const { anio, mes } = anioYMesEnLima(ahora);
  // El mes de 1 a 12, usado como índice de 0 a 11, ya es el mes siguiente (el 12 pasa a enero del año siguiente).
  const inicioDelMesSiguiente = new TZDate(anio, mes, 1, ZONA_LIMA);
  return new Date(inicioDelMesSiguiente.getTime() - 1);
}

/** El menor entre `ahora` más 24 horas y el fin del mes de Lima de `ahora`. Nunca es anterior a `ahora`. */
export function vencimientoDeReserva(ahora: Date): Date {
  return vencimientoDeReservaDelMes(ahora, anioYMesEnLima(ahora));
}

/**
 * El vencimiento de la reserva de una matrícula del mes `mes` (spec 010d, criterio 4; DR-1 y DR-12 de 005, DT-7 y DT-14): el menor entre `ahora` más
 * 24 horas y las 23:59:59.999 de Lima del último día de **ese** mes, el de la matrícula. Para el mes en curso de `ahora` (M) es `vencimientoDeReserva(ahora)`;
 * para el mes siguiente (M+1) son siempre las 24 horas, aunque crucen el día 1, porque el fin de M+1 queda a más de 24 horas. Pura, sin zona del proceso.
 */
export function vencimientoDeReservaDelMes(ahora: Date, mes: { anio: number; mes: number }): Date {
  // El mes de 1 a 12, usado como índice de 0 a 11, ya es el mes siguiente (el 12 pasa a enero del año siguiente).
  const finDelMes = new TZDate(mes.anio, mes.mes, 1, ZONA_LIMA).getTime() - 1;
  return new Date(Math.min(ahora.getTime() + RESERVA_SIN_PAGO_MS, finDelMes));
}
