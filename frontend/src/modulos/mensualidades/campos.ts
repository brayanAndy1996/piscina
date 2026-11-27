import type { ClaseDeLaOferta, PlanPublico } from '@aquagestion/contratos';

/**
 * Las clases de la oferta que sirven para un plan: las del nivel de la oferta (la API ya las filtra por el nivel del alumno) en los días y
 * franjas del plan, ordenadas por día y hora. Conserva `conPrioridad` y `cuposRestantes`.
 */
export function clasesDelPlan(clases: readonly ClaseDeLaOferta[], plan: PlanPublico): ClaseDeLaOferta[] {
  return clases
    .filter(
      (clase) => plan.diasPermitidos.includes(clase.diaSemana) && plan.franjasPermitidas.includes(clase.horaInicio),
    )
    .sort(
      (a, b) => a.diaSemana - b.diaSemana || (a.horaInicio < b.horaInicio ? -1 : a.horaInicio > b.horaInicio ? 1 : 0),
    );
}

export function textoDeCupos(cupos: number): string {
  return cupos === 1 ? '1 cupo' : `${cupos} cupos`;
}
