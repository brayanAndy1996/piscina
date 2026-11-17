import {
  type ActualizarPlan,
  type Bloque,
  type EstadoPlan,
  MENSAJE_DIAS_INSUFICIENTES,
  MENSAJE_VIGENCIA_INVERTIDA,
  type NivelNatacion,
  NIVELES,
  vigenciaInvertida,
} from '@aquagestion/contratos';
import { aTextoMonto, montosIguales } from '../../../comun/dinero';

/**
 * Dominio puro de los planes (spec 004): sin base de datos ni Nest. Los planes se manejan con los nombres y formatos de la API
 * (`precio` como texto con dos decimales, fechas `AAAA-MM-DD`, horas `HH:MM`).
 */

/** Un plan en el formato de la API, sin su `id` ni su `estado` (que se calcula al leer). */
export interface DatosDePlan {
  nombre: string;
  vecesPorSemana: number;
  clasesPorMes: number;
  duracionMinutos: number;
  precio: string;
  diasPermitidos: number[];
  franjasPermitidas: Bloque[];
  nivelesAplicables: NivelNatacion[];
  vigenciaInicio: string | null;
  vigenciaFin: string | null;
  activo: boolean;
}

/** Los nombres de los campos de un plan, en el orden en que se auditan. */
export const CAMPOS_DEL_PLAN = [
  'nombre',
  'vecesPorSemana',
  'clasesPorMes',
  'duracionMinutos',
  'precio',
  'diasPermitidos',
  'franjasPermitidas',
  'nivelesAplicables',
  'vigenciaInicio',
  'vigenciaFin',
  'activo',
] as const satisfies readonly (keyof DatosDePlan)[];
export type CampoDePlan = (typeof CAMPOS_DEL_PLAN)[number];

const POSICION_DE_NIVEL: ReadonlyMap<string, number> = new Map(NIVELES.map((nivel, posicion) => [nivel, posicion]));

/** Los días ordenados de 1 (lunes) a 7 (domingo), sin repetidos. */
export function ordenarDias(dias: readonly number[]): number[] {
  return [...new Set(dias)].sort((a, b) => a - b);
}

/** Las franjas `HH:MM` ordenadas por hora, sin repetidos (el orden alfabético de horas con ceros es el de la hora). */
export function ordenarFranjas(franjas: readonly Bloque[]): Bloque[] {
  return [...new Set(franjas)].sort();
}

/** Los niveles en el orden de `NIVELES` (`BASICO`, `INTERMEDIO`, `AVANZADO`), sin repetidos. */
export function ordenarNiveles(niveles: readonly NivelNatacion[]): NivelNatacion[] {
  return [...new Set(niveles)].sort((a, b) => (POSICION_DE_NIVEL.get(a) ?? 0) - (POSICION_DE_NIVEL.get(b) ?? 0));
}

/** El plan con sus arreglos ordenados (días de 1 a 7, franjas por hora y niveles en el orden del contrato). */
export function normalizarPlan<T extends DatosDePlan>(plan: T): T {
  return {
    ...plan,
    diasPermitidos: ordenarDias(plan.diasPermitidos),
    franjasPermitidas: ordenarFranjas(plan.franjasPermitidas),
    nivelesAplicables: ordenarNiveles(plan.nivelesAplicables),
  };
}

/** Lo guardado más lo pedido: el plan que quedaría (criterio 12). Los arreglos pedidos se normalizan. */
export function planCombinado(guardado: DatosDePlan, pedido: ActualizarPlan): DatosDePlan {
  return normalizarPlan({
    nombre: pedido.nombre ?? guardado.nombre,
    vecesPorSemana: pedido.vecesPorSemana ?? guardado.vecesPorSemana,
    clasesPorMes: pedido.clasesPorMes ?? guardado.clasesPorMes,
    duracionMinutos: pedido.duracionMinutos ?? guardado.duracionMinutos,
    // El precio pedido ("120", "120.5") se guarda y se audita como texto con dos decimales.
    precio: aTextoMonto(pedido.precio ?? guardado.precio),
    diasPermitidos: pedido.diasPermitidos ?? guardado.diasPermitidos,
    franjasPermitidas: pedido.franjasPermitidas ?? guardado.franjasPermitidas,
    nivelesAplicables: pedido.nivelesAplicables ?? guardado.nivelesAplicables,
    // `null` quita la fecha: por eso se distingue de `undefined` (no se envió).
    vigenciaInicio: pedido.vigenciaInicio === undefined ? guardado.vigenciaInicio : pedido.vigenciaInicio,
    vigenciaFin: pedido.vigenciaFin === undefined ? guardado.vigenciaFin : pedido.vigenciaFin,
    activo: pedido.activo ?? guardado.activo,
  });
}

