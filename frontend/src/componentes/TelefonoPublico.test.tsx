import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Rutas } from '../rutas/Rutas';
import { error, llamadas, simularApi } from '../pruebas-api';

// Spec 005, criterio 45: el ingreso de la academia, la inscripción y el seguimiento muestran el teléfono de la academia cuando existe,
// leído de `GET /api/a/{nombreCorto}` sin caché entre visitas (DR-4 de 003).

const TOKEN = 'dUg8U3s15Gr1QAQy0Rjl0cG5bd86JkGqUa__duZr1Ew';
const PAGINAS = [
  ['el ingreso', '/a/delfines/ingresar'],
  ['la inscripción', '/a/delfines/inscripcion'],
  ['la consulta con código y DNI', '/a/delfines/solicitud'],
  ['el seguimiento con el enlace', `/a/delfines/solicitud/${TOKEN}`],
] as const;

function academia(telefono: string | null) {
  return { estado: 200, cuerpo: { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines', telefono } };
}

function visitar(cliente: QueryClient, ruta: string) {
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Rutas />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Teléfono en las páginas públicas (criterio 45)', () => {
  it.each(PAGINAS)('%s muestra el teléfono de la academia con un enlace para llamar', async (_nombre, ruta) => {
    simularApi({ 'GET /api/a/delfines': () => academia('+51 987 654 321') });
    visitar(new QueryClient(), ruta);
    const enlace = await screen.findByRole('link', { name: '+51 987 654 321' });
    expect(enlace).toHaveAttribute('href', 'tel:+51987654321');
    expect(screen.getByText('Academia de Natación Los Delfines')).toBeInTheDocument();
  });

  it.each(PAGINAS)('%s no muestra "Teléfono" si la academia no tiene', async (_nombre, ruta) => {
    simularApi({ 'GET /api/a/delfines': () => academia(null) });
    visitar(new QueryClient(), ruta);
    await screen.findByText('Academia de Natación Los Delfines');
    expect(screen.queryByText(/Teléfono/)).not.toBeInTheDocument();
  });

  it.each(PAGINAS)('%s vuelve a pedir el teléfono en cada visita, sin caché entre visitas', async (_nombre, ruta) => {
    let telefono = '999 111 111';
    const api = simularApi({ 'GET /api/a/delfines': () => academia(telefono) });
    const cliente = new QueryClient();
    const primera = visitar(cliente, ruta);
    await screen.findByRole('link', { name: '999 111 111' });
    primera.unmount();

    // La academia cambió su teléfono entre las dos visitas: nunca se ve el anterior.
    telefono = '999 222 222';
    visitar(cliente, ruta);
    expect(screen.queryByRole('link', { name: '999 111 111' })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '999 222 222' })).toBeInTheDocument();
    expect(llamadas(api, 'GET /api/a/delfines')).toHaveLength(2);
  });

  it('una academia que no existe muestra el mensaje, no un teléfono', async () => {
    simularApi({ 'GET /api/a/delfines': () => error('ACADEMIA_NO_ENCONTRADA', 404) });
    visitar(new QueryClient(), '/a/delfines/solicitud');
    expect(await screen.findByText(/No encontramos esa academia/)).toBeInTheDocument();
    expect(screen.queryByText(/Teléfono/)).not.toBeInTheDocument();
  });
});
