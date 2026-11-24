import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { mostrar, simularApi } from '../../pruebas-api';

// Spec 007a, criterios 24 y 28: el seguimiento de una solicitud con el pago confirmado. La API se simula.

const TOKEN = 'dUg8U3s15Gr1QAQy0Rjl0cG5bd86JkGqUa__duZr1Ew';

const BASE = {
  codigo: 'AQ-7F3K9X',
  creadaEn: '2026-11-20T15:00:00.000Z',
  nombres: 'Lucía',
  plan: { nombre: 'Plan 3 veces' },
  clases: [{ nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
  mes: '2026-11',
  clasesTotales: 5,
  monto: '88.00',
  esProporcional: false,
};

const CONFIRMADA = {
  ...BASE,
  estado: 'CONFIRMADA',
  pago: { metodo: 'EFECTIVO', monto: '88.00', confirmadoEn: '2026-11-24T15:00:00.000Z', numeroTicket: 5 },
};

function servidor(solicitud: Record<string, unknown>) {
  simularApi({
    'GET /api/a/delfines': () => ({
      estado: 200,
      cuerpo: { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines', telefono: '987654321' },
    }),
    'POST /api/a/delfines/solicitudes/consulta': () => ({
      estado: 200,
      cuerpo: { solicitud, academia: { nombre: 'Academia de Natación Los Delfines', telefono: '987654321' } },
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('seguimiento de una solicitud CONFIRMADA (criterios 24 y 28)', () => {
  it('dice que el pago está confirmado, cómo ingresar y el pago, sin pedir la foto', async () => {
    servidor(CONFIRMADA);
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(solicitud).getByText('Pago confirmado')).toBeInTheDocument();
    expect(within(solicitud).getByText('Hola, Lucía')).toBeInTheDocument();
    expect(within(solicitud).getByText(/Tu pago está confirmado/)).toBeInTheDocument();
    expect(within(solicitud).getByText(/DNI como usuario y como contraseña inicial/)).toBeInTheDocument();
    expect(within(solicitud).getByRole('link', { name: 'Ingresar con mi DNI' })).toHaveAttribute(
      'href',
      '/a/delfines/ingresar',
    );
    expect(
      within(solicitud).getByText(/Efectivo, confirmado el 24\/11\/2026 10:00 \(ticket N\.º 5\)/),
    ).toBeInTheDocument();
    expect(within(solicitud).queryByText('Reserva hasta')).not.toBeInTheDocument();
    // La foto ya no se sube desde aquí: el alumno ya no está en `CLIENTE`.
    expect(screen.queryByText(/foto/i)).not.toBeInTheDocument();
  });

  it('también se ve al consultar con el código y el DNI', async () => {
    servidor(CONFIRMADA);
    mostrar('/a/delfines/solicitud');
    const usuario = (await import('@testing-library/user-event')).default.setup();
    await usuario.type(await screen.findByLabelText('Código de la solicitud'), 'aq-7f3k9x');
    await usuario.type(screen.getByLabelText('DNI'), '45678912');
    await usuario.click(screen.getByRole('button', { name: 'Consultar' }));
    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(solicitud).getByText('Pago confirmado')).toBeInTheDocument();
    expect(within(solicitud).getByRole('link', { name: 'Ingresar con mi DNI' })).toHaveAttribute(
      'href',
      '/a/delfines/ingresar',
    );
  });
});
