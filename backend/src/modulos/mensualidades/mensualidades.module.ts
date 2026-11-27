import { Module } from '@nestjs/common';
import { UsuariosModule } from '../usuarios';
import { RenovacionComprobanteService } from './renovacion-comprobante.service';
import { RenovacionController } from './renovacion.controller';
import { RenovacionService } from './renovacion.service';

/**
 * Mensualidades y renovación (spec 010a): la oferta, la cotización y el registro de la renovación de una mensualidad en recepción, en efectivo o
 * con el comprobante de Yape o transferencia, con la prioridad de horario (D-06). La 010b suma el listado y el cierre de mes; la 010c, el cambio de
 * horario. El reloj, el almacén de archivos y el correo son globales.
 */
@Module({
  imports: [UsuariosModule],
  controllers: [RenovacionController],
  providers: [RenovacionService, RenovacionComprobanteService],
  exports: [RenovacionService, RenovacionComprobanteService],
})
export class MensualidadesModule {}
