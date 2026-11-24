import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, sesionDe, simularApi } from '../../pruebas-api';
import { ConfirmacionInscripcion } from './ConfirmacionInscripcion';

// Spec 007a, criterio 34: quien inscribe desde recepción (sesión de ADMIN o SECRETARIA de esta academia) ve, al terminar, el enlace a las
// solicitudes para cobrar; un cliente sin sesión, o con la sesión de otra academia o de otro rol, no ve nada de eso.

const SOLICITUD = {
  codigo: 'AQ-7F3K9X',
  token: 'dUg8U3s15Gr1QAQy0Rjl0cG5bd86JkGqUa__duZr1Ew',
  enlace: '/a/delfines/solicitud/dUg8U3s15Gr1QAQy0Rjl0cG5bd86JkGqUa__duZr1Ew',
  estado: 'PENDIENTE_PAGO' as const,
  reservaVenceEn: '2026-11-21T20:30:00.000Z',
  cotizacion: {
    mes: '2026-11',
    fechaInicio: '2026-11-18',
    fechaFin: '2026-11-30',
    clasesRestantes: 5,
    clasesTotales: 5,
    clasesPorMes: 12,
    precioPlan: '210.00',
    monto: '88.00',
    esProporcional: true,
  },
};

function mostrarConfirmacion() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/a/delfines/inscripcion']}>
        <Routes>
          <Route
            path="/a/:nombreCorto/inscripcion"
            element={<ConfirmacionInscripcion solicitud={SOLICITUD} telefono={null} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ENLACE = 'Ir a cobrar en las solicitudes';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('confirmación de la inscripción desde recepción (criterio 34)', () => {
  it.each(['ADMIN', 'SECRETARIA'] as const)(
    '%s con sesión de esta academia ve el enlace a las solicitudes',
    async (rol) => {
      simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
      mostrarConfirmacion();
      expect(await screen.findByRole('link', { name: ENLACE })).toHaveAttribute('href', '/panel/solicitudes');
    },
  );

  it('un cliente sin sesión no lo ve y sigue viendo su código', async () => {
    const api = simularApi({ 'GET /api/sesion': () => error('NO_AUTENTICADO', 401) });
    mostrarConfirmacion();
    expect(screen.getByText('AQ-7F3K9X')).toBeInTheDocument();
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: ENLACE })).not.toBeInTheDocument();
  });

  it.each(['ENTRENADOR', 'ALUMNO'] as const)('%s no lo ve', async (rol) => {
    const api = simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
    mostrarConfirmacion();
    await waitFor(() => expect(api).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('link', { name: ENLACE })).not.toBeInTheDocument());
  });

  it('una sesión de otra academia no lo ve', async () => {
    const otra = sesionDe('SECRETARIA');
    otra.usuario.academia = { nombreCorto: 'tiburones', nombre: 'Tiburones' };
    const api = simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: otra }) });
    mostrarConfirmacion();
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: ENLACE })).not.toBeInTheDocument();
  });

  it('una sesión con el cambio de contraseña pendiente no lo ve', async () => {
    const api = simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('SECRETARIA', { debeCambiarClave: true }) }),
    });
    mostrarConfirmacion();
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: ENLACE })).not.toBeInTheDocument();
  });
});
