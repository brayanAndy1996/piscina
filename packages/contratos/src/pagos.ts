import { z } from 'zod';
import { conceptoMovimientoSchema, metodoPagoSchema } from './caja';
import { montoCotizadoSchema, montoDeLecturaSchema, montoSchema } from './dinero';
import { fechaSchema } from './horario';
import { dniSchema } from './sesion';
import { textoVisibleSchema } from './texto';
import { cuerpoVacioSchema } from './usuarios';

/**
 * Pagos (spec 007a, criterios 4, 11, 13, 16, 26; D-03, D-04, D-07, HU-07, HU-34). Los montos viajan como texto, nunca como número. La
 * 007b suma aquí los esquemas del comprobante, la bandeja y el rechazo.
 */

/** Sección 8.8: un pago se resuelve una vez, a `CONFIRMADO` o a `RECHAZADO`. */
export const ESTADOS_PAGO = ['PENDIENTE_VERIFICACION', 'CONFIRMADO', 'RECHAZADO'] as const;
export const estadoPagoSchema = z.enum(ESTADOS_PAGO);
export type EstadoPago = z.infer<typeof estadoPagoSchema>;

/** Largo máximo del número de operación que escribe la persona y largo máximo del normalizado (criterio 4 d). */
export const NUMERO_OPERACION_LARGO_ESCRITO = 40;
export const NUMERO_OPERACION_LARGO_NORMALIZADO = 30;

/** Espacios de cualquier tipo (también los de ancho completo, que NFKC ya pasó a espacio) y los separadores `-`, `.`, `/` y `_`. */
const SEPARADORES = /[\p{White_Space}\p{Z}\-./_]/gu;

/**
 * El número de operación normalizado (definición de la spec 007): el texto que escribió la persona, en forma NFKC, sin espacios de ningún
 * tipo ni `-`, `.`, `/` y `_`, en mayúsculas y sin ceros a la izquierda (si solo tiene ceros, queda `0`). `" 00012 345 "`, `"12345"`,
 * `"0001-2345"` y `"１２３４５"` dan `"12345"`; `"ab-01"` da `"AB01"`. Devuelve `null` si lo que queda no cumple `^[0-9A-Z]{1,30}$`: las
 * letras se comprueban antes de pasar a mayúsculas, así que `ß` o `ı` (que se mayusculizan a letras ASCII) no valen. Función pura.
 */
export function normalizarNumeroOperacion(escrito: string): string | null {
  if (typeof escrito !== 'string') return null;
  const limpio = escrito.normalize('NFKC').replace(SEPARADORES, '');
  if (!/^[0-9A-Za-z]+$/.test(limpio)) return null;
  const sinCeros = limpio.toUpperCase().replace(/^0+/, '');
  const normalizado = sinCeros === '' ? '0' : sinCeros;
  return normalizado.length <= NUMERO_OPERACION_LARGO_NORMALIZADO ? normalizado : null;
}

/**
 * El número de operación que escribe la persona (criterio 38, DR-6): de 1 a 40 caracteres, recortado, que normalizado cumple
 * `^[0-9A-Z]{1,30}$`. Se guarda el texto recortado y, aparte, el normalizado.
 */
export const numeroOperacionSchema = z
  .string('El número de operación debe ser un texto.')
  .trim()
  .min(1, 'Escribe el número de operación.')
  .max(
    NUMERO_OPERACION_LARGO_ESCRITO,
    `El número de operación debe tener como máximo ${NUMERO_OPERACION_LARGO_ESCRITO} caracteres.`,
  )
  .refine((texto) => normalizarNumeroOperacion(texto) !== null, {
    message: 'El número de operación solo puede tener letras sin tilde y números (hasta 30 caracteres).',
  });

/**
 * `POST /api/solicitudes/{id}/pago-efectivo` (criterio 13): la clave del intento y el total que la web mostró a quien cobra (criterio 16).
 * Estricto: el monto, el método y la academia no se aceptan del cliente.
 */
export const cobrarEnEfectivoSchema = z.strictObject({
  claveIdempotencia: z.uuid('La clave del cobro no es válida.'),
  montoMostrado: montoCotizadoSchema,
});
export type CobrarEnEfectivo = z.infer<typeof cobrarEnEfectivoSchema>;

