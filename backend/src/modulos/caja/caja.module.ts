import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { CajasController } from './cajas.controller';
import { CajasService } from './cajas.service';

/** La caja del día de cada academia (spec 006a): apertura, egresos, cierre y reapertura. Los cobros de la 007 entran por `registrarIngresoEnCaja`. */
@Module({
  imports: [AuditoriaModule],
  controllers: [CajasController],
  providers: [CajasService],
  exports: [CajasService],
})
export class CajaModule {}
