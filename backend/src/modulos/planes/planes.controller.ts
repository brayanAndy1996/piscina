import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  type ActualizarPlan,
  actualizarPlanSchema,
  type CrearPlan,
  crearPlanSchema,
  type RespuestaListaPlanes,
  type RespuestaPlan,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { PlanesService } from './planes.service';

/**
 * Planes de la academia (spec 004, HU-19). La academia sale siempre de la sesión: ninguna ruta la recibe en la dirección, la consulta o
 * el cuerpo, y los esquemas son estrictos. Solo el administrador (sección 2.1): las seis rutas de planes y clases usan el mismo permiso.
 * No hay ruta para borrar: los planes se desactivan. El Superadmin no tiene ruta aquí (D-29).
 */
@Controller('planes')
export class PlanesController {
  constructor(private readonly servicio: PlanesService) {}

  @Get()
  @Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')
  listar(@SesionActual() sesion: SesionVerificada): Promise<RespuestaListaPlanes> {
    return this.servicio.listar(sesion.usuario.academiaId);
  }

  @Post()
  @HttpCode(201)
  @Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')
  async crear(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(crearPlanSchema)) datos: CrearPlan,
    @Req() solicitud: Request,
  ): Promise<RespuestaPlan> {
    return { plan: await this.servicio.crear(sesion, datos, solicitud.ip ?? null) };
  }

  /**
   * El `id` no pasa por `IdDeRuta`: un id que no es UUID responde el mismo 404 que uno que no existe o es de otra academia (criterio 6),
   * y después del cuerpo y de la comprobación del administrador. Lo decide el servicio.
   */
  @Patch(':id')
  @Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')
  async actualizar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(actualizarPlanSchema)) datos: ActualizarPlan,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaPlan> {
    return { plan: await this.servicio.actualizar(sesion, id, datos, solicitud.ip ?? null) };
  }
}
