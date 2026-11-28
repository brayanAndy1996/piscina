import { z } from 'zod';
import { estadoConCarnetSchema } from './carnet';
import { diaSemanaSchema, fechaSchema, horaBloqueSchema, nivelNatacionSchema } from './horario';
import { mesSchema } from './inscripcion';
import { estadoMensualidadSchema } from './mensualidades';

/**
 * El panel del alumno y del apoderado (spec 011; HU-06, D-08, D-14). Solo lectura. Todos los esquemas son estrictos: la respuesta no lleva ningún id (ni del
 * alumno, ni del usuario, ni de matrículas, planes, clases o pagos), ni la fecha de nacimiento, ni datos de contacto, médicos o del apoderado, ni montos, pagos,
 * tokens o la foto (DR-1, DT-6, Ley 29733). Si el servicio armara una clave de más, falla en lugar de filtrarla.
 */

const contadorSchema = z.number().int().min(0);

/** Una clase del horario del panel: el día y la hora, sin id. */
const claseDelPanelSchema = z.strictObject({
  diaSemana: diaSemanaSchema,
  horaInicio: horaBloqueSchema,
  horaFin: z.string(),
});

/** La mensualidad que muestra el panel (criterio 8): el mes, el plan por su nombre, el horario, las clases y las fechas de la matrícula. */
export const mensualidadDelPanelSchema = z.strictObject({
  mes: mesSchema,
  plan: z.strictObject({ nombre: z.string() }),
  clases: z.array(claseDelPanelSchema),
  clasesUsadas: contadorSchema,
  clasesTotales: contadorSchema,
  clasesRestantes: contadorSchema,
  /** `fecha_inicio` de la matrícula. */
  desde: fechaSchema,
  /** `fecha_fin` de la matrícula: la fecha de vencimiento que muestra la web (DR-3). */
  hasta: fechaSchema,
});
export type MensualidadDelPanel = z.infer<typeof mensualidadDelPanelSchema>;

/** La mensualidad del mes siguiente: pagada o con el pago en verificación. */
export const siguienteDelPanelSchema = mensualidadDelPanelSchema.extend({
  estado: z.enum(['PAGADA', 'EN_VERIFICACION']),
});
export type SiguienteDelPanel = z.infer<typeof siguienteDelPanelSchema>;

/** `GET /api/mi-panel` (criterio 6). */
export const miPanelSchema = z.strictObject({
  /** Hoy en Lima, `AAAA-MM-DD`. */
  hoy: fechaSchema,
  /** El mes en curso de Lima, `AAAA-MM`. */
  mesEnCurso: mesSchema,
  alumno: z.strictObject({
    nombres: z.string(),
    apellidos: z.string(),
    dni: z.string(),
    nivel: nivelNatacionSchema,
    edad: contadorSchema,
    estado: estadoConCarnetSchema,
  }),
  mensualidad: z.strictObject({
    estado: estadoMensualidadSchema.nullable(),
    actual: mensualidadDelPanelSchema.nullable(),
    siguiente: siguienteDelPanelSchema.nullable(),
  }),
  /** Los meses con asistencia que se pueden consultar: el mes en curso y los anteriores con mensualidad pagada, del más nuevo al más viejo (DR-2). */
  mesesDeAsistencia: z.array(mesSchema),
});
export type MiPanel = z.infer<typeof miPanelSchema>;
