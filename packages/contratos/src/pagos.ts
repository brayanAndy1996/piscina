import { z } from 'zod';
import { conceptoMovimientoSchema, metodoPagoSchema } from './caja';
import { montoCotizadoSchema, montoDeLecturaSchema } from './dinero';
import { fechaSchema } from './horario';
import { textoVisibleSchema } from './texto';

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