/** Monto ajustado: soles enteros de `"1"` a `"99999"` (DR-11). Sin ceros a la izquierda, sin céntimos y sin `"0"` (las becas llegan con la 015). */
const montoAjustadoSchema = z
  .string('El monto debe ser un texto, por ejemplo "35".')
  .regex(/^[1-9][0-9]{0,4}$/, 'El monto ajustado debe ser un número entero de soles, de 1 a 99999.');

/** `POST /api/solicitudes/{id}/ajuste-monto` (criterio 11): solo el administrador, con un motivo de 3 a 200 caracteres visibles. */
export const ajustarMontoSchema = z.strictObject({
  montoAjustado: montoAjustadoSchema,
  motivo: textoVisibleSchema({ sujeto: 'El motivo', min: 3, max: 200 }),
});
export type AjustarMonto = z.infer<typeof ajustarMontoSchema>;

/** Un pago tal como lo devuelve la API (criterio 13). Nunca lleva el comprobante, la clave de idempotencia, la IP ni quién lo registró. */
export const pagoSchema = z.strictObject({
  id: z.uuid(),
  estado: estadoPagoSchema,
  metodo: metodoPagoSchema,
  concepto: conceptoMovimientoSchema,
  /** Texto con dos decimales. */
  monto: montoDeLecturaSchema,
  registradoEn: z.iso.datetime(),
  verificadoEn: z.iso.datetime().nullable(),
  /** Lo que escribió la persona (solo Yape y transferencia). */
  numeroOperacion: z.string().nullable(),
  fechaOperacion: fechaSchema.nullable(),
  motivoRechazo: z.string().nullable(),
  numeroTicket: z.number().int().nullable(),
});
export type Pago = z.infer<typeof pagoSchema>;

/** La respuesta de `POST …/pago-efectivo` es `{ pago, solicitud }` (la solicitud es el elemento del panel; ver `solicitudes.ts`). */

/** La leyenda fija del ticket interno (DR-4, D-09): no es un comprobante electrónico SUNAT. */
export const LEYENDA_TICKET = 'Comprobante interno de pago. No es un comprobante electrónico SUNAT';

const personaDelTicketSchema = z.strictObject({ nombres: z.string(), apellidos: z.string() });

/**
 * `GET /api/pagos/{id}/ticket` (criterio 26): los datos del ticket interno. Sin DNI (DR-4), sin ids internos, sin claves.
 */
export const ticketSchema = z.strictObject({
  academia: z.strictObject({ nombre: z.string(), telefono: z.string().nullable() }),
  numero: z.number().int().min(1),
  fechaHora: z.iso.datetime(),
  alumno: personaDelTicketSchema,
  concepto: conceptoMovimientoSchema,
  plan: z.strictObject({ nombre: z.string() }),
  /** `AAAA-MM`. */
  mes: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
  metodo: metodoPagoSchema,
  /** Solo Yape o transferencia. */
  numeroOperacion: z.string().nullable(),
  monto: montoDeLecturaSchema,
  /** Quién cobró (efectivo) o verificó (Yape y transferencia). */
  cobradoPor: personaDelTicketSchema,
  leyenda: z.literal(LEYENDA_TICKET),
});
export type Ticket = z.infer<typeof ticketSchema>;

export const respuestaTicketSchema = z.strictObject({ ticket: ticketSchema });
export type RespuestaTicket = z.infer<typeof respuestaTicketSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// 007b: comprobante de Yape o transferencia, bandeja de verificación y rechazo (criterios 36, 38, 45 y 49)
// ---------------------------------------------------------------------------------------------------------------------

/** Cabecera con los datos del pago en `PUT /api/a/{nombreCorto}/solicitudes/comprobante` (un JSON ASCII de hasta 1024 bytes, criterio 36). */
export const CABECERA_DATOS_PAGO = 'X-Pago-Datos';

/** Largo máximo, en bytes, de la cabecera `X-Pago-Datos` (criterio 37, paso 5). */
export const DATOS_PAGO_LARGO_MAXIMO = 1024;

