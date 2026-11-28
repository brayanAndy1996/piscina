import { Module } from '@nestjs/common';
import { AsistenciaModule } from '../asistencia';
import { MiPanelController } from './mi-panel.controller';
import { MiPanelService } from './mi-panel.service';

/**
 * El panel del alumno y del apoderado (spec 011): el resumen y la asistencia del mes de la cuenta de la sesión, solo lectura. Importa de `alumnos` (el alumno de la
 * sesión), `asistencia` (la consulta del mes), `mensualidades` (la lectura y el estado) y `configuracion` (`diasPorVencer`) sus funciones públicas; nadie importa este
 * módulo (DT-9). El reloj y la base son globales.
 */
@Module({
  imports: [AsistenciaModule],
  controllers: [MiPanelController],
  providers: [MiPanelService],
})
export class PanelAlumnoModule {}