/** Un problema de una regla que cruza campos, con el campo de la petición al que se le atribuye. */
export interface ProblemaDeCampo {
  campo: CampoDePlan;
  mensaje: string;
}

/**
 * Las reglas que cruzan campos del plan combinado (criterio 12): al menos tantos días como veces por semana, y el fin de la vigencia no
 * anterior al inicio. El error se atribuye al campo enviado: si solo se envió `vecesPorSemana`, a ese; si se envió `diasPermitidos`,
 * a ese; y lo mismo con las fechas (`vigenciaFin` si se envió, y si no `vigenciaInicio`).
 */
export function validarReglasCruzadas(combinado: DatosDePlan, pedido: ActualizarPlan): ProblemaDeCampo[] {
  const problemas: ProblemaDeCampo[] = [];
  if (combinado.diasPermitidos.length < combinado.vecesPorSemana) {
    problemas.push({
      campo: pedido.diasPermitidos !== undefined ? 'diasPermitidos' : 'vecesPorSemana',
      mensaje: MENSAJE_DIAS_INSUFICIENTES,
    });
  }
  if (vigenciaInvertida(combinado.vigenciaInicio, combinado.vigenciaFin)) {
    problemas.push({
      campo: pedido.vigenciaFin !== undefined ? 'vigenciaFin' : 'vigenciaInicio',
      mensaje: MENSAJE_VIGENCIA_INVERTIDA,
    });
  }
  return problemas;
}

/** Los campos que cambiarían, con su valor de antes y de después en el formato de la API (para la auditoría). */
export interface CambiosDePlan {
  campos: CampoDePlan[];
  antes: Record<string, unknown>;
  despues: Record<string, unknown>;
}

function sonIguales(campo: CampoDePlan, a: DatosDePlan, b: DatosDePlan): boolean {
  switch (campo) {
    case 'precio':
      // "120", "120.0" y "120.00" son el mismo precio.
      return montosIguales(a.precio, b.precio);
    case 'diasPermitidos':
    case 'franjasPermitidas':
    case 'nivelesAplicables': {
      const izquierda: readonly (string | number)[] = a[campo];
      const derecha: readonly (string | number)[] = b[campo];
      return izquierda.length === derecha.length && izquierda.every((valor, i) => valor === derecha[i]);
    }
    default:
      return a[campo] === b[campo];
  }
}

/**
 * Qué cambia al aplicar `pedido` sobre `guardado`: solo los campos enviados cuyo valor es distinto del guardado. Con los arreglos ya
 * normalizados y el precio comparado como `Decimal`. Sin cambios, la lista de campos queda vacía (criterio 12: no se escribe ni se
 * audita).
 */
export function cambiosPedidosPlan(guardado: DatosDePlan, pedido: ActualizarPlan): CambiosDePlan {
  const combinado = planCombinado(guardado, pedido);
  const campos: CampoDePlan[] = [];
  const antes: Record<string, unknown> = {};
  const despues: Record<string, unknown> = {};
  for (const campo of CAMPOS_DEL_PLAN) {
    if (pedido[campo] === undefined) continue;
    if (sonIguales(campo, guardado, combinado)) continue;
    campos.push(campo);
    antes[campo] = guardado[campo];
    despues[campo] = combinado[campo];
  }
  return { campos, antes, despues };
}

/**
 * Estado del plan con la fecha de hoy en America/Lima (`hoy` es `AAAA-MM-DD`, de `hoyEnLima(RELOJ.ahora())`): `INACTIVO` si no está
 * activo; si no, `PROGRAMADO` si hoy es anterior al inicio de la vigencia, `VENCIDO` si es posterior al fin, y `VIGENTE` en los demás
 * casos (sin fechas, o entre las dos con los dos días incluidos). Las fechas `AAAA-MM-DD` se comparan como texto.
 */
export function estadoDelPlan(
  plan: Pick<DatosDePlan, 'activo' | 'vigenciaInicio' | 'vigenciaFin'>,
  hoy: string,
): EstadoPlan {
  if (!plan.activo) return 'INACTIVO';
  if (plan.vigenciaInicio !== null && hoy < plan.vigenciaInicio) return 'PROGRAMADO';
  if (plan.vigenciaFin !== null && hoy > plan.vigenciaFin) return 'VENCIDO';
  return 'VIGENTE';
}

/** El orden de la lista de planes: por nombre en español y, a igual nombre, por id (criterio 15). */
export function compararPlanes(
  a: { nombre: string; id: string },
  b: { nombre: string; id: string },
  comparador: Intl.Collator,
): number {
  return comparador.compare(a.nombre, b.nombre) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
