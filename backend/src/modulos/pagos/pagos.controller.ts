import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  aprobarPagoSchema,
  ajustarMontoSchema,
  type AjustarMonto,
  cobrarEnEfectivoSchema,
  type CobrarEnEfectivo,
  rechazarPagoSchema,
  type RechazarPago,
  type RespuestaCobro,
  type RespuestaPago,
  type RespuestaPagosPendientes,
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
import { VerificacionService } from './verificacion.service';

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
    private readonly verificacion: VerificacionService,
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

  // -------------------------------------------------------------------------------------------------------------------------------
  // 007b: la bandeja de verificación y el comprobante. Solo `ADMIN` y `SECRETARIA` (`VERIFICAR_PAGOS`, sección 2.1).
  // -------------------------------------------------------------------------------------------------------------------------------

  /** `GET /api/pagos/pendientes`: la bandeja (criterio 45). Una lectura: no bloquea, no escribe y no audita. */
  @Get('pagos/pendientes')
  @Permiso('VERIFICAR_PAGOS')
  pendientes(@SesionActual() sesion: SesionVerificada): Promise<RespuestaPagosPendientes> {
    return this.verificacion.listarPendientes(sesion.usuario.academiaId);
  }

  /**
   * `GET /api/pagos/{id}/comprobante`: la imagen guardada (criterio 46). Va en la respuesta como JPEG con las cabeceras de una imagen que no
   * se guarda en ninguna caché ni se interpreta como otra cosa. Un id inválido o ajeno responde el 404 de siempre.
   */
  @Get('pagos/:id/comprobante')
  @Permiso('VERIFICAR_PAGOS')
  async comprobante(
    @SesionActual() sesion: SesionVerificada,
    @Param('id') id: string,
    @Res() respuesta: Response,
  ): Promise<void> {
    const imagen = await this.verificacion.leerComprobante(sesion.usuario.academiaId, id);
    respuesta.setHeader('Content-Type', 'image/jpeg');
    respuesta.setHeader('Cache-Control', 'no-store');
    respuesta.setHeader('X-Content-Type-Options', 'nosniff');
    respuesta.setHeader('Content-Disposition', 'inline');
    respuesta.setHeader('Content-Length', String(imagen.length));
    respuesta.status(200).end(imagen);
  }

  /**
   * `POST /api/pagos/{id}/aprobacion` (criterio 47): cuerpo `{}` estricto. 200 con `{ pago }`, también si ya estaba confirmado (criterio 48). El
   * `{id}` no pasa por pipes: uno que no es UUID responde el mismo 404 que uno que no existe o es de otra academia (AT-2 de 004).
   */
  @Post('pagos/:id/aprobacion')
  @HttpCode(200)
  @Permiso('VERIFICAR_PAGOS')
  aprobar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(aprobarPagoSchema)) _cuerpo: unknown,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaPago> {
    return this.verificacion.aprobar(sesion, id, solicitud.ip ?? null);
  }

  /** `POST /api/pagos/{id}/rechazo` (criterio 49): `{ motivo }` estricto. 200 con `{ pago }`, también si ya estaba rechazado. */
  @Post('pagos/:id/rechazo')
  @HttpCode(200)
  @Permiso('VERIFICAR_PAGOS')
  rechazar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(rechazarPagoSchema)) datos: RechazarPago,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaPago> {
    return this.verificacion.rechazar(sesion, id, datos, solicitud.ip ?? null);
  }
}
