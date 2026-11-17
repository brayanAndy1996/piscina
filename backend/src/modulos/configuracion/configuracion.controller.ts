import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import {
  type ActualizarConfiguracion,
  actualizarConfiguracionSchema,
  type RespuestaConfiguracion,
  type RespuestaMiAcademia,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { Permiso, SoloSesion } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { ConfiguracionService } from './configuracion.service';

/**
 * Configuración de la academia (spec 003). La academia sale siempre de la sesión (`@SesionActual()`): ninguna ruta la recibe en la
 * dirección, la consulta o el cuerpo, y el esquema del `PATCH` es estricto (criterio 4). El Superadmin no tiene ruta aquí (D-29).
 */
@Controller()
export class ConfiguracionController {
  constructor(private readonly servicio: ConfiguracionService) {}

  @Get('configuracion')
  @Permiso('CONFIGURAR_ACADEMIA')
  obtener(@SesionActual() sesion: SesionVerificada): Promise<RespuestaConfiguracion> {
    return this.servicio.obtener(sesion.usuario.academiaId);
  }

  @Patch('configuracion')
  @Permiso('CONFIGURAR_ACADEMIA')
  actualizar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(actualizarConfiguracionSchema)) datos: ActualizarConfiguracion,
    @Req() solicitud: Request,
  ): Promise<RespuestaConfiguracion> {
    return this.servicio.actualizar(sesion, datos, solicitud.ip ?? null);
  }

  /** Identidad de la academia de la sesión (D-22): le basta una sesión válida, de cualquier rol. */
  @Get('mi-academia')
  @SoloSesion()
  miAcademia(@SesionActual() sesion: SesionVerificada): Promise<RespuestaMiAcademia> {
    return this.servicio.miAcademia(sesion);
  }
}
