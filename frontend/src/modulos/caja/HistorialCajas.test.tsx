import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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
import { Rutas } from '../../rutas/Rutas';

// Spec 006b, criterio 44 y PQ12: la opción "Historial de caja" del inicio, la lista con su filtro de fechas, el detalle de solo lectura
// con sus cierres y reaperturas, la descarga del PDF de cada cierre y "Reabrir" para el administrador. La API se simula; los criterios 40 a
// 43 los prueba el backend. Los montos se comparan siempre como texto.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_HOY = 'c0000000-0000-4000-8000-000000000001';
const ID_VIEJA = 'c0000000-0000-4000-8000-000000000002';
const ID_ABIERTA_VIEJA = 'c0000000-0000-4000-8000-000000000003';
const ID_LUCIA = 'd1111111-1111-4111-8111-111111111111';
const ID_ALUMNA = 'a1111111-1111-4111-8111-111111111111';
const CERO = '0.00';

const LUCIA = { id: ID_LUCIA, nombres: 'Lucía', apellidos: 'Benites Rojas' };
const ALUMNA = { id: ID_ALUMNA, nombres: 'Valeria', apellidos: 'Pinto Soto' };
const YO = { id: ID_YO, nombres: 'Rosa', apellidos: 'Quispe Mamani' };

const MI_ACADEMIA = {
  academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null },
};

// 22/11/2026 10:00 en Lima: "hoy" para la página. Solo se congela `Date`; los temporizadores siguen siendo reales.
const AHORA = new Date('2026-11-22T15:00:00.000Z');

function cierre(extra: Record<string, unknown> = {}) {
  return {
    numero: 1,
    cerradoPor: LUCIA,
    // 18:05 en Lima del 2 de noviembre.
    cerradoEn: '2026-11-02T23:05:00.000Z',
    montoInicial: '100.00',
    ingresos: { efectivo: '42.00', yape: '88.00', transferencia: CERO },
    egresos: { efectivo: '15.50' },
    esperado: { efectivo: '126.50', yape: '88.00', transferencia: CERO },
    montoDeclarado: '126.80',
    diferencia: '0.30',
    resultado: 'SOBRANTE',
    observacion: 'Sobró un sol suelto',
    tardio: false,
    movimientosHasta: 2,
    reapertura: null,
    ...extra,
  };
}

const MOVIMIENTOS = [
  {
    id: 'e1111111-1111-4111-8111-111111111111',
    numero: 1,
    tipo: 'INGRESO',
    concepto: 'MENSUALIDAD',
    metodo: 'EFECTIVO',
    monto: '42.00',
    descripcion: null,
    comprobante: null,
    alumno: ALUMNA,
    registradoPor: LUCIA,
    registradoEn: '2026-11-02T13:45:00.000Z',
  },
  {
    id: 'e2222222-2222-4222-8222-222222222222',
    numero: 2,
    tipo: 'EGRESO',
    concepto: 'EGRESO_MENOR',
    metodo: 'EFECTIVO',
    monto: '15.50',
    descripcion: 'Compra de tizas',
    comprobante: null,
    alumno: null,
    registradoPor: LUCIA,
    registradoEn: '2026-11-02T14:15:00.000Z',
  },
];

const RESUMEN_VIEJA = {
  ingresos: { efectivo: '42.00', yape: '88.00', transferencia: CERO },
  egresos: { efectivo: '15.50' },
  esperado: { efectivo: '126.50', yape: '88.00', transferencia: CERO },
  ultimoMovimiento: 2,
};

function caja(extra: Record<string, unknown> = {}) {
  return {
    id: ID_VIEJA,
    fecha: '2026-11-02',
    estado: 'CERRADA',
    deOtroDia: true,
    montoInicial: '100.00',
    abiertaPor: LUCIA,
    abiertaEn: '2026-11-02T13:30:00.000Z',
    resumen: RESUMEN_VIEJA,
    movimientos: MOVIMIENTOS,
    cierres: [cierre()],
    ...extra,
  };
}

