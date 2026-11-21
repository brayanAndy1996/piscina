import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  type ActualizarClase,
  actualizarClaseSchema,
  type CrearClase,
  crearClaseSchema,
  type RespuestaClase,
  type RespuestaListaClases,
  type RespuestaOcupacion,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { ClasesService } from './clases.service';

/**
 * Clases y horarios de la academia (spec 004, HU-17). La academia sale siempre de la sesión: ninguna ruta la recibe en la dirección, la
 * consulta o el cuerpo, y los esquemas son estrictos. Solo el administrador (sección 2.1): las seis rutas de planes y clases usan el
 * mismo permiso. No hay ruta para borrar: las clases se desactivan. El Superadmin no tiene ruta aquí (D-29).
 */
@Controller('clases')
export class ClasesController {
  constructor(private readonly servicio: ClasesService) {}

  @Get()
  @Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')
  listar(@SesionActual() sesion: SesionVerificada): Promise<RespuestaListaClases> {
    return this.servicio.listar(sesion.usuario.academiaId);
  }

  /**
   * `GET /api/clases/ocupacion` (005b, criterio 40): cuántos inscritos tiene cada clase y cuántos cupos le quedan este mes. Va aparte de
   * `GET /api/clases` para no cambiar `claseSchema`; solo el administrador, igual que las demás rutas de clases. Los parámetros de consulta
   * se ignoran.
   */
  @Get('ocupacion')
  @Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')
  ocupacion(@SesionActual() sesion: SesionVerificada): Promise<RespuestaOcupacion> {
    return this.servicio.ocupacion(sesion.usuario.academiaId);
  }

  @Post()
  @HttpCode(201)
  @Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')
  async crear(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(crearClaseSchema)) datos: CrearClase,
    @Req() solicitud: Request,
  ): Promise<RespuestaClase> {
    return { clase: await this.servicio.crear(sesion, datos, solicitud.ip ?? null) };
  }

  /**
   * El `id` no pasa por `IdDeRuta`: un id que no es UUID responde el mismo 404 que uno que no existe o es de otra academia (criterio 6),
   * y después del cuerpo y de la comprobación del administrador. Lo decide el servicio.
   */
  @Patch(':id')
  @Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')
  async actualizar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(actualizarClaseSchema)) datos: ActualizarClase,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaClase> {
    return { clase: await this.servicio.actualizar(sesion, id, datos, solicitud.ip ?? null) };
  }
}
