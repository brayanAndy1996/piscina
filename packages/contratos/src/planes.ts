import { z } from 'zod';
import { montoSchema } from './dinero';
import { diaSemanaSchema, fechaSchema, horaBloqueSchema, nivelNatacionSchema } from './horario';
import { textoVisibleSchema } from './texto';

/**
 * Planes de la academia (spec 004, HU-19, RN-07): nombre, veces por semana, clases por mes, duración, precio con IGV incluido (D-03),
 * días, franjas y niveles permitidos, vigencia y estado. El precio y las clases por mes son la base del cobro proporcional (RN-25).
 */

/** Límites de la API (DR-1 de 004), para validar también en la web. La base solo exige los de las reglas de negocio. */
export const LIMITES_PLAN = {
  nombre: { minimo: 3, maximo: 80 },
  vecesPorSemana: { minimo: 1, maximo: 7 },
  clasesPorMes: { minimo: 1, maximo: 31 },
  duracionMinutos: { minimo: 15, maximo: 60, porDefecto: 60 },
} as const;

/** Estado de un plan, calculado al leer con la fecha de hoy en America/Lima (criterio 14). */
export const ESTADOS_PLAN = ['VIGENTE', 'PROGRAMADO', 'VENCIDO', 'INACTIVO'] as const;
export const estadoPlanSchema = z.enum(ESTADOS_PLAN);
export type EstadoPlan = z.infer<typeof estadoPlanSchema>;

/** Espacios Unicode (categoría `Zs`: no separable, ideográfico, finos, etc.) y el braille en blanco U+2800, que se ve como un espacio. */
const ESPACIOS_UNICODE = /[\p{Zs}\u2800]/gu;

/**
 * Caracteres de formato (`Cf`) y los que Unicode manda ignorar al mostrar el texto (`Default_Ignorable_Code_Point`): ancho cero U+200B, U+200C, U+200D,
 * U+2060, U+FEFF, guion suave U+00AD, unión de grafemas U+034F, selectores de variación (U+FE00 a U+FE0F, U+E0100 a U+E01EF),
 * selectores mongoles (U+180B a U+180F), U+17B4 y U+17B5, rellenos de hangul (U+115F, U+1160, U+3164, U+FFA0), etiquetas, etc.
 * Se excluyen los de control bidireccional: no se eliminan, `textoVisibleSchema` los rechaza con 400.
 */
