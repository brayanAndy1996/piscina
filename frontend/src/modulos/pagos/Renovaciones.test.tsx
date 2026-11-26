import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llamadas, type Manejador, mostrar, sesionDe, simularApi, simularUrlLocal } from '../../pruebas-api';

// Spec 010a, criterios 14 y 22: la bandeja `/panel/pagos` muestra «Renovación» y el mes cuando la solicitud es nula, y los diálogos de aprobar y
// rechazar dicen «renovación» (no hablan de una persona que pasa a alumno ni de un seguimiento). Las solicitudes siguen con sus textos. La API
// se simula.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const P_REN = 'a1111111-1111-4111-8111-111111111111';
const P_SOL = 'a2222222-2222-4222-8222-222222222222';
const S1 = 'b1111111-1111-4111-8111-111111111111';
const ID_CAJA = 'c0000000-0000-4000-8000-000000000001';
// 26/11/2026 10:00 en Lima.
const AHORA = new Date('2026-11-26T15:00:00.000Z');

const RENOVACION = {
  id: P_REN,
  metodo: 'YAPE',
  monto: '120.00',
  numeroOperacion: 'YP-778899',
  fechaOperacion: '2026-11-26',
  enviadoEn: '2026-11-26T14:30:00.000Z',
  solicitud: null,
  cliente: { nombres: 'Sofía', apellidos: 'León Barrios', dni: '30000003' },
  mes: '2026-12',
  mesTerminado: false,
};

const DE_SOLICITUD = {
  id: P_SOL,
  metodo: 'TRANSFERENCIA',
  monto: '88.00',
  numeroOperacion: 'AB991',
  fechaOperacion: '2026-11-25',
  enviadoEn: '2026-11-25T14:30:00.000Z',
  solicitud: { id: S1, codigo: 'AQ-7F3K9X' },
  cliente: { nombres: 'Mario', apellidos: 'Rojas Díaz', dni: '71234567' },
  mes: '2026-11',
  mesTerminado: false,
};

function pagoResuelto(extra: Record<string, unknown> = {}) {
  return {
    id: P_REN,
    estado: 'CONFIRMADO',
    metodo: 'YAPE',
    concepto: 'MENSUALIDAD',
    monto: '120.00',
    registradoEn: '2026-11-26T14:30:00.000Z',
    verificadoEn: '2026-11-26T15:00:00.000Z',
    numeroOperacion: 'YP-778899',
    fechaOperacion: '2026-11-26',
    motivoRechazo: null,
    numeroTicket: 9,
    ...extra,
  };
}

function caja() {
  const cero = '0.00';
  return {
    id: ID_CAJA,
    fecha: '2026-11-26',
    estado: 'ABIERTA',
    deOtroDia: false,
    montoInicial: '100.00',
    abiertaPor: { id: ID_YO, nombres: 'Rosa', apellidos: 'Quispe Mamani' },
    abiertaEn: '2026-11-26T13:00:00.000Z',
    resumen: {
      ingresos: { efectivo: cero, yape: cero, transferencia: cero },
      egresos: { efectivo: cero },
      esperado: { efectivo: '100.00', yape: cero, transferencia: cero },
      ultimoMovimiento: 0,
    },
    movimientos: [],
    cierres: [],
  };
}

