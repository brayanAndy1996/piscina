import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  type AdministradorResumen,
  type CrearAdministrador,
  crearAdministradorSchema,
  cuerpoVacioSchema,
  type RespuestaAdministrador,
  type RespuestaListaAdministradores,
  type UsuarioResumen,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { UsuariosService } from '../usuarios';
import { SesionPlataformaGuard } from './sesion-plataforma.guard';
import { SuperadminActual } from './superadmin-actual.decorator';
import type { SuperadminAutenticado } from './tipos';

/** El Superadmin ve de un administrador solo estos campos (D-29): sin rol ni último acceso. */
function aAdministrador(usuario: UsuarioResumen): AdministradorResumen {
  return {
    id: usuario.id,
    dni: usuario.dni,
    nombres: usuario.nombres,
    apellidos: usuario.apellidos,
    estado: usuario.estado,
    debeCambiarClave: usuario.debeCambiarClave,
    bloqueado: usuario.bloqueado,
  };
}

/**
 * Los administradores de cada academia desde la plataforma (DR-1 y DR-5, D-29): listar, crear y restablecer la contraseña. Es
 * lo único de una academia que el Superadmin toca; no hay rutas para ver otros usuarios ni su auditoría. La academia de la
 * dirección se valida con `conAcademia` (404 `ACADEMIA_NO_ENCONTRADA`, 403 `ACADEMIA_SUSPENDIDA`) y lo que se hace queda en la
 * auditoría de esa academia, con actor `SUPERADMIN`, en la misma transacción.
 */
@Controller('plataforma/academias/:id/administradores')
@UseGuards(SesionPlataformaGuard)
export class AdministradoresPlataformaController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  async listar(@Param('id') academiaId: string): Promise<RespuestaListaAdministradores> {
    const administradores = await this.usuarios.listarAdministradores(academiaId);
    return { administradores: administradores.map(aAdministrador) };
  }

  @Post()
  @HttpCode(201)
  async crear(
    @Param('id') academiaId: string,
    @Body(new ValidarCon(crearAdministradorSchema)) datos: CrearAdministrador,
    @SuperadminActual() superadmin: SuperadminAutenticado,
    @Req() solicitud: Request,
  ): Promise<RespuestaAdministrador> {
    const creado = await this.usuarios.crearPersonal(
      academiaId,
      { ...datos, rol: 'ADMIN' },
      { tipo: 'SUPERADMIN', id: superadmin.id },
      solicitud.ip ?? null,
    );
    return { administrador: aAdministrador(creado) };
  }

  @Post(':usuarioId/restablecer-clave')
  @HttpCode(200)
  async restablecerClave(
    @Param('id') academiaId: string,
    @Param('usuarioId') usuarioId: string,
    @Body(new ValidarCon(cuerpoVacioSchema)) _cuerpo: unknown,
    @SuperadminActual() superadmin: SuperadminAutenticado,
    @Req() solicitud: Request,
  ): Promise<RespuestaAdministrador> {
    const restablecido = await this.usuarios.restablecer(
      academiaId,
      { tipo: 'SUPERADMIN', id: superadmin.id },
      usuarioId,
      solicitud.ip ?? null,
    );
    return { administrador: aAdministrador(restablecido) };
  }
}
