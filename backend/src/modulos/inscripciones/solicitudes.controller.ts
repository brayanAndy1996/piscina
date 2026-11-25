import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import {
  type CancelarSolicitud,
  cancelarSolicitudSchema,
  consultaListaSolicitudesSchema,
  type RespuestaListaSolicitudes,
  type RespuestaSolicitudPanel,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { tipoDeMedio } from '../../comun/http/cuerpo-imagen';
import { parametroCrudo } from '../../comun/http/parametro-crudo';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { FotoPanelService } from './foto-panel.service';
import { SolicitudesService } from './solicitudes.service';

/**
 * Panel de solicitudes de inscripción (spec 005b, criterios 38 y 39). La academia sale siempre de la sesión: ninguna ruta la recibe en la
 * dirección, la consulta o el cuerpo. Solo `ADMIN` y `SECRETARIA` (`REGISTRAR_INSCRIPCION_Y_COBRO`, sección 2.1); el Superadmin no tiene
 * ruta aquí (D-29).
 */
@Controller('solicitudes')
export class SolicitudesController {
  private readonly validarConsulta = new ValidarCon(consultaListaSolicitudesSchema);

  constructor(
    private readonly servicio: SolicitudesService,
    private readonly foto: FotoPanelService,
  ) {}

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

  /**
   * La foto del alumno de la solicitud desde el panel (008b, criterios 23 a 27): 204 sin cuerpo. El tipo, la codificación y el tamaño ya los decidió
   * el lector binario (`cuerpo-imagen.ts`), que solo lee el cuerpo si la sesión tiene el permiso; el `{id}` (404), el estado de la solicitud (409) y
   * la imagen los comprueba `FotoPanelService`, en ese orden.
   */
  @Put(':id/foto')
  @HttpCode(204)
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  async subirFoto(
    @SesionActual() sesion: SesionVerificada,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<void> {
    const cuerpo: unknown = solicitud.body;
    const imagen = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.alloc(0);
    // El lector binario ya comprobó que el tipo es uno de `FOTO_TIPOS`.
    const tipo = tipoDeMedio(solicitud.headers['content-type']) === 'image/png' ? 'image/png' : 'image/jpeg';
    await this.foto.subir(sesion, id, imagen, tipo, solicitud.ip ?? null);
  }
}
