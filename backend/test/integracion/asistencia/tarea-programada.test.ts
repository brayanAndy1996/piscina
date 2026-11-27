// spec: 009-asistencia (pruebas protegidas)
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FaltasService } from '../../../src/modulos/asistencia';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { cargarClaseDeCierre } from '../../utilidades/escenario-cierre';
import type { NestExpressApplication } from '@nestjs/platform-express';

// Actualizada por la 010b (A1). Aprobada por Bryan el 26/11/2026 (spec 010-mensualidades, criterio 30): con `activas` ahora hay exactamente dos tareas, `cierre-de-mes` y `faltas`, y las dos corren una vez al arrancar (antes esperaba solo `['faltas']`). `CierreDeMesService` también se
// reemplaza por un doble, para que la prueba no escriba en la base compartida. La clase del cierre se carga con la utilidad protegida de la 010b (`escenario-cierre.ts`): si todavía no existe, falla con un mensaje de funcionalidad pendiente.
// Criterio 33 de la 009b: con `TAREAS_PROGRAMADAS=inactivas` (lo que usan las pruebas), crear la aplicación no programa ninguna tarea; con `activas` hay
// exactamente dos (la del cierre de mes y la de las faltas) y cada una corre una vez al arrancar. `FaltasService` se reemplaza por un doble: la prueba no escribe en la base compartida.

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
    const cerrar = vi.fn().mockResolvedValue(new Map());
    const CierreDeMesService = await cargarClaseDeCierre();
    app = await crearAppDePruebas({
      ajustar: (constructor) =>
        constructor
          .overrideProvider(FaltasService)
          .useValue({ registrarFaltas })
          .overrideProvider(CierreDeMesService)
          .useValue({ cerrar }),
    });
    await app.init();

    expect(trabajos(app).size).toBe(0);
    expect(registrarFaltas).not.toHaveBeenCalled();
    expect(cerrar).not.toHaveBeenCalled();
  });

  it('con activas hay exactamente dos tareas, cierre-de-mes y faltas, y las dos corren una vez al arrancar', async () => {
    const registrarFaltas = vi.fn().mockResolvedValue(new Map());
    const cerrar = vi.fn().mockResolvedValue(new Map());
    const CierreDeMesService = await cargarClaseDeCierre();
    app = await crearAppDePruebas({
      variables: { TAREAS_PROGRAMADAS: 'activas' },
      ajustar: (constructor) =>
        constructor
          .overrideProvider(FaltasService)
          .useValue({ registrarFaltas })
          .overrideProvider(CierreDeMesService)
          .useValue({ cerrar }),
    });
    await app.init();

    const programadas = trabajos(app);
    expect([...programadas.keys()].sort()).toEqual(['cierre-de-mes', 'faltas']);
    await vi.waitFor(() => expect(registrarFaltas).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(cerrar).toHaveBeenCalledTimes(1));
  });
});
