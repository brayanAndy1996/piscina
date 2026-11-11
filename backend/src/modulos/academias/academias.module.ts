import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { SeguridadModule } from '../../infraestructura/seguridad';
import { AuditoriaModule } from '../auditoria';
import { AcademiaPublicaController } from './academia-publica.controller';
import { AcademiasPlataformaController } from './academias-plataforma.controller';
import { AcademiasService } from './academias.service';
import { ResolverAcademiaPipe } from './resolver-academia.pipe';
import { SesionPlataformaController } from './sesion-plataforma.controller';
import { SesionPlataformaGuard } from './sesion-plataforma.guard';
import { SesionPlataformaService } from './sesion-plataforma.service';

/** Límite del inicio de sesión de la plataforma: 10 peticiones por IP cada 60 segundos (DR-3, P-5). */
export const LIMITE_INICIO_SESION = { name: 'sesion', ttl: 60_000, limit: 10 };

/** Academias (plataforma y rutas públicas por nombre corto) y sesión del Superadmin. */
@Module({
  imports: [SeguridadModule, AuditoriaModule, ThrottlerModule.forRoot({ throttlers: [LIMITE_INICIO_SESION] })],
  controllers: [SesionPlataformaController, AcademiasPlataformaController, AcademiaPublicaController],
  providers: [SesionPlataformaService, SesionPlataformaGuard, AcademiasService, ResolverAcademiaPipe],
  exports: [ResolverAcademiaPipe, SesionPlataformaService],
})
export class AcademiasModule {}
