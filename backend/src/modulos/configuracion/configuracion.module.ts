import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { ConfiguracionController } from './configuracion.controller';
import { ConfiguracionService } from './configuracion.service';

/** Configuración de cada academia (spec 003): tolerancia, días "por vencer", prioridad, bloqueo del ingreso y teléfono. */
@Module({
  imports: [AuditoriaModule],
  controllers: [ConfiguracionController],
  providers: [ConfiguracionService],
  exports: [ConfiguracionService],
})
export class ConfiguracionModule {}
