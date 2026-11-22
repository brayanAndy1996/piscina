import { z } from 'zod';
import { fechaSchema } from './horario';
import { montoConSignoSchema, montoDeLecturaSchema, montoNoNegativoSchema, montoSchema } from './dinero';
import { contarVisibles, sinControles, textoVisibleSchema, tieneBidiOSeparadores } from './texto';

/**
 * Caja del día (spec 006a; HU-25 a HU-27, RN-17, RN-22; D-03, D-04, D-23). Los montos viajan como texto con dos decimales (`"120.00"`) y
 * se calculan con `Decimal` en la API y en céntimos enteros (`bigint`) en la web: nunca con coma flotante. Todos los esquemas son
 * estrictos: un campo de más en un cuerpo es un 400. Los esquemas de entrada (`abrirCajaSchema`…) los valida la API y los formularios; los
 * de respuesta (`cajaSchema`…) describen lo que la API devuelve.
 */

/** Los métodos de pago (D-04). La caja los guarda en cada ingreso y la 007 los reutiliza en los pagos. */
export const METODOS_PAGO = ['EFECTIVO', 'YAPE', 'TRANSFERENCIA'] as const;
export const metodoPagoSchema = z.enum(METODOS_PAGO);
export type MetodoPago = z.infer<typeof metodoPagoSchema>;

/** Los conceptos de un movimiento de la caja: tres de ingreso (HU-26) y el egreso menor (DR-3). La 019 suma el suyo. */
export const CONCEPTOS_MOVIMIENTO = ['INSCRIPCION', 'MENSUALIDAD', 'CLASE_PARTICULAR', 'EGRESO_MENOR'] as const;
export const conceptoMovimientoSchema = z.enum(CONCEPTOS_MOVIMIENTO);
export type ConceptoMovimiento = z.infer<typeof conceptoMovimientoSchema>;

export const TIPOS_MOVIMIENTO = ['INGRESO', 'EGRESO'] as const;
export const tipoMovimientoSchema = z.enum(TIPOS_MOVIMIENTO);
export type TipoMovimiento = z.infer<typeof tipoMovimientoSchema>;

/** Estado de la caja (sección 8.8): `ABIERTA` → `CERRADA`; el administrador puede reabrirla. */
export const ESTADOS_CAJA = ['ABIERTA', 'CERRADA'] as const;
export const estadoCajaSchema = z.enum(ESTADOS_CAJA);
export type EstadoCaja = z.infer<typeof estadoCajaSchema>;

/** Resultado de un cierre: el efectivo contado frente al esperado (sección 4.3). */
export const RESULTADOS_CIERRE = ['CUADRA', 'SOBRANTE', 'FALTANTE'] as const;
export const resultadoCierreSchema = z.enum(RESULTADOS_CIERRE);
export type ResultadoCierre = z.infer<typeof resultadoCierreSchema>;

/** Límites de los textos y números de la caja (criterios 18, 30 y 35). */
export const LIMITES_CAJA = {
  descripcion: { min: 3, max: 200 },
  comprobante: { max: 60 },
  observacion: { min: 3, max: 500 },
  motivo: { min: 3, max: 200 },
  ultimoMovimientoVisto: { min: 0, max: 1_000_000 },
} as const;

/** El mensaje del 400 de un cierre con diferencia y sin observación (criterio 30). */
export const MENSAJE_EXPLICA_LA_DIFERENCIA = 'Explica la diferencia (sobrante o faltante)';

const claveIdempotenciaSchema = z.uuid('La clave del envío no es válida.');

// ---------------------------------------------------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------------------------------------------------

/** `POST /api/cajas` (criterios 10, 11 y 16): la fecha nunca viene del cliente. */
export const abrirCajaSchema = z.strictObject({
  claveIdempotencia: claveIdempotenciaSchema,
  montoInicial: montoNoNegativoSchema,
});
export type AbrirCaja = z.infer<typeof abrirCajaSchema>;

/**
 * El comprobante opcional de un egreso (DR-3, criterios 18 y 47): se recorta como la descripción (el `trim` también quita U+2028 y U+2029
 * de los bordes) y rechaza lo mismo que ella: controles, sustitutos sueltos, caracteres de dirección del texto y separadores de línea o de
 * párrafo (antes de normalizar, así que U+202E solo es un 400), y más de 60 caracteres. Si lo que queda no tiene ningún carácter visible
 * (`contarVisibles`: vacío, solo espacios, solo invisibles), nulo o ausente, cuenta como "sin comprobante" y se guarda `null`. Con algo
 * visible se guarda tal como llega, recortado, sin mínimo de visibles.
 */
