import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { InscripcionPublicaController } from './inscripcion-publica.controller';
import { InscripcionesService } from './inscripciones.service';
import { SeguimientoController } from './seguimiento.controller';
import { SeguimientoService } from './seguimiento.service';

/** Inscripción pública, reserva del cupo y seguimiento de la solicitud (spec 005a). El correo llega por `ENVIADOR_CORREO` (global). */
@Module({
  imports: [AuditoriaModule],
  controllers: [InscripcionPublicaController, SeguimientoController],
  providers: [InscripcionesService, SeguimientoService],
  exports: [InscripcionesService, SeguimientoService],
})
export class InscripcionesModule {}
