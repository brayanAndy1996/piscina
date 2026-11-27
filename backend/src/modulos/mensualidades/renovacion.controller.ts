import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import {
  CABECERA_DATOS_RENOVACION,
  cotizarRenovacionSchema,
  type CotizarRenovacion,
  mesSchema,
  type OfertaRenovacion,
  renovarEnEfectivoSchema,
  type RenovarEnEfectivo,
  type RespuestaCotizacionRenovacion,
  type RespuestaRenovacion,
} from '@aquagestion/contratos';
import type { Request, Response } from 'express';
import { tipoDeMedio } from '../../comun/http/cuerpo-imagen';
import { parametroCrudo } from '../../comun/http/parametro-crudo';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { RenovacionComprobanteService } from './renovacion-comprobante.service';
import { RenovacionService } from './renovacion.service';

/**
 * La renovación de la mensualidad en recepción (spec 010a, criterios 2, 5, 6 y 17). La academia sale siempre de la sesión: ninguna ruta la recibe en
 * la dirección, la consulta o el cuerpo, y los esquemas son estrictos. Las rutas son de `ADMIN` y `SECRETARIA` (`REGISTRAR_INSCRIPCION_Y_COBRO`,
 * sección 2.1): el alumno no renueva desde su cuenta (D-14, DR-1) y el entrenador tampoco. Orden de las comprobaciones (el de 002): sesión → academia
 * activa → cambio obligatorio → permiso → cuerpo → operación. El `{id}` no pasa por pipes: uno que no es UUID responde el mismo 404 que uno que no
 * existe, es de otra academia o es de un `CLIENTE`, después del cuerpo. `HEAD` responde 404 (`/alumnos` está en `PREFIJOS_SIN_HEAD`).
 */
@Controller('alumnos')
export class RenovacionController {
  private readonly validarMes = new ValidarCon(mesSchema);

  constructor(
    private readonly renovacion: RenovacionService,
    private readonly comprobante: RenovacionComprobanteService,
  ) {}

  /** `?mes=AAAA-MM` es opcional; se valida el valor crudo (uno repetido o con corchetes es un 400). */
  @Get(':id/renovacion')
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  oferta(
    @SesionActual() sesion: SesionVerificada,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<OfertaRenovacion> {
    const crudo = parametroCrudo(solicitud, 'mes');
    const mes = crudo === undefined ? undefined : this.validarMes.transform(crudo);
    return this.renovacion.oferta(sesion.usuario.academiaId, id, mes);
  }

  @Post(':id/renovacion/cotizacion')
  @HttpCode(200)
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  cotizar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(cotizarRenovacionSchema)) datos: CotizarRenovacion,
    @Param('id') id: string,
  ): Promise<RespuestaCotizacionRenovacion> {
    return this.renovacion.cotizar(sesion.usuario.academiaId, id, datos);
  }

  /** 201 con la renovación cobrada; 200 con la misma respuesta y `repetida: true` si repite la clave (doble clic o reintento, criterio 12). */
  @Post(':id/renovacion/efectivo')
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  async efectivo(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(renovarEnEfectivoSchema)) datos: RenovarEnEfectivo,
    @Param('id') id: string,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaRenovacion> {
    const resultado = await this.renovacion.registrarEnEfectivo(sesion, id, datos, solicitud.ip ?? null);
    respuesta.status(resultado.creada ? 201 : 200);
    return resultado.respuesta;
  }

  /**
   * El comprobante de Yape o transferencia (criterio 7): la imagen como cuerpo binario y los datos en `X-Renovacion-Datos`. El tipo, la codificación
   * y el tamaño ya los decidió el lector binario (`cuerpo-imagen.ts`), que solo lee el cuerpo si la sesión tiene el permiso; la cabecera (400), el
   * alumno (404), la clave y la imagen (400) los comprueba `RenovacionComprobanteService`, en ese orden. 201 con la renovación en verificación; 200
   * con la misma respuesta si repite la clave. Esta ruta no cuenta en `LIMITES_PUBLICOS`: exige sesión.
   */
  @Put(':id/renovacion/comprobante')
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  async subirComprobante(
    @SesionActual() sesion: SesionVerificada,
    @Param('id') id: string,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaRenovacion> {
    const cuerpo: unknown = solicitud.body;
    const imagen = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.alloc(0);
    // El lector binario ya comprobó que el tipo es uno de `FOTO_TIPOS`.
    const tipo = tipoDeMedio(solicitud.headers['content-type']) === 'image/png' ? 'image/png' : 'image/jpeg';
    const resultado = await this.comprobante.registrar(
      sesion,
      id,
      solicitud.headers[CABECERA_DATOS_RENOVACION.toLowerCase()],
      imagen,
      tipo,
      solicitud.ip ?? null,
    );
    respuesta.status(resultado.creada ? 201 : 200);
    return resultado.respuesta;
  }
}