/** La caja de hoy, ya cerrada, con un cierre reabierto antes y otro vigente tardío. */
const CERRADA_CON_REAPERTURA = caja({
  cierres: [
    cierre({
      reapertura: {
        reabiertaPor: YO,
        reabiertaEn: '2026-11-03T15:00:00.000Z',
        motivo: 'Faltaba registrar un gasto',
      },
    }),
    cierre({
      numero: 2,
      cerradoEn: '2026-11-03T15:30:00.000Z',
      montoDeclarado: '126.50',
      diferencia: '0.00',
      resultado: 'CUADRA',
      observacion: null,
      tardio: true,
      movimientosHasta: 2,
    }),
  ],
});

const ABIERTA_VIEJA = caja({
  id: ID_ABIERTA_VIEJA,
  fecha: '2026-11-20',
  estado: 'ABIERTA',
  movimientos: [],
  cierres: [],
  resumen: { ...RESUMEN_VIEJA, ingresos: { efectivo: CERO, yape: CERO, transferencia: CERO }, ultimoMovimiento: 0 },
});

function filaDeLista(extra: Record<string, unknown> = {}) {
  return {
    id: ID_VIEJA,
    fecha: '2026-11-02',
    estado: 'CERRADA',
    deOtroDia: true,
    montoInicial: '100.00',
    abiertaPor: LUCIA,
    totalIngresos: { efectivo: '42.00', yape: '88.00', transferencia: '1200.00' },
    totalEgresos: { efectivo: '15.50' },
    ultimoCierre: {
      numero: 1,
      montoDeclarado: '126.80',
      diferencia: '0.30',
      resultado: 'SOBRANTE',
      tardio: false,
      cerradoPor: LUCIA,
      cerradoEn: '2026-11-02T23:05:00.000Z',
    },
    ...extra,
  };
}

const FILA_HOY = filaDeLista({
  id: ID_HOY,
  fecha: '2026-11-22',
  estado: 'ABIERTA',
  deOtroDia: false,
  totalIngresos: { efectivo: CERO, yape: CERO, transferencia: CERO },
  totalEgresos: { efectivo: CERO },
  ultimoCierre: null,
});
const FILA_ABIERTA_VIEJA = filaDeLista({
  id: ID_ABIERTA_VIEJA,
  fecha: '2026-11-20',
  estado: 'ABIERTA',
  ultimoCierre: null,
});
const FILA_TARDIA = filaDeLista({
  id: 'c0000000-0000-4000-8000-000000000004',
  fecha: '2026-11-10',
  ultimoCierre: {
    numero: 2,
    montoDeclarado: '80.00',
    diferencia: '-4.50',
    resultado: 'FALTANTE',
    tardio: true,
    cerradoPor: LUCIA,
    cerradoEn: '2026-11-11T15:00:00.000Z',
  },
});

const HISTORIAL = {
  desde: '2026-10-23',
  hasta: '2026-11-22',
  cajas: [FILA_HOY, FILA_ABIERTA_VIEJA, FILA_TARDIA, filaDeLista()],
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Rol = 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO';

function servidor(rol: Rol = 'ADMIN', extra: Record<string, Manejador> = {}) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol, { id: ID_YO }) }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    'GET /api/cajas': () => ({ estado: 200, cuerpo: HISTORIAL }),
    [`GET /api/cajas/${ID_VIEJA}`]: () => ({ estado: 200, cuerpo: { caja: CERRADA_CON_REAPERTURA } }),
    [`GET /api/cajas/${ID_ABIERTA_VIEJA}`]: () => ({ estado: 200, cuerpo: { caja: ABIERTA_VIEJA } }),
    ...extra,
  });
}

