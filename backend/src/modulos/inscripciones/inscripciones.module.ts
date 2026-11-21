import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { FotoService } from './foto.service';
import { InscripcionPublicaController } from './inscripcion-publica.controller';
import { InscripcionesService } from './inscripciones.service';
import { SeguimientoController } from './seguimiento.controller';
import { SeguimientoService } from './seguimiento.service';
import { SolicitudesController } from './solicitudes.controller';
import { SolicitudesService } from './solicitudes.service';

/**
 * Inscripción pública, reserva del cupo y seguimiento de la solicitud (spec 005a), y la foto y el panel de solicitudes (005b). El correo llega
 * por `ENVIADOR_CORREO` y el almacén de archivos por `ALMACEN_ARCHIVOS` (los dos globales).
 */
@Module({
  imports: [AuditoriaModule],
  controllers: [InscripcionPublicaController, SeguimientoController, SolicitudesController],
  providers: [InscripcionesService, SeguimientoService, FotoService, SolicitudesService],
  exports: [InscripcionesService, SeguimientoService, FotoService, SolicitudesService],
})
export class InscripcionesModule {}
