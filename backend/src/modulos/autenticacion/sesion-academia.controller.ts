import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  type CambiarClave,
  cambiarClaveSchema,
  type IniciarSesionAcademia,
  iniciarSesionAcademiaSchema,
  type RespuestaSesionAcademia,
} from '@aquagestion/contratos';
import type { Request, Response } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { ENTORNO, type Entorno } from '../../infraestructura/entorno';
import type { AcademiaResuelta } from '../../infraestructura/prisma';
import { NOMBRE_COOKIE_ACADEMIA, opcionesCookieAcademia } from '../../infraestructura/seguridad';
import { ResolverAcademiaPipe } from '../academias/resolver-academia.pipe';
import { SoloSesion } from './permiso.decorator';
import { SesionAcademiaService, type SesionEmitida } from './sesion-academia.service';
import type { SesionVerificada } from './tipos';
import { SesionActual } from './usuario-actual.decorator';

/** Pone la cookie de sesión con la duración del rol (`Max-Age`) y devuelve el cuerpo de la respuesta. */
function emitirCookie(respuesta: Response, entorno: Entorno, sesion: SesionEmitida): RespuestaSesionAcademia {
  respuesta.cookie(NOMBRE_COOKIE_ACADEMIA, sesion.token, {
    ...opcionesCookieAcademia(entorno.NODE_ENV),
    maxAge: sesion.duracionSegundos * 1000,
  });
  return sesion.respuesta;
}

/**
 * Inicio de sesión de una academia (D-27, D-28): `POST /api/a/{nombreCorto}/sesion`. Es pública: la academia sale del nombre corto
 * de la dirección solo aquí; todas las demás rutas la toman de la sesión. El límite por IP (10 por minuto, todas las academias
 * juntas) lo aplica un middleware que corre antes de leer el cuerpo y de buscar la academia (`instalarProteccionDePrefijos`,
 * criterio 12).
 */
@Controller('a/:nombreCorto/sesion')
export class IngresoAcademiaController {
  constructor(
    private readonly servicio: SesionAcademiaService,
    @Inject(ENTORNO) private readonly entorno: Entorno,
  ) {}

  @Post()
  @HttpCode(200)
  async iniciar(
    @Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta,
    @Body(new ValidarCon(iniciarSesionAcademiaSchema)) datos: IniciarSesionAcademia,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaSesionAcademia> {
    const sesion = await this.servicio.iniciarSesion(academia, datos.usuario, datos.clave, solicitud.ip ?? null);
    return emitirCookie(respuesta, this.entorno, sesion);
  }
}

/**
 * Sesión de academia (cookie `aq_sesion`): ver, cerrar y cambiar la propia contraseña. Basta la sesión (D-14: también el alumno).
 * `DELETE` no pasa por el middleware de sesión: siempre responde 204 y borra la cookie.
 */
@Controller('sesion')
export class SesionAcademiaController {
  constructor(
    private readonly servicio: SesionAcademiaService,
    @Inject(ENTORNO) private readonly entorno: Entorno,
  ) {}

  @Get()
  @SoloSesion()
  obtener(@SesionActual() sesion: SesionVerificada): RespuestaSesionAcademia {
    return this.servicio.respuestaDe(sesion);
  }

  /** Siempre responde 204 y borra la cookie; si la sesión era válida, además invalida el token de la cuenta. */
  @Delete()
  @HttpCode(204)
  async cerrar(@Req() solicitud: Request, @Res({ passthrough: true }) respuesta: Response): Promise<void> {
    await this.servicio.cerrarSesion(solicitud);
    // `maxAge: 0` produce `Max-Age=0` y la misma ruta que la cookie original (`clearCookie` no garantiza `Max-Age=0`).
    respuesta.cookie(NOMBRE_COOKIE_ACADEMIA, '', { ...opcionesCookieAcademia(this.entorno.NODE_ENV), maxAge: 0 });
  }

  @Post('clave')
  @HttpCode(200)
  @SoloSesion()
  async cambiarClave(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(cambiarClaveSchema)) datos: CambiarClave,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaSesionAcademia> {
    const nueva = await this.servicio.cambiarClave(sesion, datos, solicitud.ip ?? null);
    return emitirCookie(respuesta, this.entorno, nueva);
  }
}
