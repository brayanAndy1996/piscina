import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { SesionPlataformaService } from './sesion-plataforma.service';
import type { SolicitudDePlataforma } from './tipos';

/**
 * Exige una sesión de superadmin válida (cookie `aq_plataforma`) y deja al superadmin en la petición. Comparte la
 * verificación con el middleware que protege todo el prefijo `/api/plataforma`, así que una ruta nueva no puede
 * quedar sin proteger por olvido.
 */
@Injectable()
export class SesionPlataformaGuard implements CanActivate {
  constructor(private readonly sesion: SesionPlataformaService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const solicitud = contexto.switchToHttp().getRequest<SolicitudDePlataforma>();
    const { id, correo, nombre } = await this.sesion.autenticar(solicitud);
    solicitud.superadminPlataforma = { id, correo, nombre };
    return true;
  }
}
