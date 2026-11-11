import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { SolicitudDePlataforma, SuperadminAutenticado } from './tipos';

/** Parámetro de un método protegido por `SesionPlataformaGuard`: el superadmin de la sesión. */
export const SuperadminActual = createParamDecorator(
  (_dato: unknown, contexto: ExecutionContext): SuperadminAutenticado => {
    const solicitud = contexto.switchToHttp().getRequest<SolicitudDePlataforma>();
    if (!solicitud.superadminPlataforma) {
      throw new Error('SuperadminActual se usa en una ruta sin SesionPlataformaGuard.');
    }
    return solicitud.superadminPlataforma;
  },
);