const comprobanteSchema = sinControles(
  z
    .string('El comprobante debe ser un texto.')
    .trim()
    .max(
      LIMITES_CAJA.comprobante.max,
      `El comprobante debe tener como máximo ${LIMITES_CAJA.comprobante.max} caracteres.`,
    ),
  'El comprobante no puede contener caracteres de control ni caracteres no válidos.',
)
  .refine((valor) => !tieneBidiOSeparadores(valor), {
    message: 'El comprobante no puede contener caracteres de dirección del texto ni separadores de línea.',
  })
  .nullish()
  .transform((valor): string | null =>
    valor === undefined || valor === null || contarVisibles(valor) === 0 ? null : valor,
  );

/** `POST /api/cajas/{id}/egresos` (criterios 17, 18 y 22): siempre en efectivo y con el concepto `EGRESO_MENOR` (DR-3). */
export const registrarEgresoSchema = z.strictObject({
  claveIdempotencia: claveIdempotenciaSchema,
  descripcion: textoVisibleSchema({ sujeto: 'La descripción', ...LIMITES_CAJA.descripcion }),
  monto: montoSchema,
  comprobante: comprobanteSchema,
});
export type RegistrarEgreso = z.infer<typeof registrarEgresoSchema>;
export type RegistrarEgresoEntrada = z.input<typeof registrarEgresoSchema>;

/** `POST /api/cajas/{id}/cierre` (criterios 29 a 31 y 34). La observación vacía no cuenta como ausente (PP6 c). */
export const cerrarCajaSchema = z.strictObject({
  claveIdempotencia: claveIdempotenciaSchema,
  montoDeclarado: montoNoNegativoSchema,
  ultimoMovimientoVisto: z
    .number('El último movimiento visto debe ser un número entero.')
    .int('El último movimiento visto debe ser un número entero.')
    .min(LIMITES_CAJA.ultimoMovimientoVisto.min, 'El último movimiento visto no puede ser negativo.')
    .max(LIMITES_CAJA.ultimoMovimientoVisto.max, 'El último movimiento visto es demasiado grande.'),
  observacion: textoVisibleSchema({ sujeto: 'La observación', ...LIMITES_CAJA.observacion }).nullish(),
});
export type CerrarCaja = z.infer<typeof cerrarCajaSchema>;
export type CerrarCajaEntrada = z.input<typeof cerrarCajaSchema>;

/** `POST /api/cajas/{id}/reapertura` (criterio 35): el motivo queda en el cierre y en la auditoría (sección 11.4). */
export const reabrirCajaSchema = z.strictObject({
  motivo: textoVisibleSchema({ sujeto: 'El motivo', ...LIMITES_CAJA.motivo }),
});
export type ReabrirCaja = z.infer<typeof reabrirCajaSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------------------------------------------------

/** Una persona de la caja: nunca lleva el DNI (RNF-05). */
export const personaCajaSchema = z.strictObject({
  id: z.uuid(),
  nombres: z.string(),
  apellidos: z.string(),
});
export type PersonaCaja = z.infer<typeof personaCajaSchema>;

export const movimientoCajaSchema = z.strictObject({
  id: z.uuid(),
  numero: z.number().int().min(1),
  tipo: tipoMovimientoSchema,
  concepto: conceptoMovimientoSchema,
  metodo: metodoPagoSchema,
  monto: montoDeLecturaSchema,
  descripcion: z.string().nullable(),
  comprobante: z.string().nullable(),
  alumno: personaCajaSchema.nullable(),
  registradoPor: personaCajaSchema,
  registradoEn: z.iso.datetime(),
});
export type MovimientoCaja = z.infer<typeof movimientoCajaSchema>;

const ingresosPorMetodoSchema = z.strictObject({
  efectivo: montoDeLecturaSchema,
  yape: montoDeLecturaSchema,
  transferencia: montoDeLecturaSchema,
});

/**
 * Ingresos y egresos por método, esperado por método (Yape y transferencia no suman al efectivo, D-04) y el número del último movimiento
 * (0 si no hay), que el cierre devuelve como `ultimoMovimientoVisto` (D3).
 */
export const resumenCajaSchema = z.strictObject({
  ingresos: ingresosPorMetodoSchema,
  egresos: z.strictObject({ efectivo: montoDeLecturaSchema }),
  esperado: ingresosPorMetodoSchema,
  ultimoMovimiento: z.number().int().min(0),
});
export type ResumenCaja = z.infer<typeof resumenCajaSchema>;

export const reaperturaCierreSchema = z.strictObject({
  reabiertaPor: personaCajaSchema,
  reabiertaEn: z.iso.datetime(),
  motivo: z.string(),
});

