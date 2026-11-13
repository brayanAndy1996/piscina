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
export { contarVisibles, sinControles, textoVisibleSchema, tieneControles, VISIBLES_MINIMOS } from './texto';
export {
  ALCANCES,
  MATRIZ_PERMISOS,
  PERMISOS,
  puede,
  ROLES_USUARIO,
  type Alcance,
  type FilaDePermiso,
  type Permiso,
  type RolUsuario,
} from './permisos';
export {
  cambiarClaveSchema,
  CLAVE_MAXIMA,
  CLAVE_MINIMA,
  claveNuevaSchema,
  dniSchema,
  iniciarSesionAcademiaSchema,
  respuestaSesionAcademiaSchema,
  rolUsuarioSchema,
  usuarioSesionSchema,
  type CambiarClave,
  type IniciarSesionAcademia,
  type RespuestaSesionAcademia,
  type UsuarioSesion,
} from './sesion';
export {
  administradorResumenSchema,
  buscarUsuarioPorDniSchema,
  crearAdministradorSchema,
  crearUsuarioSchema,
  cuerpoVacioSchema,
  estadoUsuarioSchema,
  respuestaAdministradorSchema,
  respuestaListaAdministradoresSchema,
  respuestaListaUsuariosSchema,
  respuestaUsuarioSchema,
  rolPersonalSchema,
  usuarioResumenSchema,
  type AdministradorResumen,
  type BuscarUsuarioPorDni,
  type CrearAdministrador,
  type CrearUsuario,
  type EstadoUsuario,
  type RespuestaAdministrador,
  type RespuestaListaAdministradores,
  type RespuestaListaUsuarios,
  type RespuestaUsuario,
  type RolPersonal,
  type UsuarioResumen,
} from './usuarios';
