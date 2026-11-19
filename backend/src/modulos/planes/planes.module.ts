import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { PlanesController } from './planes.controller';
import { PlanesService } from './planes.service';

/** Planes de cada academia (spec 004): precio con IGV, clases por mes, días, franjas, niveles y vigencia. */
@Module({
  imports: [AuditoriaModule],
  controllers: [PlanesController],
  providers: [PlanesService],
  exports: [PlanesService],
})
export class PlanesModule {}
