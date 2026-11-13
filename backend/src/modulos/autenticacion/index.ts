// Contrato público del módulo de autenticación para las historias siguientes (spec 002, "Servicios del backend"):
//   @Permiso('PERMISO_DE_LA_MATRIZ')  o  @SoloSesion()  en cada manejador de una ruta de academia;
//   @UsuarioActual() usuario: UsuarioAutenticado  para tomar la academia y el rol de la sesión.
export { AutenticacionModule } from './autenticacion.module';
export { Permiso, SoloSesion } from './permiso.decorator';
export { instalarProteccionDeAcademia } from './proteccion-academia';
export { SesionAcademiaService } from './sesion-academia.service';
export type { SesionVerificada, UsuarioAutenticado } from './tipos';
export { UsuarioActual } from './usuario-actual.decorator';
