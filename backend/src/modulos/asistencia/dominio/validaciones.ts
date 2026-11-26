import type { CodigoRechazoAsistencia, EstadoLlegada } from '@aquagestion/contratos';
import { estadoDeLlegada } from './llegada';
import { dentroDeLaVentana, instanteEnLima, ventanaDeLaClase } from './ventana';

/** Lo que `decidirMarcado` necesita saber del alumno, ya leído de la base dentro de la transacción. */
export interface EntradaDeLaDecision {
  /** «Ahora», leído después de tomar los bloqueos (DT-16). */
  readonly ahora: Date;
  /** La fecha de hoy en Lima, `AAAA-MM-DD`. */
  readonly hoy: string;
  /** La tolerancia de tardanza de la academia, en minutos. */
  readonly toleranciaMinutos: number;
  readonly alumnoInactivo: boolean;
  /** El alumno ya tiene una asistencia de hoy que no es `PARTICULAR`. */
  readonly yaMarcoHoy: boolean;
  /** La matrícula del día, o `null` si no hay. */
  readonly matricula: { readonly clasesTotales: number; readonly clasesUsadas: number; readonly creadaEn: Date } | null;
  /** Sin matrícula del día, un pago `PENDIENTE_VERIFICACION` de una matrícula `RESERVADA` del mes (DR-3). */
  readonly pagoEnVerificacion: boolean;
  /** La clase de la matrícula que cae hoy, o `null` si no tiene. */
  readonly claseDeHoy: { readonly horaInicio: string; readonly horaFin: string } | null;
}

export type DecisionDeMarcado =
  | { readonly tipo: 'RECHAZO'; readonly codigo: CodigoRechazoAsistencia; readonly llegadaEn?: undefined }
  | { readonly tipo: 'REGISTRAR'; readonly estadoLlegada: EstadoLlegada; readonly llegadaEn?: undefined };

/**
 * Qué hacer con una lectura (spec 009a, criterio 7; HU-14, RN-15, RN-16, D-16): la primera validación que falla decide, en este orden:
 * alumno inactivo → ya marcó hoy → pago en verificación → sin matrícula del día → sin clases restantes → sin clase hoy o fuera de la ventana
 * `[inicio, fin)` → ocurrencia no incluida en la mensualidad (su inicio no es posterior a la creación de la matrícula, DT-14). Si pasan todas,
 * registrar con el estado de llegada. Pura: sin base de datos, sin reloj propio.
 */
export function decidirMarcado(entrada: EntradaDeLaDecision): DecisionDeMarcado {
  const rechazo = (codigo: CodigoRechazoAsistencia): DecisionDeMarcado => ({ tipo: 'RECHAZO', codigo });

  if (entrada.alumnoInactivo) return rechazo('ALUMNO_INACTIVO');
  if (entrada.yaMarcoHoy) return rechazo('ASISTENCIA_YA_REGISTRADA');
  const { matricula } = entrada;
  if (matricula === null)
    return rechazo(entrada.pagoEnVerificacion ? 'PAGO_EN_VERIFICACION' : 'MENSUALIDAD_NO_VIGENTE');
  if (matricula.clasesTotales - matricula.clasesUsadas <= 0) return rechazo('SIN_CLASES_RESTANTES');
  if (entrada.claseDeHoy === null) return rechazo('FUERA_DE_HORARIO');
  const ventana = ventanaDeLaClase(entrada.hoy, entrada.claseDeHoy.horaInicio, entrada.claseDeHoy.horaFin);
  if (!dentroDeLaVentana(entrada.ahora, ventana)) return rechazo('FUERA_DE_HORARIO');
  if (ventana.inicio.getTime() <= matricula.creadaEn.getTime()) return rechazo('CLASE_NO_INCLUIDA');
  return {
    tipo: 'REGISTRAR',
    estadoLlegada: estadoDeLlegada(entrada.ahora, ventana.inicio, entrada.toleranciaMinutos),
  };
}