/** La foto de lo calculado al cerrar, con la reapertura si ese cierre se reabrió (D1). */
export const cierreCajaSchema = z.strictObject({
  numero: z.number().int().min(1),
  cerradoPor: personaCajaSchema,
  cerradoEn: z.iso.datetime(),
  montoInicial: montoDeLecturaSchema,
  ingresos: ingresosPorMetodoSchema,
  egresos: z.strictObject({ efectivo: montoDeLecturaSchema }),
  esperado: ingresosPorMetodoSchema,
  montoDeclarado: montoDeLecturaSchema,
  diferencia: montoConSignoSchema,
  resultado: resultadoCierreSchema,
  observacion: z.string().nullable(),
  tardio: z.boolean(),
  movimientosHasta: z.number().int().min(0),
  reapertura: reaperturaCierreSchema.nullable(),
});
export type CierreCaja = z.infer<typeof cierreCajaSchema>;

export const cajaSchema = z.strictObject({
  id: z.uuid(),
  fecha: fechaSchema,
  estado: estadoCajaSchema,
  deOtroDia: z.boolean(),
  montoInicial: montoDeLecturaSchema,
  abiertaPor: personaCajaSchema,
  abiertaEn: z.iso.datetime(),
  resumen: resumenCajaSchema,
  movimientos: z.array(movimientoCajaSchema),
  cierres: z.array(cierreCajaSchema),
});
export type Caja = z.infer<typeof cajaSchema>;

export const respuestaCajaSchema = z.strictObject({ caja: cajaSchema });
export type RespuestaCaja = z.infer<typeof respuestaCajaSchema>;

export const respuestaCajaActualSchema = z.strictObject({ caja: cajaSchema.nullable() });
export type RespuestaCajaActual = z.infer<typeof respuestaCajaActualSchema>;

export const respuestaEgresoSchema = z.strictObject({ movimiento: movimientoCajaSchema, caja: cajaSchema });
export type RespuestaEgreso = z.infer<typeof respuestaEgresoSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Historial de cajas (spec 006b, criterio 40, PQ3, PQ4 y PQ13)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Los límites del rango del historial (PQ3): sin parámetros, los últimos 31 días contando los dos extremos (hasta hoy en Lima), y como mucho
 * 366 días contando los dos extremos.
 */
export const LIMITES_HISTORIAL_CAJAS = { diasPorDefecto: 31, diasMaximos: 366 } as const;

export const MENSAJE_RANGO_INVERTIDO = 'La fecha inicial no puede ser posterior a la final.';
export const MENSAJE_RANGO_DEMASIADO_LARGO = `El rango puede ser de como mucho ${LIMITES_HISTORIAL_CAJAS.diasMaximos} días.`;

const MS_POR_DIA = 86_400_000;
const PRIMERA_FECHA = '0001-01-01';

/** Los días de calendario desde 1970-01-01 de una fecha `AAAA-MM-DD` ya comprobada. Sin zona horaria: solo UTC sobre el calendario. */
function diaDeCalendario(fecha: string): number {
  const [anio = 0, mes = 1, dia = 1] = fecha.split('-').map(Number);
  const instante = new Date(0);
  // `setUTCFullYear` con las tres partes no desplaza los años 0 a 99 como lo hace `Date.UTC`.
  instante.setUTCFullYear(anio, mes - 1, dia);
  return Math.round(instante.getTime() / MS_POR_DIA);
}

