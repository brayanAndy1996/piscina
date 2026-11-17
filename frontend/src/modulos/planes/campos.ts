import {
  type ActualizarPlan,
  actualizarPlanSchema,
  type CrearPlan,
  crearPlanSchema,
  MENSAJE_DIAS_INSUFICIENTES,
  MENSAJE_VIGENCIA_INVERTIDA,
  NIVELES,
  normalizarNombrePlan,
  type Plan,
  vigenciaInvertida,
} from '@aquagestion/contratos';
import { sonMismoMonto } from '../../lib/dinero';

/** Los campos del formulario de un plan: los números y el precio son el texto de la entrada; se convierten al enviar. */
export interface CamposPlan {
  nombre: string;
  vecesPorSemana: string;
  clasesPorMes: string;
  duracionMinutos: string;
  precio: string;
  diasPermitidos: number[];
  franjasPermitidas: string[];
  nivelesAplicables: string[];
  /** `AAAA-MM-DD` o vacío (sin fecha). */
  vigenciaInicio: string;
  vigenciaFin: string;
  activo: boolean;
}

export type CampoPlan = keyof CamposPlan;

export const CAMPOS_PLAN: readonly CampoPlan[] = [
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
];

export function esCampoPlan(nombre: unknown): nombre is CampoPlan {
  return CAMPOS_PLAN.some((campo) => campo === nombre);
}

/** Los campos de un plan nuevo. */
export const CAMPOS_PLAN_NUEVO: CamposPlan = {
  nombre: '',
  vecesPorSemana: '',
  clasesPorMes: '',
  duracionMinutos: '60',
  precio: '',
  diasPermitidos: [],
  franjasPermitidas: [],
  nivelesAplicables: [],
  vigenciaInicio: '',
  vigenciaFin: '',
  activo: true,
};

/** Los campos del formulario con los valores de un plan (`null`: plan nuevo). El precio se muestra como lo guarda la API. */
export function aCamposPlan(plan: Plan | null): CamposPlan {
  if (!plan) return { ...CAMPOS_PLAN_NUEVO };
  return {
    nombre: plan.nombre,
    vecesPorSemana: String(plan.vecesPorSemana),
    clasesPorMes: String(plan.clasesPorMes),
    duracionMinutos: String(plan.duracionMinutos),
    precio: plan.precio,
    diasPermitidos: [...plan.diasPermitidos],
    franjasPermitidas: [...plan.franjasPermitidas],
    nivelesAplicables: [...plan.nivelesAplicables],
    vigenciaInicio: plan.vigenciaInicio ?? '',
    vigenciaFin: plan.vigenciaFin ?? '',
    activo: plan.activo,
  };
}

/** Un texto de enteros como número; cualquier otro texto se deja tal cual para que el esquema compartido lo rechace con su mensaje. */
function numeroODeTexto(texto: string): number | string {
  const recortado = texto.trim();
  return /^-?[0-9]+$/.test(recortado) ? Number(recortado) : recortado;
}

function mismosValores<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((valor) => b.includes(valor));
}

const POSICION_NIVEL = new Map<string, number>(NIVELES.map((nivel, posicion) => [nivel, posicion]));

/**
 * Los campos que el formulario cambió frente a la base (un plan), con el valor como lo pide la API. El precio se compara como
 * texto con dos decimales, sin pasar por `number` (`"120"` y `"120.00"` no son un cambio). Una fecha vacía es `null` (quita la fecha).
 */
export function cambiosDePlan(campos: CamposPlan, base: Plan): Record<string, unknown> {
  const cambios: Record<string, unknown> = {};
  const nombre = normalizarNombrePlan(campos.nombre);
  if (nombre !== base.nombre) cambios['nombre'] = nombre;
  for (const campo of ['vecesPorSemana', 'clasesPorMes', 'duracionMinutos'] as const) {
    const valor = numeroODeTexto(campos[campo]);
    if (valor !== base[campo]) cambios[campo] = valor;
  }
  const precio = campos.precio.trim();
  if (!sonMismoMonto(precio, base.precio)) cambios['precio'] = precio;
  if (!mismosValores(campos.diasPermitidos, base.diasPermitidos)) {
    cambios['diasPermitidos'] = [...campos.diasPermitidos].sort((a, b) => a - b);
  }
  if (!mismosValores(campos.franjasPermitidas, base.franjasPermitidas)) {
    cambios['franjasPermitidas'] = [...campos.franjasPermitidas].sort();
  }
  if (!mismosValores(campos.nivelesAplicables, base.nivelesAplicables)) {
    cambios['nivelesAplicables'] = [...campos.nivelesAplicables].sort(
      (a, b) => (POSICION_NIVEL.get(a) ?? 99) - (POSICION_NIVEL.get(b) ?? 99),
    );
  }
  const inicio = campos.vigenciaInicio.trim() === '' ? null : campos.vigenciaInicio.trim();
  if (inicio !== base.vigenciaInicio) cambios['vigenciaInicio'] = inicio;
  const fin = campos.vigenciaFin.trim() === '' ? null : campos.vigenciaFin.trim();
  if (fin !== base.vigenciaFin) cambios['vigenciaFin'] = fin;
  if (campos.activo !== base.activo) cambios['activo'] = campos.activo;
  return cambios;
}

/** Los nombres de los campos que la persona editó frente a la base. */
export function camposEditadosDePlan(campos: CamposPlan, base: Plan | null): string[] {
  return base ? Object.keys(cambiosDePlan(campos, base)) : [];
}

