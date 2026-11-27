import { type MesDeCalendario, mesSiguiente } from './ventana';

/**
 * Las decisiones puras del cambio de horario de una matrícula (spec 010c, criterios 35 y 37; HU-03, RN-08, DT-15, DT-16). Sin base de datos ni reloj
 * propio: reciben lo que la transacción ya leyó con los bloqueos tomados.
 */

/** Lo que importa de la matrícula para saber si su horario se puede cambiar. */
export interface MatriculaParaCambiar {
  readonly anio: number;
  readonly mes: number;
  readonly estado: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  /** Nula en una matrícula pagada y en una renovación en verificación; con valor, es la reserva de 24 horas de la inscripción pública. */
  readonly reservaVenceEn: Date | null;
}

/**
 * ¿Se puede cambiar el horario de esta matrícula? Es de M (el mes en curso de Lima) o de M+1, y está `VIGENTE` o en verificación (`RESERVADA` sin
 * vencimiento). Una `FINALIZADA`, una `CANCELADA`, la de otro mes y una reserva de 24 horas no (criterio 35).
 */
export function sePuedeCambiarElHorario(matricula: MatriculaParaCambiar, mesEnCurso: MesDeCalendario): boolean {
  const siguiente = mesSiguiente(mesEnCurso);
  const esDeMesPermitido =
    (matricula.anio === mesEnCurso.anio && matricula.mes === mesEnCurso.mes) ||
    (matricula.anio === siguiente.anio && matricula.mes === siguiente.mes);
  if (!esDeMesPermitido) return false;
  if (matricula.estado === 'VIGENTE') return true;
  return matricula.estado === 'RESERVADA' && matricula.reservaVenceEn === null;
}

export interface DiferenciaDeClases {
  /** Las clases que la matrícula tiene y el pedido ya no incluye, ordenadas. */
  readonly salen: readonly string[];
  /** Las clases del pedido que la matrícula todavía no tiene, ordenadas. */
  readonly entran: readonly string[];
  /** Las clases que están en los dos lados, ordenadas. */
  readonly seQuedan: readonly string[];
}

/** Compara las clases actuales con las pedidas como conjuntos (el orden y las mayúsculas del id no cuentan, DT-16). */
export function diferenciaDeClases(actuales: readonly string[], pedidas: readonly string[]): DiferenciaDeClases {
  const antes = new Set(actuales.map((id) => id.toLowerCase()));
  const despues = new Set(pedidas.map((id) => id.toLowerCase()));
  return {
    salen: [...antes].filter((id) => !despues.has(id)).sort(),
    entran: [...despues].filter((id) => !antes.has(id)).sort(),
    seQuedan: [...despues].filter((id) => antes.has(id)).sort(),
  };
}
