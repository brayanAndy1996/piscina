import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Rutas } from './Rutas';

function mostrarRuta(ruta: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => undefined)),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[ruta]}>
        <Rutas />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Rutas de la web', () => {
  it('una ruta desconocida muestra "Página no encontrada"', () => {
    mostrarRuta('/xyz');
    expect(screen.getByRole('heading', { name: 'Página no encontrada' })).toBeInTheDocument();
  });

  it('"Volver al inicio" lleva a /', async () => {
    mostrarRuta('/xyz');
    const enlace = screen.getByRole('link', { name: 'Volver al inicio' });
    expect(enlace).toHaveAttribute('href', '/');
    await userEvent.click(enlace);
    expect(screen.getByRole('heading', { level: 1, name: 'AquaGestión' })).toBeInTheDocument();
  });
});