describe('inicio del panel: "Historial de caja" (criterio 44)', () => {
  it.each(['ADMIN', 'SECRETARIA'] as const)('%s lo ve y lleva a /panel/cajas', async (rol) => {
    servidor(rol);
    mostrar('/panel');
    expect(await screen.findByRole('link', { name: /^Historial de caja/ })).toHaveAttribute('href', '/panel/cajas');
  });

  it.each(['ENTRENADOR', 'ALUMNO'] as const)('%s no lo ve', async (rol) => {
    servidor(rol);
    mostrar('/panel');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Historial de caja/ })).not.toBeInTheDocument();
  });

  it.each(['/panel/cajas', `/panel/cajas/${ID_VIEJA}`])(
    '%s responde "sin permiso" a quien no ve reportes y no pide nada',
    async (ruta) => {
      const api = servidor('ENTRENADOR');
      mostrar(ruta);
      expect(await screen.findByText('No tienes permiso para ver esta página')).toBeInTheDocument();
      expect(api.mock.calls.filter(([url]) => String(url).startsWith('/api/cajas'))).toHaveLength(0);
    },
  );

  it('/panel/caja no cambia: "Caja" sigue llevando a la caja del día', async () => {
    servidor('SECRETARIA');
    mostrar('/panel');
    expect(await screen.findByRole('link', { name: /^Caja/ })).toHaveAttribute('href', '/panel/caja');
  });
});

