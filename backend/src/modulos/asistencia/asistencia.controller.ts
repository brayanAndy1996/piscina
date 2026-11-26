import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import {
  type RegistrarAsistenciaManual,
  registrarAsistenciaManualSchema,
  type RegistrarAsistenciaPosterior,
  registrarAsistenciaPosteriorSchema,
  type RegistrarAsistenciaQr,
  registrarAsistenciaQrSchema,
  type ResultadoAsistencia,
} from '@aquagestion/contratos';
import type { Request, Response } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { MarcadoService, type ResultadoDelMarcado } from './marcado.service';

/**
 * El marcado de asistencia para recepción (spec 009a, criterios 2, 5 y 6): `POST /api/asistencias/qr` y `/manual`, y desde la 009b `/posterior` (criterio 28). Son del `ADMIN` y la
 * `SECRETARIA` (`REGISTRAR_ASISTENCIA`, sección 2.1); el Superadmin no tiene ruta aquí (D-29). La academia sale siempre de la sesión: ninguna ruta
 * la recibe en la dirección o el cuerpo, y los esquemas son estrictos. Orden de las comprobaciones (el de 002): sesión → academia activa → cambio
 * obligatorio → permiso → cuerpo → operación. Ninguna ruta lleva el token ni el contenido del QR en la dirección (criterio 17). `HEAD` responde
 * 404 (criterio 18, middleware de `configurarApp`; no hay ningún `@Head()` aquí).
 */
@Controller('asistencias')
export class AsistenciaController {
  constructor(private readonly marcado: MarcadoService) {}

  /** 201 con el resultado; 200 con el mismo resultado y `repetida: true` si repite la clave (doble clic o reintento, criterio 13). */
  @Post('qr')
  @Permiso('REGISTRAR_ASISTENCIA')
  async marcarPorQr(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(registrarAsistenciaQrSchema)) datos: RegistrarAsistenciaQr,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<ResultadoAsistencia> {
    const marcado = await this.marcado.marcar(
      sesion,
      { tipo: 'QR', contenido: datos.contenido },
      datos.claveIdempotencia,
      solicitud.ip ?? null,
    );
    return responder(respuesta, marcado);
  }

  @Post('manual')
  @Permiso('REGISTRAR_ASISTENCIA')
  async marcarManual(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(registrarAsistenciaManualSchema)) datos: RegistrarAsistenciaManual,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<ResultadoAsistencia> {
    const marcado = await this.marcado.marcar(
      sesion,
      { tipo: 'MANUAL', alumnoId: datos.alumnoId },
      datos.claveIdempotencia,
      solicitud.ip ?? null,
    );
    return responder(respuesta, marcado);
  }

  /**
   * El registro posterior de D-16 (009b, criterios 28 a 30): la asistencia de una clase que ya terminó, del mes en curso, con la hora de llegada y el motivo.
   * 201 con el resultado (`registroPosterior: true`); 200 con `repetida: true` si repite la clave. Queda en la auditoría.
   */
  @Post('posterior')
  @Permiso('REGISTRAR_ASISTENCIA')
  async registrarPosterior(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(registrarAsistenciaPosteriorSchema)) datos: RegistrarAsistenciaPosterior,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<ResultadoAsistencia> {
    const marcado = await this.marcado.marcar(
      sesion,
      {
        tipo: 'POSTERIOR',
        alumnoId: datos.alumnoId,
        fecha: datos.fecha,
        horaLlegada: datos.horaLlegada,
        motivo: datos.motivo,
      },
      datos.claveIdempotencia,
      solicitud.ip ?? null,
    );
    return responder(respuesta, marcado);
  }
}

function responder(respuesta: Response, marcado: ResultadoDelMarcado): ResultadoAsistencia {
  respuesta.status(marcado.creado ? 201 : 200);
  return marcado.resultado;
}
