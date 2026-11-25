import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  error,
  llamadas,
  type Manejador,
  mostrar,
  rutaActual,
  sesionDe,
  simularApi,
  simularUrlLocal,
} from '../../pruebas-api';

// Spec 007b, criterios 54 a 56: la bandeja `/panel/pagos` (solo con `VERIFICAR_PAGOS`), el visor de la imagen pedida con la sesión, aprobar con
// el aviso de la caja, rechazar con el motivo y los estados nuevos en el panel de solicitudes. La API se simula.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const P1 = 'a1111111-1111-4111-8111-111111111111';
const P2 = 'a2222222-2222-4222-8222-222222222222';
const S1 = 'b1111111-1111-4111-8111-111111111111';
const S2 = 'b2222222-2222-4222-8222-222222222222';
const ID_CAJA = 'c0000000-0000-4000-8000-000000000001';
// 24/11/2026 10:00 en Lima.
const AHORA = new Date('2026-11-24T15:00:00.000Z');

function pendiente(extra: Record<string, unknown> = {}) {
  return {
    id: P1,
    metodo: 'YAPE',
    monto: '88.00',
    numeroOperacion: '0001-2345',
    fechaOperacion: '2026-11-24',
    enviadoEn: '2026-11-24T14:30:00.000Z',
    solicitud: { id: S1, codigo: 'AQ-7F3K9X' },
    cliente: { nombres: 'Lucía Fernanda', apellidos: 'Prado Quispe', dni: '45678912' },
    mes: '2026-11',
    mesTerminado: false,
    ...extra,
  };
}

const TERMINADO = pendiente({
  id: P2,
  metodo: 'TRANSFERENCIA',
  monto: '120.00',
  numeroOperacion: 'AB991',
  fechaOperacion: '2026-10-30',
  solicitud: { id: S2, codigo: 'AQ-2B4C6D' },
  cliente: { nombres: 'Mario', apellidos: 'Rojas Díaz', dni: '71234567' },
  mes: '2026-10',
  mesTerminado: true,
});

function pagoResuelto(extra: Record<string, unknown> = {}) {
  return {
    id: P1,
    estado: 'CONFIRMADO',
    metodo: 'YAPE',
    concepto: 'INSCRIPCION',
    monto: '88.00',
    registradoEn: '2026-11-24T14:30:00.000Z',
    verificadoEn: '2026-11-24T15:00:00.000Z',
    numeroOperacion: '0001-2345',
    fechaOperacion: '2026-11-24',
    motivoRechazo: null,
    numeroTicket: 7,
    ...extra,
  };
}

function caja(extra: Record<string, unknown> = {}) {
  const cero = '0.00';
  return {
    id: ID_CAJA,
    fecha: '2026-11-24',
    estado: 'ABIERTA',
    deOtroDia: false,
    montoInicial: '100.00',
    abiertaPor: { id: ID_YO, nombres: 'Rosa', apellidos: 'Quispe Mamani' },
    abiertaEn: '2026-11-24T13:00:00.000Z',
    resumen: {
      ingresos: { efectivo: cero, yape: cero, transferencia: cero },
      egresos: { efectivo: cero },
      esperado: { efectivo: '100.00', yape: cero, transferencia: cero },
      ultimoMovimiento: 0,
    },
    movimientos: [],
    cierres: [],
    ...extra,
  };
}

const MI_ACADEMIA = {
  academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null },
};

interface Opciones {
  rol?: 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR';
  caja?: unknown;
  pagos?: unknown[];
  extra?: Record<string, Manejador>;
}

/** Un servidor con la bandeja, la caja de hoy y la imagen del comprobante (que no es JSON: se pide con `pedirArchivo`). */
function servidor({
  rol = 'SECRETARIA',
  caja: cajaActual = caja(),
  pagos = [pendiente(), TERMINADO],
  extra = {},
}: Opciones = {}) {
  const api = simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol, { id: ID_YO }) }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    'GET /api/pagos/pendientes': () => ({ estado: 200, cuerpo: { pagos } }),
    'GET /api/cajas/actual': () => ({ estado: 200, cuerpo: { caja: cajaActual } }),
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

let urls: ReturnType<typeof simularUrlLocal>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  urls = simularUrlLocal();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

const tarjeta = (codigo: string) => screen.findByRole('article', { name: `Pago de la solicitud ${codigo}` });

