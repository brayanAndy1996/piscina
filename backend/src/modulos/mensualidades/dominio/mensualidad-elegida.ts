import type { EstadoMensualidad } from '@aquagestion/contratos';
import { estadoDeMensualidad } from './estado';
import { mesAnterior, mesDeTexto, mesSiguiente, textoDelMes } from './ventana';

/**
 * Qué mensualidad de un alumno se muestra para un mes X (spec 010b, criterios 24 y 25; 011, criterio 8): la regla que comparten el listado de recepción y el panel del
 * alumno. Función pura, sin base de datos ni Nest y sin depender de la zona del proceso: `hoy` ya es la fecha de Lima y los meses van como `AAAA-MM`. Es genérica en
 * la fila para no depender de la lectura de la base.
 */

/** Lo que se guarda de la mensualidad de un alumno en un mes: la pagada o, si no hay, la que está en verificación. */
export interface MensualidadDeUnMes<F> {
  readonly pagada: boolean;
  readonly fila: F;
}

export interface EntradaDeElegir<F> {
  /** Hoy en Lima, `AAAA-MM-DD`; el mes en curso (M) es el de esta fecha. */
  readonly hoy: string;
  /** El mes X que se evalúa, `AAAA-MM`, no posterior a M. */
  readonly mes: string;
  readonly diasPorVencer: number;
  /** Las mensualidades del alumno por mes (`AAAA-MM`): la pagada manda sobre la que está en verificación. */
  readonly meses: ReadonlyMap<string, MensualidadDeUnMes<F>>;
}

export interface MensualidadesElegidas<F> {
  /** El estado de la mensualidad en X (`estadoDeMensualidad`), o `null` si el alumno no tiene estado. */
  readonly estado: EstadoMensualidad | null;
  /** La mensualidad mostrada, o `null` (sin estado, o sin la fila que el estado pide). */
  readonly actual: F | null;
  /** La de M+1, pagada o en verificación, solo si X es M; se devuelve aunque el alumno no tenga estado (quien no la quiere, la ignora). */
  readonly siguiente: { readonly mes: string; readonly estado: 'PAGADA' | 'EN_VERIFICACION'; readonly fila: F } | null;
}

/**
 * Con `AL_DIA`, `POR_VENCER` o `PENDIENTE_VERIFICACION`, la de X (la pagada si la hay; si no, la que está en verificación); con `VENCIDO`, la pagada de X−1; sin estado,
 * ninguna. `siguiente` solo se mira cuando X es el mes en curso.
 */
export function elegirMensualidades<F>(entrada: EntradaDeElegir<F>): MensualidadesElegidas<F> {
  const mes = mesDeTexto(entrada.mes);
  const delMes = entrada.meses.get(entrada.mes);
  const delAnterior = entrada.meses.get(textoDelMes(mesAnterior(mes)));
  const textoSiguiente = textoDelMes(mesSiguiente(mes));
  const delSiguiente = entrada.mes === entrada.hoy.slice(0, 7) ? entrada.meses.get(textoSiguiente) : undefined;
  const siguiente =
    delSiguiente === undefined
      ? null
      : {
          mes: textoSiguiente,
          estado: delSiguiente.pagada ? ('PAGADA' as const) : ('EN_VERIFICACION' as const),
          fila: delSiguiente.fila,
        };
  const estado = estadoDeMensualidad({
    hoy: entrada.hoy,
    mes: entrada.mes,
    diasPorVencer: entrada.diasPorVencer,
    pagadaDelMes: delMes?.pagada === true,
    enVerificacionDelMes: delMes !== undefined && !delMes.pagada,
    pagadaDelMesAnterior: delAnterior?.pagada === true,
    siguiente: siguiente === null ? null : siguiente.estado,
  });
  if (estado === null) return { estado: null, actual: null, siguiente };
  const elegida = estado === 'VENCIDO' ? delAnterior : delMes;
  return { estado, actual: elegida?.fila ?? null, siguiente };
}
