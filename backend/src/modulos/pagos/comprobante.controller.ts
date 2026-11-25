import { Controller, Param, Put, Req, Res } from '@nestjs/common';
import { CABECERA_DATOS_PAGO, CABECERA_TOKEN_SOLICITUD, type VistaSolicitud } from '@aquagestion/contratos';
import type { Request, Response } from 'express';
import { tipoDeMedio } from '../../comun/http/cuerpo-imagen';
import type { AcademiaResuelta } from '../../infraestructura/prisma';
import { ResolverAcademiaPipe } from '../academias/resolver-academia.pipe';
import { ComprobanteService } from './comprobante.service';

/** Express entrega los nombres de las cabeceras en minúsculas. */
const CABECERA_TOKEN = CABECERA_TOKEN_SOLICITUD.toLowerCase();
const CABECERA_DATOS = CABECERA_DATOS_PAGO.toLowerCase();

/**
 * El comprobante de Yape o transferencia (spec 007b, criterios 36 a 44): `PUT /api/a/{nombreCorto}/solicitudes/comprobante`. Sin sesión: la
 * persona se identifica con el token de su solicitud en `X-Token-Solicitud` (nunca en la dirección) y manda los datos del pago en
 * `X-Pago-Datos` y la imagen como cuerpo binario. El límite por conexión, el tipo, la codificación y el tamaño ya los decidieron los
 * middlewares de Express (`LIMITES_PUBLICOS` y el lector binario de `cuerpo-imagen.ts`), antes de leer el cuerpo y de buscar la academia;
 * aquí sigue la academia (el pipe, 404 o 403) y el resto lo decide `ComprobanteService`, en su orden.
 */
@Controller('a/:nombreCorto/solicitudes')
export class ComprobantePublicoController {
  constructor(private readonly comprobante: ComprobanteService) {}

  /** 201 con `{ solicitud }` (la vista `EN_VERIFICACION`); 200 con la vista actual si es un reintento con la misma clave. */
  @Put('comprobante')
  async subir(
    @Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<{ solicitud: VistaSolicitud }> {
    const cuerpo: unknown = solicitud.body;
    const imagen = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.alloc(0);
    // El lector binario ya comprobó que el tipo es uno de `FOTO_TIPOS`.
    const tipo = tipoDeMedio(solicitud.headers['content-type']) === 'image/png' ? 'image/png' : 'image/jpeg';
    const resultado = await this.comprobante.subir(
      academia,
      solicitud.headers[CABECERA_TOKEN],
      solicitud.headers[CABECERA_DATOS],
      imagen,
      tipo,
      solicitud.ip ?? null,
    );
    respuesta.status(resultado.creado ? 201 : 200);
    return { solicitud: resultado.solicitud };
  }
}
