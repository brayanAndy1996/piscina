/**
 * El cupo libre de una clase para un alumno (spec 010a, definición «Cupo libre»; D-06, RN-11, DT-4). Pura: recibe los números ya contados
 * (después de `bloquearClasesParaCupo`) y no toca la base.
 *
 * - Mes en curso: `aforo − ocupación`. Las reservas de prioridad no restan: el lugar apartado es para el mes siguiente.
 * - Mes siguiente: `aforo − ocupación − reservas`, más 1 si el alumno es titular de prioridad en la clase (su propio lugar apartado).
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
  if (!esMesSiguiente) return aforo - ocupacion;
  return aforo - ocupacion - reservas + (esTitular ? 1 : 0);
}

/** ¿Hay lugar para el alumno? Cupo libre de 1 o más. */
export function hayCupo(entrada: EntradaDelCupo): boolean {
  return cupoLibre(entrada) >= 1;
}

/** Lo que se muestra como «cupos restantes»: el cupo libre, nunca negativo. */
export function cuposParaMostrar(entrada: EntradaDelCupo): number {
  return Math.max(0, cupoLibre(entrada));
}