/** Lado mayor, en píxeles, del comprobante que se guarda (DT-8): más grande que la foto (800) para que el número se lea. */
export const COMPROBANTE_LADO_GUARDADO = 2000;

/** Los métodos que llevan comprobante: el efectivo se cobra en recepción y no sube imagen (criterio 38). */
export const METODOS_CON_COMPROBANTE = ['YAPE', 'TRANSFERENCIA'] as const;
export const metodoConComprobanteSchema = z.enum(METODOS_CON_COMPROBANTE, 'El método de pago no es válido.');
export type MetodoConComprobante = z.infer<typeof metodoConComprobanteSchema>;

/**
 * Los datos del comprobante (`X-Pago-Datos`, criterios 36 y 38): estricto, así que ni la academia, ni el estado, ni quién lo registra se
 * aceptan del cliente. `numeroOperacion` es lo que escribió la persona, recortado (se guarda así y, aparte, normalizado); `monto` debe ser
 * igual al total a cobrar (lo decide el servicio, 409 `MONTO_DISTINTO`); `fechaOperacion` es una fecha real (que no sea posterior a hoy en
 * Lima ni anterior al día en que se creó la solicitud lo comprueba el servicio).
 */
export const datosComprobanteSchema = z.strictObject({
  claveIdempotencia: z.uuid('La clave del comprobante no es válida.'),
  metodo: metodoConComprobanteSchema,
  numeroOperacion: numeroOperacionSchema,
  monto: montoSchema,
  fechaOperacion: fechaSchema,
});
export type DatosComprobante = z.infer<typeof datosComprobanteSchema>;

/**
 * Un pago de la bandeja de verificación (`GET /api/pagos/pendientes`, criterio 45): lo que la secretaria necesita para comparar el
 * comprobante con su Yape o su estado de cuenta. Nunca lleva datos médicos, el apoderado, el token, la clave del archivo, el número
 * normalizado ni la IP.
 */
export const pagoPendienteSchema = z.strictObject({
  id: z.uuid(),
  metodo: metodoConComprobanteSchema,
  /** Texto con dos decimales. */
  monto: montoDeLecturaSchema,
  /** Lo que escribió la persona. */
  numeroOperacion: z.string(),
  fechaOperacion: fechaSchema,
  /** Cuándo se subió el comprobante. */
  enviadoEn: z.iso.datetime(),
  /** `null` en una renovación (010a, DT-10): la matrícula no tiene solicitud. */
  solicitud: z.strictObject({ id: z.uuid(), codigo: z.string() }).nullable(),
  cliente: z.strictObject({ nombres: z.string(), apellidos: z.string(), dni: dniSchema }),
  /** `AAAA-MM` de la matrícula. */
  mes: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
  /** Si «hoy» en Lima ya no es del mes de la matrícula (criterio 52). */
  mesTerminado: z.boolean(),
});
export type PagoPendiente = z.infer<typeof pagoPendienteSchema>;

/** Cuántos pagos trae la bandeja como mucho (criterio 45): los más antiguos. */
export const TOPE_DE_LA_BANDEJA = 200;

export const respuestaPagosPendientesSchema = z.strictObject({
  pagos: z.array(pagoPendienteSchema).max(TOPE_DE_LA_BANDEJA),
});
export type RespuestaPagosPendientes = z.infer<typeof respuestaPagosPendientesSchema>;

/** `POST /api/pagos/{id}/aprobacion` (criterio 47): el cuerpo es `{}` estricto. */
export const aprobarPagoSchema = cuerpoVacioSchema;

/** `POST /api/pagos/{id}/rechazo` (criterio 49): el motivo de 3 a 200 caracteres visibles, que se muestra a la persona y queda en la auditoría. */
export const rechazarPagoSchema = z.strictObject({
  motivo: textoVisibleSchema({ sujeto: 'El motivo', min: 3, max: 200 }),
});
export type RechazarPago = z.infer<typeof rechazarPagoSchema>;

/** La respuesta de la aprobación y del rechazo (criterios 47 y 49). */
export const respuestaPagoSchema = z.strictObject({ pago: pagoSchema });
export type RespuestaPago = z.infer<typeof respuestaPagoSchema>;
