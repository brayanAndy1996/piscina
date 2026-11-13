import { Controller, Get, Param } from '@nestjs/common';
import type { AcademiaPublica } from '@aquagestion/contratos';
import type { AcademiaResuelta } from '../../infraestructura/prisma';
import { ResolverAcademiaPipe } from './resolver-academia.pipe';

/** Rutas públicas de una academia por su nombre corto (D-27). Sin sesión. */
@Controller('a')
export class AcademiaPublicaController {
  /** Lo único que un visitante puede saber de una academia activa: su nombre corto y su nombre. */
  @Get(':nombreCorto')
  obtener(@Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta): AcademiaPublica {
    return { nombreCorto: academia.nombreCorto, nombre: academia.nombre };
  }
}