describe('la bandeja de pagos (criterio 56)', () => {
  it('lista los pendientes con monto, número de operación, cliente y fechas, y destaca el mes terminado', async () => {
    servidor();
    mostrar('/panel/pagos');
    const primera = await tarjeta('AQ-7F3K9X');
    expect(within(primera).getByText('Lucía Fernanda Prado Quispe')).toBeInTheDocument();
    expect(within(primera).getByText('S/ 88.00')).toBeInTheDocument();
    expect(within(primera).getByText('0001-2345')).toBeInTheDocument();
    expect(within(primera).getByText('45678912')).toBeInTheDocument();
    expect(within(primera).getByText('24/11/2026')).toBeInTheDocument();
    // Enviado a las 14:30 UTC: 09:30 en Lima.
    expect(within(primera).getByText('24/11/2026 09:30')).toBeInTheDocument();
    expect(within(primera).getByText('Yape', { selector: 'span' })).toBeInTheDocument();
    expect(within(primera).queryByText('Mes terminado')).not.toBeInTheDocument();

    const terminada = await tarjeta('AQ-2B4C6D');
    expect(within(terminada).getByText('Mes terminado')).toBeInTheDocument();
    expect(within(terminada).getByText(/Es de octubre de 2026, un mes que ya terminó/)).toBeInTheDocument();
    expect(within(terminada).getByText('Transferencia', { selector: 'span' })).toBeInTheDocument();
  });

  it('sin pendientes lo dice', async () => {
    servidor({ pagos: [] });
    mostrar('/panel/pagos');
    expect(await screen.findByText('No hay comprobantes por verificar.')).toBeInTheDocument();
  });

  it('el inicio ofrece la opción con VERIFICAR_PAGOS y el entrenador no la ve ni entra', async () => {
    servidor();
    mostrar('/panel');
    expect(await screen.findByRole('link', { name: /Pagos por verificar/ })).toHaveAttribute('href', '/panel/pagos');
  });

  it('un entrenador ve "sin permiso" y no se pide la bandeja', async () => {
    const api = servidor({ rol: 'ENTRENADOR' });
    mostrar('/panel/pagos');
    expect(await screen.findByText('No tienes permiso para ver esta página')).toBeInTheDocument();
    expect(llamadas(api, 'GET /api/pagos/pendientes')).toHaveLength(0);
  });

  it('un entrenador no ve la opción en el inicio', async () => {
    servidor({ rol: 'ENTRENADOR' });
    mostrar('/panel');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Pagos por verificar/ })).not.toBeInTheDocument();
  });
});

describe('el visor del comprobante (criterio 56)', () => {
  it('pide la imagen con la sesión, la muestra con una URL de objeto, se amplía y la libera al cerrar', async () => {
    const api = servidor();
    mostrar('/panel/pagos');
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await usuario.click(
      within(await tarjeta('AQ-7F3K9X')).getByRole('button', { name: 'Ver el comprobante de la solicitud AQ-7F3K9X' }),
    );
    const dialogo = await screen.findByRole('dialog', { name: 'Comprobante de AQ-7F3K9X' });
    const imagen = await within(dialogo).findByRole('img', {
      name: 'Imagen del comprobante de Lucía Fernanda Prado Quispe',
    });
    expect(imagen).toHaveAttribute('src', 'blob:prueba-1');
    const pedida = api.mock.calls.find(([url]) => url === `/api/pagos/${P1}/comprobante`);
    expect(pedida?.[1]).toMatchObject({ method: 'GET', credentials: 'same-origin' });
    expect(urls.liberar).not.toHaveBeenCalled();

    const ampliar = within(dialogo).getByRole('button', { name: 'Ampliar la imagen' });
    await usuario.click(ampliar);
    expect(within(dialogo).getByRole('button', { name: 'Reducir la imagen' })).toHaveAttribute('aria-pressed', 'true');

    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(urls.liberar).toHaveBeenCalledWith('blob:prueba-1');
  });

  it('si la imagen falla, lo dice y deja reintentar', async () => {
    let intentos = 0;
    const api = servidor();
    const base = api.getMockImplementation();
    api.mockImplementation((url: string, opciones?: RequestInit) => {
      if (url.endsWith('/comprobante') && ++intentos === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ codigo: 'ERROR_INTERNO', mensaje: 'x' }), { status: 500 }),
        );
      }
      return base ? base(url, opciones) : Promise.reject(new Error('sin simulación'));
    });
    mostrar('/panel/pagos');
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await usuario.click(
      within(await tarjeta('AQ-7F3K9X')).getByRole('button', { name: 'Ver el comprobante de la solicitud AQ-7F3K9X' }),
    );
    const dialogo = await screen.findByRole('dialog', { name: 'Comprobante de AQ-7F3K9X' });
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No pudimos cargar la imagen del comprobante');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reintentar' }));
    expect(await within(dialogo).findByRole('img')).toBeInTheDocument();
  });
});

