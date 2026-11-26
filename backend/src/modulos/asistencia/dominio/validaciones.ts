import type { CodigoRechazoAsistencia, EstadoLlegada } from '@aquagestion/contratos';
import { estadoDeLlegada } from './llegada';
import { dentroDeLaVentana, ventanaDeLaClase } from './ventana';

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
  | { readonly tipo: 'RECHAZO'; readonly codigo: CodigoRechazoAsistencia }
  | { readonly tipo: 'REGISTRAR'; readonly estadoLlegada: EstadoLlegada };

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