describe('/panel/cajas: la lista', () => {
  it('al entrar pide sin parámetros y muestra el rango que devuelve la API', async () => {
    const api = servidor();
    mostrar('/panel/cajas');
    expect(await screen.findByText('Mostrando las cajas del 23/10/2026 al 22/11/2026.')).toBeInTheDocument();
    expect(api.mock.calls.filter(([url]) => String(url).startsWith('/api/cajas'))).toEqual([
      ['/api/cajas', expect.objectContaining({ method: 'GET' })],
    ]);
    expect(screen.getByLabelText('Desde')).toHaveValue('');
    expect(screen.getByLabelText('Hasta')).toHaveValue('');
  });

  it('cada fila muestra la fecha, el estado, quién abrió, los montos, el último cierre y "Tardío"', async () => {
    servidor();
    mostrar('/panel/cajas');
    const lista = await screen.findByRole('list', { name: 'Cajas' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(4);

    const hoy = filas[0] as HTMLElement;
    expect(within(hoy).getByRole('link', { name: 'Caja del 22/11/2026' })).toHaveAttribute(
      'href',
      `/panel/cajas/${ID_HOY}`,
    );
    expect(within(hoy).getByText('Abierta')).toBeInTheDocument();
    expect(within(hoy).getByText('Sin cerrar')).toBeInTheDocument();

    const vieja = filas[1] as HTMLElement;
    expect(within(vieja).getByText('Abierta de otro día')).toBeInTheDocument();

    const tardia = filas[2] as HTMLElement;
    expect(within(tardia).getByText('Cerrada')).toBeInTheDocument();
    expect(within(tardia).getByText('Tardío')).toBeInTheDocument();
    expect(within(tardia).getByText('Faltante de S/ 4.50')).toBeInTheDocument();
    expect(within(tardia).getByText('S/ 80.00')).toBeInTheDocument();

    const cerrada = filas[3] as HTMLElement;
    expect(within(cerrada).getByText('Caja del 02/11/2026', { exact: false })).toBeInTheDocument();
    expect(within(cerrada).getByText('Abierta por Lucía Benites Rojas')).toBeInTheDocument();
    expect(within(cerrada).getByText('S/ 100.00')).toBeInTheDocument();
    expect(within(cerrada).getByText('S/ 42.00')).toBeInTheDocument();
    expect(within(cerrada).getByText('S/ 88.00')).toBeInTheDocument();
    expect(within(cerrada).getByText('S/ 1,200.00')).toBeInTheDocument();
    expect(within(cerrada).getByText('S/ 15.50')).toBeInTheDocument();
    expect(within(cerrada).getByText('S/ 126.80')).toBeInTheDocument();
    expect(within(cerrada).getByText('Sobrante de S/ 0.30')).toBeInTheDocument();
    expect(within(cerrada).queryByText('Tardío')).not.toBeInTheDocument();
    // Nunca un DNI.
    expect(lista.textContent).not.toMatch(/dni/i);
  });

  it('una fila lleva al detalle de esa caja', async () => {
    servidor();
    mostrar('/panel/cajas');
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Caja del 20/11/2026' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Detalle de la caja' })).toBeInTheDocument();
    expect(rutaActual()).toBe(`/panel/cajas/${ID_ABIERTA_VIEJA}`);
  });

  it('sin cajas, lo dice', async () => {
    servidor('ADMIN', { 'GET /api/cajas': () => ({ estado: 200, cuerpo: { ...HISTORIAL, cajas: [] } }) });
    mostrar('/panel/cajas');
    expect(await screen.findByText('No hay cajas en estas fechas')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Cajas' })).not.toBeInTheDocument();
  });

  it('el filtro envía solo las fechas escritas y muestra el rango nuevo', async () => {
    const respuestas: string[] = [];
    servidor('ADMIN', {
      'GET /api/cajas': () => ({ estado: 200, cuerpo: HISTORIAL }),
    });
    const base = vi.mocked(fetch);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opciones?: RequestInit) => {
        respuestas.push(url);
        if (url.startsWith('/api/cajas?')) {
          return Promise.resolve(
            new Response(JSON.stringify({ ...HISTORIAL, desde: '2026-11-01', hasta: '2026-11-22' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return base(url, opciones);
      }),
    );
    mostrar('/panel/cajas');
    const usuario = userEvent.setup();
    await screen.findByText('Mostrando las cajas del 23/10/2026 al 22/11/2026.');
    await usuario.type(screen.getByLabelText('Desde'), '2026-11-01');
    await usuario.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(await screen.findByText('Mostrando las cajas del 01/11/2026 al 22/11/2026.')).toBeInTheDocument();
    expect(respuestas).toContain('/api/cajas?desde=2026-11-01');
  });

  it.each([
    ['desde', '2026-11-10', '2026-11-01', 'desde', 'La fecha inicial no puede ser posterior a la final.'],
    ['rango de 367 días', '2025-11-10', '2026-11-11', 'desde', 'El rango puede ser de como mucho 366 días.'],
    ['solo "desde" posterior a hoy', '2026-11-23', '', 'desde', 'La fecha inicial no puede ser posterior a la final.'],
    ['solo "desde" a más de 366 días de hoy', '2025-11-10', '', 'desde', 'El rango puede ser de como mucho 366 días.'],
  ])('%s: lo explica junto a su campo y no llama a la API', async (_nombre, desde, hasta, campo, mensaje) => {
    const api = servidor();
    mostrar('/panel/cajas');
    const usuario = userEvent.setup();
    await screen.findByText(/Mostrando las cajas/);
    await usuario.type(screen.getByLabelText('Desde'), desde);
    if (hasta) await usuario.type(screen.getByLabelText('Hasta'), hasta);
    await usuario.click(screen.getByRole('button', { name: 'Filtrar' }));
    const entrada = screen.getByLabelText(campo === 'desde' ? 'Desde' : 'Hasta');
    expect(entrada).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findByText(mensaje)).toBeInTheDocument();
    expect(llamadas(api, 'GET /api/cajas')).toHaveLength(1);
  });

  it('366 días exactos se aceptan', async () => {
    const api = servidor();
    mostrar('/panel/cajas');
    const usuario = userEvent.setup();
    await screen.findByText(/Mostrando las cajas/);
    await usuario.type(screen.getByLabelText('Desde'), '2025-11-11');
    await usuario.type(screen.getByLabelText('Hasta'), '2026-11-11');
    await usuario.click(screen.getByRole('button', { name: 'Filtrar' }));
    await waitFor(() =>
      expect(api.mock.calls.map(([url]) => String(url))).toContain('/api/cajas?desde=2025-11-11&hasta=2026-11-11'),
    );
  });

  it('si no carga, ofrece reintentar', async () => {
    let intentos = 0;
    servidor('ADMIN', {
      'GET /api/cajas': () => (++intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: HISTORIAL }),
    });
    mostrar('/panel/cajas');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el historial.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('list', { name: 'Cajas' })).toBeInTheDocument();
  });

  it('las consultas llevan la academia y la identidad de la sesión (criterio 28 de 003)', async () => {
    servidor();
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={['/panel/cajas']}>
          <Rutas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('list', { name: 'Cajas' });
    expect(
      cliente
        .getQueryCache()
        .findAll({ queryKey: ['cajas-historial'] })
        .map((q) => q.queryKey),
    ).toEqual([['cajas-historial', 'delfines', ID_YO, null, null]]);
  });
});