function servidor(extra: Record<string, Manejador> = {}) {
  const api = simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('SECRETARIA', { id: ID_YO }) }),
    'GET /api/mi-academia': () => ({
      estado: 200,
      cuerpo: { academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null } },
    }),
    'GET /api/pagos/pendientes': () => ({ estado: 200, cuerpo: { pagos: [RENOVACION, DE_SOLICITUD] } }),
    'GET /api/cajas/actual': () => ({ estado: 200, cuerpo: { caja: caja() } }),
    ...extra,
  });
  const json = api.getMockImplementation();
  api.mockImplementation((url: string, opciones?: RequestInit) => {
    if (url.endsWith('/comprobante') && (opciones?.method ?? 'GET') === 'GET') {
      return Promise.resolve(
        new Response(new Uint8Array([255, 216, 255]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
      );
    }
    return json ? json(url, opciones) : Promise.reject(new Error('sin simulación'));
  });
  return api;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  simularUrlLocal();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

const NOMBRE_RENOVACION = 'Pago de la renovación de diciembre de 2026 de Sofía León Barrios';
const tarjetaRenovacion = () => screen.findByRole('article', { name: NOMBRE_RENOVACION });

describe('la bandeja con una renovación (criterios 14 y 22)', () => {
  it('muestra «Renovación» y el mes en lugar del código, y no inventa una solicitud', async () => {
    servidor();
    mostrar('/panel/pagos');
    const tarjeta = await tarjetaRenovacion();
    expect(within(tarjeta).getByText('Renovación de diciembre de 2026', { selector: 'p' })).toBeInTheDocument();
    expect(within(tarjeta).getByText('Sofía León Barrios')).toBeInTheDocument();
    expect(within(tarjeta).getByText('S/ 120.00')).toBeInTheDocument();
    expect(within(tarjeta).getByText('YP-778899')).toBeInTheDocument();
    // La tarjeta de una solicitud sigue con su código.
    const otra = await screen.findByRole('article', { name: 'Pago de la solicitud AQ-7F3K9X' });
    expect(within(otra).getByText('AQ-7F3K9X')).toBeInTheDocument();
    expect(within(otra).queryByText(/Renovación/)).not.toBeInTheDocument();
  });

  it('el visor del comprobante dice de qué renovación es', async () => {
    servidor();
    mostrar('/panel/pagos');
    const usuario = userEvent.setup();
    await usuario.click(
      within(await tarjetaRenovacion()).getByRole('button', {
        name: 'Ver el comprobante de la renovación de diciembre de 2026 de Sofía León Barrios',
      }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Comprobante de Renovación de diciembre de 2026' }),
    ).toBeInTheDocument();
  });
});

describe('aprobar una renovación (criterio 22)', () => {
  it('habla de la renovación y no de un alumno nuevo; al terminar ofrece el ticket', async () => {
    const api = servidor({
      [`POST /api/pagos/${P_REN}/aprobacion`]: () => ({ estado: 200, cuerpo: { pago: pagoResuelto() } }),
    });
    mostrar('/panel/pagos');
    const usuario = userEvent.setup();
    await usuario.click(
      within(await tarjetaRenovacion()).getByRole('button', {
        name: 'Aprobar el pago de la renovación de diciembre de 2026 de Sofía León Barrios',
      }),
    );
    const dialogo = await screen.findByRole('dialog', { name: 'Aprobar el pago: Renovación de diciembre de 2026' });
    expect(within(dialogo).getByText(/Alumno:/)).toBeInTheDocument();
    expect(within(dialogo).queryByText(/Cliente:/)).not.toBeInTheDocument();
    expect(within(dialogo).getByText(/la renovación de diciembre de 2026 queda vigente/)).toBeInTheDocument();
    expect(within(dialogo).queryByText(/pasa a alumno/)).not.toBeInTheDocument();
    const confirmar = await within(dialogo).findByRole('button', { name: 'Aprobar S/ 120.00' });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.click(confirmar);
    const hecho = await screen.findByRole('dialog', { name: 'Pago aprobado: Renovación de diciembre de 2026' });
    expect(
      within(hecho).getByText(
        /La mensualidad de diciembre de 2026 ya está vigente y el ingreso quedó en la caja de hoy\./,
      ),
    ).toBeInTheDocument();
    expect(within(hecho).queryByText(/Entra con su DNI/)).not.toBeInTheDocument();
    expect(within(hecho).getByRole('link', { name: 'Imprimir ticket' })).toHaveAttribute(
      'href',
      `/panel/pagos/${P_REN}/ticket`,
    );
    expect(llamadas(api, `POST /api/pagos/${P_REN}/aprobacion`)).toEqual([{}]);
  });

  it('el pago de una solicitud conserva sus textos de inscripción', async () => {
    servidor();
    mostrar('/panel/pagos');
    const usuario = userEvent.setup();
    await usuario.click(
      within(await screen.findByRole('article', { name: 'Pago de la solicitud AQ-7F3K9X' })).getByRole('button', {
        name: 'Aprobar el pago de la solicitud AQ-7F3K9X',
      }),
    );
    const dialogo = await screen.findByRole('dialog', { name: 'Aprobar el pago: AQ-7F3K9X' });
    expect(within(dialogo).getByText(/Cliente:/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/la persona pasa a alumno y se le crea su usuario/)).toBeInTheDocument();
  });
});

describe('rechazar una renovación (criterio 22)', () => {
  it('habla de la renovación, del correo y de renovar de nuevo; el aviso final no menciona el seguimiento', async () => {
    const api = servidor({
      [`POST /api/pagos/${P_REN}/rechazo`]: () => ({
        estado: 200,
        cuerpo: {
          pago: pagoResuelto({
            estado: 'RECHAZADO',
            verificadoEn: null,
            numeroTicket: null,
            motivoRechazo: 'No se lee',
          }),
        },
      }),
    });
    mostrar('/panel/pagos');
    const usuario = userEvent.setup();
    await usuario.click(
      within(await tarjetaRenovacion()).getByRole('button', {
        name: 'Rechazar el pago de la renovación de diciembre de 2026 de Sofía León Barrios',
      }),
    );
    const dialogo = await screen.findByRole('dialog', { name: 'Rechazar el pago: Renovación de diciembre de 2026' });
    expect(within(dialogo).getByText(/Alumno:/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/La renovación queda cancelada y se libera el cupo/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/se puede registrar otra renovación del mismo mes/)).toBeInTheDocument();
    expect(within(dialogo).queryByText(/en su seguimiento/)).not.toBeInTheDocument();
    await usuario.type(within(dialogo).getByLabelText('Motivo del rechazo'), 'No se lee');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Rechazar el pago' }));
    expect(
      await screen.findByText(
        'Pago de Sofía León Barrios (renovación de diciembre de 2026) rechazado. Se liberó el cupo y el alumno puede renovar de nuevo ese mes.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/seguimiento/)).not.toBeInTheDocument();
    expect(llamadas(api, `POST /api/pagos/${P_REN}/rechazo`)).toEqual([{ motivo: 'No se lee' }]);
  });
});
