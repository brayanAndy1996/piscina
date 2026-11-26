import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FaltasService } from '../../../src/modulos/asistencia';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import type { NestExpressApplication } from '@nestjs/platform-express';

// Criterio 33 de la 009b: con `TAREAS_PROGRAMADAS=inactivas` (lo que usan las pruebas), crear la aplicación no programa ninguna tarea; con `activas` hay
// exactamente una, la de las faltas, y corre una vez al arrancar. `FaltasService` se reemplaza por un doble: la prueba no escribe en la base compartida.

describe('la tarea de faltas se programa solo con TAREAS_PROGRAMADAS=activas (criterio 33)', () => {
  let app: NestExpressApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function trabajos(aplicacion: NestExpressApplication): Map<string, unknown> {
    try {
      return aplicacion.get(SchedulerRegistry).getCronJobs();
    } catch {
      // Sin `ScheduleModule` no hay registro de tareas: ninguna tarea programada.
      return new Map();
    }
  }

  it('con inactivas (por defecto en las pruebas) no hay ninguna tarea programada', async () => {
    const registrarFaltas = vi.fn().mockResolvedValue(new Map());
    app = await crearAppDePruebas({
      ajustar: (constructor) => constructor.overrideProvider(FaltasService).useValue({ registrarFaltas }),
    });
    await app.init();

    expect(trabajos(app).size).toBe(0);
    expect(registrarFaltas).not.toHaveBeenCalled();
  });

  it('con activas hay exactamente una tarea, la de las faltas, y corre una vez al arrancar', async () => {
    const registrarFaltas = vi.fn().mockResolvedValue(new Map());
    app = await crearAppDePruebas({
      variables: { TAREAS_PROGRAMADAS: 'activas' },
      ajustar: (constructor) => constructor.overrideProvider(FaltasService).useValue({ registrarFaltas }),
    });
    await app.init();

    const programadas = trabajos(app);
    expect([...programadas.keys()]).toEqual(['faltas']);
    await vi.waitFor(() => expect(registrarFaltas).toHaveBeenCalledTimes(1));
  });
});