describe('/panel/cajas/:id: el detalle de solo lectura', () => {
  it('muestra el resumen, cada cierre con su reapertura y los movimientos, sin egresos ni cierre', async () => {
    servidor('SECRETARIA');
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    const resumen = await screen.findByRole('region', { name: 'Resumen de la caja' });
    expect(within(resumen).getByText('Caja del 02/11/2026')).toBeInTheDocument();
    expect(within(resumen).getByText('Abierta por Lucía Benites Rojas a las 08:30')).toBeInTheDocument();

    const primero = screen.getByRole('article', { name: 'Cierre 1' });
    expect(within(primero).getByText('Reabierto')).toBeInTheDocument();
    expect(within(primero).getByText('Sobrante de S/ 0.30')).toBeInTheDocument();
    expect(within(primero).getByText('Sobró un sol suelto')).toBeInTheDocument();
    expect(within(primero).getByText(/Reabierto por Rosa Quispe Mamani el 03\/11\/2026 10:00/)).toBeInTheDocument();
    expect(within(primero).getByText('Motivo: Faltaba registrar un gasto')).toBeInTheDocument();
    expect(within(primero).queryByText('Cierre tardío')).not.toBeInTheDocument();

    const segundo = screen.getByRole('article', { name: 'Cierre 2' });
    expect(within(segundo).getByText('Cierre tardío')).toBeInTheDocument();
    expect(within(segundo).getByText('Cuadra', { selector: 'dd' })).toBeInTheDocument();
    expect(within(segundo).queryByText(/Motivo:/)).not.toBeInTheDocument();

    const movimientos = screen.getByRole('list', { name: 'Movimientos' });
    expect(within(movimientos).getByText('Mensualidad: Valeria Pinto Soto')).toBeInTheDocument();
    expect(within(movimientos).getByText('Egreso: Compra de tizas')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Registrar egreso' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar caja' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reabrir caja' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ir a la caja del día' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Volver al historial de caja/ })).toHaveAttribute('href', '/panel/cajas');
  });

  it('una caja que nunca se cerró lo dice', async () => {
    servidor('ADMIN', {
      [`GET /api/cajas/${ID_VIEJA}`]: () => ({
        estado: 200,
        cuerpo: { caja: caja({ estado: 'ABIERTA', cierres: [] }) },
      }),
    });
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    expect(await screen.findByText('Esta caja todavía no se cerró.')).toBeInTheDocument();
  });

  it('una caja abierta ofrece "Ir a la caja del día" a quien abre y cierra la caja, y avisa si es de otro día', async () => {
    servidor('SECRETARIA');
    mostrar(`/panel/cajas/${ID_ABIERTA_VIEJA}`);
    expect(await screen.findByRole('link', { name: 'Ir a la caja del día' })).toHaveAttribute('href', '/panel/caja');
    expect(
      screen.getByText(/La caja del 20\/11\/2026 sigue abierta\. No admite egresos ni cobros/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reabrir caja' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar egreso' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar caja' })).not.toBeInTheDocument();
  });

  it('una caja que no existe o no se puede ver muestra un mensaje y el camino de vuelta', async () => {
    servidor('ADMIN', { [`GET /api/cajas/${ID_VIEJA}`]: () => error('NO_ENCONTRADO', 404) });
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró la caja.');
    expect(screen.getByRole('link', { name: /Volver al historial de caja/ })).toBeInTheDocument();
  });

  it('las consultas llevan la academia, la identidad de la sesión y el id (criterio 28 de 003)', async () => {
    servidor();
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={[`/panel/cajas/${ID_VIEJA}`]}>
          <Rutas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('region', { name: 'Resumen de la caja' });
    expect(
      cliente
        .getQueryCache()
        .findAll({ queryKey: ['caja'] })
        .map((q) => q.queryKey),
    ).toEqual([['caja', 'delfines', ID_YO, ID_VIEJA]]);
  });
});

