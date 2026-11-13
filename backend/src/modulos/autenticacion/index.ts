// Contrato público del módulo de autenticación para las historias siguientes (spec 002, "Servicios del backend"):
//   @Permiso('PERMISO_DE_LA_MATRIZ')  o  @SoloSesion()  en cada manejador de una ruta de academia;
//   @UsuarioActual() usuario: UsuarioAutenticado  para tomar la academia y el rol de la sesión;
//   @SesionActual() sesion: SesionVerificada  cuando el servicio necesita también la versión de token;
//   bloquearActorVigente(tx, …)  como primera sentencia de toda transacción que escribe a pedido de un usuario de la academia
//   (criterios 56 y 57: quien pide sigue vigente, con su fila bloqueada, y 401 `NO_AUTENTICADO` si no).
export { type ActorParaBloquear, bloquearActorVigente, type OpcionesBloqueoDelActor } from './actor-vigente';
export { AutenticacionModule } from './autenticacion.module';
export { esCierreDeSesion } from './dominio/rutas-de-academia';
export { Permiso, SoloSesion } from './permiso.decorator';
export { instalarProteccionDeAcademia } from './proteccion-academia';
export { SesionAcademiaService } from './sesion-academia.service';
export type { SesionVerificada, UsuarioAutenticado } from './tipos';
export { SesionActual, UsuarioActual } from './usuario-actual.decorator';
