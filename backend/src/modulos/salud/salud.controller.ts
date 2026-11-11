import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { RespuestaSalud } from '@aquagestion/contratos';
import type { Response } from 'express';
import { SaludService } from './salud.service';

@Controller('salud')
export class SaludController {
  constructor(private readonly servicio: SaludService) {}

  /** Público. 200 si la base responde; 503 si no. Nunca se guarda en caché. */
  @Get()
  async obtener(@Res({ passthrough: true }) respuesta: Response): Promise<RespuestaSalud> {
    respuesta.setHeader('Cache-Control', 'no-store');
    const resultado = await this.servicio.comprobar();
    respuesta.status(resultado.estado === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return resultado;
  }
}