const IGNORABLES_INVISIBLES = /(?![\p{Bidi_Control}])[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * Normaliza el nombre de un plan (criterio 34, DT-6 de 004): dos nombres que se ven iguales son el mismo. Se eliminan los caracteres invisibles (`Cf` y `Default_Ignorable_Code_Point`), salvo los de control
 * bidireccional; los espacios Unicode y el braille en blanco pasan a un espacio normal; los espacios seguidos se colapsan en uno, se recortan los extremos y, al final, el texto queda en NFC
 * (al final, porque quitar un invisible entre una letra y su tilde suelta deja marcas que solo entonces se pueden componer).
 * Función pura e idempotente: la web y la API aplican la misma antes de validar.
 */
export function normalizarNombrePlan(texto: string): string {
  return texto
    .replace(IGNORABLES_INVISIBLES, '')
    .replace(ESPACIOS_UNICODE, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .normalize('NFC');
}

/** El nombre se normaliza antes de validar: los límites de 3 a 80 caracteres y 3 visibles se miden sobre el nombre que se guarda. */
const nombrePlanSchema = z
  .string()
  .transform(normalizarNombrePlan)
  .pipe(
    textoVisibleSchema({
      sujeto: 'El nombre',
      min: LIMITES_PLAN.nombre.minimo,
      max: LIMITES_PLAN.nombre.maximo,
    }),
  );

function enteroDe(campo: 'vecesPorSemana' | 'clasesPorMes' | 'duracionMinutos', sujeto: string, unidad: string) {
  const { minimo, maximo } = LIMITES_PLAN[campo];
  return z
    .number(`${sujeto} debe ser un número entero.`)
    .int(`${sujeto} debe ser un número entero.`)
    .min(minimo, `${sujeto} debe ser de ${minimo} a ${maximo} ${unidad}.`)
    .max(maximo, `${sujeto} debe ser de ${minimo} a ${maximo} ${unidad}.`);
}

const vecesPorSemanaSchema = enteroDe('vecesPorSemana', 'Las veces por semana', 'veces');
const clasesPorMesSchema = enteroDe('clasesPorMes', 'Las clases por mes', 'clases');
const duracionMinutosSchema = enteroDe('duracionMinutos', 'La duración', 'minutos');

/** Una lista sin repetidos y con al menos un elemento. */
function listaSinRepetidos<T extends z.ZodType>(elemento: T, sujeto: string) {
  return z
    .array(elemento, `${sujeto} debe ser una lista.`)
    .min(1, `Elige al menos un valor en ${sujeto}.`)
    .refine((lista) => new Set(lista).size === lista.length, {
      message: `${sujeto} no puede tener valores repetidos.`,
    });
}

const diasPermitidosSchema = listaSinRepetidos(diaSemanaSchema, 'Los días');
const franjasPermitidasSchema = listaSinRepetidos(horaBloqueSchema, 'Las franjas');
const nivelesAplicablesSchema = listaSinRepetidos(nivelNatacionSchema, 'Los niveles');

export const MENSAJE_DIAS_INSUFICIENTES = 'Elige al menos tantos días como veces por semana tiene el plan.';
export const MENSAJE_VIGENCIA_INVERTIDA = 'La fecha de fin no puede ser anterior a la de inicio.';

/** `AAAA-MM-DD` se compara como texto: el orden alfabético de fechas con ceros a la izquierda es el cronológico. */
export function vigenciaInvertida(inicio: string | null | undefined, fin: string | null | undefined): boolean {
  return typeof inicio === 'string' && typeof fin === 'string' && fin < inicio;
}

/**
 * `POST /api/planes`: estricto (un campo que no es del contrato, como `academiaId` o `estado`, es un 400). `duracionMinutos` vale 60
 * si no se envía. Las reglas que cruzan campos van aquí porque llegan todos (criterio 9).
 */
export const crearPlanSchema = z
  .strictObject({
    nombre: nombrePlanSchema,
    vecesPorSemana: vecesPorSemanaSchema,
    clasesPorMes: clasesPorMesSchema,
    duracionMinutos: duracionMinutosSchema.default(LIMITES_PLAN.duracionMinutos.porDefecto),
    precio: montoSchema,
    diasPermitidos: diasPermitidosSchema,
    franjasPermitidas: franjasPermitidasSchema,
    nivelesAplicables: nivelesAplicablesSchema,
    vigenciaInicio: fechaSchema.nullable().optional(),
    vigenciaFin: fechaSchema.nullable().optional(),
  })
  .superRefine((plan, contexto) => {
    if (plan.diasPermitidos.length < plan.vecesPorSemana) {
      contexto.addIssue({ code: 'custom', path: ['diasPermitidos'], message: MENSAJE_DIAS_INSUFICIENTES });
    }
    if (vigenciaInvertida(plan.vigenciaInicio, plan.vigenciaFin)) {
      contexto.addIssue({ code: 'custom', path: ['vigenciaFin'], message: MENSAJE_VIGENCIA_INVERTIDA });
    }
  });
export type CrearPlan = z.infer<typeof crearPlanSchema>;

/**
 * `PATCH /api/planes/{id}`: estricto, todo opcional más `activo`, al menos un campo. `null` en `vigenciaInicio` o `vigenciaFin` quita
 * esa fecha. Las reglas que cruzan campos las comprueba la API con lo guardado (criterio 12).
 */
export const actualizarPlanSchema = z
  .strictObject({
    nombre: nombrePlanSchema.optional(),
    vecesPorSemana: vecesPorSemanaSchema.optional(),
    clasesPorMes: clasesPorMesSchema.optional(),
    duracionMinutos: duracionMinutosSchema.optional(),
    precio: montoSchema.optional(),
    diasPermitidos: diasPermitidosSchema.optional(),
    franjasPermitidas: franjasPermitidasSchema.optional(),
    nivelesAplicables: nivelesAplicablesSchema.optional(),
    vigenciaInicio: fechaSchema.nullable().optional(),
    vigenciaFin: fechaSchema.nullable().optional(),
    activo: z.boolean('El estado debe ser verdadero o falso.').optional(),
  })
  .refine((cuerpo) => Object.values(cuerpo).some((valor) => valor !== undefined), {
    message: 'Envía al menos un campo del plan.',
  });
export type ActualizarPlan = z.infer<typeof actualizarPlanSchema>;

/** Un plan tal como lo devuelve la API: `precio` como texto con dos decimales y `estado` calculado al leer. */
export const planSchema = z.strictObject({
  id: z.uuid(),
  nombre: z.string(),
  vecesPorSemana: z.number().int(),
  clasesPorMes: z.number().int(),
  duracionMinutos: z.number().int(),
  precio: montoSchema,
  diasPermitidos: z.array(diaSemanaSchema),
  franjasPermitidas: z.array(horaBloqueSchema),
  nivelesAplicables: z.array(nivelNatacionSchema),
  vigenciaInicio: fechaSchema.nullable(),
  vigenciaFin: fechaSchema.nullable(),
  activo: z.boolean(),
  estado: estadoPlanSchema,
});
export type Plan = z.infer<typeof planSchema>;

export const respuestaPlanSchema = z.strictObject({ plan: planSchema });
export type RespuestaPlan = z.infer<typeof respuestaPlanSchema>;

export const respuestaListaPlanesSchema = z.strictObject({ planes: z.array(planSchema) });
export type RespuestaListaPlanes = z.infer<typeof respuestaListaPlanesSchema>;
