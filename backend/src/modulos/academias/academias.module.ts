import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { SeguridadModule } from '../../infraestructura/seguridad';
import { AuditoriaModule } from '../auditoria';
import { AcademiaPublicaController } from './academia-publica.controller';
import { AcademiasPlataformaController } from './academias-plataforma.controller';
import { AcademiasService } from './academias.service';
import { LIMITE_INICIO_SESION } from './limite-inicio-sesion';
import { ResolverAcademiaPipe } from './resolver-academia.pipe';
import { SesionPlataformaController } from './sesion-plataforma.controller';
import { SesionPlataformaGuard } from './sesion-plataforma.guard';
import { SesionPlataformaService } from './sesion-plataforma.service';

/** Academias (plataforma y rutas públicas por nombre corto) y sesión del Superadmin. */
@Module({
  imports: [SeguridadModule, AuditoriaModule, ThrottlerModule.forRoot({ throttlers: [LIMITE_INICIO_SESION] })],
  controllers: [SesionPlataformaController, AcademiasPlataformaController, AcademiaPublicaController],
  providers: [SesionPlataformaService, SesionPlataformaGuard, AcademiasService, ResolverAcademiaPipe],
  exports: [ResolverAcademiaPipe, SesionPlataformaService],
})
export class AcademiasModule {}
