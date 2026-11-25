import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error, mostrar, sesionDe, simularApi } from '../../pruebas-api';

// Spec 007a, criterios 26 y 27: la página imprimible del ticket (`/panel/pagos/{id}/ticket`). La API se simula; el contenido exacto del
// ticket y su aislamiento los prueba el backend.

const PAGO = 'f1111111-1111-4111-8111-111111111111';
const MI_ACADEMIA = {
  academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null },
};

function ticket(extra: Record<string, unknown> = {}) {
  return {
    academia: { nombre: 'Academia de Natación Los Delfines', telefono: '987654321' },
    numero: 5,
    // 24/11/2026 10:00 en Lima.
    fechaHora: '2026-11-24T15:00:00.000Z',
    alumno: { nombres: 'Lucía Fernanda', apellidos: 'Prado Quispe' },
    concepto: 'INSCRIPCION',
    plan: { nombre: 'Plan 3 veces' },
    mes: '2026-11',
    metodo: 'EFECTIVO',
    numeroOperacion: null,
    monto: '88.00',
    cobradoPor: { nombres: 'Rosa', apellidos: 'Quispe Mamani' },
    leyenda: 'Comprobante interno de pago. No es un comprobante electrónico SUNAT',
    ...extra,
  };
}

function servidor(
  manejador: () => { estado: number; cuerpo?: unknown },
  rol: 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' = 'SECRETARIA',
) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    [`GET /api/pagos/${PAGO}/ticket`]: manejador,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('/panel/pagos/{id}/ticket (criterios 26 y 27)', () => {
  it('muestra los datos del ticket, sin DNI y con la leyenda, y el botón "Imprimir" abre la impresión', async () => {
    servidor(() => ({ estado: 200, cuerpo: { ticket: ticket() } }));
    const imprimir = vi.fn();
    vi.stubGlobal('print', imprimir);
    mostrar(`/panel/pagos/${PAGO}/ticket`);

    const impreso = await screen.findByRole('article', { name: 'Ticket de pago' });
    expect(within(impreso).getByText('Academia de Natación Los Delfines')).toBeInTheDocument();
    expect(within(impreso).getByText('Teléfono: 987654321')).toBeInTheDocument();
    expect(within(impreso).getByText('Ticket N.º 5')).toBeInTheDocument();
    expect(within(impreso).getByText('24/11/2026 10:00 (hora de Lima)')).toBeInTheDocument();
    expect(within(impreso).getByText('Lucía Fernanda Prado Quispe')).toBeInTheDocument();
    expect(within(impreso).getByText('Inscripción')).toBeInTheDocument();
    expect(within(impreso).getByText('Plan 3 veces')).toBeInTheDocument();
    expect(within(impreso).getByText('noviembre de 2026')).toBeInTheDocument();
    expect(within(impreso).getByText('Efectivo')).toBeInTheDocument();
    expect(within(impreso).getByText('Rosa Quispe Mamani')).toBeInTheDocument();
    expect(within(impreso).getByText('S/ 88.00')).toBeInTheDocument();
    expect(
      within(impreso).getByText('Comprobante interno de pago. No es un comprobante electrónico SUNAT'),
    ).toBeInTheDocument();
    expect(within(impreso).queryByText('N.º de operación')).not.toBeInTheDocument();
    expect(impreso.textContent).not.toMatch(/DNI/);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: '← Volver a las solicitudes' })).toHaveAttribute(
      'href',
      '/panel/solicitudes',
    );
  });

  it('un pago de Yape o transferencia muestra su número de operación', async () => {
    servidor(() => ({ estado: 200, cuerpo: { ticket: ticket({ metodo: 'YAPE', numeroOperacion: 'AB12345' }) } }));
    mostrar(`/panel/pagos/${PAGO}/ticket`);
    const impreso = await screen.findByRole('article', { name: 'Ticket de pago' });
    expect(within(impreso).getByText('Yape')).toBeInTheDocument();
    expect(within(impreso).getByText('AB12345')).toBeInTheDocument();
  });

  it('un ticket que no existe (o es de otra academia) dice que no se encontró', async () => {
    servidor(() => error('NO_ENCONTRADO', 404));
    mostrar(`/panel/pagos/${PAGO}/ticket`);
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos ese ticket');
    expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument();
  });

  it('un error del servidor ofrece reintentar', async () => {
    let intentos = 0;
    servidor(() => (++intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: { ticket: ticket() } }));
    mostrar(`/panel/pagos/${PAGO}/ticket`);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el ticket.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('article', { name: 'Ticket de pago' })).toBeInTheDocument();
  });

  it('un entrenador ve "sin permiso" y no se pide el ticket', async () => {
    const api = servidor(() => ({ estado: 200, cuerpo: { ticket: ticket() } }), 'ENTRENADOR');
    mostrar(`/panel/pagos/${PAGO}/ticket`);
    expect(await screen.findByText('No tienes permiso para ver esta página')).toBeInTheDocument();
    expect(api.mock.calls.filter(([url]) => String(url).includes('/ticket'))).toHaveLength(0);
  });
});
