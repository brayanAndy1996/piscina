import { Body, Controller, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import {
  CABECERA_TOKEN_SOLICITUD,
  type ConsultarSolicitud,
  consultarSolicitudSchema,
  type RespuestaConsultaSolicitud,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { tipoDeMedio } from '../../comun/http/cuerpo-imagen';
import { ValidarCon } from '../../comun/validacion';
import type { AcademiaResuelta } from '../../infraestructura/prisma';
import { ResolverAcademiaPipe } from '../academias/resolver-academia.pipe';
import { FotoService } from './foto.service';
import { SeguimientoService } from './seguimiento.service';

/** Express entrega los nombres de las cabeceras en minúsculas. */
const CABECERA_TOKEN = CABECERA_TOKEN_SOLICITUD.toLowerCase();

/**
 * Seguimiento de la solicitud (spec 005, criterios 29 a 32; D-05, D-27): `POST /api/a/{nombreCorto}/solicitudes/consulta`. Sin sesión.
 * El token y el DNI viajan en el cuerpo, nunca en la dirección (una dirección queda en los registros del proxy y en el historial del
 * navegador). Es un `POST` de lectura: no escribe ni audita.
 *
 * Y la foto opcional (005b, criterios 34 a 37): `PUT /api/a/{nombreCorto}/solicitudes/foto`, con el token en `X-Token-Solicitud` (tampoco en
 * la dirección) y la imagen como cuerpo binario. El tipo, la codificación y el tamaño ya los decidió el lector binario (`cuerpo-imagen.ts`),
 * antes de buscar la academia.
 */
@Controller('a/:nombreCorto/solicitudes')
export class SeguimientoController {
  private readonly validarConsulta = new ValidarCon(consultarSolicitudSchema);

  constructor(
    private readonly servicio: SeguimientoService,
    private readonly foto: FotoService,
  ) {}

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

  /** 204 sin cuerpo. La academia se resuelve antes (404 o 403); el token, el estado y la imagen los comprueba `FotoService`, en ese orden. */
  @Put('foto')
  @HttpCode(204)
  async subirFoto(
    @Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta,
    @Req() solicitud: Request,
  ): Promise<void> {
    const cuerpo: unknown = solicitud.body;
    const imagen = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.alloc(0);
    // El lector binario ya comprobó que el tipo es uno de `FOTO_TIPOS`.
    const tipo = tipoDeMedio(solicitud.headers['content-type']) === 'image/png' ? 'image/png' : 'image/jpeg';
    await this.foto.subir(academia, solicitud.headers[CABECERA_TOKEN], imagen, tipo);
  }
}
