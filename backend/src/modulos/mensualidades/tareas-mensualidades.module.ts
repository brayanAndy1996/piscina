import { Module } from '@nestjs/common';
import { CierreDeMesTarea } from './cierre-de-mes.tarea';
import { MensualidadesModule } from './mensualidades.module';

/**
 * Las tareas programadas de las mensualidades (spec 010b, criterios 27 y 30): la del cierre de mes. `AppModule` lo carga, junto con
 * `ScheduleModule.forRoot()`, solo con `TAREAS_PROGRAMADAS=activas`; con `inactivas` ni la tarea ni el planificador existen. El servicio del cierre
 * (`CierreDeMesService`) está en `MensualidadesModule`, que siempre se carga.
 */
@Module({ imports: [MensualidadesModule], providers: [CierreDeMesTarea] })
export class TareasMensualidadesModule {}