describe('/panel/cajas/:id: reabrir (PQ12)', () => {
  const REABIERTA_HOY = caja({
    id: ID_HOY,
    fecha: '2026-11-22',
    deOtroDia: false,
    estado: 'ABIERTA',
    cierres: [
      cierre({ reapertura: { reabiertaPor: YO, reabiertaEn: '2026-11-22T15:00:00.000Z', motivo: 'Faltó un cobro' } }),
    ],
  });
  const CERRADA_HOY = caja({ id: ID_HOY, fecha: '2026-11-22', deOtroDia: false });

  it('solo el administrador ve "Reabrir caja", y solo en una caja cerrada', async () => {
    servidor('ADMIN');
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    expect(await screen.findByRole('button', { name: 'Reabrir caja' })).toBeInTheDocument();
  });

  it('de un día anterior, el diálogo dice que solo podrá contar el efectivo y cerrarla, y al reabrir muestra la caja que devuelve la API', async () => {
    const reabierta = caja({ estado: 'ABIERTA', cierres: CERRADA_CON_REAPERTURA.cierres });
    let actual = CERRADA_CON_REAPERTURA;
    const api = servidor('ADMIN', {
      [`GET /api/cajas/${ID_VIEJA}`]: () => ({ estado: 200, cuerpo: { caja: actual } }),
      [`POST /api/cajas/${ID_VIEJA}/reapertura`]: () => {
        actual = reabierta;
        return { estado: 200, cuerpo: { caja: reabierta } };
      },
    });
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir caja' }));
    const dialogo = screen.getByRole('dialog', { name: 'Reabrir caja' });
    expect(
      within(dialogo).getByText(/Es la caja de un día anterior: solo podrás volver a contar el efectivo y cerrarla\./),
    ).toBeInTheDocument();
    expect(within(dialogo).queryByText(/volverá a admitir egresos y cobros/i)).not.toBeInTheDocument();

    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir caja' }));
    expect(within(dialogo).getByLabelText('Motivo de la reapertura')).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(api, `POST /api/cajas/${ID_VIEJA}/reapertura`)).toHaveLength(0);
    await usuario.type(within(dialogo).getByLabelText('Motivo de la reapertura'), 'Faltaba registrar un gasto');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir caja' }));

    expect(await screen.findByText(/Caja reabierta\. Es la caja de un día anterior/)).toBeInTheDocument();
    const [cuerpo] = llamadas(api, `POST /api/cajas/${ID_VIEJA}/reapertura`) as { motivo: string }[];
    expect(cuerpo).toEqual({ motivo: 'Faltaba registrar un gasto' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reabrir caja' })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Ir a la caja del día' })).toBeInTheDocument();
  });

  it('de hoy, el diálogo dice que volverá a admitir egresos y cobros', async () => {
    servidor('ADMIN', { [`GET /api/cajas/${ID_HOY}`]: () => ({ estado: 200, cuerpo: { caja: CERRADA_HOY } }) });
    mostrar(`/panel/cajas/${ID_HOY}`);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Reabrir caja' }));
    const dialogo = screen.getByRole('dialog', { name: 'Reabrir caja' });
    expect(within(dialogo).getByText(/Volverá a admitir egresos y cobros\./)).toBeInTheDocument();
    expect(within(dialogo).queryByText(/Es la caja de un día anterior/)).not.toBeInTheDocument();
  });

  it('al reabrir la caja de hoy se invalidan la lista y la caja del día', async () => {
    let estado = CERRADA_HOY;
    const api = servidor('ADMIN', {
      [`GET /api/cajas/${ID_HOY}`]: () => ({ estado: 200, cuerpo: { caja: estado } }),
      [`POST /api/cajas/${ID_HOY}/reapertura`]: () => {
        estado = REABIERTA_HOY;
        return { estado: 200, cuerpo: { caja: REABIERTA_HOY } };
      },
    });
    mostrar(`/panel/cajas/${ID_HOY}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir caja' }));
    await usuario.type(screen.getByLabelText('Motivo de la reapertura'), 'Faltó un cobro');
    await usuario.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reabrir caja' }));
    expect(await screen.findByText('Caja reabierta. Ya admite egresos y cobros.')).toBeInTheDocument();
    expect(llamadas(api, `POST /api/cajas/${ID_HOY}/reapertura`)).toHaveLength(1);
  });

  it('un 409 se explica con su mensaje, se cierra el diálogo y la caja se vuelve a pedir', async () => {
    const api = servidor('ADMIN', {
      [`POST /api/cajas/${ID_VIEJA}/reapertura`]: () =>
        error('HAY_OTRA_CAJA_ABIERTA', 409, { cajaId: ID_HOY, fecha: '2026-11-22' }),
    });
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir caja' }));
    await usuario.type(screen.getByLabelText('Motivo de la reapertura'), 'Faltaba registrar un gasto');
    await usuario.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reabrir caja' }));
    expect(
      await screen.findByText('Hay otra caja abierta, la del 22/11/2026. Ciérrala antes de reabrir esta.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(llamadas(api, `GET /api/cajas/${ID_VIEJA}`).length).toBeGreaterThanOrEqual(2));
  });
});

describe('/panel/cajas/:id: descargar el PDF de cada cierre (criterio 42 y 44)', () => {
  /** Una API que además sirve el PDF: la simulada solo responde JSON. */
  function conPdf(pdf: (numero: string) => Response | Promise<Response>) {
    const api = servidor('SECRETARIA');
    const pedidos: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opciones?: RequestInit) => {
        const partes = /\/cierres\/([^/]+)\/pdf$/.exec(url);
        if (partes) {
          pedidos.push(url);
          return Promise.resolve(pdf(partes[1] as string));
        }
        return api(url, opciones);
      }),
    );
    return { api, pedidos };
  }

  // Con texto y no con un `Blob` de jsdom: la `Response` de Node no entiende el `Blob` de jsdom.
  const respuestaPdf = () =>
    new Response('%PDF-1.3 cierre', { status: 200, headers: { 'Content-Type': 'application/pdf' } });

  it('cada cierre tiene su botón; la descarga confirma la sesión, pide el PDF y lo entrega con su nombre', async () => {
    const { crear, liberar } = simularUrlLocal();
    const entregados: { descarga: string; direccion: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      entregados.push({ descarga: this.download, direccion: this.href });
    });
    const { api, pedidos } = conPdf(respuestaPdf);
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    const usuario = userEvent.setup();
    const botones = await screen.findAllByRole('button', { name: /Descargar PDF/ });
    expect(botones).toHaveLength(2);
    expect(botones.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Descargar PDF del cierre 1',
      'Descargar PDF del cierre 2',
    ]);
    const sesiones = llamadas(api, 'GET /api/sesion').length;

    await usuario.click(botones[1] as HTMLElement);
    await waitFor(() => expect(entregados).toHaveLength(1));
    expect(pedidos).toEqual([`/api/cajas/${ID_VIEJA}/cierres/2/pdf`]);
    expect(entregados[0]?.descarga).toBe('cierre-caja-2026-11-02-2.pdf');
    expect(entregados[0]?.direccion).toBe('blob:prueba-1');
    expect(crear).toHaveBeenCalledTimes(1);
    expect(llamadas(api, 'GET /api/sesion').length).toBeGreaterThan(sesiones);
    // La dirección de objeto se libera al terminar.
    await waitFor(() => expect(liberar).toHaveBeenCalledWith('blob:prueba-1'), { timeout: 2000 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('mientras prepara el PDF, los botones quedan desactivados', async () => {
    simularUrlLocal();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    let soltar: () => void = () => undefined;
    const espera = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    conPdf(async () => {
      await espera;
      return respuestaPdf();
    });
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    const usuario = userEvent.setup();
    await usuario.click((await screen.findAllByRole('button', { name: /Descargar PDF/ }))[0] as HTMLElement);
    expect(await screen.findByRole('button', { name: 'Descargar PDF del cierre 1' })).toHaveTextContent(
      'Preparando el PDF…',
    );
    for (const boton of screen.getAllByRole('button', { name: /Descargar PDF/ })) expect(boton).toBeDisabled();
    soltar();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar PDF del cierre 1' })).toBeEnabled());
  });

  it('404: "No se encontró el cierre", solo en el cierre pedido', async () => {
    simularUrlLocal();
    conPdf(() => new Response(JSON.stringify({ codigo: 'NO_ENCONTRADO', mensaje: 'x' }), { status: 404 }));
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    const usuario = userEvent.setup();
    await usuario.click((await screen.findAllByRole('button', { name: /Descargar PDF/ }))[0] as HTMLElement);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No se encontró el cierre');
    expect(within(screen.getByRole('article', { name: 'Cierre 1' })).getByRole('alert')).toBe(alerta);
    expect(within(screen.getByRole('article', { name: 'Cierre 2' })).queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    [
      'un 500 de la API',
      () => new Response(JSON.stringify({ codigo: 'ERROR_INTERNO', mensaje: 'x' }), { status: 500 }),
    ],
    [
      'un 403 sin permiso',
      () => new Response(JSON.stringify({ codigo: 'SIN_PERMISO', mensaje: 'x' }), { status: 403 }),
    ],
    ['una respuesta que no es JSON ni PDF', () => new Response('<html>', { status: 502 })],
    ['un 200 que no es un PDF', () => new Response('hola', { status: 200, headers: { 'Content-Type': 'text/html' } })],
  ])('%s: "No se pudo generar el PDF. Inténtalo de nuevo."', async (_nombre, respuesta) => {
    const { crear } = simularUrlLocal();
    conPdf(respuesta);
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    await userEvent.setup().click((await screen.findAllByRole('button', { name: /Descargar PDF/ }))[0] as HTMLElement);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo generar el PDF. Inténtalo de nuevo.');
    expect(crear).not.toHaveBeenCalled();
  });

  it('si no hay red, también dice que no se pudo generar el PDF', async () => {
    simularUrlLocal();
    conPdf(() => Promise.reject(new TypeError('red caída')));
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    await userEvent.setup().click((await screen.findAllByRole('button', { name: /Descargar PDF/ }))[0] as HTMLElement);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo generar el PDF. Inténtalo de nuevo.');
  });

  it('401: no muestra un mensaje de PDF y vuelve a pedir la sesión', async () => {
    simularUrlLocal();
    const { api } = conPdf(
      () => new Response(JSON.stringify({ codigo: 'NO_AUTENTICADO', mensaje: 'x' }), { status: 401 }),
    );
    mostrar(`/panel/cajas/${ID_VIEJA}`);
    const usuario = userEvent.setup();
    await usuario.click((await screen.findAllByRole('button', { name: /Descargar PDF/ }))[0] as HTMLElement);
    const antes = llamadas(api, 'GET /api/sesion').length;
    await waitFor(() => expect(llamadas(api, 'GET /api/sesion').length).toBeGreaterThan(antes - 1));
    expect(screen.queryByText(/No se pudo generar el PDF/)).not.toBeInTheDocument();
    expect(screen.queryByText('No se encontró el cierre')).not.toBeInTheDocument();
  });
});
