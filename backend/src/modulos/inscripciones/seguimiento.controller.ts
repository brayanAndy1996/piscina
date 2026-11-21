import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  type ConsultarSolicitud,
  consultarSolicitudSchema,
  type RespuestaConsultaSolicitud,
} from '@aquagestion/contratos';
import { ValidarCon } from '../../comun/validacion';
import type { AcademiaResuelta } from '../../infraestructura/prisma';
import { ResolverAcademiaPipe } from '../academias/resolver-academia.pipe';
import { SeguimientoService } from './seguimiento.service';

/**
 * Seguimiento de la solicitud (spec 005, criterios 29 a 32; D-05, D-27): `POST /api/a/{nombreCorto}/solicitudes/consulta`. Sin sesión.
 * El token y el DNI viajan en el cuerpo, nunca en la dirección (una dirección queda en los registros del proxy y en el historial del
 * navegador). Es un `POST` de lectura: no escribe ni audita.
 */
@Controller('a/:nombreCorto/solicitudes')
export class SeguimientoController {
  private readonly validarConsulta = new ValidarCon(consultarSolicitudSchema);

  constructor(private readonly servicio: SeguimientoService) {}

  /** El cuerpo se valida después de resolver la academia (404 o 403 antes que 400): Nest resuelve los parámetros a la vez. */
  @Post('consulta')
  @HttpCode(200)
  consultar(
    @Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta,
    @Body() cuerpo: unknown,
  ): Promise<RespuestaConsultaSolicitud> {
    const datos: ConsultarSolicitud = this.validarConsulta.transform(cuerpo);
    return this.servicio.consultar(academia, datos);
  }
}
