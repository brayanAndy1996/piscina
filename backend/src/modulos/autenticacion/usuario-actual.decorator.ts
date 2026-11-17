import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { SesionVerificada, SolicitudDeAcademia, UsuarioAutenticado } from './tipos';

function sesionDe(contexto: ExecutionContext): SesionVerificada {
  const sesion = contexto.switchToHttp().getRequest<SolicitudDeAcademia>().sesionAcademia;
  if (!sesion) throw new Error('El decorador de la sesión de academia se usa en una ruta sin sesión de academia.');
  return sesion;
}

/** Parámetro de un manejador de una ruta de academia: el usuario de la sesión. Se usa como `@UsuarioActual() usuario`. */
export const UsuarioActual = createParamDecorator((_dato: unknown, contexto: ExecutionContext): UsuarioAutenticado => {
  return sesionDe(contexto).usuario;
});

/** Parámetro de un manejador de una ruta de academia: la sesión completa (con la academia y la versión de token). */
export const SesionActual = createParamDecorator((_dato: unknown, contexto: ExecutionContext): SesionVerificada => {
  return sesionDe(contexto);
});
