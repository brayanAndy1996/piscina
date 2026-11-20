import type { NivelNatacion } from '@aquagestion/contratos';

/**
 * Validación de las clases elegidas (spec 005, criterio 15 b; HU-02, RN-07, RN-08, D-15, DR-2 de 004). Funciones puras: reciben lo que la
 * base ya devolvió (las clases bloqueadas) y devuelven los errores. Una clase que no existe, que es de otra academia o que está inactiva
 * da el mismo error, sin distinguirla (los ids de otra academia no vuelven del bloqueo).
 */

export interface PlanParaSeleccion {
  vecesPorSemana: number;
  diasPermitidos: readonly number[];
  franjasPermitidas: readonly string[];
  nivelesAplicables: readonly NivelNatacion[];
}

export interface ClaseParaSeleccion {
  id: string;
  nivel: NivelNatacion;
  diaSemana: number;
  horaInicio: string;
  activo: boolean;
}

export interface ErrorDeSeleccion {
  campo: string;
  mensaje: string;
}

export const MENSAJE_CLASE_NO_DISPONIBLE = 'Una de las clases elegidas no está disponible.';

/** ¿El plan se ofrece para ese nivel? (El estado del plan —activo y vigente hoy— lo decide `estadoDelPlan`.) */
export function planAplicaAlNivel(plan: Pick<PlanParaSeleccion, 'nivelesAplicables'>, nivel: NivelNatacion): boolean {
  return plan.nivelesAplicables.includes(nivel);
}

/**
 * Los errores de la selección, o una lista vacía si es válida: exactamente `vecesPorSemana` clases, en días distintos (una por día,
 * DR-4 de 005), todas activas, del nivel elegido, en un día de `diasPermitidos` y en una franja de `franjasPermitidas`. `campo` es el
 * campo de la lista de ids en la petición (`inscripcion.claseIds` en el envío y `claseIds` en la cotización); los errores de una
 * clase llevan su posición (`claseIds.2`).
 */
export function validarSeleccion(
  plan: PlanParaSeleccion,
  nivel: NivelNatacion,
  clases: readonly ClaseParaSeleccion[],
  claseIds: readonly string[],
  campo: string,
): ErrorDeSeleccion[] {
  const errores: ErrorDeSeleccion[] = [];
  if (claseIds.length !== plan.vecesPorSemana) {
    errores.push({
      campo,
      mensaje:
        plan.vecesPorSemana === 1
          ? 'Elige exactamente 1 clase.'
          : `Elige exactamente ${plan.vecesPorSemana} clases, una por día.`,
    });
  }
  const porId = new Map(clases.map((clase) => [clase.id.toLowerCase(), clase]));
  const dias = new Set<number>();
  let repetido = false;
  claseIds.forEach((id, posicion) => {
    const clase = porId.get(id.toLowerCase());
    const campoDeClase = `${campo}.${posicion}`;
    if (!clase || !clase.activo) {
      errores.push({ campo: campoDeClase, mensaje: MENSAJE_CLASE_NO_DISPONIBLE });
      return;
    }
    if (clase.nivel !== nivel) errores.push({ campo: campoDeClase, mensaje: 'La clase no es del nivel elegido.' });
    if (!plan.diasPermitidos.includes(clase.diaSemana)) {
      errores.push({ campo: campoDeClase, mensaje: 'El plan no permite clases ese día.' });
    }
    if (!plan.franjasPermitidas.includes(clase.horaInicio)) {
      errores.push({ campo: campoDeClase, mensaje: 'El plan no permite clases a esa hora.' });
    }
    if (dias.has(clase.diaSemana)) repetido = true;
    dias.add(clase.diaSemana);
  });
  if (repetido) errores.push({ campo, mensaje: 'Elige una sola clase por día.' });
  return errores;
}
