import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, llamadas, mostrar, simularApi } from '../../pruebas-api';
import { Rutas } from '../../rutas/Rutas';

// Spec 005, criterio 44 (005a): la página de seguimiento con el token en el cuerpo, la vista mínima, la consulta con código y DNI y el
// cuidado del token (sin almacenamiento del navegador, sin título, sin caché persistida). Criterio 45: el teléfono de la academia.

const TOKEN = 'dUg8U3s15Gr1QAQy0Rjl0cG5bd86JkGqUa__duZr1Ew';
const TELEFONO = '987654321';
const GET_ACADEMIA = 'GET /api/a/delfines';
const POST_CONSULTA = 'POST /api/a/delfines/solicitudes/consulta';

function vista(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    codigo: 'AQ-7F3K9X',
    estado: 'PENDIENTE_PAGO',
    creadaEn: '2026-11-20T15:00:00.000Z',
    reservaVenceEn: '2026-11-21T20:30:00.000Z',
    nombres: 'Lucía',
    plan: { nombre: 'Plan 3 veces' },
    clases: [
      { nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' },
      { nivel: 'BASICO', diaSemana: 3, horaInicio: '18:00', horaFin: '19:00' },
      { nivel: 'BASICO', diaSemana: 5, horaInicio: '19:00', horaFin: '20:00' },
    ],
    mes: '2026-11',
    clasesTotales: 5,
    monto: '88.00',
    esProporcional: true,
    fotoCargada: false,
    ...extra,
  };
}

function respuesta(extra: Record<string, unknown> = {}, telefono: string | null = TELEFONO) {
  return { solicitud: vista(extra), academia: { nombre: 'Academia de Natación Los Delfines', telefono } };
}

