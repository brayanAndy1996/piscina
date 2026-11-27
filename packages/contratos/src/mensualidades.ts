import { z } from 'zod';
import { diaSemanaSchema, fechaSchema, horaBloqueSchema, nivelNatacionSchema } from './horario';
import { montoCotizadoSchema, montoSchema } from './dinero';
import { claseIdsSchema, cotizacionSchema, mesSchema, planPublicoSchema } from './inscripcion';
import { metodoConComprobanteSchema, numeroOperacionSchema, pagoSchema } from './pagos';

/**
 * Mensualidades y renovación (spec 010a; HU-12, D-03, D-04, D-06). Los montos viajan como texto, nunca como número. Todos los cuerpos
 * son estrictos: la academia, el alumno (va en la dirección), el monto ajustado y el estado no se aceptan del cliente.
 */

/** Cabecera con los datos del comprobante de una renovación en `PUT /api/alumnos/{id}/renovacion/comprobante` (criterio 7, DT-8). */
export const CABECERA_DATOS_RENOVACION = 'X-Renovacion-Datos';

/** Largo máximo, en bytes, de la cabecera `X-Renovacion-Datos`: lleva además el mes, el plan y las clases (criterio 7). */
export const DATOS_RENOVACION_LARGO_MAXIMO = 2048;

/** El alumno de la oferta: lo que recepción necesita para elegir el plan y las clases. Sin DNI, datos médicos ni apoderado. */
const alumnoDeLaOfertaSchema = z.strictObject({
  id: z.uuid(),
  nombres: z.string(),
  apellidos: z.string(),
  nivel: nivelNatacionSchema,
  estado: z.enum(['ALUMNO_ACTIVO', 'ALUMNO_VENCIDO', 'INACTIVO']),
});

/** Una clase de una mensualidad: el día y la hora, tal como las lee la web y el ticket. */
export const claseDeMensualidadSchema = z.strictObject({
  id: z.uuid(),
  diaSemana: diaSemanaSchema,
  horaInicio: horaBloqueSchema,
  horaFin: z.string(),
});
export type ClaseDeMensualidad = z.infer<typeof claseDeMensualidadSchema>;

/** Una clase que se puede elegir para renovar: con el cupo libre para este alumno y si el lugar le está apartado (D-06, DT-4). */
export const claseDeLaOfertaSchema = z.strictObject({
  id: z.uuid(),
  nivel: nivelNatacionSchema,
  diaSemana: diaSemanaSchema,
  horaInicio: horaBloqueSchema,
  horaFin: z.string(),
  /** El cupo libre para este alumno en el mes pedido (definición «Cupo libre» de la spec; nunca negativo). */
  cuposRestantes: z.number().int().min(0),
  /** `true` si el alumno es titular de prioridad en esta clase (su lugar está apartado para el mes siguiente). */
  conPrioridad: z.boolean(),
});
export type ClaseDeLaOferta = z.infer<typeof claseDeLaOfertaSchema>;

/** `GET /api/alumnos/{id}/renovacion?mes=AAAA-MM` (criterio 2). */
export const ofertaRenovacionSchema = z.strictObject({
  alumno: alumnoDeLaOfertaSchema,
  /** Los meses que se pueden renovar ahora, en orden cronológico, sin los que ya tienen una matrícula que ocupa cupo. */
  mesesPermitidos: z.array(mesSchema),
  /** El mes de esta oferta: el pedido o, sin `mes`, el siguiente si la ventana está abierta y se permite; si no, el mes en curso. */
  mes: mesSchema,
  /** La ventana de renovación del mes en curso: los últimos `diasPrioridadRenovacion` días (ambos incluidos). */
  ventana: z.strictObject({ desde: fechaSchema, hasta: fechaSchema }),
  /** La matrícula del alumno del mes en curso (la vigente o la que está en verificación), o `null`. */
  mensualidadActual: z
    .strictObject({
      mes: mesSchema,
      plan: z.strictObject({ id: z.uuid(), nombre: z.string() }),
      clases: z.array(claseDeMensualidadSchema),
    })
    .nullable(),
  /** Vacío si el `mes` no está permitido. */
  planes: z.array(planPublicoSchema),
  /** Vacío si el `mes` no está permitido. */
  clases: z.array(claseDeLaOfertaSchema),
});
export type OfertaRenovacion = z.infer<typeof ofertaRenovacionSchema>;

/** `POST /api/alumnos/{id}/renovacion/cotizacion` (criterio 5). */
export const cotizarRenovacionSchema = z.strictObject({
  mes: mesSchema,
  planId: z.uuid('El plan no es válido.'),
  claseIds: claseIdsSchema,
});
export type CotizarRenovacion = z.infer<typeof cotizarRenovacionSchema>;

export const respuestaCotizacionRenovacionSchema = z.strictObject({ cotizacion: cotizacionSchema });
export type RespuestaCotizacionRenovacion = z.infer<typeof respuestaCotizacionRenovacionSchema>;

/** `POST /api/alumnos/{id}/renovacion/efectivo` (criterio 6): la clave del intento y el total que la web mostró a quien cobra. */
export const renovarEnEfectivoSchema = z.strictObject({
  claveIdempotencia: z.uuid('La clave del cobro no es válida.'),
  mes: mesSchema,
  planId: z.uuid('El plan no es válido.'),
  claseIds: claseIdsSchema,
  montoMostrado: montoCotizadoSchema,
});
export type RenovarEnEfectivo = z.infer<typeof renovarEnEfectivoSchema>;

