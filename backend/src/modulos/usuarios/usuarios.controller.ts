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
import type { SesionVerificada, UsuarioAutenticado } from '../autenticacion/tipos';
import { SesionActual, UsuarioActual } from '../autenticacion/usuario-actual.decorator';
import { type ActorQueCambiaEstado, UsuariosService } from './usuarios.service';

function actorQueCambiaEstado(sesion: SesionVerificada): ActorQueCambiaEstado {
  return { id: sesion.usuario.id, academiaId: sesion.usuario.academiaId, versionToken: sesion.versionToken };
}

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
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(crearUsuarioSchema)) datos: CrearUsuario,
    @Req() solicitud: Request,
  ): Promise<RespuestaUsuario> {
    const creado = await this.servicio.crearPersonal(
      sesion.usuario.academiaId,
      datos,
      { tipo: 'USUARIO', id: sesion.usuario.id, versionToken: sesion.versionToken },
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
    @SesionActual() sesion: SesionVerificada,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(cuerpoVacioSchema)) _cuerpo: unknown,
    @Req() solicitud: Request,
  ): Promise<RespuestaUsuario> {
    return { usuario: await this.servicio.desactivar(actorQueCambiaEstado(sesion), id, solicitud.ip ?? null) };
  }

  @Post(':id/reactivar')
  @HttpCode(200)
  @Permiso('GESTIONAR_USUARIOS')
  async reactivar(
    @SesionActual() sesion: SesionVerificada,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(cuerpoVacioSchema)) _cuerpo: unknown,
    @Req() solicitud: Request,
  ): Promise<RespuestaUsuario> {
    return { usuario: await this.servicio.reactivar(actorQueCambiaEstado(sesion), id, solicitud.ip ?? null) };
  }

  @Post(':id/restablecer-clave')
  @HttpCode(200)
  @Permiso('RESTABLECER_CLAVE')
  async restablecerClave(
    @SesionActual() sesion: SesionVerificada,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(cuerpoVacioSchema)) _cuerpo: unknown,
    @Req() solicitud: Request,
  ): Promise<RespuestaUsuario> {
    const restablecido = await this.servicio.restablecer(
      sesion.usuario.academiaId,
      { tipo: 'USUARIO', id: sesion.usuario.id, rol: sesion.usuario.rol, versionToken: sesion.versionToken },
      id,
      solicitud.ip ?? null,
    );
    return { usuario: restablecido };
  }
}