function servidor(consulta: () => { estado: number; cuerpo?: unknown }, telefono: string | null = TELEFONO) {
  return simularApi({
    [GET_ACADEMIA]: () => ({
      estado: 200,
      cuerpo: { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines', telefono },
    }),
    [POST_CONSULTA]: consulta,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.title = 'AquaGestión';
});

describe('Página de seguimiento con el enlace (criterio 44)', () => {
  it('consulta con el token en el cuerpo, nunca en la dirección de la API, y muestra la vista mínima', async () => {
    const api = servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);

    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(llamadas(api, POST_CONSULTA)).toEqual([{ token: TOKEN }]);
    for (const [url] of api.mock.calls) expect(String(url)).not.toContain(TOKEN);

    expect(within(solicitud).getByText('Pendiente de pago')).toBeInTheDocument();
    expect(within(solicitud).getByText('AQ-7F3K9X')).toBeInTheDocument();
    expect(within(solicitud).getByText('Hola, Lucía')).toBeInTheDocument();
    expect(within(solicitud).getByText('Plan 3 veces')).toBeInTheDocument();
    expect(within(solicitud).getByText(/Lunes de 18:00 a 19:00/)).toBeInTheDocument();
    expect(within(solicitud).getByText(/Miércoles de 18:00 a 19:00/)).toBeInTheDocument();
    expect(within(solicitud).getByText(/Viernes de 19:00 a 20:00/)).toBeInTheDocument();
    expect(within(solicitud).getByText('noviembre de 2026')).toBeInTheDocument();
    expect(within(solicitud).getByText(/S\/ 88\.00 \(el precio ya incluye IGV\)/)).toBeInTheDocument();
    // La reserva vence el 21/11 a las 15:30 en Lima.
    expect(within(solicitud).getByText('21/11/2026 15:30')).toBeInTheDocument();
    expect(screen.getByText(/llama a la academia al 987654321/)).toBeInTheDocument();
    // 005a: sin "subir foto".
    expect(screen.queryByText(/foto/i)).not.toBeInTheDocument();
  });

  it('no guarda el token en localStorage, sessionStorage ni cookies y no lo pone en el título', async () => {
    servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    expect(document.cookie).not.toContain(TOKEN);
    expect(document.title).not.toContain(TOKEN);
    expect(document.title).toBe('Seguimiento de tu solicitud · AquaGestión');
  });

  it('la clave de la consulta vive solo en la memoria y se descarta al salir de la página', async () => {
    servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={[`/a/delfines/solicitud/${TOKEN}`]}>
          <Rutas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(cliente.getQueryCache().findAll({ queryKey: ['seguimiento'] })).toHaveLength(1);
    unmount();
    // Sin `persistQueryClient` nada va al almacenamiento, y la entrada con el token se descarta de la memoria.
    await waitFor(() => expect(cliente.getQueryCache().findAll({ queryKey: ['seguimiento'] })).toHaveLength(0));
    expect(localStorage).toHaveLength(0);
    expect(document.title).toBe('AquaGestión');
  });

  it('una solicitud vencida o cancelada muestra solo ese estado, sin fecha límite', async () => {
    let estado = 'VENCIDA';
    servidor(() => {
      const sinFecha = vista({ estado });
      delete sinFecha['reservaVenceEn'];
      return { estado: 200, cuerpo: { solicitud: sinFecha, academia: { nombre: 'x', telefono: TELEFONO } } };
    });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(solicitud).getByText('Vencida')).toBeInTheDocument();
    expect(within(solicitud).getByText(/La reserva venció y el cupo se liberó/)).toBeInTheDocument();
    expect(within(solicitud).queryByText(/Reserva hasta/)).not.toBeInTheDocument();
    expect(within(solicitud).queryByText(/Paga S\//)).not.toBeInTheDocument();

    estado = 'CANCELADA';
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByText('Cancelada')).toBeInTheDocument();
    expect(screen.getByText(/La academia canceló esta solicitud/)).toBeInTheDocument();
  });

  it('un enlace que no existe muestra un solo mensaje y ofrece la consulta con código y DNI', async () => {
    servidor(() => error('SOLICITUD_NO_ENCONTRADA', 404));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos una solicitud con ese enlace');
    expect(screen.getByRole('link', { name: 'Consultar con mi código y mi DNI' })).toHaveAttribute(
      'href',
      '/a/delfines/solicitud',
    );
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('el límite de consultas y los fallos del servidor se dicen claro', async () => {
    servidor(() => error('DEMASIADAS_SOLICITUDES', 429));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Hiciste demasiadas consultas');
  });

  it('una academia suspendida no muestra la solicitud', async () => {
    simularApi({ [GET_ACADEMIA]: () => error('ACADEMIA_SUSPENDIDA', 403) });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    expect(await screen.findByText('Academia no disponible por el momento.')).toBeInTheDocument();
  });
});

describe('Consulta con código y DNI (criterio 44)', () => {
  it('manda el código recortado y en mayúsculas y el DNI en el cuerpo, y muestra la misma vista', async () => {
    const api = servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    const user = userEvent.setup();
    mostrar('/a/delfines/solicitud');
    await user.type(await screen.findByLabelText('Código de la solicitud'), '  aq-7f3k9x ');
    await user.type(screen.getByLabelText('DNI'), '45678912');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(llamadas(api, POST_CONSULTA)).toEqual([{ codigo: 'AQ-7F3K9X', dni: '45678912' }]);
    expect(within(solicitud).getByText('Plan 3 veces')).toBeInTheDocument();
    for (const [url] of api.mock.calls) expect(String(url)).not.toContain('45678912');
  });

  it('valida el formato antes de consultar', async () => {
    const api = servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    const user = userEvent.setup();
    mostrar('/a/delfines/solicitud');
    await screen.findByLabelText('Código de la solicitud');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(screen.getByText('El código debe tener el formato AQ-XXXXXX.')).toBeInTheDocument();
    expect(screen.getByText('El DNI debe tener exactamente 8 dígitos.')).toBeInTheDocument();
    // La O no se corrige a 0: el código tiene el alfabeto de Crockford.
    fireEvent.change(screen.getByLabelText('Código de la solicitud'), { target: { value: 'AQ-7F3K9O' } });
    fireEvent.change(screen.getByLabelText('DNI'), { target: { value: '45678912' } });
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(screen.getByText('El código debe tener el formato AQ-XXXXXX.')).toBeInTheDocument();
    expect(llamadas(api, POST_CONSULTA)).toHaveLength(0);
  });

  it('un código que no existe y un código con otro DNI dan el mismo mensaje', async () => {
    servidor(() => error('SOLICITUD_NO_ENCONTRADA', 404));
    const user = userEvent.setup();
    mostrar('/a/delfines/solicitud');
    await user.type(await screen.findByLabelText('Código de la solicitud'), 'AQ-7F3K9X');
    await user.type(screen.getByLabelText('DNI'), '45678912');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos una solicitud con ese código y ese DNI');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