/** Lo que `decidirPosterior` necesita saber: lo mismo que el marcado, pero de la fecha `fecha` y no de hoy, más la hora de llegada que escribió la secretaria. */
export interface EntradaDelPosterior {
  /** «Ahora», leído después de tomar los bloqueos (DT-16). */
  readonly ahora: Date;
  /** La fecha de hoy en Lima, `AAAA-MM-DD`. */
  readonly hoy: string;
  /** El día que se corrige, `AAAA-MM-DD`. */
  readonly fecha: string;
  /** La hora de Lima a la que llegó el alumno, `HH:MM`. */
  readonly horaLlegada: string;
  /** La tolerancia de tardanza de la academia, en minutos (la de hoy: riesgo aceptado de la 009b). */
  readonly toleranciaMinutos: number;
  readonly alumnoInactivo: boolean;
  /** El alumno ya tiene una asistencia de `fecha` que no es `PARTICULAR`. */
  readonly yaTieneAsistencia: boolean;
  /** La matrícula `VIGENTE` que cubre `fecha`, o `null` si no hay. */
  readonly matricula: { readonly clasesTotales: number; readonly clasesUsadas: number; readonly creadaEn: Date } | null;
  /** La clase de la matrícula que cae en `fecha`, o `null` si no tiene. */
  readonly clase: { readonly horaInicio: string; readonly horaFin: string } | null;
}

export type CodigoDelPosterior = CodigoRechazoAsistencia;

export type DecisionDelPosterior =
  | { readonly tipo: 'RECHAZO'; readonly codigo: CodigoDelPosterior; readonly llegadaEn?: undefined }
  | { readonly tipo: 'REGISTRAR'; readonly estadoLlegada: EstadoLlegada; readonly llegadaEn: Date };

/**
 * Qué hacer con un registro posterior (spec 009b, criterio 28; D-16, DR-2). La primera validación que falla decide, en este orden: la fecha no es del
 * mes en curso de Lima o es posterior a hoy → alumno inactivo → ya tiene una asistencia ese día → sin matrícula de ese día → sin clases restantes → sin clase
 * ese día (`FUERA_DE_HORARIO`) → la clase no terminó (`CLASE_NO_TERMINADA`: durante la clase se usa el marcado normal) → la hora de llegada no cae en
 * `[inicio, fin)` → la ocurrencia no está incluida en la mensualidad (DT-14). Pura: sin base de datos, sin reloj propio.
 */
export function decidirPosterior(entrada: EntradaDelPosterior): DecisionDelPosterior {
  const rechazo = (codigo: CodigoDelPosterior): DecisionDelPosterior => ({ tipo: 'RECHAZO', codigo });

  if (entrada.fecha > entrada.hoy || entrada.fecha.slice(0, 7) !== entrada.hoy.slice(0, 7))
    return rechazo('FECHA_NO_PERMITIDA');
  if (entrada.alumnoInactivo) return rechazo('ALUMNO_INACTIVO');
  if (entrada.yaTieneAsistencia) return rechazo('ASISTENCIA_YA_REGISTRADA');
  const { matricula } = entrada;
  if (matricula === null) return rechazo('MENSUALIDAD_NO_VIGENTE');
  if (matricula.clasesTotales - matricula.clasesUsadas <= 0) return rechazo('SIN_CLASES_RESTANTES');
  if (entrada.clase === null) return rechazo('FUERA_DE_HORARIO');
  const ventana = ventanaDeLaClase(entrada.fecha, entrada.clase.horaInicio, entrada.clase.horaFin);
  if (entrada.ahora.getTime() < ventana.fin.getTime()) return rechazo('CLASE_NO_TERMINADA');
  const llegadaEn = instanteEnLima(entrada.fecha, entrada.horaLlegada);
  if (!dentroDeLaVentana(llegadaEn, ventana)) return rechazo('HORA_FUERA_DE_LA_CLASE');
  if (ventana.inicio.getTime() <= matricula.creadaEn.getTime()) return rechazo('CLASE_NO_INCLUIDA');
  return {
    tipo: 'REGISTRAR',
    estadoLlegada: estadoDeLlegada(llegadaEn, ventana.inicio, entrada.toleranciaMinutos),
    llegadaEn,
  };
}