/** Los datos de `X-Renovacion-Datos` (criterio 7): los de `datosComprobanteSchema` de la 007b y los de la renovación. */
export const datosRenovacionComprobanteSchema = z.strictObject({
  claveIdempotencia: z.uuid('La clave del comprobante no es válida.'),
  mes: mesSchema,
  planId: z.uuid('El plan no es válido.'),
  claseIds: claseIdsSchema,
  metodo: metodoConComprobanteSchema,
  numeroOperacion: numeroOperacionSchema,
  monto: montoSchema,
  fechaOperacion: fechaSchema,
});
export type DatosRenovacionComprobante = z.infer<typeof datosRenovacionComprobanteSchema>;

/** La renovación registrada (criterio 11). Sin DNI, token, datos médicos, apoderado ni clave del archivo. */
export const renovacionRegistradaSchema = z.strictObject({
  matriculaId: z.uuid(),
  mes: mesSchema,
  estado: z.enum(['VIGENTE', 'EN_VERIFICACION']),
  plan: z.strictObject({ id: z.uuid(), nombre: z.string() }),
  clases: z.array(claseDeMensualidadSchema),
  fechaInicio: fechaSchema,
  fechaFin: fechaSchema,
  clasesTotales: z.number().int(),
  /** El total cobrado o por verificar, con dos decimales. */
  total: z.string().regex(/^[0-9]+\.[0-9]{2}$/),
  /** Los ids de las clases en las que usó su prioridad (era titular en ellas), ordenados. */
  conPrioridad: z.array(z.uuid()),
});
export type RenovacionRegistrada = z.infer<typeof renovacionRegistradaSchema>;

/** `201` del registro (o `200` con `repetida: true` si ya estaba, criterio 12). */
export const respuestaRenovacionSchema = z.strictObject({
  renovacion: renovacionRegistradaSchema,
  pago: pagoSchema,
  repetida: z.boolean(),
});
export type RespuestaRenovacion = z.infer<typeof respuestaRenovacionSchema>;

// ---------------------------------------------------------------------------------------------------------------------------------
// 010b · Estados de la mensualidad y listado (HU-11)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Los estados de la mensualidad de un alumno en un mes (criterio 24, HU-11). */
export const ESTADOS_MENSUALIDAD = ['AL_DIA', 'POR_VENCER', 'VENCIDO', 'PENDIENTE_VERIFICACION'] as const;
export const estadoMensualidadSchema = z.enum(ESTADOS_MENSUALIDAD);
export type EstadoMensualidad = z.infer<typeof estadoMensualidadSchema>;

/** El primer mes que acepta el listado (criterio 25): `2000-01`. El tope, el mes en curso de Lima, lo comprueba el servicio con el reloj. */
export const PRIMER_MES_DEL_LISTADO = '2000-01';

/**
 * Los parámetros de `GET /api/mensualidades` (criterio 25). Todos son opcionales y el esquema es estricto: uno que no se define (como una
 * academia), repetido o con otra forma es un 400 `SOLICITUD_INVALIDA` con el campo. La academia sale siempre de la sesión.
 */
export const consultaListadoMensualidadesSchema = z.strictObject({
  mes: mesSchema
    .refine((mes) => mes >= PRIMER_MES_DEL_LISTADO, { message: 'El mes no puede ser anterior a 2000-01.' })
    .optional(),
  estado: estadoMensualidadSchema.optional(),
  planId: z.uuid('El plan no es válido.').optional(),
  nivel: nivelNatacionSchema.optional(),
  claseId: z.uuid('La clase no es válida.').optional(),
});
export type ConsultaListadoMensualidades = z.infer<typeof consultaListadoMensualidadesSchema>;

/** La mensualidad que muestra una fila: la del mes del listado o, si el alumno está vencido, la del mes anterior (criterio 25). */
export const mensualidadDelListadoSchema = z.strictObject({
  mes: mesSchema,
  plan: z.strictObject({ id: z.uuid(), nombre: z.string() }),
  clases: z.array(claseDeMensualidadSchema),
  clasesUsadas: z.number().int().min(0),
  clasesTotales: z.number().int().min(0),
});
export type MensualidadDelListado = z.infer<typeof mensualidadDelListadoSchema>;

/** Una fila del listado: sin DNI, datos médicos ni apoderado (DT-14, Ley 29733). */
export const filaDelListadoMensualidadesSchema = z.strictObject({
  alumnoId: z.uuid(),
  nombres: z.string(),
  apellidos: z.string(),
  nivel: nivelNatacionSchema,
  estado: estadoMensualidadSchema,
  mensualidad: mensualidadDelListadoSchema,
  /** La mensualidad del mes siguiente (solo si el mes del listado es el mes en curso): pagada, en verificación o ninguna (`null`). */
  siguiente: z.strictObject({ mes: mesSchema, estado: z.enum(['PAGADA', 'EN_VERIFICACION']) }).nullable(),
});
export type FilaDelListadoMensualidades = z.infer<typeof filaDelListadoMensualidadesSchema>;

/** `GET /api/mensualidades` (criterio 25). `totales` cuenta por estado a todos los alumnos que cumplen los filtros, menos el de `estado`. */
export const listadoMensualidadesSchema = z.strictObject({
  mes: mesSchema,
  hoy: fechaSchema,
  totales: z.strictObject({
    AL_DIA: z.number().int().min(0),
    POR_VENCER: z.number().int().min(0),
    VENCIDO: z.number().int().min(0),
    PENDIENTE_VERIFICACION: z.number().int().min(0),
  }),
  alumnos: z.array(filaDelListadoMensualidadesSchema),
  /** `true` si hay más filas de las que se devuelven (como mucho 500, DT-14). */
  hayMas: z.boolean(),
});
export type ListadoMensualidades = z.infer<typeof listadoMensualidadesSchema>;
