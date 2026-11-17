import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { ClasesController } from './clases.controller';
import { ClasesService } from './clases.service';

/** Clases y horarios de cada academia (spec 004): nivel, día, bloque de 1 hora, entrenador y aforo. */
@Module({
  imports: [AuditoriaModule],
  controllers: [ClasesController],
  providers: [ClasesService],
  exports: [ClasesService],
})
export class ClasesModule {}
