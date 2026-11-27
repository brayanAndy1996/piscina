/**
 * El cupo libre de una clase para un alumno (spec 010a, definición «Cupo libre» y criterio 44; D-06, RN-11, DT-4). Pura: recibe los números ya
 * contados (después de `bloquearClasesParaCupo`) y no toca la base.
 *
 * - Mes en curso: `aforo − ocupación`. Las reservas de prioridad no restan: el lugar apartado es para el mes siguiente.
 * - Mes siguiente, titular de la clase: `aforo − ocupación`. Las reservas no le restan: los titulares compiten solo entre ellos por los lugares que
 *   quedan y gana el primero que llega (con más titulares que lugares, los últimos reciben `SIN_CUPO`).
 * - Mes siguiente, no titular: `aforo − ocupación − reservas`; no puede tomar un lugar apartado.
 *
 * Puede dar menos de 0 si el administrador bajó el aforo por debajo de los inscritos (DR-5 de 004): quien muestra el cupo lo recorta a 0.
 * El alumno puede tomar la clase si el cupo libre es 1 o más, y así la ocupación del mes nunca pasa del aforo.
 */
export interface EntradaDelCupo {
  readonly aforo: number;
  /** Cuántas matrículas que ocupan cupo en el mes pedido incluyen la clase (`contarOcupacion`). */
  readonly ocupacion: number;
  /** Los titulares de prioridad de la clase (`contarReservasDePrioridad`); solo cuentan para el mes siguiente. */
  readonly reservas: number;
  /** ¿El alumno es titular de prioridad en la clase? Solo suma para el mes siguiente. */
  readonly esTitular: boolean;
  /** ¿El mes pedido es el mes siguiente (M+1)? */
  readonly esMesSiguiente: boolean;
}

export function cupoLibre(entrada: EntradaDelCupo): number {
  const { aforo, ocupacion, reservas, esTitular, esMesSiguiente } = entrada;
  if (!esMesSiguiente || esTitular) return aforo - ocupacion;
  return aforo - ocupacion - reservas;
}

/** ¿Hay lugar para el alumno? Cupo libre de 1 o más. */
export function hayCupo(entrada: EntradaDelCupo): boolean {
  return cupoLibre(entrada) >= 1;
}

/** Lo que se muestra como «cupos restantes»: el cupo libre, nunca negativo. */
export function cuposParaMostrar(entrada: EntradaDelCupo): number {
  return Math.max(0, cupoLibre(entrada));
}
