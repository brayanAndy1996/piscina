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