/** La fecha `AAAA-MM-DD` de unos días de calendario desde 1970-01-01. */
function fechaDeDiaDeCalendario(dias: number): string {
  const instante = new Date(dias * MS_POR_DIA);
  const anio = String(instante.getUTCFullYear()).padStart(4, '0');
  const mes = String(instante.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(instante.getUTCDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/**
 * El rango que se aplica (PQ3), con `hoy` (la fecha de hoy en Lima) para lo que falte: sin `hasta`, `hasta` es `hoy`; sin `desde`, `desde` es
 * `hasta` menos 30 días (31 días contando los dos extremos), sin bajar de `0001-01-01`. Las cuentas son en días de calendario, sin zona horaria.
 * Las fechas de entrada ya deben ser válidas (`fechaSchema`); no valida el rango (`mensajeDelRangoDelHistorial`).
 */
export function rangoDelHistorial(
  filtro: { readonly desde?: string | undefined; readonly hasta?: string | undefined },
  hoy: string,
): { desde: string; hasta: string } {
  const hasta = filtro.hasta ?? hoy;
  if (filtro.desde !== undefined) return { desde: filtro.desde, hasta };
  const desde = fechaDeDiaDeCalendario(diaDeCalendario(hasta) - (LIMITES_HISTORIAL_CAJAS.diasPorDefecto - 1));
  return { desde: desde < PRIMERA_FECHA ? PRIMERA_FECHA : desde, hasta };
}

/**
 * El mensaje de error del rango (PQ3), o `null` si vale: `desde` posterior a `hasta`, o más de 366 días contando los dos extremos
 * (`hasta - desde > 365`). Ambos errores se informan en el campo `desde`. Las fechas ya deben ser válidas.
 */
export function mensajeDelRangoDelHistorial(desde: string, hasta: string): string | null {
  if (desde > hasta) return MENSAJE_RANGO_INVERTIDO;
  if (diaDeCalendario(hasta) - diaDeCalendario(desde) > LIMITES_HISTORIAL_CAJAS.diasMaximos - 1) {
    return MENSAJE_RANGO_DEMASIADO_LARGO;
  }
  return null;
}

/**
 * Una fecha de la consulta: `fechaSchema` con un solo error por campo (PQ3, "uno por campo"). Con el formato mal escrito, `fechaSchema` diría
 * también que la fecha no existe; aquí el primer error corta (`abort`) y el segundo nunca se agrega. Un texto vacío, un arreglo, un objeto y
 * `null` fallan en el primer paso.
 */
const fechaDeConsultaSchema = z
  .string('La fecha debe ser un texto AAAA-MM-DD.')
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha debe tener el formato AAAA-MM-DD.', abort: true })
  .pipe(fechaSchema);

/**
 * La consulta de `GET /api/cajas` (PQ3): solo `desde` y `hasta`, cada uno con `fechaSchema`; los demás parámetros se ignoran. La API arma el
 * objeto con `undefined` si el parámetro no viene, el texto si viene una vez y un arreglo si se repite o se escribe con corchetes (un error en
 * su campo); un valor vacío tampoco es una fecha. Si los dos valores vienen y tienen formato válido, también se comprueba el rango (error en
 * `desde`). Los valores por defecto los aplica el servicio con el reloj (`rangoDelHistorial`).
 */
export const filtroHistorialCajasSchema = z
  .object({ desde: fechaDeConsultaSchema.optional(), hasta: fechaDeConsultaSchema.optional() })
  .superRefine((filtro, contexto) => {
    // Con un formato inválido en cualquiera de los dos, el rango no se evalúa (la regla corre aunque haya errores de campo).
    if (!fechaSchema.safeParse(filtro.desde).success || !fechaSchema.safeParse(filtro.hasta).success) return;
    const mensaje = mensajeDelRangoDelHistorial(filtro.desde as string, filtro.hasta as string);
    if (mensaje !== null) contexto.addIssue({ code: 'custom', path: ['desde'], message: mensaje });
  });
export type FiltroHistorialCajas = z.infer<typeof filtroHistorialCajasSchema>;

/** El último cierre de una caja en la lista: el de mayor `numero`, vigente o reabierto. */
const ultimoCierreDeHistorialSchema = z.strictObject({
  numero: z.number().int().min(1),
  montoDeclarado: montoDeLecturaSchema,
  diferencia: montoConSignoSchema,
  resultado: resultadoCierreSchema,
  tardio: z.boolean(),
  cerradoPor: personaCajaSchema,
  cerradoEn: z.iso.datetime(),
});

/**
 * Una caja de la lista del historial (PQ4): sin movimientos ni cierres, con los totales de ahora (no la foto del cierre) y el último cierre o
 * `null`. Una caja `ABIERTA` con `ultimoCierre` es una caja reabierta. Sin DNI.
 */
export const cajaHistorialSchema = z.strictObject({
  id: z.uuid(),
  fecha: fechaSchema,
  estado: estadoCajaSchema,
  deOtroDia: z.boolean(),
  montoInicial: montoDeLecturaSchema,
  abiertaPor: personaCajaSchema,
  totalIngresos: ingresosPorMetodoSchema,
  totalEgresos: z.strictObject({ efectivo: montoDeLecturaSchema }),
  ultimoCierre: ultimoCierreDeHistorialSchema.nullable(),
});
export type CajaHistorial = z.infer<typeof cajaHistorialSchema>;

/** `GET /api/cajas`: el rango que se aplicó (después de los valores por defecto) y las cajas, de la fecha más reciente a la más antigua. */
export const respuestaHistorialCajasSchema = z.strictObject({
  desde: fechaSchema,
  hasta: fechaSchema,
  cajas: z.array(cajaHistorialSchema),
});
export type RespuestaHistorialCajas = z.infer<typeof respuestaHistorialCajasSchema>;
