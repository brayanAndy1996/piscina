import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  type BuscarUsuarioPorDni,
  buscarUsuarioPorDniSchema,
  type CrearUsuario,
  crearUsuarioSchema,
  cuerpoVacioSchema,
  type RespuestaListaUsuarios,
  type RespuestaUsuario,
} from '@aquagestion/contratos';
import { Param } from '@nestjs/common';
import type { Request } from 'express';
import { IdDeRuta, ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { UsuarioAutenticado } from '../autenticacion/tipos';
import { UsuarioActual } from '../autenticacion/usuario-actual.decorator';
import { UsuariosService } from './usuarios.service';

/**
 * Gestión de las cuentas de una academia (spec 002). La academia sale siempre de la sesión (`@UsuarioActual()`): ninguna ruta la
 * recibe en la dirección, la consulta o el cuerpo, y los esquemas son estrictos (criterio 20). El DNI que se busca para restablecer
 * va en el cuerpo de un `POST` y no en la dirección, para que no llegue a los registros de acceso (PO-3, criterio 43).
 */
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly servicio: UsuariosService) {}

  @Get()
  @Permiso('GESTIONAR_USUARIOS')
  async listar(@UsuarioActual() usuario: UsuarioAutenticado): Promise<RespuestaListaUsuarios> {
    return { usuarios: await this.servicio.listarPersonal(usuario.academiaId) };
  }

  @Post()
  @HttpCode(201)
  @Permiso('GESTIONAR_USUARIOS')
  async crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidarCon(crearUsuarioSchema)) datos: CrearUsuario,
    @Req() solicitud: Request,
  ): Promise<RespuestaUsuario> {
    const creado = await this.servicio.crearPersonal(
      usuario.academiaId,
      datos,
      { tipo: 'USUARIO', id: usuario.id },
      solicitud.ip ?? null,
    );
    return { usuario: creado };
  }

  /** Un segmento literal: no se confunde con `:id/…` (esas rutas tienen un segundo segmento y validan el UUID). */
  @Post('buscar-por-dni')
  @HttpCode(200)
  @Permiso('RESTABLECER_CLAVE')
  async buscarPorDni(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidarCon(buscarUsuarioPorDniSchema)) datos: BuscarUsuarioPorDni,
  ): Promise<RespuestaUsuario> {
    return { usuario: await this.servicio.buscarParaRestablecer(usuario, datos.dni) };
  }

  @Post(':id/desactivar')
  @HttpCode(200)
  @Permiso('GESTIONAR_USUARIOS')
  async desactivar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(cuerpoVacioSchema)) _cuerpo: unknown,
    @Req() solicitud: Request,
  ): Promise<RespuestaUsuario> {
    return { usuario: await this.servicio.desactivar(usuario, id, solicitud.ip ?? null) };
  }

  @Post(':id/reactivar')
  @HttpCode(200)
  @Permiso('GESTIONAR_USUARIOS')
  async reactivar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(cuerpoVacioSchema)) _cuerpo: unknown,
    @Req() solicitud: Request,
  ): Promise<RespuestaUsuario> {
    return { usuario: await this.servicio.reactivar(usuario, id, solicitud.ip ?? null) };
  }

  @Post(':id/restablecer-clave')
  @HttpCode(200)
  @Permiso('RESTABLECER_CLAVE')
  async restablecerClave(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(cuerpoVacioSchema)) _cuerpo: unknown,
    @Req() solicitud: Request,
  ): Promise<RespuestaUsuario> {
    const restablecido = await this.servicio.restablecer(
      usuario.academiaId,
      { tipo: 'USUARIO', id: usuario.id, rol: usuario.rol },
      id,
      solicitud.ip ?? null,
    );
    return { usuario: restablecido };
  }
}
