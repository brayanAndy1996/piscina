import { Module } from '@nestjs/common';
import { AsistenciaModule } from './asistencia.module';
import { FaltasTarea } from './faltas.tarea';

/**
 * Las tareas programadas de la asistencia (spec 009b, criterios 23 y 33): la de faltas. `AppModule` lo carga, junto con `ScheduleModule.forRoot()`, solo
 * con `TAREAS_PROGRAMADAS=activas`; con `inactivas` ni la tarea ni el planificador existen.
 */
@Module({ imports: [AsistenciaModule], providers: [FaltasTarea] })
export class TareasAsistenciaModule {}