/** Si dos planes valen lo mismo en todos sus campos (el `estado` lo calcula la API con la fecha de hoy). */
export function sonIgualesPlanes(a: Plan | null, b: Plan | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.nombre === b.nombre &&
    a.vecesPorSemana === b.vecesPorSemana &&
    a.clasesPorMes === b.clasesPorMes &&
    a.duracionMinutos === b.duracionMinutos &&
    sonMismoMonto(a.precio, b.precio) &&
    mismosValores(a.diasPermitidos, b.diasPermitidos) &&
    mismosValores(a.franjasPermitidas, b.franjasPermitidas) &&
    mismosValores(a.nivelesAplicables, b.nivelesAplicables) &&
    a.vigenciaInicio === b.vigenciaInicio &&
    a.vigenciaFin === b.vigenciaFin &&
    a.activo === b.activo
  );
}

/** El cuerpo de `POST /api/planes` con los campos del formulario. Sin fecha, el campo no se envía. */
function pedidoDeCreacion(campos: CamposPlan): Record<string, unknown> {
  const pedido: Record<string, unknown> = {
    nombre: normalizarNombrePlan(campos.nombre),
    vecesPorSemana: numeroODeTexto(campos.vecesPorSemana),
    clasesPorMes: numeroODeTexto(campos.clasesPorMes),
    duracionMinutos: numeroODeTexto(campos.duracionMinutos),
    precio: campos.precio.trim(),
    diasPermitidos: [...campos.diasPermitidos].sort((a, b) => a - b),
    franjasPermitidas: [...campos.franjasPermitidas].sort(),
    nivelesAplicables: NIVELES.filter((nivel) => campos.nivelesAplicables.includes(nivel)),
  };
  if (campos.vigenciaInicio.trim() !== '') pedido['vigenciaInicio'] = campos.vigenciaInicio.trim();
  if (campos.vigenciaFin.trim() !== '') pedido['vigenciaFin'] = campos.vigenciaFin.trim();
  return pedido;
}

export type ErroresPlan = Partial<Record<CampoPlan, string>>;

const MENSAJES_SIN_ELEGIR = {
  diasPermitidos: 'Elige al menos un día.',
  franjasPermitidas: 'Elige al menos una franja.',
  nivelesAplicables: 'Elige al menos un nivel.',
} as const;

/** Un grupo de casillas sin ninguna marcada: un mensaje claro en lugar del del esquema, que habla de "valores". */
function sinElegir(campos: Pick<CamposPlan, keyof typeof MENSAJES_SIN_ELEGIR>, errores: ErroresPlan): ErroresPlan {
  for (const campo of Object.keys(MENSAJES_SIN_ELEGIR) as (keyof typeof MENSAJES_SIN_ELEGIR)[]) {
    if (campos[campo].length === 0) errores[campo] = MENSAJES_SIN_ELEGIR[campo];
  }
  return errores;
}

function erroresDe(problemas: readonly { path: readonly PropertyKey[]; message: string }[]): ErroresPlan {
  const errores: ErroresPlan = {};
  for (const problema of problemas) {
    const campo = problema.path[0];
    // Un solo mensaje por campo: el primero es el más claro.
    if (esCampoPlan(campo) && errores[campo] === undefined) errores[campo] = problema.message;
  }
  return errores;
}

export type ResultadoValidacion<T> = { correcto: true; datos: T } | { correcto: false; errores: ErroresPlan };

/** Valida un plan nuevo con el esquema compartido de la API, antes de enviar. */
export function validarPlanNuevo(campos: CamposPlan): ResultadoValidacion<CrearPlan> {
  const resultado = crearPlanSchema.safeParse(pedidoDeCreacion(campos));
  return resultado.success
    ? { correcto: true, datos: resultado.data }
    : { correcto: false, errores: sinElegir(campos, erroresDe(resultado.error.issues)) };
}

/**
 * Valida los cambios de un plan con el esquema compartido. Las reglas que cruzan campos se comprueban con lo guardado más lo
 * cambiado, como hace la API (criterio 12), y solo si el cambio toca alguno de los campos de la regla.
 */
export function validarCambiosDePlan(campos: CamposPlan, base: Plan): ResultadoValidacion<ActualizarPlan> {
  const cambios = cambiosDePlan(campos, base);
  const resultado = actualizarPlanSchema.safeParse(cambios);
  const errores = resultado.success ? {} : sinElegir(campos, erroresDe(resultado.error.issues));

  const veces = 'vecesPorSemana' in cambios ? cambios['vecesPorSemana'] : base.vecesPorSemana;
  const dias = 'diasPermitidos' in cambios ? cambios['diasPermitidos'] : base.diasPermitidos;
  if (
    ('vecesPorSemana' in cambios || 'diasPermitidos' in cambios) &&
    typeof veces === 'number' &&
    Array.isArray(dias) &&
    dias.length < veces &&
    errores.diasPermitidos === undefined
  ) {
    errores.diasPermitidos = MENSAJE_DIAS_INSUFICIENTES;
  }
  const inicio = 'vigenciaInicio' in cambios ? cambios['vigenciaInicio'] : base.vigenciaInicio;
  const fin = 'vigenciaFin' in cambios ? cambios['vigenciaFin'] : base.vigenciaFin;
  if (
    ('vigenciaInicio' in cambios || 'vigenciaFin' in cambios) &&
    (typeof inicio === 'string' || inicio === null) &&
    (typeof fin === 'string' || fin === null) &&
    vigenciaInvertida(inicio, fin) &&
    errores.vigenciaFin === undefined
  ) {
    errores.vigenciaFin = MENSAJE_VIGENCIA_INVERTIDA;
  }

  if (Object.keys(errores).length > 0 || !resultado.success) return { correcto: false, errores };
  return { correcto: true, datos: resultado.data };
}
