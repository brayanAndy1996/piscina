import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Rutas } from '../../rutas/Rutas';

function respuestaJson(cuerpo: unknown, estado: number): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });
}

function mostrarInicio(fetchSimulado: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(fetchSimulado));
  const cliente = new QueryClient();
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={['/']}>
        <Rutas />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Página de inicio: estado del sistema', () => {
  it('muestra el título AquaGestión', () => {
    mostrarInicio(() => new Promise(() => undefined));
    expect(screen.getByRole('heading', { level: 1, name: 'AquaGestión' })).toBeInTheDocument();
  });

  it('muestra "Comprobando el sistema…" mientras consulta', () => {
    mostrarInicio(() => new Promise(() => undefined));
    expect(screen.getByRole('status')).toHaveTextContent('Comprobando el sistema…');
  });

  it('muestra "Sistema en línea" con 200', async () => {
    mostrarInicio(() => Promise.resolve(respuestaJson({ estado: 'ok', baseDatos: 'ok' }, 200)));
    expect(await screen.findByText('Sistema en línea')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/salud', expect.anything());
  });

  it('muestra "Sin conexión con la base de datos" con 503', async () => {
    mostrarInicio(() => Promise.resolve(respuestaJson({ estado: 'error', baseDatos: 'error' }, 503)));
    expect(await screen.findByText('Sin conexión con la base de datos')).toBeInTheDocument();
  });

  it('muestra "No se pudo contactar al servidor" ante un error de red', async () => {
    mostrarInicio(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await screen.findByText('No se pudo contactar al servidor')).toBeInTheDocument();
  });

  it('muestra "No se pudo contactar al servidor" ante otro código de estado', async () => {
    mostrarInicio(() => Promise.resolve(respuestaJson({ codigo: 'ERROR_INTERNO', mensaje: 'x' }, 500)));
    expect(await screen.findByText('No se pudo contactar al servidor')).toBeInTheDocument();
  });

  it('muestra "No se pudo contactar al servidor" si el cuerpo no cumple respuestaSaludSchema', async () => {
    mostrarInicio(() => Promise.resolve(respuestaJson({ estado: 'ok' }, 200)));
    expect(await screen.findByText('No se pudo contactar al servidor')).toBeInTheDocument();
  });

  it('muestra "No se pudo contactar al servidor" si el cuerpo no es JSON', async () => {
    mostrarInicio(() => Promise.resolve(new Response('<html></html>', { status: 200 })));
    expect(await screen.findByText('No se pudo contactar al servidor')).toBeInTheDocument();
  });
});
