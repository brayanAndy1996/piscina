import { z } from 'zod';

// Los mensajes por defecto de zod (los que no escribimos a mano en los esquemas) salen en español, para mostrarlos
// al usuario en la web y en `detalles.errores` de la API.
z.config(z.locales.es());

export { estadoComponenteSchema, respuestaSaludSchema, type RespuestaSalud } from './salud';
export { detallesValidacionSchema, errorApiSchema, type DetallesValidacion, type ErrorApi } from './error-api';
export {
  academiaPublicaSchema,
  academiaResumenSchema,
  crearAcademiaSchema,
  estadoAcademiaSchema,
  nombreCortoSchema,
  PALABRAS_RESERVADAS,
  reactivarAcademiaSchema,
  respuestaAcademiaSchema,
  respuestaListaAcademiasSchema,
  suspenderAcademiaSchema,
  type AcademiaPublica,
  type AcademiaResumen,
  type CrearAcademia,
  type EstadoAcademia,
  type ReactivarAcademia,
  type RespuestaAcademia,
  type RespuestaListaAcademias,
  type SuspenderAcademia,
} from './academias';
export {
  iniciarSesionPlataformaSchema,
  respuestaSesionPlataformaSchema,
  superadminSesionSchema,
  type IniciarSesionPlataforma,
  type RespuestaSesionPlataforma,
  type SuperadminSesion,
} from './plataforma';
