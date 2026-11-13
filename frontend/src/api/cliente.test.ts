import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { enviarJson, enviarSinRespuesta, ErrorDeApi, ErrorDeRespuesta, pedirJson } from './cliente';

function respuesta(cuerpo: string | null, estado: number): Response {
  return new Response(cuerpo, { status: estado, headers: { 'Content-Type': 'application/json' } });
}

const esquema = z.object({ ok: z.boolean() });

describe('Cliente HTTP', () => {
  it('envía el cuerpo como JSON con el método, las cookies del mismo dominio y valida la respuesta', async () => {
    const simulado = vi.fn(() => Promise.resolve(respuesta('{"ok":true}', 201)));
    vi.stubGlobal('fetch', simulado);

    const resultado = await enviarJson('POST', '/api/x', { a: 1 }, esquema);

    expect(resultado).toEqual({ estado: 201, datos: { ok: true } });
    expect(simulado).toHaveBeenCalledWith(
      '/api/x',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: '{"a":1}',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }) as unknown,
      }),
    );
  });

  it('una respuesta de error de la API se lanza como ErrorDeApi con estado, código y detalles', async () => {
    const cuerpo = { codigo: 'CUENTA_BLOQUEADA', mensaje: 'Bloqueada.', detalles: { x: 1 } };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respuesta(JSON.stringify(cuerpo), 423))),
    );

    const error: unknown = await pedirJson('/api/x', esquema).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ estado: 423, codigo: 'CUENTA_BLOQUEADA', message: 'Bloqueada.', detalles: { x: 1 } });
  });

  it('un error que no cumple el formato de la API es un ErrorDeRespuesta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respuesta('<html></html>', 502))),
    );

    const error: unknown = await enviarJson('POST', '/api/x', {}, esquema).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeRespuesta);
    expect(error).not.toBeInstanceOf(ErrorDeApi);
  });

  it('un error de red es un ErrorDeRespuesta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    await expect(enviarJson('POST', '/api/x', {}, esquema)).rejects.toThrow('No se pudo contactar al servidor.');
  });

  it('enviarSinRespuesta acepta un 204 sin cuerpo y envía DELETE sin Content-Type', async () => {
    const simulado = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', simulado);

    await expect(enviarSinRespuesta('DELETE', '/api/plataforma/sesion')).resolves.toBeUndefined();

    const opciones = (simulado.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(opciones.method).toBe('DELETE');
    expect(opciones.body).toBeUndefined();
    expect(opciones.headers).not.toHaveProperty('Content-Type');
  });

  it('un cuerpo que no cumple el esquema es un ErrorDeRespuesta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respuesta('{"ok":"no"}', 200))),
    );

    await expect(pedirJson('/api/x', esquema)).rejects.toThrow('formato esperado');
  });
});
