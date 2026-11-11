import { z } from 'zod';
import { sinControles } from './texto';

const CORREO_MAXIMO = 254;
const CLAVE_MAXIMA = 128;

/**
 * `POST /api/plataforma/sesion`. El correo se recorta y se pasa a minúsculas; la clave se envía tal cual (solo se
 * limita su largo para no calcular hashes de textos enormes). Ninguno de los dos admite caracteres de control (criterio 76).
 */
export const iniciarSesionPlataformaSchema = z.strictObject({
  correo: sinControles(
    z.string().trim().toLowerCase().max(CORREO_MAXIMO, `El correo debe tener como máximo ${CORREO_MAXIMO} caracteres.`),
    'El correo no puede contener caracteres de control ni caracteres no válidos.',
  ).pipe(z.email('El correo no es válido.')),
  clave: sinControles(
    z
      .string()
      .min(1, 'La contraseña es obligatoria.')
      .max(CLAVE_MAXIMA, `La contraseña debe tener como máximo ${CLAVE_MAXIMA} caracteres.`),
    'La contraseña no puede contener caracteres de control ni caracteres no válidos.',
  ),
});
export type IniciarSesionPlataforma = z.infer<typeof iniciarSesionPlataformaSchema>;

/** El superadmin que inició sesión: nunca incluye el hash de su clave ni el token. */
export const superadminSesionSchema = z.strictObject({
  id: z.uuid(),
  correo: z.string(),
  nombre: z.string(),
});
export type SuperadminSesion = z.infer<typeof superadminSesionSchema>;

export const respuestaSesionPlataformaSchema = z.strictObject({ superadmin: superadminSesionSchema });
export type RespuestaSesionPlataforma = z.infer<typeof respuestaSesionPlataformaSchema>;
