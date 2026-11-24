import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  type CancelarSolicitud,
  cancelarSolicitudSchema,
  consultaListaSolicitudesSchema,
  type RespuestaListaSolicitudes,
  type RespuestaSolicitudPanel,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { parametroCrudo } from '../../comun/http/parametro-crudo';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { SolicitudesService } from './solicitudes.service';

/**
 * Panel de solicitudes de inscripción (spec 005b, criterios 38 y 39). La academia sale siempre de la sesión: ninguna ruta la recibe en la
 * dirección, la consulta o el cuerpo. Solo `ADMIN` y `SECRETARIA` (`REGISTRAR_INSCRIPCION_Y_COBRO`, sección 2.1); el Superadmin no tiene
 * ruta aquí (D-29).
 */
@Controller('solicitudes')
export class SolicitudesController {
  private readonly validarConsulta = new ValidarCon(consultaListaSolicitudesSchema);

  constructor(private readonly servicio: SolicitudesService) {}

  @Get()
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  listar(@SesionActual() sesion: SesionVerificada, @Req() solicitud: Request): Promise<RespuestaListaSolicitudes> {
    const { estado } = this.validarConsulta.transform({ estado: parametroCrudo(solicitud, 'estado') });
    return this.servicio.listar(sesion.usuario.academiaId, estado);
  }

  /**
   * El `id` no pasa por `IdDeRuta`: un id que no es UUID responde el mismo 404 que uno que no existe o es de otra academia, después del
   * cuerpo y de `bloquearActorVigente` (lo decide el servicio).
   */
  @Post(':id/cancelar')
  @HttpCode(200)
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  cancelar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(cancelarSolicitudSchema)) datos: CancelarSolicitud,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaSolicitudPanel> {
    return this.servicio.cancelar(sesion, id, datos, solicitud.ip ?? null);
  }
}
