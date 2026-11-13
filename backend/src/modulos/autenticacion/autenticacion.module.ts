import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SeguridadModule } from '../../infraestructura/seguridad';
import { AuditoriaModule } from '../auditoria';
import { PermisosGuard } from './permisos.guard';
import { IngresoAcademiaController, SesionAcademiaController } from './sesion-academia.controller';
import { SesionAcademiaService } from './sesion-academia.service';

/** Sesión de los usuarios de una academia (cookie `aq_sesion`), permisos por rol y cambio de la propia contraseña (spec 002). */
@Module({
  imports: [SeguridadModule, AuditoriaModule],
  controllers: [IngresoAcademiaController, SesionAcademiaController],
  providers: [SesionAcademiaService, { provide: APP_GUARD, useClass: PermisosGuard }],
  exports: [SesionAcademiaService],
})
export class AutenticacionModule {}
