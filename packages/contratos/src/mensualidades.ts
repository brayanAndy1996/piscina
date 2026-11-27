import { z } from 'zod';
import { diaSemanaSchema, fechaSchema, horaBloqueSchema, nivelNatacionSchema } from './horario';
import { montoCotizadoSchema, montoSchema } from './dinero';
import { claseIdsSchema, cotizacionSchema, mesSchema, planPublicoSchema } from './inscripcion';
import { metodoConComprobanteSchema, numeroOperacionSchema, pagoSchema } from './pagos';
import { textoVisibleSchema } from './texto';

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
const PATRON_DE_MES = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/**
 * Los parámetros de `GET /api/mensualidades` (criterio 25). Todos son opcionales y el esquema es estricto: uno que no se define (como una
 * academia), repetido o con otra forma es un 400 `SOLICITUD_INVALIDA` con el campo. La academia sale siempre de la sesión.
 */
export const consultaListadoMensualidadesSchema = z.strictObject({
  // La cota solo se comprueba si el formato es válido: un mes mal escrito da un solo error, el del formato.
  mes: mesSchema
    .refine((mes) => !PATRON_DE_MES.test(mes) || mes >= PRIMER_MES_DEL_LISTADO, {
      message: 'El mes no puede ser anterior a 2000-01.',
    })
    .optional(),
  estado: estadoMensualidadSchema.optional(),
  planId: z.uuid('El plan no es válido.').optional(),
  nivel: nivelNatacionSchema.optional(),
  claseId: z.uuid('La clase no es válida.').optional(),
  /** Solo a este alumno (la ficha del alumno): uno de otra academia o que no existe da la lista vacía. */
  alumnoId: z.uuid('El alumno no es válido.').optional(),
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

// ---------------------------------------------------------------------------------------------------------------------------------
// 010c · Cambio de horario (HU-03, RN-08)
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * `POST /api/matriculas/{id}/horario` (criterio 35): las clases que tendrá la matrícula (todas, no solo las que cambian) y el motivo, de 3 a 200
 * caracteres visibles. Estricto: la academia, el alumno, el plan y los montos no se aceptan del cliente; la matrícula va en la dirección.
 */
export const cambiarHorarioSchema = z.strictObject({
  claseIds: claseIdsSchema,
  motivo: textoVisibleSchema({ sujeto: 'El motivo', min: 3, max: 200 }),
});
export type CambiarHorario = z.infer<typeof cambiarHorarioSchema>;

/** La matrícula después del cambio. Sin DNI, nombres, plan ni pagos: el dinero y las clases del mes no cambian (criterio 37). */
export const respuestaCambioHorarioSchema = z.strictObject({
  matricula: z.strictObject({
    id: z.uuid(),
    mes: mesSchema,
    clases: z.array(claseDeMensualidadSchema),
    clasesTotales: z.number().int().min(0),
    clasesUsadas: z.number().int().min(0),
    /** Las clases del nuevo horario que quedan en el mes de la matrícula desde «ahora» (o desde el día 1 si es del mes siguiente). */
    ocurrenciasRestantes: z.number().int().min(0),
  }),
});
export type RespuestaCambioHorario = z.infer<typeof respuestaCambioHorarioSchema>;

/**
 * `GET /api/alumnos/{id}/horario` (criterio 46, DT-38): las matrículas del alumno cuyo horario se puede cambiar (de M o de M+1, `VIGENTE` o en
 * verificación), cada una con su plan tal como está hoy, sus clases actuales y las clases que el plan deja elegir con su cupo para este alumno (sin contar
 * la matrícula que se cambia). Sin DNI, nombres, datos médicos, apoderado, montos ni datos de otros alumnos.
 */
export const matriculaDelHorarioSchema = z.strictObject({
  id: z.uuid(),
  mes: mesSchema,
  /** El estado de la matrícula (no el de la mensualidad de HU-11): `VIGENTE`, o `EN_VERIFICACION` si espera la aprobación de su pago. */
  estado: z.enum(['VIGENTE', 'EN_VERIFICACION']),
  plan: z.strictObject({
    id: z.uuid(),
    nombre: z.string(),
    vecesPorSemana: z.number().int(),
    diasPermitidos: z.array(diaSemanaSchema),
    franjasPermitidas: z.array(horaBloqueSchema),
  }),
  /** Las clases actuales de la matrícula, por día y hora. */
  clases: z.array(claseDeMensualidadSchema),
  clasesTotales: z.number().int().min(0),
  clasesUsadas: z.number().int().min(0),
  /** Las clases activas del nivel actual del alumno en los días y franjas del plan, por día, hora e id. */
  clasesDelPlan: z.array(claseDeLaOfertaSchema),
});
export type MatriculaDelHorario = z.infer<typeof matriculaDelHorarioSchema>;

export const horarioDelAlumnoSchema = z.strictObject({
  alumno: z.strictObject({ id: z.uuid(), nivel: nivelNatacionSchema }),
  /** Ordenadas por mes; vacío si el alumno no tiene ninguna que se pueda cambiar. */
  matriculas: z.array(matriculaDelHorarioSchema),
});
export type HorarioDelAlumno = z.infer<typeof horarioDelAlumnoSchema>;
