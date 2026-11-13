import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseDatos } from '../../infraestructura/prisma';
import { LIMITE_BASE_DATOS_MS, SaludService } from './salud.service';

function crearServicio(consulta: () => Promise<unknown>): SaludService {
  const baseDatos = { comprobarConexion: vi.fn(consulta) } as unknown as BaseDatos;
  return new SaludService(baseDatos);
}

describe('SaludService.comprobar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('responde ok cuando la base contesta', async () => {
    const servicio = crearServicio(() => Promise.resolve([{ '?column?': 1 }]));
    await expect(servicio.comprobar()).resolves.toEqual({ estado: 'ok', baseDatos: 'ok' });
  });

  it('responde error cuando la consulta falla', async () => {
    const servicio = crearServicio(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')));
    await expect(servicio.comprobar()).resolves.toEqual({ estado: 'error', baseDatos: 'error' });
  });

  it('responde error a los 2 segundos si la consulta nunca termina', async () => {
    const servicio = crearServicio(() => new Promise(() => undefined));
    let resultado: unknown;
    const pendiente = servicio.comprobar().then((valor) => {
      resultado = valor;
    });

    await vi.advanceTimersByTimeAsync(LIMITE_BASE_DATOS_MS - 1);
    expect(resultado).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await pendiente;
    expect(resultado).toEqual({ estado: 'error', baseDatos: 'error' });
    expect(LIMITE_BASE_DATOS_MS).toBe(2000);
  });

  it('limpia el temporizador cuando la base contesta a tiempo', async () => {
    const servicio = crearServicio(() => Promise.resolve([]));
    await servicio.comprobar();
    expect(vi.getTimerCount()).toBe(0);
  });
});
