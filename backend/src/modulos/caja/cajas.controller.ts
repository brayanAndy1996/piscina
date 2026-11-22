import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  type AbrirCaja,
  abrirCajaSchema,
  type CerrarCaja,
  cerrarCajaSchema,
  type ReabrirCaja,
  reabrirCajaSchema,
  type RegistrarEgreso,
  registrarEgresoSchema,
  type RespuestaCaja,
  type RespuestaCajaActual,
  type RespuestaEgreso,
} from '@aquagestion/contratos';
import type { Request, Response } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { CajasService } from './cajas.service';

/**
 * La caja del día (spec 006a, HU-25 a HU-27). La academia sale siempre de la sesión: ninguna ruta la recibe en la dirección, la consulta o el
 * cuerpo, y los esquemas son estrictos. Abrir, cerrar y registrar egresos: administrador y secretaria (`ABRIR_CERRAR_CAJA`, sección 2.1);
 * reabrir un cierre, solo el administrador (`REABRIR_CAJA`, DT-1). El Superadmin no tiene ruta aquí (D-29).
 *
 * Orden de las comprobaciones (el de 002): sesión → academia activa → cambio obligatorio → permiso → cuerpo → operación. No hay rutas para
 * cambiar ni borrar un movimiento ni un cierre (criterio 23): esas direcciones responden 404.
 */
@Controller('cajas')
export class CajasController {
  constructor(private readonly servicio: CajasService) {}

  /** Declarada antes de cualquier ruta con `:id` (la de 006b: `GET /api/cajas/{id}`). Los parámetros de consulta se ignoran. */
  @Get('actual')
  @Permiso('ABRIR_CERRAR_CAJA')
  actual(@SesionActual() sesion: SesionVerificada): Promise<RespuestaCajaActual> {
    return this.servicio.actual(sesion.usuario.academiaId);
  }

  /** 201 con la caja nueva; 200 con la caja ya creada si repite la clave (doble clic o reintento, criterio 16). */
  @Post()
  @Permiso('ABRIR_CERRAR_CAJA')
  async abrir(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(abrirCajaSchema)) datos: AbrirCaja,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaCaja> {
    const { caja, creada } = await this.servicio.abrir(sesion, datos, solicitud.ip ?? null);
    if (!creada) respuesta.status(200);
    return { caja };
  }

  /**
   * El `id` no pasa por `IdDeRuta`: un id que no es UUID responde el mismo 404 que uno que no existe o es de otra academia, después del cuerpo
   * y de `bloquearActorVigente` (lo decide el servicio). 201 con el egreso nuevo; 200 si repite la clave (criterio 22).
   */
  @Post(':id/egresos')
  @Permiso('ABRIR_CERRAR_CAJA')
  async registrarEgreso(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(registrarEgresoSchema)) datos: RegistrarEgreso,
    @Param('id') id: string,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaEgreso> {
    const { respuesta: cuerpo, creado } = await this.servicio.registrarEgreso(sesion, id, datos, solicitud.ip ?? null);
    if (!creado) respuesta.status(200);
    return cuerpo;
  }

  @Post(':id/cierre')
  @HttpCode(200)
  @Permiso('ABRIR_CERRAR_CAJA')
  cerrar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(cerrarCajaSchema)) datos: CerrarCaja,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaCaja> {
    return this.servicio.cerrar(sesion, id, datos, solicitud.ip ?? null);
  }

  @Post(':id/reapertura')
  @HttpCode(200)
  @Permiso('REABRIR_CAJA')
  reabrir(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(reabrirCajaSchema)) datos: ReabrirCaja,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaCaja> {
    return this.servicio.reabrir(sesion, id, datos, solicitud.ip ?? null);
  }
}
