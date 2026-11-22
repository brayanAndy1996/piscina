import { hoyEnLima } from '../../../comun/fechas';

/**
 * El día de una caja se decide en America/Lima con la hora del reloj inyectable (RNF-12), nunca con la zona del servidor ni con la de la
 * base: desde las 19:00 de Lima ya es otro día en UTC. Una fecha es `AAAA-MM-DD`, así que se compara como texto.
 */

/**
 * `true` si la caja (con su fecha de Lima) no es la de hoy según `ahora`: desde las 00:00 de Lima del día siguiente ya no admite egresos ni
 * cobros y solo se cierra (RN-17, DR-2). Una caja con fecha futura tampoco es "de hoy": no admite movimientos.
 */
export function esDeOtroDia(fechaCaja: string, ahora: Date): boolean {
  return fechaCaja !== hoyEnLima(ahora);
}

/** `true` si la fecha de Lima de `cerradoEn` es posterior a la de la caja: el cierre es "tardío" (criterio 32). */
export function esCierreTardio(fechaCaja: string, cerradoEn: Date): boolean {
  return hoyEnLima(cerradoEn) > fechaCaja;
}
