import { z } from 'zod';

/**
 * Nombres cortos que no pueden usarse porque chocarían con rutas, carpetas o términos propios del sistema (DR-5).
 * Se comparan ya normalizados (recortados y en minúsculas).
 */
export const PALABRAS_RESERVADAS = [
  'a',
  'admin',
  'administrador',
  'api',
  'app',
  'aquagestion',
  'assets',
  'ayuda',
  'ingresar',
  'inscripcion',
  'login',
  'logout',
  'plataforma',
  'public',
  'publico',
  'root',
  'salir',
  'sistema',
  'solicitud',
  'soporte',
  'static',
  'superadmin',
  'www',
] as const;

const NOMBRE_CORTO_MINIMO = 3;
const NOMBRE_CORTO_MAXIMO = 30;
const FORMATO_NOMBRE_CORTO = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const NOMBRE_MINIMO = 3;
const NOMBRE_MAXIMO = 100;
const MOTIVO_MINIMO = 3;
const MOTIVO_MAXIMO = 500;
const SIN_CARACTERES_DE_CONTROL = /^[^\p{Cc}]*$/u;

/**
 * Nombre corto de una academia (D-27): va en la dirección de sus páginas públicas (`/a/{nombreCorto}`). Se recorta y
 * se pasa a minúsculas; después debe tener de 3 a 30 caracteres, empezar con una letra, usar solo `a-z`, `0-9` y
 * guiones (sin guiones al inicio, al final ni seguidos) y no ser una palabra reservada.
 */
export const nombreCortoSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(NOMBRE_CORTO_MINIMO, `El nombre corto debe tener al menos ${NOMBRE_CORTO_MINIMO} caracteres.`)
  .max(NOMBRE_CORTO_MAXIMO, `El nombre corto debe tener como máximo ${NOMBRE_CORTO_MAXIMO} caracteres.`)
  .regex(
    FORMATO_NOMBRE_CORTO,
    'El nombre corto debe empezar con una letra y usar solo letras minúsculas sin tildes, números y guiones.',
  )
  .refine((valor) => !(PALABRAS_RESERVADAS as readonly string[]).includes(valor), {
    message: 'Ese nombre corto está reservado por el sistema. Elige otro.',
  });

/** Estado de una academia: `ACTIVA` o `SUSPENDIDA` (DR-4). */
export const estadoAcademiaSchema = z.enum(['ACTIVA', 'SUSPENDIDA']);
export type EstadoAcademia = z.infer<typeof estadoAcademiaSchema>;

const nombreAcademiaSchema = z
  .string()
  .trim()
  .min(NOMBRE_MINIMO, `El nombre debe tener al menos ${NOMBRE_MINIMO} caracteres.`)
  .max(NOMBRE_MAXIMO, `El nombre debe tener como máximo ${NOMBRE_MAXIMO} caracteres.`)
  .regex(SIN_CARACTERES_DE_CONTROL, 'El nombre no puede contener caracteres de control.');

const motivoSchema = z
  .string()
  .trim()
  .min(MOTIVO_MINIMO, `El motivo debe tener al menos ${MOTIVO_MINIMO} caracteres.`)
  .max(MOTIVO_MAXIMO, `El motivo debe tener como máximo ${MOTIVO_MAXIMO} caracteres.`);

/** `POST /api/plataforma/academias` (DR-6: solo el nombre y el nombre corto). */
export const crearAcademiaSchema = z.strictObject({
  nombre: nombreAcademiaSchema,
  nombreCorto: nombreCortoSchema,
});
export type CrearAcademia = z.infer<typeof crearAcademiaSchema>;

/** `POST /api/plataforma/academias/{id}/suspender`: el motivo es obligatorio (DR-4). */
export const suspenderAcademiaSchema = z.strictObject({ motivo: motivoSchema });
export type SuspenderAcademia = z.infer<typeof suspenderAcademiaSchema>;

/** `POST /api/plataforma/academias/{id}/reactivar`: el motivo es opcional. */
export const reactivarAcademiaSchema = z.strictObject({ motivo: motivoSchema.optional() });
export type ReactivarAcademia = z.infer<typeof reactivarAcademiaSchema>;

/** Lo único que la plataforma ve de una academia: nunca datos internos (D-29). Fechas en ISO 8601 UTC. */
export const academiaResumenSchema = z.strictObject({
  id: z.uuid(),
  nombre: z.string(),
  nombreCorto: z.string(),
  estado: estadoAcademiaSchema,
  creadaEn: z.iso.datetime(),
  suspendidaEn: z.iso.datetime().nullable(),
  motivoSuspension: z.string().nullable(),
});
export type AcademiaResumen = z.infer<typeof academiaResumenSchema>;

export const respuestaAcademiaSchema = z.strictObject({ academia: academiaResumenSchema });
export type RespuestaAcademia = z.infer<typeof respuestaAcademiaSchema>;

export const respuestaListaAcademiasSchema = z.strictObject({ academias: z.array(academiaResumenSchema) });
export type RespuestaListaAcademias = z.infer<typeof respuestaListaAcademiasSchema>;

/** `GET /api/a/{nombreCorto}`: lo que cualquier visitante puede saber de una academia activa. */
export const academiaPublicaSchema = z.strictObject({
  nombreCorto: z.string(),
  nombre: z.string(),
});
export type AcademiaPublica = z.infer<typeof academiaPublicaSchema>;
