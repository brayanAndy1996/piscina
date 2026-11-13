import { z } from 'zod';
import { ROLES_USUARIO } from './permisos';
import { sinControles } from './texto';

/** Largo máximo de una contraseña, en puntos de código: acota el trabajo de argon2 y el tamaño de lo que se guarda. */
export const CLAVE_MAXIMA = 128;
/** Largo mínimo de una contraseña nueva, en puntos de código (DR-2 de la spec 002). */
export const CLAVE_MINIMA = 8;

/** Cantidad de caracteres de un texto por puntos de código (un emoji cuenta como uno, no como dos unidades UTF-16). */
function puntosDeCodigo(texto: string): number {
  return [...texto].length;
}

const MENSAJE_CONTROLES = 'La contraseña no puede contener caracteres de control ni caracteres no válidos.';

/** DNI: texto recortado de exactamente 8 dígitos. Es texto, no número: `01234567` conserva su cero (DR-10). */
export const dniSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{8}$/, 'El DNI debe tener exactamente 8 dígitos.');

/** Contraseña que se escribe para entrar o como contraseña actual: sin recortar, de 1 a 128 puntos de código, sin controles. */
const claveEscritaSchema = sinControles(z.string().min(1, 'La contraseña es obligatoria.'), MENSAJE_CONTROLES).refine(
  (valor) => puntosDeCodigo(valor) <= CLAVE_MAXIMA,
  { message: `La contraseña debe tener como máximo ${CLAVE_MAXIMA} caracteres.` },
);

/** `POST /api/a/{nombreCorto}/sesion`: el usuario es el DNI (RN-02, D-28) y la clave se envía tal cual. */
export const iniciarSesionAcademiaSchema = z.strictObject({
  usuario: dniSchema,
  clave: claveEscritaSchema,
});
export type IniciarSesionAcademia = z.infer<typeof iniciarSesionAcademiaSchema>;

/** Contraseña nueva: de 8 a 128 puntos de código, sin controles y sin recortar ni normalizar (se guarda lo que se escribió). */
export const claveNuevaSchema = sinControles(z.string(), MENSAJE_CONTROLES)
  .refine((valor) => puntosDeCodigo(valor) >= CLAVE_MINIMA, {
    message: `La contraseña nueva debe tener al menos ${CLAVE_MINIMA} caracteres.`,
  })
  .refine((valor) => puntosDeCodigo(valor) <= CLAVE_MAXIMA, {
    message: `La contraseña nueva debe tener como máximo ${CLAVE_MAXIMA} caracteres.`,
  });

/** `POST /api/sesion/clave`. Que la nueva no sea el DNI ni la actual lo comprueba el servicio (necesita al usuario). */
export const cambiarClaveSchema = z.strictObject({
  claveActual: claveEscritaSchema,
  claveNueva: claveNuevaSchema,
});
export type CambiarClave = z.infer<typeof cambiarClaveSchema>;

export const rolUsuarioSchema = z.enum(ROLES_USUARIO);

/** El usuario de la sesión: nunca lleva el DNI, el hash, la versión de token ni el estado de bloqueo. */
export const usuarioSesionSchema = z.strictObject({
  id: z.uuid(),
  nombres: z.string(),
  apellidos: z.string(),
  rol: rolUsuarioSchema,
  debeCambiarClave: z.boolean(),
  academia: z.strictObject({ nombreCorto: z.string(), nombre: z.string() }),
});
export type UsuarioSesion = z.infer<typeof usuarioSesionSchema>;

export const respuestaSesionAcademiaSchema = z.strictObject({ usuario: usuarioSesionSchema });
export type RespuestaSesionAcademia = z.infer<typeof respuestaSesionAcademiaSchema>;
