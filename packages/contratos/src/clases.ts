import { z } from 'zod';
import { diaSemanaSchema, horaBloqueSchema, nivelNatacionSchema } from './horario';

/**
 * Clases de la semana (spec 004, HU-17): nivel, día, bloque de 1 hora, entrenador y aforo. Un `PATCH` solo cambia el entrenador, el
 * aforo y si está activa (DR-4 de 004): para mover una clase se desactiva y se crea otra.
 */

/** Aforo de cada clase (RN-11): entero de 20 a 50, con los dos extremos incluidos. */
export const AFORO_MINIMO = 20;
export const AFORO_MAXIMO = 50;

const aforoSchema = z
  .number('El aforo debe ser un número entero de 20 a 50.')
  .int('El aforo debe ser un número entero de 20 a 50.')
  .min(AFORO_MINIMO, `El aforo debe ser de ${AFORO_MINIMO} a ${AFORO_MAXIMO} alumnos.`)
  .max(AFORO_MAXIMO, `El aforo debe ser de ${AFORO_MINIMO} a ${AFORO_MAXIMO} alumnos.`);

const entrenadorIdSchema = z.uuid('El entrenador no es válido.');

/** `POST /api/clases`: estricto; la academia sale de la sesión, nunca del cuerpo. */
export const crearClaseSchema = z.strictObject({
  nivel: nivelNatacionSchema,
  diaSemana: diaSemanaSchema,
  horaInicio: horaBloqueSchema,
  entrenadorId: entrenadorIdSchema,
  aforo: aforoSchema,
});
export type CrearClase = z.infer<typeof crearClaseSchema>;

/**
 * `PATCH /api/clases/{id}`: estricto; el nivel, el día y la hora no se cambian (DR-4). Debe venir al menos un campo de la clase.
 * `confirmarAforoMenor` (005, DR-5 de 004) confirma bajar el aforo por debajo de los inscritos; no cuenta como "un campo".
 */
export const actualizarClaseSchema = z
  .strictObject({
    entrenadorId: entrenadorIdSchema.optional(),
    aforo: aforoSchema.optional(),
    activo: z.boolean('El estado debe ser verdadero o falso.').optional(),
    confirmarAforoMenor: z.boolean('La confirmación debe ser verdadera o falsa.').optional(),
  })
  .refine((cuerpo) => [cuerpo.entrenadorId, cuerpo.aforo, cuerpo.activo].some((valor) => valor !== undefined), {
    message: 'Envía al menos un campo de la clase.',
  });
export type ActualizarClase = z.infer<typeof actualizarClaseSchema>;

/** El entrenador de una clase tal como lo ve el administrador: sin DNI ni otros datos personales. */
export const entrenadorDeClaseSchema = z.strictObject({
  id: z.uuid(),
  nombres: z.string(),
  apellidos: z.string(),
  activo: z.boolean(),
});
export type EntrenadorDeClase = z.infer<typeof entrenadorDeClaseSchema>;

export const claseSchema = z.strictObject({
  id: z.uuid(),
  nivel: nivelNatacionSchema,
  diaSemana: diaSemanaSchema,
  horaInicio: horaBloqueSchema,
  /** Una hora después de `horaInicio` (`"20:00"` para la clase de las `"19:00"`), por eso no usa `horaBloqueSchema`. */
  horaFin: z.string(),
  aforo: aforoSchema,
  activo: z.boolean(),
  entrenador: entrenadorDeClaseSchema,
});
export type Clase = z.infer<typeof claseSchema>;

export const respuestaClaseSchema = z.strictObject({ clase: claseSchema });
export type RespuestaClase = z.infer<typeof respuestaClaseSchema>;

export const respuestaListaClasesSchema = z.strictObject({ clases: z.array(claseSchema) });
export type RespuestaListaClases = z.infer<typeof respuestaListaClasesSchema>;

/**
 * `GET /api/clases/ocupacion` (spec 005b, criterio 40; PB13): un elemento por cada clase de la academia, activa o no. `inscritos` es la mayor
 * ocupación entre el mes en curso y los siguientes (la cifra de los 409 de DR-5) y `cuposRestantes`, `max(0, aforo - ocupación del mes en curso)`.
 */
export const respuestaOcupacionSchema = z.strictObject({
  /** `AAAA-MM`: el mes en curso en Lima. */
  mes: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'El mes debe tener el formato AAAA-MM.'),
  ocupacion: z.array(
    z.strictObject({
      claseId: z.uuid(),
      inscritos: z.number().int().min(0),
      cuposRestantes: z.number().int().min(0),
    }),
  ),
});
export type RespuestaOcupacion = z.infer<typeof respuestaOcupacionSchema>;
