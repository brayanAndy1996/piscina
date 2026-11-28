import { TZDate } from '@date-fns/tz';
import { ZONA_LIMA, anioYMesEnLima, fechaEnLima } from '../../../comun/fechas';
import { diasDelMes } from '../../matriculas/dominio/cobro';

/**
 * La ventana de renovación y los meses que se pueden renovar (spec 010a, criterios 3 y 21; D-06, DR-2, DR-4). Funciones puras, sin base de
 * datos ni Nest, en America/Lima y sin depender de la zona del proceso. «M» es el mes de Lima de «ahora» y «M+1» el que le sigue (diciembre
 * pasa al enero del año siguiente).
 */

export interface MesDeCalendario {
  readonly anio: number;
  readonly mes: number;
}

const dos = (n: number): string => String(n).padStart(2, '0');

/** `AAAA-MM`. */
export function textoDelMes({ anio, mes }: MesDeCalendario): string {
  return `${anio}-${dos(mes)}`;
}

/** El mes que le sigue (diciembre → enero del año siguiente). */
export function mesSiguiente({ anio, mes }: MesDeCalendario): MesDeCalendario {
  return mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
}

/** El mes que le precede (enero → diciembre del año anterior). */
export function mesAnterior({ anio, mes }: MesDeCalendario): MesDeCalendario {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

/** El mes de un texto `AAAA-MM` ya validado por el contrato. */
export function mesDeTexto(texto: string): MesDeCalendario {
  const [anio = 0, mes = 0] = texto.split('-').map(Number);
  return { anio, mes };
}

/** El último día de un mes, como `AAAA-MM-DD`. */
export function ultimoDiaDelMes(mes: MesDeCalendario): string {
  return `${textoDelMes(mes)}-${dos(diasDelMes(mes.anio, mes.mes))}`;
}

/** El primer día de un mes, como `AAAA-MM-DD`. */
export function primerDiaDelMes(mes: MesDeCalendario): string {
  return `${textoDelMes(mes)}-01`;
}

/** Las 00:00:00.000 de Lima del día 1 del mes: desde ahí se cotiza el mes siguiente (DT-6). */
export function inicioDelMesEnLima(mes: MesDeCalendario): Date {
  return new Date(new TZDate(mes.anio, mes.mes - 1, 1, 0, 0, 0, 0, ZONA_LIMA).getTime());
}

export interface VentanaDeRenovacion {
  /** El mes en curso de Lima, M. */
  readonly mes: MesDeCalendario;
  /** El primer día de la ventana, `AAAA-MM-DD`: `último − N + 1`. */
  readonly desde: string;
  /** El último día del mes, `AAAA-MM-DD`. */
  readonly hasta: string;
  /** ¿«Ahora» (día de Lima) está dentro de la ventana, con los dos extremos incluidos? */
  readonly abierta: boolean;
}

/**
 * Los últimos `dias` días del mes de Lima de `ahora`: desde las 00:00:00.000 del día `último − N + 1` hasta las 23:59:59.999 del último día.
 * Con N = 5 y noviembre de 2026, del 26/11 al 30/11; con N = 15 y febrero de 2027, del 14/02 al 28/02. `dias` va de 1 a 15 (configuración).
 */
export function ventanaDeRenovacion(ahora: Date, dias: number): VentanaDeRenovacion {
  if (!Number.isInteger(dias) || dias < 1)
    throw new RangeError('Los días de la ventana deben ser un entero de 1 o más.');
  const { anio, mes, dia } = fechaEnLima(ahora);
  const ultimo = diasDelMes(anio, mes);
  const primero = Math.max(1, ultimo - dias + 1);
  return {
    mes: { anio, mes },
    desde: `${textoDelMes({ anio, mes })}-${dos(primero)}`,
    hasta: ultimoDiaDelMes({ anio, mes }),
    abierta: dia >= primero,
  };
}

/**
 * «Por vencer» (HU-11): `hoy` (`AAAA-MM-DD` de Lima) está entre el día `último − N + 1` y el último día de su mes, ambos incluidos. Con N = 5 en
 * noviembre de 2026, desde el 26/11. Es la misma cuenta de la ventana, con su propio valor de días (DR-3 de 003).
 */
export function estaPorVencer(hoy: string, dias: number): boolean {
  const [anio = 0, mes = 0, dia = 0] = hoy.split('-').map(Number);
  const ultimo = diasDelMes(anio, mes);
  return dia >= Math.max(1, ultimo - dias + 1);
}

/**
 * Los meses que se pueden renovar con «ahora»: M (renovación tardía de quien no tiene la de M, DR-4) y, dentro de la ventana, M+1 (DR-2), en
 * orden cronológico y como `AAAA-MM`. No mira las matrículas del alumno: quien llama quita los que ya tienen una que ocupa cupo.
 */
export function mesesPermitidos(ahora: Date, dias: number): string[] {
  const ventana = ventanaDeRenovacion(ahora, dias);
  const meses = [textoDelMes(ventana.mes)];
  if (ventana.abierta) meses.push(textoDelMes(mesSiguiente(ventana.mes)));
  return meses;
}

/** El mes en curso de Lima de `ahora` como `AAAA-MM`. */
export function mesEnCurso(ahora: Date): string {
  return textoDelMes(anioYMesEnLima(ahora));
}
