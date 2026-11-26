import { TZDate } from '@date-fns/tz';
import { ZONA_LIMA } from '../../../comun/fechas';

/**
 * La ventana de una clase en una fecha (spec 009a, criterios 9 y 20; D-16, DT-3). Funciones puras, sin base de datos ni Nest y exactas en
 * America/Lima: nada depende de la zona del proceso ni de la de la base. Las fechas son `AAAA-MM-DD` y las horas, `HH:MM` (o `HH:MM:SS`).
 */

/** El inicio y el fin de una ocurrencia de la clase, como instantes. */
export interface VentanaDeClase {
  readonly inicio: Date;
  readonly fin: Date;
}

function partesDeLaFecha(fecha: string): { anio: number; mes: number; dia: number } {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!coincidencia) throw new RangeError('La fecha debe tener el formato AAAA-MM-DD.');
  return { anio: Number(coincidencia[1]), mes: Number(coincidencia[2]), dia: Number(coincidencia[3]) };
}

function partesDeLaHora(hora: string): { horas: number; minutos: number; segundos: number } {
  const coincidencia = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(hora);
  if (!coincidencia) throw new RangeError('La hora debe tener el formato HH:MM.');
  return { horas: Number(coincidencia[1]), minutos: Number(coincidencia[2]), segundos: Number(coincidencia[3] ?? 0) };
}

/** El instante de `fecha` a `hora` en America/Lima (por ejemplo, la hora de llegada de un registro posterior). */
export function instanteEnLima(fecha: string, hora: string): Date {
  const { anio, mes, dia } = partesDeLaFecha(fecha);
  const { horas, minutos, segundos } = partesDeLaHora(hora);
  return new Date(new TZDate(anio, mes - 1, dia, horas, minutos, segundos, ZONA_LIMA).getTime());
}

/**
 * El día de la semana ISO (1 lunes … 7 domingo) de una fecha de calendario de Lima. Se calcula con el mediodía de Lima para que ni la zona del
 * proceso ni un cambio de día en UTC lo muevan (como el conteo de clases del cobro, criterio 8 de 005).
 */
export function diaIsoEnLima(fecha: string): number {
  const { anio, mes, dia } = partesDeLaFecha(fecha);
  const diaDeLaSemana = new TZDate(anio, mes - 1, dia, 12, 0, 0, ZONA_LIMA).getDay();
  return diaDeLaSemana === 0 ? 7 : diaDeLaSemana;
}

/**
 * La ocurrencia de una clase el día `fecha`: desde `horaInicio` hasta `horaFin` en America/Lima. La ventana de marcado es `[inicio, fin)`:
 * incluye el inicio y no incluye el fin (la clase de 18:00 a 19:00 admite 18:59:59.999 y no 19:00:00.000).
 */
export function ventanaDeLaClase(fecha: string, horaInicio: string, horaFin: string): VentanaDeClase {
  return { inicio: instanteEnLima(fecha, horaInicio), fin: instanteEnLima(fecha, horaFin) };
}

/** `true` si `ahora` está dentro de `[inicio, fin)`. */
export function dentroDeLaVentana(ahora: Date, ventana: VentanaDeClase): boolean {
  const instante = ahora.getTime();
  return instante >= ventana.inicio.getTime() && instante < ventana.fin.getTime();
}
