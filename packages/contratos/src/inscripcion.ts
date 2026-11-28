import { z } from 'zod';
import { montoCotizadoSchema } from './dinero';
import { diaSemanaSchema, esBisiesto, fechaSchema, horaBloqueSchema, nivelNatacionSchema } from './horario';
import { PATRON_UUID } from './identificadores';
import { dniSchema } from './sesion';
import { sinControles, textoVisibleSchema } from './texto';

/**
 * Inscripción pública (spec 005, criterios 6, 11 a 14 y 16): el formulario, la cotización, los datos de la oferta y la respuesta del envío.
 * Los esquemas de entrada son estrictos en todos los niveles: un campo de más es un 400. Los obligatorios y los opcionales son los de
 * DR-5 de 005.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// Listas (DR-5 de 005). Son los valores de los tipos enumerados de la base.
// ---------------------------------------------------------------------------------------------------------------------------------

/** Tipos de sangre, con la opción "No sé". */
export const TIPOS_SANGRE = [
  'A_POSITIVO',
  'A_NEGATIVO',
  'B_POSITIVO',
  'B_NEGATIVO',
  'AB_POSITIVO',
  'AB_NEGATIVO',
  'O_POSITIVO',
  'O_NEGATIVO',
  'NO_SABE',
] as const;
export type TipoSangre = (typeof TIPOS_SANGRE)[number];
export const NOMBRE_TIPO_SANGRE: Readonly<Record<TipoSangre, string>> = {
  A_POSITIVO: 'A+',
  A_NEGATIVO: 'A−',
  B_POSITIVO: 'B+',
  B_NEGATIVO: 'B−',
  AB_POSITIVO: 'AB+',
  AB_NEGATIVO: 'AB−',
  O_POSITIVO: 'O+',
  O_NEGATIVO: 'O−',
  NO_SABE: 'No sé',
};

/** Grado del colegio: de inicial a 5.° de secundaria, o "no estudia". */
export const GRADOS_COLEGIO = [
  'INICIAL',
  'PRIMARIA_1',
  'PRIMARIA_2',
  'PRIMARIA_3',
  'PRIMARIA_4',
  'PRIMARIA_5',
  'PRIMARIA_6',
  'SECUNDARIA_1',
  'SECUNDARIA_2',
  'SECUNDARIA_3',
  'SECUNDARIA_4',
  'SECUNDARIA_5',
  'NO_ESTUDIA',
] as const;
export type GradoColegio = (typeof GRADOS_COLEGIO)[number];
export const NOMBRE_GRADO_COLEGIO: Readonly<Record<GradoColegio, string>> = {
  INICIAL: 'Inicial',
  PRIMARIA_1: '1.° de primaria',
  PRIMARIA_2: '2.° de primaria',
  PRIMARIA_3: '3.° de primaria',
  PRIMARIA_4: '4.° de primaria',
  PRIMARIA_5: '5.° de primaria',
  PRIMARIA_6: '6.° de primaria',
  SECUNDARIA_1: '1.° de secundaria',
  SECUNDARIA_2: '2.° de secundaria',
  SECUNDARIA_3: '3.° de secundaria',
  SECUNDARIA_4: '4.° de secundaria',
  SECUNDARIA_5: '5.° de secundaria',
  NO_ESTUDIA: 'No estudia',
};