describe('aprobar (criterio 56)', () => {
  async function abrirAprobar(codigo = 'AQ-7F3K9X') {
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await usuario.click(
      within(await tarjeta(codigo)).getByRole('button', { name: `Aprobar el pago de la solicitud ${codigo}` }),
    );
    const dialogo = await screen.findByRole('dialog', { name: `Aprobar el pago: ${codigo}` });
    return { usuario, dialogo };
  }

  it('confirma con un diálogo, aprueba una sola vez y ofrece imprimir el ticket', async () => {
    const api = servidor({
      extra: { [`POST /api/pagos/${P1}/aprobacion`]: () => ({ estado: 200, cuerpo: { pago: pagoResuelto() } }) },
    });
    mostrar('/panel/pagos');
    const { usuario, dialogo } = await abrirAprobar();
    expect(within(dialogo).getByText('S/ 88.00', { selector: 'span' })).toBeInTheDocument();
    const confirmar = await within(dialogo).findByRole('button', { name: 'Aprobar S/ 88.00' });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.dblClick(confirmar);
    expect(await screen.findByRole('dialog', { name: 'Pago aprobado: AQ-7F3K9X' })).toBeInTheDocument();
    expect(screen.getByText(/Ticket N\.º 7/)).toBeInTheDocument();
    expect(llamadas(api, `POST /api/pagos/${P1}/aprobacion`)).toEqual([{}]);
    expect(screen.getByRole('link', { name: 'Imprimir ticket' })).toHaveAttribute('href', `/panel/pagos/${P1}/ticket`);
  });

  it('sin la caja abierta avisa «Abre la caja antes de aprobar» y no deja confirmar', async () => {
    const api = servidor({ caja: null });
    mostrar('/panel/pagos');
    const { dialogo } = await abrirAprobar();
    expect(await within(dialogo).findByText('Abre la caja antes de aprobar el pago.')).toBeInTheDocument();
    expect(within(dialogo).getByRole('link', { name: 'Ir a la caja' })).toHaveAttribute('href', '/panel/caja');
    expect(within(dialogo).getByRole('button', { name: 'Aprobar S/ 88.00' })).toBeDisabled();
    expect(llamadas(api, `POST /api/pagos/${P1}/aprobacion`)).toHaveLength(0);
  });

  it('con la caja de otro día no deja confirmar', async () => {
    servidor({ caja: caja({ fecha: '2026-11-23', deOtroDia: true }) });
    mostrar('/panel/pagos');
    const { dialogo } = await abrirAprobar();
    expect(await within(dialogo).findByText(/La caja abierta es del 23\/11\/2026/)).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Aprobar S/ 88.00' })).toBeDisabled();
  });

  it('avisa que el pago es de un mes terminado', async () => {
    servidor();
    mostrar('/panel/pagos');
    const { dialogo } = await abrirAprobar('AQ-2B4C6D');
    expect(within(dialogo).getByText(/un mes que ya terminó/)).toBeInTheDocument();
  });

  it('un 409 PAGO_YA_RECHAZADO se muestra con su mensaje y se vuelve a pedir la bandeja', async () => {
    const api = servidor({ extra: { [`POST /api/pagos/${P1}/aprobacion`]: () => error('PAGO_YA_RECHAZADO', 409) } });
    mostrar('/panel/pagos');
    const { usuario, dialogo } = await abrirAprobar();
    const confirmar = await within(dialogo).findByRole('button', { name: 'Aprobar S/ 88.00' });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.click(confirmar);
    expect(await within(dialogo).findByText(/ya se había rechazado, así que no se puede aprobar/)).toBeInTheDocument();
    await waitFor(() => expect(llamadas(api, 'GET /api/pagos/pendientes')).toHaveLength(2));
    expect(within(dialogo).getByRole('button', { name: /Aprobar/ })).toBeDisabled();
  });

  it('un 409 SIN_CAJA_ABIERTA de la API se muestra con el enlace a la caja', async () => {
    servidor({ extra: { [`POST /api/pagos/${P1}/aprobacion`]: () => error('SIN_CAJA_ABIERTA', 409) } });
    mostrar('/panel/pagos');
    const { usuario, dialogo } = await abrirAprobar();
    const confirmar = await within(dialogo).findByRole('button', { name: 'Aprobar S/ 88.00' });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.click(confirmar);
    expect(await within(dialogo).findByText('Abre la caja antes de aprobar el pago.')).toBeInTheDocument();
    expect(within(dialogo).getByRole('link', { name: 'Ir a la caja' })).toBeInTheDocument();
  });
});

