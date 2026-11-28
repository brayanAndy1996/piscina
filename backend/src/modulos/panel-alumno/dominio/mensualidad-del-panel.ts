import type { EstadoMensualidad } from '@aquagestion/contratos';
import { estadoDeMensualidad } from '../../mensualidades/dominio/estado';
import type { FilaDeMatricula, MensualidadDeUnMes } from '../../mensualidades/lectura-de-estado';

/**
 * Lo que el panel muestra de la mensualidad de un alumno (spec 011, criterios 8 a 11). Funciones puras, sin base de datos ni Nest y sin depender de la zona del
 * proceso: `hoy` ya es la fecha de Lima y los meses van como `AAAA-MM`.
 */

export interface MensualidadesElegidas {
  /** El estado de la mensualidad en M (`estadoDeMensualidad`), o `null` si el alumno no tiene estado. */
  readonly estado: EstadoMensualidad | null;
  /** La mensualidad mostrada, o `null` (sin estado, o sin la fila que el estado pide). */
  readonly actual: FilaDeMatricula | null;
  /** La mensualidad de M+1, pagada o en verificación, aunque el alumno no tenga estado en M. */
  readonly siguiente: { readonly estado: 'PAGADA' | 'EN_VERIFICACION'; readonly fila: FilaDeMatricula } | null;
}

export interface EntradaDeElegir {
  /** Hoy en Lima, `AAAA-MM-DD`; el mes en curso (M) es el de esta fecha. */
  readonly hoy: string;
  readonly diasPorVencer: number;
  /** Las mensualidades del alumno por mes (`AAAA-MM`): la pagada manda sobre la que está en verificación. */
  readonly meses: ReadonlyMap<string, MensualidadDeUnMes>;
}

/** El mes anterior de un `AAAA-MM`. */
function anterior(mes: string): string {
  const [anio = 0, numero = 0] = mes.split('-').map(Number);
  return numero === 1 ? `${anio - 1}-12` : `${anio}-${String(numero - 1).padStart(2, '0')}`;
}

/** El mes siguiente de un `AAAA-MM`. */
function siguiente(mes: string): string {
  const [anio = 0, numero = 0] = mes.split('-').map(Number);
  return numero === 12 ? `${anio + 1}-01` : `${anio}-${String(numero + 1).padStart(2, '0')}`;
}

/**
 * Las mismas reglas del listado de recepción (criterios 24 y 25 de 010) para X = M: con `AL_DIA`, `POR_VENCER` o `PENDIENTE_VERIFICACION`, la mensualidad de M (la pagada
 * si la hay; si no, la que está en verificación); con `VENCIDO`, la pagada de M−1; sin estado, ninguna. `siguiente` es la de M+1, con o sin estado.
 */
export function elegirMensualidades(entrada: EntradaDeElegir): MensualidadesElegidas {
  const mesEnCurso = entrada.hoy.slice(0, 7);
  const delMes = entrada.meses.get(mesEnCurso);
  const delAnterior = entrada.meses.get(anterior(mesEnCurso));
  const delSiguiente = entrada.meses.get(siguiente(mesEnCurso));
  const siguienteElegida =
    delSiguiente === undefined
      ? null
      : { estado: delSiguiente.pagada ? ('PAGADA' as const) : ('EN_VERIFICACION' as const), fila: delSiguiente.fila };
  const estado = estadoDeMensualidad({
    hoy: entrada.hoy,
    mes: mesEnCurso,
    diasPorVencer: entrada.diasPorVencer,
    pagadaDelMes: delMes?.pagada === true,
    enVerificacionDelMes: delMes !== undefined && !delMes.pagada,
    pagadaDelMesAnterior: delAnterior?.pagada === true,
    siguiente: siguienteElegida === null ? null : siguienteElegida.estado,
  });
  if (estado === null) return { estado: null, actual: null, siguiente: siguienteElegida };
  const elegida = estado === 'VENCIDO' ? delAnterior : delMes;
  return { estado, actual: elegida?.fila ?? null, siguiente: siguienteElegida };
}

/**
 * Los meses de asistencia que el alumno puede consultar (criterio 11, DR-2): M siempre y cada mes anterior a M con una mensualidad pagada, del más nuevo al más
 * viejo y sin repetir. Nunca M+1 ni uno posterior, aunque ya esté pagado.
 */
export function mesesDeAsistencia(mesEnCurso: string, mesesPagados: readonly string[]): string[] {
  const meses = new Set<string>([mesEnCurso]);
  for (const mes of mesesPagados) if (mes < mesEnCurso) meses.add(mes);
  return [...meses].sort().reverse();
}
