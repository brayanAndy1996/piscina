import { NOMBRE_DIA } from '@aquagestion/contratos';
import type { MensualidadDelPanel } from '@aquagestion/contratos';
import { esErrorDeApi } from '../../api/cliente';
import { mensajeGeneral } from '../../lib/errores';
import { capitalizar, nombreDelMes } from '../../lib/fechas';

/** Los textos del panel del alumno (spec 011, criterios 18 y 19). Todo en español y sin códigos. */

export const TEXTO_SOLO_LECTURA = 'Para corregir tus datos o cambiar tu horario, acércate a recepción.';
export const TEXTO_INACTIVO = 'Tu cuenta está inactiva en la academia. Acércate a recepción.';
export const TEXTO_SIN_MENSUALIDAD = 'No tienes una mensualidad vigente. Acércate a recepción.';
export const TEXTO_PARA_RENOVAR = 'Para renovar, acércate a recepción.';
export const TEXTO_SIN_FICHA = 'No encontramos tu ficha de alumno. Acércate a recepción.';

export function mensajeDelPanel(error: unknown): string {
  if (esErrorDeApi(error, 404)) return TEXTO_SIN_FICHA;
  return mensajeGeneral(error);
}

export function textoDeEdad(edad: number): string {
  return `${edad} ${edad === 1 ? 'año' : 'años'}`;
}

/** «Martes 18:00 a 19:00»: una clase del horario. */
export function textoDeClase(clase: MensualidadDelPanel['clases'][number]): string {
  return `${NOMBRE_DIA[clase.diaSemana]} ${clase.horaInicio} a ${clase.horaFin}`;
}

/** «Clases: 5 de 12 usadas · te quedan 7». */
export function textoDeClases(
  m: Pick<MensualidadDelPanel, 'clasesUsadas' | 'clasesTotales' | 'clasesRestantes'>,
): string {
  return `Clases: ${m.clasesUsadas} de ${m.clasesTotales} usadas · te quedan ${m.clasesRestantes}`;
}

/** «Diciembre» a partir de `2026-12`. */
function nombreDeMes(mes: string): string {
  return capitalizar(nombreDelMes(mes));
}

/** El estado del mes siguiente: «Diciembre: pagada» o «Diciembre: pago en verificación» (DR-3). */
export function textoDelSiguiente(mes: string, estado: 'PAGADA' | 'EN_VERIFICACION'): string {
  return `${nombreDeMes(mes)}: ${estado === 'PAGADA' ? 'pagada' : 'pago en verificación'}`;
}
