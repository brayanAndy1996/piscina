import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  type CotizarInscripcion,
  cotizarInscripcionSchema,
  type EnviarInscripcion,
  enviarInscripcionSchema,
  type RespuestaCotizacion,
  type RespuestaFormularioInscripcion,
  type RespuestaInscripcionCreada,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { ValidarCon } from '../../comun/validacion';
import type { AcademiaResuelta } from '../../infraestructura/prisma';
import { ResolverAcademiaPipe } from '../academias/resolver-academia.pipe';
import { InscripcionesService } from './inscripciones.service';

/**
 * Inscripción pública de una academia (spec 005; D-27): `/api/a/{nombreCorto}/inscripcion`. Sin sesión: la academia sale solo del nombre
 * corto de la dirección (nunca del cuerpo ni de la consulta, y los esquemas son estrictos). El orden es el de las rutas públicas: el
 * límite por IP (un middleware que corre antes de leer el cuerpo y de buscar la academia, criterio 33) → la academia (404 o 403) → el
 * cuerpo (400) → la operación.
 */
@Controller('a/:nombreCorto/inscripcion')
export class InscripcionPublicaController {
  private readonly validarCotizacion = new ValidarCon(cotizarInscripcionSchema);
  private readonly validarEnvio = new ValidarCon(enviarInscripcionSchema);

  constructor(private readonly servicio: InscripcionesService) {}

  /** Los datos del formulario: planes vigentes, clases con cupo y textos de consentimiento (criterio 6). */
  @Get()
  formulario(
    @Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta,
  ): Promise<RespuestaFormularioInscripcion> {
    return this.servicio.leerFormulario(academia);
  }

  /**
   * La cotización: lo que pagaría con el plan y las clases elegidas. No escribe ni reserva nada (criterio 11). El cuerpo se valida aquí,
   * después de resolver la academia: Nest resuelve los parámetros a la vez y, si los dos fallaran, ganaría el 400 (síncrono) sobre el 404 o el
   * 403 de la academia; el orden del contrato es academia → cuerpo.
   */
  @Post('cotizacion')
  @HttpCode(200)
  cotizar(
    @Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta,
    @Body() cuerpo: unknown,
  ): Promise<RespuestaCotizacion> {
    const datos: CotizarInscripcion = this.validarCotizacion.transform(cuerpo);
    return this.servicio.cotizar(academia, datos);
  }

  /** El envío del formulario: crea la solicitud y reserva el cupo (criterios 12 a 28). Mismo orden: academia → cuerpo. */
  @Post()
  @HttpCode(201)
  enviar(
    @Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta,
    @Body() cuerpo: unknown,
    @Req() solicitud: Request,
  ): Promise<RespuestaInscripcionCreada> {
    const datos: EnviarInscripcion = this.validarEnvio.transform(cuerpo);
    return this.servicio.enviar(academia, datos, solicitud.ip ?? null);
  }
}
