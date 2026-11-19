import { type ActualizarClase, type NivelNatacion, NIVELES } from '@aquagestion/contratos';

/** Dominio puro de las clases (spec 004): sin base de datos ni Nest. Las clases se manejan con los nombres y formatos de la API. */

/** Los campos de una clase que el `PATCH` puede cambiar (DR-4 de 004), en el orden en que se auditan. */
export interface DatosEditablesDeClase {
  entrenadorId: string;
  aforo: number;
  activo: boolean;
}
export const CAMPOS_EDITABLES_DE_CLASE = [
  'entrenadorId',
  'aforo',
  'activo',
] as const satisfies readonly (keyof DatosEditablesDeClase)[];
export type CampoEditableDeClase = (typeof CAMPOS_EDITABLES_DE_CLASE)[number];

export interface CambiosDeClase {
  campos: CampoEditableDeClase[];
  /** Solo los campos que cambian, con los nombres de la API: es lo que se guarda en la auditoría. */
  antes: Record<string, unknown>;
  despues: Record<string, unknown>;
  /** La clase como quedaría (lo guardado más los cambios). */
  resultante: DatosEditablesDeClase;
}

/**
 * Qué cambia al aplicar `pedido` sobre `guardado` (criterio 21): solo los campos enviados cuyo valor es distinto del guardado. El
 * `entrenadorId` se compara sin distinguir mayúsculas. Sin cambios, `campos` queda vacío (no se escribe ni se audita).
 */
export function cambiosPedidosClase(guardado: DatosEditablesDeClase, pedido: ActualizarClase): CambiosDeClase {
  const entrenadorPedido = pedido.entrenadorId?.toLowerCase();
  const resultante: DatosEditablesDeClase = {
    entrenadorId: entrenadorPedido ?? guardado.entrenadorId,
    aforo: pedido.aforo ?? guardado.aforo,
    activo: pedido.activo ?? guardado.activo,
  };
  const campos: CampoEditableDeClase[] = [];
  const antes: Record<string, unknown> = {};
  const despues: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITABLES_DE_CLASE) {
    if (resultante[campo] === guardado[campo]) continue;
    campos.push(campo);
    antes[campo] = guardado[campo];
    despues[campo] = resultante[campo];
  }
  return {
    campos,
    antes,
    despues,
    resultante,
  };
}

/** `true` si una clase inactiva pasa a activa: hay que volver a comprobar el entrenador y los choques del bloque (criterio 21). */
export function esReactivacion(guardado: DatosEditablesDeClase, resultante: DatosEditablesDeClase): boolean {
  return !guardado.activo && resultante.activo;
}

const POSICION_DE_NIVEL: ReadonlyMap<string, number> = new Map(NIVELES.map((nivel, posicion) => [nivel, posicion]));

/** Lo que el orden de la lista necesita de una clase. */
export interface ClaseOrdenable {
  id: string;
  diaSemana: number;
  horaInicio: string;
  nivel: NivelNatacion;
}

/** El orden de la lista de clases: por día, hora de inicio, nivel (`BASICO`, `INTERMEDIO`, `AVANZADO`) y, a igualdad, por id. */
export function ordenDeClases(a: ClaseOrdenable, b: ClaseOrdenable): number {
  return (
    a.diaSemana - b.diaSemana ||
    (a.horaInicio < b.horaInicio ? -1 : a.horaInicio > b.horaInicio ? 1 : 0) ||
    (POSICION_DE_NIVEL.get(a.nivel) ?? 0) - (POSICION_DE_NIVEL.get(b.nivel) ?? 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
