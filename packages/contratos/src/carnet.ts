import { z } from 'zod';
import { diaSemanaSchema, fechaSchema, nivelNatacionSchema } from './horario';
import { textoVisibleSchema } from './texto';

/**
 * Carnet digital y QR (spec 008a, criterios 3, 7, 12, 13, 15 y 16; HU-13, RN-05, RN-06, sección 8.6). El QR lleva solo
 * un token aleatorio con el prefijo `AQ1:`; la asistencia (009) lo lee con `tokenDelContenidoQr`.
 */

/** Prefijo del contenido del QR (DT-2): separa los QR de AquaGestión de cualquier otro y deja versionar el formato. */
export const PREFIJO_QR = 'AQ1:';

/** El token: 32 bytes al azar en base64url sin relleno, 43 caracteres. Sin banderas ni `^`/`$` multilínea: `$` no acepta un salto final. */
export const PATRON_TOKEN_QR = /^[A-Za-z0-9_-]{43}$/;

/** El texto que se dibuja en el QR del carnet: `AQ1:` y el token (47 caracteres). */
export function contenidoQr(token: string): string {
  return `${PREFIJO_QR}${token}`;
}

/**
 * El token de un contenido de QR, o `null` si el texto no tiene exactamente la forma `AQ1:` más 43 caracteres de
 * base64url (sin espacios, saltos, minúsculas en el prefijo ni nada de más).
 */
export function tokenDelContenidoQr(texto: string): string | null {
  if (typeof texto !== 'string' || !texto.startsWith(PREFIJO_QR)) return null;
  const token = texto.slice(PREFIJO_QR.length);
  // `\z` no existe en JavaScript: `$` sin la bandera `m` solo acepta el final del texto, pero la longitud lo asegura.
  return token.length === 43 && PATRON_TOKEN_QR.test(token) ? token : null;
}

/** Opciones de `qrcode` que usan la web y el PDF (DT-5): con las mismas opciones, el mismo texto da el mismo QR. */
export const OPCIONES_QR = { errorCorrectionLevel: 'M', margin: 4 } as const;

const horaSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'La hora debe tener el formato HH:MM.');

/** Una clase de la matrícula del carnet: día de la semana (1 a 7) y horas de inicio y de fin. */
export const claseDelCarnetSchema = z.strictObject({
  diaSemana: diaSemanaSchema,
  horaInicio: horaSchema,
  horaFin: horaSchema,
});
export type ClaseDelCarnet = z.infer<typeof claseDelCarnetSchema>;

export const matriculaDelCarnetSchema = z.strictObject({
  plan: z.string(),
  clases: z.array(claseDelCarnetSchema),
  desde: fechaSchema,
  hasta: fechaSchema,
  vigenteHoy: z.boolean(),
});
export type MatriculaDelCarnet = z.infer<typeof matriculaDelCarnetSchema>;

/** Estados con carnet: un `CLIENTE` no tiene (RN-05). */
export const ESTADOS_CON_CARNET = ['ALUMNO_ACTIVO', 'ALUMNO_VENCIDO', 'INACTIVO'] as const;
export const estadoConCarnetSchema = z.enum(ESTADOS_CON_CARNET);
export type EstadoConCarnet = z.infer<typeof estadoConCarnetSchema>;

const contenidoQrSchema = z
  .string()
  .refine((texto) => tokenDelContenidoQr(texto) !== null, { message: 'El contenido del QR no es válido.' });

/**
 * `GET /api/alumnos/{id}/carnet` y `GET /api/mi-carnet` (criterio 7). Estricto: sin fecha de nacimiento, teléfono, correo,
 * datos médicos, apoderado, consentimientos, claves del archivo, pagos ni el token suelto. La foto va como `data:` JPEG (DT-6).
 */
export const carnetSchema = z.strictObject({
  academia: z.strictObject({ nombre: z.string().min(1) }),
  alumno: z.strictObject({
    id: z.uuid(),
    nombres: z.string().min(1),
    apellidos: z.string().min(1),
    dni: z.string().min(1),
    nivel: nivelNatacionSchema,
    estado: estadoConCarnetSchema,
  }),
  foto: z
    .string()
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]*={0,2}$/)
    .nullable(),
  matricula: matriculaDelCarnetSchema.nullable(),
  qr: z.strictObject({ contenido: contenidoQrSchema, generadoEn: z.iso.datetime() }).nullable(),
});
export type Carnet = z.infer<typeof carnetSchema>;

/** `POST /api/alumnos/{id}/carnet/qr` (criterios 13 a 15): la clave del intento y el motivo, que va a la auditoría. */
export const regenerarQrSchema = z.strictObject({
  claveIdempotencia: z.uuid('La clave de la regeneración no es válida.'),
  motivo: textoVisibleSchema({ sujeto: 'El motivo', min: 3, max: 200 }),
});
export type RegenerarQr = z.infer<typeof regenerarQrSchema>;

/** `POST /api/alumnos/buscar` (criterio 16): un DNI de 8 dígitos o parte del nombre. El texto va en el cuerpo, no en la dirección. */
export const buscarAlumnosSchema = z.strictObject({
  texto: textoVisibleSchema({ sujeto: 'El texto', min: 3, max: 60 }),
});
export type BuscarAlumnos = z.infer<typeof buscarAlumnosSchema>;

export const alumnoEncontradoSchema = z.strictObject({
  id: z.uuid(),
  nombres: z.string(),
  apellidos: z.string(),
  dni: z.string(),
  estado: estadoConCarnetSchema,
  nivel: nivelNatacionSchema,
  tieneFoto: z.boolean(),
});
export type AlumnoEncontrado = z.infer<typeof alumnoEncontradoSchema>;

/** Respuesta de la búsqueda: como mucho 20 alumnos y `hayMas` si había más. */
export const resultadoBusquedaAlumnosSchema = z.strictObject({
  alumnos: z.array(alumnoEncontradoSchema),
  hayMas: z.boolean(),
});
export type ResultadoBusquedaAlumnos = z.infer<typeof resultadoBusquedaAlumnosSchema>;

const NOMBRE_DIA_CORTO: Readonly<Record<number, string>> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom',
};

function unirDias(dias: string[]): string {
  if (dias.length <= 1) return dias.join('');
  return `${dias.slice(0, -1).join(', ')} y ${dias[dias.length - 1] ?? ''}`;
}

/**
 * Texto corto del horario de una matrícula, para la web y el PDF: «Mar, Mié y Jue · 18:00 a 19:00». Si las clases tienen
 * horas distintas, un grupo por hora, separados por «; ». Sin clases: «Sin clases».
 */
export function resumenDeHorario(clases: readonly ClaseDelCarnet[]): string {
  if (clases.length === 0) return 'Sin clases';
  const ordenadas = [...clases].sort(
    (a, b) =>
      a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio) || a.horaFin.localeCompare(b.horaFin),
  );
  const grupos = new Map<string, string[]>();
  for (const clase of ordenadas) {
    const clave = `${clase.horaInicio} a ${clase.horaFin}`;
    const dias = grupos.get(clave) ?? [];
    const nombre = NOMBRE_DIA_CORTO[clase.diaSemana] ?? String(clase.diaSemana);
    if (!dias.includes(nombre)) dias.push(nombre);
    grupos.set(clave, dias);
  }
  return [...grupos.entries()].map(([horas, dias]) => `${unirDias(dias)} · ${horas}`).join('; ');
}