describe('rechazar (criterio 56)', () => {
  async function abrirRechazar() {
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await usuario.click(
      within(await tarjeta('AQ-7F3K9X')).getByRole('button', { name: 'Rechazar el pago de la solicitud AQ-7F3K9X' }),
    );
    const dialogo = await screen.findByRole('dialog', { name: 'Rechazar el pago: AQ-7F3K9X' });
    return { usuario, dialogo };
  }

  it('exige el motivo, avisa que el cliente lo verá y lo envía una sola vez', async () => {
    const api = servidor({
      extra: {
        [`POST /api/pagos/${P1}/rechazo`]: () => ({
          estado: 200,
          cuerpo: {
            pago: pagoResuelto({
              estado: 'RECHAZADO',
              verificadoEn: '2026-11-24T15:00:00.000Z',
              motivoRechazo: 'La imagen no se lee',
              numeroTicket: null,
            }),
          },
        }),
      },
    });
    mostrar('/panel/pagos');
    const { usuario, dialogo } = await abrirRechazar();
    expect(within(dialogo).getByText(/El cliente verá este motivo/)).toBeInTheDocument();

    await usuario.click(within(dialogo).getByRole('button', { name: 'Rechazar el pago' }));
    expect(await within(dialogo).findByRole('alert')).toBeInTheDocument();
    expect(llamadas(api, `POST /api/pagos/${P1}/rechazo`)).toHaveLength(0);

    await usuario.type(within(dialogo).getByLabelText('Motivo del rechazo'), '  La imagen no se lee  ');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Rechazar el pago' }));
    expect(await screen.findByText(/rechazado\. El cliente verá el motivo en su seguimiento/)).toBeInTheDocument();
    expect(llamadas(api, `POST /api/pagos/${P1}/rechazo`)).toEqual([{ motivo: 'La imagen no se lee' }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('un 409 PAGO_YA_CONFIRMADO se muestra con su mensaje', async () => {
    servidor({ extra: { [`POST /api/pagos/${P1}/rechazo`]: () => error('PAGO_YA_CONFIRMADO', 409) } });
    mostrar('/panel/pagos');
    const { usuario, dialogo } = await abrirRechazar();
    await usuario.type(within(dialogo).getByLabelText('Motivo del rechazo'), 'No llegó el dinero');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Rechazar el pago' }));
    expect(
      await within(dialogo).findByText(/ya se había confirmado, así que no se puede rechazar/),
    ).toBeInTheDocument();
  });
});

describe('el panel de solicitudes con los estados nuevos (criterio 54)', () => {
  function solicitud(extra: Record<string, unknown>) {
    return {
      id: S1,
      codigo: 'AQ-7F3K9X',
      estado: 'EN_VERIFICACION',
      creadaEn: '2026-11-24T14:00:00.000Z',
      reservaVenceEn: null,
      nombres: 'Lucía Fernanda',
      apellidos: 'Prado Quispe',
      dni: '45678912',
      telefono: '987654321',
      menorDeEdad: false,
      plan: { id: 'd1111111-1111-4111-8111-111111111111', nombre: 'Plan 3 veces' },
      clases: [
        {
          id: 'e1111111-1111-4111-8111-111111111111',
          nivel: 'BASICO',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
        },
      ],
      mes: '2026-11',
      clasesTotales: 5,
      monto: '88.00',
      ajuste: null,
      pago: null,
      ...extra,
    };
  }

  it('una solicitud EN_VERIFICACION no se cobra ni se cancela y lleva a la bandeja', async () => {
    servidor({
      extra: {
        'GET /api/solicitudes?estado=ACTIVAS': () => ({
          estado: 200,
          cuerpo: {
            solicitudes: [
              solicitud({
                pago: {
                  id: P1,
                  metodo: 'YAPE',
                  estado: 'PENDIENTE_VERIFICACION',
                  monto: '88.00',
                  registradoEn: '2026-11-24T14:30:00.000Z',
                  verificadoEn: null,
                  numeroOperacion: '12345',
                  fechaOperacion: '2026-11-24',
                  motivoRechazo: null,
                  numeroTicket: null,
                },
              }),
            ],
          },
        }),
      },
    });
    mostrar('/panel/solicitudes');
    const tarjetaSolicitud = await screen.findByRole('article', { name: 'Solicitud AQ-7F3K9X' });
    expect(within(tarjetaSolicitud).getByText('Comprobante en revisión', { selector: 'span' })).toBeInTheDocument();
    expect(within(tarjetaSolicitud).getByText(/Yape · En verificación el 24\/11\/2026 09:30/)).toBeInTheDocument();
    expect(within(tarjetaSolicitud).queryByRole('button', { name: /Cobrar en efectivo/ })).not.toBeInTheDocument();
    expect(within(tarjetaSolicitud).queryByRole('button', { name: /Cancelar/ })).not.toBeInTheDocument();
    const enlace = within(tarjetaSolicitud).getByRole('link', {
      name: 'Verificar el comprobante de la solicitud AQ-7F3K9X',
    });
    expect(enlace).toHaveAttribute('href', '/panel/pagos');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(enlace);
    expect(await screen.findByRole('heading', { level: 1, name: 'Pagos por verificar' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/panel/pagos');
  });
});
