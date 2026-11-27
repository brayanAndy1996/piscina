import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { errorParaRegistro } from '../../infraestructura/prisma';
import { CierreDeMesService } from './cierre-de-mes.service';

/** Cada 15 minutos, en el segundo 0 (spec 010b, criterio 27; DT-12). */
export const PROGRAMACION_DEL_CIERRE_DE_MES = '0 */15 * * * *';
export const NOMBRE_DE_LA_TAREA_DEL_CIERRE = 'cierre-de-mes';

/**
 * La tarea programada del cierre de mes (spec 010b, criterios 27 y 30; RN-23, D-10, D-25): corre `CierreDeMesService.cerrar` cada 15 minutos y una vez
 * al arrancar (si el servidor estuvo apagado el día 1, cierra el mes en cuanto arranca). Solo se carga con `TAREAS_PROGRAMADAS=activas`
 * (`TareasMensualidadesModule`), junto con `ScheduleModule`: con `inactivas` no hay ninguna tarea y las pruebas llaman al servicio directamente. Una bandera
 * en memoria evita que dos vueltas del mismo proceso se pisen: si una sigue, la siguiente se salta; entre instancias lo ordena el bloqueo consultivo por
 * academia del servicio. Es otra tarea que la de las faltas, con su propio bloqueo y su propio error (DT-12).
 */
@Injectable()
export class CierreDeMesTarea implements OnApplicationBootstrap {
  private enCurso = false;

  constructor(
    private readonly cierre: CierreDeMesService,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(CierreDeMesTarea.name);
  }

  onApplicationBootstrap(): void {
    // Sin esperar: el arranque de la API no depende de la base ni de la tarea. `vuelta` nunca rechaza; el `catch` es solo por si algo escapa.
    this.vuelta().catch((error: unknown) => {
      this.registro.error(
        { err: errorParaRegistro(error) },
        'La vuelta de arranque de la tarea del cierre de mes falló',
      );
    });
  }

  @Cron(PROGRAMACION_DEL_CIERRE_DE_MES, { name: NOMBRE_DE_LA_TAREA_DEL_CIERRE })
  async alCumplirse(): Promise<void> {
    await this.vuelta();
  }

  /** Una vuelta que nunca lanza: el servicio ya registra el error de cada academia; esto cubre lo que escape de él. */
  private async vuelta(): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      await this.cierre.cerrar();
    } catch (error) {
      this.registro.error({ err: errorParaRegistro(error) }, 'La vuelta de la tarea del cierre de mes falló');
    } finally {
      this.enCurso = false;
    }
  }
}
