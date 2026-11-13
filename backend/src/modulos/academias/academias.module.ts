import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { SeguridadModule } from '../../infraestructura/seguridad';
import { AuditoriaModule } from '../auditoria';
import { UsuariosModule } from '../usuarios';
import { AcademiaPublicaController } from './academia-publica.controller';
import { AdministradoresPlataformaController } from './administradores-plataforma.controller';
import { AcademiasPlataformaController } from './academias-plataforma.controller';
import { AcademiasService } from './academias.service';
import { LIMITE_INICIO_SESION } from './limite-inicio-sesion';
import { ResolverAcademiaPipe } from './resolver-academia.pipe';
import { SesionPlataformaController } from './sesion-plataforma.controller';
import { SesionPlataformaGuard } from './sesion-plataforma.guard';
import { SesionPlataformaService } from './sesion-plataforma.service';

/** Academias (plataforma y rutas públicas por nombre corto), sesión del Superadmin y administradores de cada academia. */
@Module({
  imports: [
    SeguridadModule,
    AuditoriaModule,
    UsuariosModule,
    ThrottlerModule.forRoot({ throttlers: [LIMITE_INICIO_SESION] }),
  ],
  controllers: [
    SesionPlataformaController,
    AcademiasPlataformaController,
    AdministradoresPlataformaController,
    AcademiaPublicaController,
  ],
  providers: [SesionPlataformaService, SesionPlataformaGuard, AcademiasService, ResolverAcademiaPipe],
  exports: [ResolverAcademiaPipe, SesionPlataformaService],
})
export class AcademiasModule {}
