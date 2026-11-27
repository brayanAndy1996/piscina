import type { EstadoMensualidad } from '@aquagestion/contratos';
import { estaPorVencer } from './ventana';

/**
 * El estado de la mensualidad de un alumno en un mes X (spec 010b, criterio 24; HU-11, 4.5). Función pura, sin base de datos ni Nest y sin depender
 * de la zona del proceso: `hoy` ya es la fecha de Lima (`hoyEnLima(ahora)`) y los meses van como `AAAA-MM`. Quien llama decide qué es una mensualidad
 * pagada (matrícula `VIGENTE` o `FINALIZADA`) y cuál está en verificación (`RESERVADA` sin vencimiento con un pago `PENDIENTE_VERIFICACION`, RN-28).
 */
export interface EntradaDeEstado {
  /** Hoy en Lima, `AAAA-MM-DD`. El mes en curso (M) es el de esta fecha. */
  readonly hoy: string;
  /** El mes X que se evalúa, `AAAA-MM`, no posterior a M. */
  readonly mes: string;
  /** `diasPorVencer` de la configuración de la academia. */
  readonly diasPorVencer: number;
  /** El alumno tiene la mensualidad de X pagada (`VIGENTE` o `FINALIZADA`). */
  readonly pagadaDelMes: boolean;
  /** El alumno tiene la mensualidad de X en verificación. */
  readonly enVerificacionDelMes: boolean;
  /** El alumno tiene la mensualidad de X−1 pagada. */
  readonly pagadaDelMesAnterior: boolean;
  /** La mensualidad de M+1 del alumno; solo se mira cuando X es M. */
  readonly siguiente: 'PAGADA' | 'EN_VERIFICACION' | null;
}

/**
 * - Con la mensualidad de X pagada: si X es M y hoy está por vencer, `AL_DIA` si ya pagó la de M+1, `PENDIENTE_VERIFICACION` si la de M+1 está en
 *   verificación y `POR_VENCER` si no; en cualquier otro caso, `AL_DIA`.
 * - Sin pagada pero con la de X en verificación: `PENDIENTE_VERIFICACION`.
 * - Sin ninguna de las dos y con la de X−1 pagada: `VENCIDO`.
 * - En cualquier otro caso el alumno no tiene estado en X (el listado no lo muestra): `null`.
 */
export function estadoDeMensualidad(entrada: EntradaDeEstado): EstadoMensualidad | null {
  const mesEnCurso = entrada.hoy.slice(0, 7);
  if (entrada.mes > mesEnCurso) throw new RangeError('El mes no puede ser posterior al mes en curso.');
  if (entrada.pagadaDelMes) {
    if (entrada.mes === mesEnCurso && estaPorVencer(entrada.hoy, entrada.diasPorVencer)) {
      if (entrada.siguiente === 'PAGADA') return 'AL_DIA';
      if (entrada.siguiente === 'EN_VERIFICACION') return 'PENDIENTE_VERIFICACION';
      return 'POR_VENCER';
    }
    return 'AL_DIA';
  }
  if (entrada.enVerificacionDelMes) return 'PENDIENTE_VERIFICACION';
  if (entrada.pagadaDelMesAnterior) return 'VENCIDO';
  return null;
}
