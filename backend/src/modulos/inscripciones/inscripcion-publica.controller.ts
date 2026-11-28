import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  consultaFormularioSchema,
  type CotizarInscripcion,
  cotizarInscripcionSchema,
  type EnviarInscripcion,
  enviarInscripcionSchema,
  type MesesInscripcion,
  type RespuestaCotizacion,
  type RespuestaFormularioInscripcion,
  type RespuestaInscripcionCreada,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { parametroCrudo } from '../../comun/http/parametro-crudo';
import { ValidarCon } from '../../comun/validacion';
import type { AcademiaResuelta } from '../../infraestructura/prisma';
import { ResolverAcademiaPipe } from '../academias/resolver-academia.pipe';
import type { SolicitudDeRecepcion } from '../autenticacion/tipos';
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
  private readonly validarConsulta = new ValidarCon(consultaFormularioSchema);

  constructor(private readonly servicio: InscripcionesService) {}

  /**
   * Los meses para los que se puede inscribir hoy (010d, criterio 1). Se declara antes que las demás rutas del prefijo; no choca con ellas (`cotizacion`
   * es un `POST`).
   */
  @Get('meses')
  meses(@Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta): Promise<MesesInscripcion> {
    return this.servicio.leerMeses(academia);
  }

  /**
   * Los datos del formulario: planes vigentes, clases con cupo y textos de consentimiento (criterio 6). Con `?mes=` (010d, criterio 2) los de ese mes: solo
   * se lee la clave `mes` (repetida o mal escrita, 400 en ese campo); las demás se ignoran (criterio 7 de 005). Se valida después de resolver la academia.
   */
  @Get()
  formulario(
    @Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta,
    @Req() solicitud: Request,
  ): Promise<RespuestaFormularioInscripcion> {
    const { mes } = this.validarConsulta.transform({ mes: parametroCrudo(solicitud, 'mes') });
    return this.servicio.leerFormulario(academia, mes);
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
    // La sesión de recepción que verificó el middleware de `/api/a` (007, criterio 33): solo si es de la academia de la dirección.
    const recepcion = (solicitud as SolicitudDeRecepcion).sesionDeRecepcion;
    return this.servicio.enviar(academia, datos, solicitud.ip ?? null, recepcion);
  }
}
