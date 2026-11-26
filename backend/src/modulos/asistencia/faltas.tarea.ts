import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { errorParaRegistro } from '../../infraestructura/prisma';
import { FaltasService } from './faltas.service';

/** Cada 5 minutos, en el segundo 0 (spec 009b, criterio 23; DT-9). */
export const PROGRAMACION_DE_FALTAS = '0 */5 * * * *';
export const NOMBRE_DE_LA_TAREA_DE_FALTAS = 'faltas';

/**
 * La tarea programada de las faltas (spec 009b, criterios 23 y 33; D-08, D-10, D-25): corre `FaltasService.registrarFaltas` cada 5 minutos y una vez al
 * arrancar (si el servidor estuvo apagado de noche, registra las faltas de ayer y de hoy, criterio 25). Solo se carga con `TAREAS_PROGRAMADAS=activas`
 * (`TareasAsistenciaModule`), junto con `ScheduleModule`: con `inactivas` no hay ninguna tarea y las pruebas llaman al servicio directamente.
 * Una bandera en memoria evita que dos vueltas del mismo proceso se pisen: si una sigue, la siguiente se salta; entre instancias lo ordena el bloqueo
 * consultivo por academia del servicio.
 */
@Injectable()
export class FaltasTarea implements OnApplicationBootstrap {
  private enCurso = false;

  constructor(
    private readonly faltas: FaltasService,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(FaltasTarea.name);
  }

  onApplicationBootstrap(): void {
    // Sin esperar: el arranque de la API no depende de la base ni de la tarea. `vuelta` nunca rechaza; el `catch` es solo por si algo escapa.
    this.vuelta().catch((error: unknown) => {
      this.registro.error({ err: errorParaRegistro(error) }, 'La vuelta de arranque de la tarea de faltas falló');
    });
  }

  @Cron(PROGRAMACION_DE_FALTAS, { name: NOMBRE_DE_LA_TAREA_DE_FALTAS })
  async alCumplirse(): Promise<void> {
    await this.vuelta();
  }

  /** Una vuelta que nunca lanza: el servicio ya registra el error de cada academia; esto cubre lo que escape de él. */
  private async vuelta(): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      await this.faltas.registrarFaltas();
    } catch (error) {
      this.registro.error({ err: errorParaRegistro(error) }, 'La vuelta de la tarea de faltas falló');
    } finally {
      this.enCurso = false;
    }
  }
}