/** Parentesco del apoderado con la persona que se inscribe. */
export const PARENTESCOS = ['PADRE', 'MADRE', 'OTRO_APODERADO'] as const;
export type Parentesco = (typeof PARENTESCOS)[number];
export const NOMBRE_PARENTESCO: Readonly<Record<Parentesco, string>> = {
  PADRE: 'Padre',
  MADRE: 'Madre',
  OTRO_APODERADO: 'Otro apoderado',
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Fechas de calendario sin `Date` ni zona (la API pasa la fecha de Lima; la web, la que le dio la API)
// ---------------------------------------------------------------------------------------------------------------------------------

const MAYORIA_DE_EDAD = 18;
const EDAD_MAXIMA = 100;

/** `AAAA-MM-DD` de una fecha de calendario, con el 29 de febrero tratado como 1 de marzo si el año no es bisiesto. */
function fechaDeCumpleanios(anio: number, mes: number, dia: number): string {
  const [m, d] = mes === 2 && dia === 29 && !esBisiesto(anio) ? [3, 1] : [mes, dia];
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${String(anio).padStart(4, '0')}-${dos(m)}-${dos(d)}`;
}

function partesDeFecha(fecha: string): [number, number, number] {
  const [anio = '0', mes = '0', dia = '0'] = fecha.split('-');
  return [Number(anio), Number(mes), Number(dia)];
}

/**
 * ¿Es menor de edad una persona nacida en `fechaNacimiento` si hoy es `hoy` (RN-20)? Las dos son textos `AAAA-MM-DD` (la fecha de
 * America/Lima: la API la calcula con el reloj, y la web usa la que le da la API) y se comparan como textos, sin `Date` ni zona del
 * proceso. Es menor si hoy todavía no cumplió 18 años; el día de su cumpleaños número 18 ya es mayor. Quien nació el 29 de febrero cumple
 * el 1 de marzo en los años no bisiestos.
 */
export function esMenorDeEdad(fechaNacimiento: string, hoy: string): boolean {
  const [anio, mes, dia] = partesDeFecha(fechaNacimiento);
  return hoy < fechaDeCumpleanios(anio + MAYORIA_DE_EDAD, mes, dia);
}

/**
 * Comprueba que la fecha de nacimiento no sea futura ni de hace más de 100 años (criterio 12). Devuelve el mensaje del error, o `null` si
 * está bien. Lo usan la API (con la fecha de Lima) y la web (con la `hoy` que le da la API).
 */
export function validarFechaNacimiento(fechaNacimiento: string, hoy: string): string | null {
  if (fechaNacimiento > hoy) return 'La fecha de nacimiento no puede ser futura.';
  const [anio, mes, dia] = partesDeFecha(hoy);
  if (fechaNacimiento < fechaDeCumpleanios(anio - EDAD_MAXIMA, mes, dia)) {
    return `La fecha de nacimiento no puede ser de hace más de ${EDAD_MAXIMA} años.`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Celular peruano de 9 dígitos que empieza con 9 (DR-5 de 005). Se recorta y se quitan los espacios y guiones: el valor que se guarda son
 * los 9 dígitos.
 */
export const telefonoCelularSchema = z
  .string('El celular debe ser un texto.')
  .transform((texto) => texto.trim().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^9[0-9]{8}$/, 'El celular debe tener 9 dígitos y empezar con 9.'));

const nombresSchema = textoVisibleSchema({ sujeto: 'Los nombres', min: 2, max: 60, visibles: 2 });
const apellidosSchema = textoVisibleSchema({ sujeto: 'Los apellidos', min: 2, max: 60, visibles: 2 });
const direccionSchema = textoVisibleSchema({ sujeto: 'La dirección', min: 3, max: 200 });
const textoMedicoSchema = (sujeto: string) => textoVisibleSchema({ sujeto, min: 2, max: 500, visibles: 2 });

/** Correo en minúsculas, recortado, de como mucho 254 caracteres. */
export const correoSchema = z
  .string('El correo debe ser un texto.')
  .trim()
  .toLowerCase()
  .max(254, 'El correo debe tener como máximo 254 caracteres.')
  .pipe(z.email('El correo no tiene un formato válido.'));

/**
 * Una lista de 1 a 7 clases, sin repetidos (el id se compara sin distinguir mayúsculas) y todas UUID. Los errores de la lista se informan
 * en el campo de la lista (`inscripcion.claseIds`) y no en cada elemento, para que la web los muestre en un solo lugar.
 */
export const claseIdsSchema = z
  .array(z.string('Las clases no son válidas.'), 'Elige las clases.')
  .min(1, 'Elige al menos una clase.')
  .max(7, 'Elige como mucho 7 clases.')
  .refine((ids) => ids.every((id) => PATRON_UUID.test(id)), { message: 'Las clases elegidas no son válidas.' })
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
    message: 'No repitas una clase.',
  });

/** El mes de la cotización, `AAAA-MM`. */
export const mesSchema = z
  .string('El mes debe ser un texto AAAA-MM.')
  .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'El mes debe tener el formato AAAA-MM.');

// ---------------------------------------------------------------------------------------------------------------------------------
// Envío del formulario (criterios 12 a 14)
// ---------------------------------------------------------------------------------------------------------------------------------

const alumnoSchema = z.strictObject({
  nombres: nombresSchema,
  apellidos: apellidosSchema,
  dni: dniSchema,
  fechaNacimiento: fechaSchema,
  telefono: telefonoCelularSchema,
  correo: correoSchema.optional(),
  direccion: direccionSchema.optional(),
  gradoColegio: z.enum(GRADOS_COLEGIO, 'El grado del colegio no es válido.').optional(),
  nivel: nivelNatacionSchema,
});

const fichaMedicaSchema = z.strictObject({
  tipoSangre: z.enum(TIPOS_SANGRE, 'El tipo de sangre no es válido.'),
  enfermedades: textoMedicoSchema('Las enfermedades').optional(),
  alergias: textoMedicoSchema('Las alergias').optional(),
  medicamentos: textoMedicoSchema('Los medicamentos').optional(),
  seguro: textoVisibleSchema({ sujeto: 'El seguro', min: 2, max: 100, visibles: 2 }).optional(),
  contactoEmergencia: z.strictObject({
    nombre: textoVisibleSchema({ sujeto: 'El nombre del contacto', min: 2, max: 80, visibles: 2 }),
    telefono: telefonoCelularSchema,
  }),
});

const apoderadoSchema = z.strictObject({
  nombres: nombresSchema,
  apellidos: apellidosSchema,
  dni: dniSchema,
  telefono: telefonoCelularSchema,
  parentesco: z.enum(PARENTESCOS, 'El parentesco no es válido.'),
  correo: correoSchema.optional(),
});

/** Lo elegido: el plan, las clases y lo que vio el cliente en la cotización (el mes y el monto, criterio 19). */
const inscripcionSchema = z.strictObject({
  planId: z.uuid('El plan no es válido.'),
  claseIds: claseIdsSchema,
  mes: mesSchema,
  montoMostrado: montoCotizadoSchema,
});

const consentimientosSchema = z.strictObject({
  version: sinControles(z.string('La versión debe ser un texto.').min(1, 'Falta la versión.').max(100)),
  datosPersonales: z.literal(true, 'Debes aceptar el tratamiento de datos personales.'),
  deslinde: z.literal(true, 'Debes aceptar el deslinde de responsabilidad.'),
  imagen: z.boolean('El uso de imagen debe ser verdadero o falso.').optional(),
});

/**
 * `POST /api/a/{nombreCorto}/inscripcion`: estricto en todos los niveles. Que `apoderado` sea obligatorio si la persona es menor y esté
 * prohibido si es mayor, y que la fecha de nacimiento no sea futura ni de hace más de 100 años, dependen de la fecha de hoy: las comprueba
 * el servicio (con la fecha de Lima) y la web (con la `hoy` de la API), con `esMenorDeEdad` y `validarFechaNacimiento`.
 */
export const enviarInscripcionSchema = z.strictObject({
  claveIdempotencia: z.uuid('La clave del envío no es válida.'),
  alumno: alumnoSchema,
  fichaMedica: fichaMedicaSchema,
  apoderado: apoderadoSchema.optional(),
  inscripcion: inscripcionSchema,
  consentimientos: consentimientosSchema,
});
export type EnviarInscripcion = z.infer<typeof enviarInscripcionSchema>;
export type EnviarInscripcionEntrada = z.input<typeof enviarInscripcionSchema>;

/** `POST /api/a/{nombreCorto}/inscripcion/cotizacion`. */
export const cotizarInscripcionSchema = z.strictObject({
  planId: z.uuid('El plan no es válido.'),
  nivel: nivelNatacionSchema,
  claseIds: claseIdsSchema,
  /** El mes de inscripción (010d, criterio 3): sin él, el mes en curso; con él, el mes en curso o el siguiente si la ventana está abierta. */
  mes: mesSchema.optional(),
});
export type CotizarInscripcion = z.infer<typeof cotizarInscripcionSchema>;

// ---------------------------------------------------------------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------------------------------------------------------------

const PATRON_MONTO_TEXTO = /^[0-9]+\.[0-9]{2}$/;
const montoTextoSchema = z.string().regex(PATRON_MONTO_TEXTO);

/** Lo que el cliente va a pagar y por qué (criterios 9 y 11). Los montos van como texto con dos decimales. */
export const cotizacionSchema = z.strictObject({
  mes: mesSchema,
  fechaInicio: fechaSchema,
  fechaFin: fechaSchema,
  clasesRestantes: z.number().int(),
  clasesTotales: z.number().int(),
  clasesPorMes: z.number().int(),
  precioPlan: montoTextoSchema,
  monto: montoTextoSchema,
  esProporcional: z.boolean(),
});
export type Cotizacion = z.infer<typeof cotizacionSchema>;

export const respuestaCotizacionSchema = z.strictObject({ cotizacion: cotizacionSchema });
export type RespuestaCotizacion = z.infer<typeof respuestaCotizacionSchema>;

/** Un plan tal como lo ve el público: sin estado ni vigencia (solo se ofrecen los vigentes). */
export const planPublicoSchema = z.strictObject({
  id: z.uuid(),
  nombre: z.string(),
  vecesPorSemana: z.number().int(),
  clasesPorMes: z.number().int(),
  duracionMinutos: z.number().int(),
  precio: montoTextoSchema,
  diasPermitidos: z.array(diaSemanaSchema),
  franjasPermitidas: z.array(horaBloqueSchema),
  nivelesAplicables: z.array(nivelNatacionSchema),
});
export type PlanPublico = z.infer<typeof planPublicoSchema>;

/** Una clase tal como la ve el público: sin entrenador, aforo ni ocupación; solo los cupos que quedan. */
export const clasePublicaSchema = z.strictObject({
  id: z.uuid(),
  nivel: nivelNatacionSchema,
  diaSemana: diaSemanaSchema,
  horaInicio: horaBloqueSchema,
  horaFin: z.string(),
  cuposRestantes: z.number().int(),
});
export type ClasePublica = z.infer<typeof clasePublicaSchema>;

const textosSchema = z.strictObject({
  DATOS_PERSONALES: z.string(),
  DESLINDE: z.string(),
  IMAGEN: z.string(),
});

/** La versión vigente de los consentimientos y sus textos: para una persona mayor de edad y para una menor. */
export const consentimientosVigentesSchema = z.strictObject({
  version: z.string(),
  textos: textosSchema,
  textosMenor: textosSchema,
});
export type ConsentimientosVigentes = z.infer<typeof consentimientosVigentesSchema>;

/** La consulta del `GET /api/a/{nombreCorto}/inscripcion` (010d, criterio 2): solo `mes`, opcional. Estricta. */
export const consultaFormularioSchema = z.strictObject({ mes: mesSchema.optional() });
export type ConsultaFormulario = z.infer<typeof consultaFormularioSchema>;

/** `GET /api/a/{nombreCorto}/inscripcion`. */
export const respuestaFormularioInscripcionSchema = z.strictObject({
  academia: z.strictObject({ nombre: z.string(), telefono: z.string().nullable() }),
  mes: mesSchema,
  hoy: z.string(),
  planes: z.array(planPublicoSchema),
  clases: z.array(clasePublicaSchema),
  consentimientos: consentimientosVigentesSchema,
});
export type RespuestaFormularioInscripcion = z.infer<typeof respuestaFormularioInscripcionSchema>;

/**
 * `GET /api/a/{nombreCorto}/inscripcion/meses` (010d, criterio 1): los meses para los que se puede inscribir hoy. `meses` trae siempre el mes en
 * curso (desde hoy) y, con la ventana de renovación abierta, el siguiente (desde su día 1); `aperturaMesSiguiente` es el primer día de la ventana
 * mientras no se abre, y `null` cuando está abierta.
 */
export const mesInscripcionSchema = z.strictObject({
  mes: mesSchema,
  fechaInicio: fechaSchema,
  inscripcionHasta: fechaSchema,
});
export type MesInscripcion = z.infer<typeof mesInscripcionSchema>;

export const mesesInscripcionSchema = z.strictObject({
  hoy: fechaSchema,
  meses: z.array(mesInscripcionSchema),
  aperturaMesSiguiente: fechaSchema.nullable(),
});
export type MesesInscripcion = z.infer<typeof mesesInscripcionSchema>;

/** `201` del envío: el código, el token (solo aquí y en el correo), el enlace de seguimiento y la cotización guardada. */
export const respuestaInscripcionCreadaSchema = z.strictObject({
  solicitud: z.strictObject({
    codigo: z.string(),
    token: z.string(),
    enlace: z.string(),
    estado: z.literal('PENDIENTE_PAGO'),
    reservaVenceEn: z.iso.datetime(),
    cotizacion: cotizacionSchema,
  }),
});
export type RespuestaInscripcionCreada = z.infer<typeof respuestaInscripcionCreadaSchema>;
