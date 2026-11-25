import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  ajustarMontoSchema,
  type AjustarMonto,
  cobrarEnEfectivoSchema,
  type CobrarEnEfectivo,
  type RespuestaCobro,
  type RespuestaSolicitudPanel,
  type RespuestaTicket,
} from '@aquagestion/contratos';
import type { Request, Response } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { CobrosService } from './cobros.service';
import { TicketService } from './ticket.service';

/**
 * Cobro en efectivo, ajuste del monto y ticket (spec 007a). La academia sale siempre de la sesión: ninguna ruta la recibe en la dirección, la
 * consulta o el cuerpo, y los esquemas son estrictos. El cobro y el ticket son de `ADMIN` y `SECRETARIA` (`REGISTRAR_INSCRIPCION_Y_COBRO`, sección
 * 2.1); el ajuste del monto, solo del `ADMIN` (`AJUSTAR_MONTO_COBRO`, RN-25). El Superadmin no tiene ruta aquí (D-29). Orden de las
 * comprobaciones (el de 002): sesión → academia activa → cambio obligatorio → permiso → cuerpo → operación. El `{id}` no pasa por pipes: uno que
 * no es UUID responde el mismo 404 que uno que no existe o es de otra academia, después del cuerpo y de `bloquearActorVigente` (AT-2 de 004).
 */
@Controller()
export class PagosController {
  constructor(
    private readonly cobros: CobrosService,
    private readonly tickets: TicketService,
  ) {}

  /** 201 con el pago nuevo; 200 con el mismo `{ pago, solicitud }` si repite la clave (doble clic o reintento, criterio 17). */
  @Post('solicitudes/:id/pago-efectivo')
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  async cobrarEnEfectivo(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(cobrarEnEfectivoSchema)) datos: CobrarEnEfectivo,
    @Param('id') id: string,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaCobro> {
    const resultado = await this.cobros.cobrarEnEfectivo(sesion, id, datos, solicitud.ip ?? null);
    respuesta.status(resultado.creado ? 201 : 200);
    return { pago: resultado.pago, solicitud: resultado.solicitud };
  }

  @Post('solicitudes/:id/ajuste-monto')
  @HttpCode(200)
  @Permiso('AJUSTAR_MONTO_COBRO')
  ajustarMonto(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(ajustarMontoSchema)) datos: AjustarMonto,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaSolicitudPanel> {
    return this.cobros.ajustarMonto(sesion, id, datos, solicitud.ip ?? null);
  }

  @Get('pagos/:id/ticket')
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  ticket(@SesionActual() sesion: SesionVerificada, @Param('id') id: string): Promise<RespuestaTicket> {
    return this.tickets.leer(sesion.usuario.academiaId, id);
  }
}
