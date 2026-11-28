import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { AsistenciaController } from './asistencia.controller';
import { ConsultaDeAsistenciaController } from './consulta.controller';
import { ConsultaDeAsistenciaService } from './consulta.service';
import { FaltasService } from './faltas.service';
import { MarcadoService } from './marcado.service';

/**
 * Asistencia (spec 009a): el marcado por QR y manual en recepción, con el descuento de una clase de la mensualidad (RN-14). La 009b suma las faltas (`FaltasService`; su tarea
 * programada está en `TareasAsistenciaModule`), el registro posterior y la consulta del mes. El reloj, el almacén de archivos y la base son globales.
 */
@Module({
  imports: [AuditoriaModule],
  controllers: [AsistenciaController, ConsultaDeAsistenciaController],
  providers: [MarcadoService, FaltasService, ConsultaDeAsistenciaService],
  exports: [MarcadoService, FaltasService, ConsultaDeAsistenciaService],
})
export class AsistenciaModule {}
