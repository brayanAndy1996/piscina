import { Body, Controller, Delete, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  type IniciarSesionPlataforma,
  iniciarSesionPlataformaSchema,
  type RespuestaSesionPlataforma,
} from '@aquagestion/contratos';
import type { Request, Response } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { ENTORNO, type Entorno } from '../../infraestructura/entorno';
import { NOMBRE_COOKIE_PLATAFORMA, opcionesCookiePlataforma } from '../../infraestructura/seguridad';
import { SesionPlataformaGuard } from './sesion-plataforma.guard';
import { SesionPlataformaService } from './sesion-plataforma.service';
import { SuperadminActual } from './superadmin-actual.decorator';
import { DURACION_SESION_PLATAFORMA_SEGUNDOS, type SuperadminAutenticado } from './tipos';

/**
 * Sesión del Superadmin. `POST` y `DELETE` son públicos (el middleware de `/api/plataforma` los deja pasar); todo lo
 * demás bajo el prefijo exige sesión.
 */
@Controller('plataforma/sesion')
export class SesionPlataformaController {
  constructor(
    private readonly servicio: SesionPlataformaService,
    @Inject(ENTORNO) private readonly entorno: Entorno,
  ) {}

  /**
   * Inicia la sesión. El límite por IP (10 por minuto) lo aplica un middleware que corre antes del lector del cuerpo
   * (`instalarProteccionDePrefijos`, criterio 75): cuentan todas las peticiones y la 11.ª recibe 429 sin leer el cuerpo.
   */
  @Post()
  @HttpCode(200)
  async iniciar(
    @Body(new ValidarCon(iniciarSesionPlataformaSchema)) datos: IniciarSesionPlataforma,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaSesionPlataforma> {
    const { superadmin, token } = await this.servicio.iniciarSesion(datos.correo, datos.clave, solicitud.ip ?? null);
    respuesta.cookie(NOMBRE_COOKIE_PLATAFORMA, token, {
      ...opcionesCookiePlataforma(this.entorno.NODE_ENV),
      maxAge: DURACION_SESION_PLATAFORMA_SEGUNDOS * 1000,
    });
    return { superadmin };
  }

  @Get()
  @UseGuards(SesionPlataformaGuard)
  obtener(@SuperadminActual() superadmin: SuperadminAutenticado): RespuestaSesionPlataforma {
    return { superadmin };
  }

  /** Siempre responde 204 y borra la cookie; si la sesión era válida, además invalida el token. */
  @Delete()
  @HttpCode(204)
  async cerrar(@Req() solicitud: Request, @Res({ passthrough: true }) respuesta: Response): Promise<void> {
    await this.servicio.cerrarSesion(solicitud);
    // `res.cookie` con `maxAge: 0` produce `Max-Age=0` y la misma ruta que la cookie original (`clearCookie` no
    // garantiza `Max-Age=0`).
    respuesta.cookie(NOMBRE_COOKIE_PLATAFORMA, '', { ...opcionesCookiePlataforma(this.entorno.NODE_ENV), maxAge: 0 });
  }
}
