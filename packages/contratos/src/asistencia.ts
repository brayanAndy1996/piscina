import { z } from 'zod';
import { diaSemanaSchema, fechaSchema, nivelNatacionSchema } from './horario';
import { textoVisibleSchema } from './texto';

/**
 * Asistencia por QR y manual (spec 009a, criterios 2, 5, 7 y 15; HU-14, HU-15, RN-14 a RN-16, D-07, D-11, D-16). La asistencia la marca el
 * administrador o la secretaria (`REGISTRAR_ASISTENCIA`); la academia sale siempre de la sesión.
 */

/** Estado de llegada (D-11): puntual hasta la tolerancia de la academia, comparada por minuto (DT-3), y tarde después. */
export const ESTADOS_LLEGADA = ['PUNTUAL', 'TARDE'] as const;
export const estadoLlegadaSchema = z.enum(ESTADOS_LLEGADA);
export type EstadoLlegada = z.infer<typeof estadoLlegadaSchema>;

/** Cómo se marcó (D-07): leyendo el QR del carnet o buscando al alumno. */
export const METODOS_ASISTENCIA = ['QR', 'MANUAL'] as const;
export const metodoAsistenciaSchema = z.enum(METODOS_ASISTENCIA);
export type MetodoAsistencia = z.infer<typeof metodoAsistenciaSchema>;

/** El color de un rechazo en la pantalla de recepción (HU-14): rojo, no puede ingresar; amarillo, fuera de su horario o ya marcó. */
export const ALERTAS = ['ROJA', 'AMARILLA'] as const;
export const alertaSchema = z.enum(ALERTAS);
export type Alerta = z.infer<typeof alertaSchema>;

/**
 * Los códigos de un rechazo 409 de la asistencia y su alerta (criterio 7). El orden es el de las validaciones: la primera que falla decide.
 * Los tres últimos son del registro posterior (009b, criterio 28). `CLAVE_YA_USADA` (fila c) no está aquí: es un conflicto de la clave de idempotencia, sin alerta ni `detalles`.
 */
export const CODIGOS_RECHAZO_ASISTENCIA = {
  ALUMNO_INACTIVO: 'ROJA',
  ASISTENCIA_YA_REGISTRADA: 'AMARILLA',
  PAGO_EN_VERIFICACION: 'ROJA',
  MENSUALIDAD_NO_VIGENTE: 'ROJA',
  SIN_CLASES_RESTANTES: 'ROJA',
  FUERA_DE_HORARIO: 'AMARILLA',
  CLASE_NO_INCLUIDA: 'AMARILLA',
  // 009b, registro posterior (criterio 28): la fecha no es del mes en curso o es posterior a hoy, la clase no terminó y la hora de llegada no cae en la clase.
  FECHA_NO_PERMITIDA: 'AMARILLA',
  CLASE_NO_TERMINADA: 'AMARILLA',
  HORA_FUERA_DE_LA_CLASE: 'AMARILLA',
} as const satisfies Record<string, Alerta>;
export type CodigoRechazoAsistencia = keyof typeof CODIGOS_RECHAZO_ASISTENCIA;
export const codigoRechazoAsistenciaSchema = z.enum(
  Object.keys(CODIGOS_RECHAZO_ASISTENCIA) as [CodigoRechazoAsistencia, ...CodigoRechazoAsistencia[]],
);

/** `POST /api/asistencias/qr` (criterio 2): lo que leyó la lectora o la cámara, tal cual (hasta 200 caracteres), y la clave del intento. */
export const registrarAsistenciaQrSchema = z.strictObject({
  contenido: z.string().max(200, 'El contenido del QR es demasiado largo.'),
  claveIdempotencia: z.uuid('La clave del intento no es válida.'),
});
export type RegistrarAsistenciaQr = z.infer<typeof registrarAsistenciaQrSchema>;

/**
 * `POST /api/asistencias/manual` (criterio 5): el alumno elegido en la búsqueda (criterio 16 de la 008) y la clave del intento. `alumnoId` es un
 * texto cualquiera: uno que no es UUID responde el mismo 404 `NO_ENCONTRADO` que uno inexistente (como el `{id}` de las rutas de la 008); uno que
 * no es texto, 400.
 */
export const registrarAsistenciaManualSchema = z.strictObject({
  alumnoId: z.string(),
  claveIdempotencia: z.uuid('La clave del intento no es válida.'),
});
export type RegistrarAsistenciaManual = z.infer<typeof registrarAsistenciaManualSchema>;

/**
 * `POST /api/asistencias/posterior` (009b, criterio 28; D-16): la asistencia de una clase que ya terminó, del mes en curso. `fecha` es `AAAA-MM-DD`, `horaLlegada`
 * es la hora de Lima a la que llegó el alumno (`HH:MM`, dentro de su clase) y el motivo, de 3 a 200 caracteres visibles, queda en la auditoría.
 */
export const registrarAsistenciaPosteriorSchema = z.strictObject({
  alumnoId: z.uuid('El alumno no es válido.'),
  fecha: fechaSchema,
  horaLlegada: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'La hora debe tener el formato HH:MM.'),
  motivo: textoVisibleSchema({ sujeto: 'El motivo', min: 3, max: 200 }),
  claveIdempotencia: z.uuid('La clave del intento no es válida.'),
});
export type RegistrarAsistenciaPosterior = z.infer<typeof registrarAsistenciaPosteriorSchema>;

const horaSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'La hora debe tener el formato HH:MM.');
const contadorSchema = z.number().int().min(0);

/** `data:image/jpeg;base64,…` de la foto del alumno (como el carnet, criterio 9 de la 008), o `null` sin foto o si no se pudo leer. */
const fotoSchema = z
  .string()
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]*={0,2}$/)
  .nullable();

/** El alumno en la pantalla de recepción: sin DNI, fecha de nacimiento, datos médicos, apoderado ni la clave del archivo (criterio 15). */
export const alumnoDeAsistenciaSchema = z.strictObject({
  id: z.uuid(),
  nombres: z.string().min(1),
  apellidos: z.string().min(1),
  nivel: nivelNatacionSchema,
  foto: fotoSchema,
});
export type AlumnoDeAsistencia = z.infer<typeof alumnoDeAsistenciaSchema>;

/** «Le quedan X de Y»: las clases de la matrícula del día, después del descuento si se registró. */
export const clasesDeAsistenciaSchema = z.strictObject({
  usadas: contadorSchema,
  totales: contadorSchema,
  restantes: contadorSchema,
});
export type ClasesDeAsistencia = z.infer<typeof clasesDeAsistenciaSchema>;

/** `201` (o `200` con `repetida: true`) de las dos rutas de marcado (criterio 15). Estricto: lo que no está aquí no sale. */
export const resultadoAsistenciaSchema = z.strictObject({
  asistencia: z.strictObject({
    id: z.uuid(),
    fecha: fechaSchema,
    horaLlegada: horaSchema,
    llegadaEn: z.iso.datetime(),
    estadoLlegada: estadoLlegadaSchema,
    metodo: metodoAsistenciaSchema,
    registroPosterior: z.boolean(),
  }),
  alumno: alumnoDeAsistenciaSchema,
  clase: z.strictObject({
    id: z.uuid(),
    nivel: nivelNatacionSchema,
    diaSemana: diaSemanaSchema,
    horaInicio: horaSchema,
    horaFin: horaSchema,
  }),
  clases: clasesDeAsistenciaSchema,
  repetida: z.boolean(),
});
export type ResultadoAsistencia = z.infer<typeof resultadoAsistenciaSchema>;

/** Los `detalles` de un rechazo 409 (criterio 15): el color, el alumno y lo que la pantalla muestra como motivo. */
export const rechazoAsistenciaSchema = z.strictObject({
  alerta: alertaSchema,
  alumno: alumnoDeAsistenciaSchema,
  claseDeHoy: z.strictObject({ horaInicio: horaSchema, horaFin: horaSchema }).nullable(),
  asistenciaDeHoy: z
    .strictObject({ horaLlegada: horaSchema, estadoLlegada: estadoLlegadaSchema, metodo: metodoAsistenciaSchema })
    .nullable(),
  clases: clasesDeAsistenciaSchema.nullable(),
});
export type RechazoAsistencia = z.infer<typeof rechazoAsistenciaSchema>;

/** El mes de la consulta (`?mes=AAAA-MM`, criterio 31): del 2000-01 al 9999-12. */
export const mesDeAsistenciaSchema = z
  .string()
  .regex(/^[2-9][0-9]{3}-(0[1-9]|1[0-2])$/, 'El mes debe tener el formato AAAA-MM.');

const claseDelRegistroSchema = z.strictObject({ horaInicio: horaSchema, horaFin: horaSchema });

/** Una asistencia en la consulta del mes (criterio 31): sin DNI, motivo ni quién la registró. `faltaCubierta`: cubrió la falta de esa clase y fecha. */
export const registroDeAsistenciaSchema = z.strictObject({
  tipo: z.literal('ASISTENCIA'),
  fecha: fechaSchema,
  clase: claseDelRegistroSchema,
  horaLlegada: horaSchema,
  estadoLlegada: estadoLlegadaSchema,
  metodo: metodoAsistenciaSchema,
  registroPosterior: z.boolean(),
  faltaCubierta: z.boolean(),
});
export type RegistroDeAsistencia = z.infer<typeof registroDeAsistenciaSchema>;

/** Una falta sin cubrir en la consulta del mes: una falta cubierta aparece solo como su asistencia. */
export const registroDeFaltaSchema = z.strictObject({
  tipo: z.literal('FALTA'),
  fecha: fechaSchema,
  clase: claseDelRegistroSchema,
});
export type RegistroDeFalta = z.infer<typeof registroDeFaltaSchema>;

/** `GET /api/alumnos/{id}/asistencias?mes=AAAA-MM` (009b, criterio 31): las clases de la matrícula del mes y sus asistencias y faltas, por fecha. */
export const asistenciaDelMesSchema = z.strictObject({
  mes: mesDeAsistenciaSchema,
  matricula: z
    .strictObject({ clasesTotales: contadorSchema, clasesUsadas: contadorSchema, clasesRestantes: contadorSchema })
    .nullable(),
  registros: z.array(z.discriminatedUnion('tipo', [registroDeAsistenciaSchema, registroDeFaltaSchema])),
});
export type AsistenciaDelMes = z.infer<typeof asistenciaDelMesSchema>;
