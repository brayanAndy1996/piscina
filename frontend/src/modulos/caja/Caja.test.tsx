import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, llamadas, type Manejador, mostrar, sesionDe, simularApi } from '../../pruebas-api';
import { Rutas } from '../../rutas/Rutas';
import { describirDiferencia, diferenciaEnVivo, resultadoDeDiferencia } from './montos';

// Spec 006a, criterios 37 a 39: el inicio del panel ("Caja"), la página /panel/caja con sus cuatro estados, la apertura, el egreso, el
// cierre con la diferencia en vivo, la reapertura del administrador y los mensajes de los 409. La API se simula; los criterios 1 a 36 los
// prueba el backend. Los montos se escriben y se comparan siempre como texto.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_CAJA = 'c0000000-0000-4000-8000-000000000001';
const ID_OTRA = 'c0000000-0000-4000-8000-000000000002';
const ID_LUCIA = 'd1111111-1111-4111-8111-111111111111';
const ID_ALUMNA = 'a1111111-1111-4111-8111-111111111111';
const ID_MOV1 = 'e1111111-1111-4111-8111-111111111111';
const ID_MOV2 = 'e2222222-2222-4222-8222-222222222222';
const ID_MOV3 = 'e3333333-3333-4333-8333-333333333333';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const MI_ACADEMIA = {
  academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null },
};

const LUCIA = { id: ID_LUCIA, nombres: 'Lucía', apellidos: 'Benites Rojas' };
const ALUMNA = { id: ID_ALUMNA, nombres: 'Valeria', apellidos: 'Pinto Soto' };

const CERO = '0.00';
// 22/11/2026 08:30 en Lima.
const ABIERTA_EN = '2026-11-22T13:30:00.000Z';

function resumen(extra: Record<string, unknown> = {}) {
  return {
    ingresos: { efectivo: CERO, yape: CERO, transferencia: CERO },
    egresos: { efectivo: CERO },
    esperado: { efectivo: '100.00', yape: CERO, transferencia: CERO },
    ultimoMovimiento: 0,
    ...extra,
  };
}

function caja(extra: Record<string, unknown> = {}) {
  return {
    id: ID_CAJA,
    fecha: '2026-11-22',
    estado: 'ABIERTA',
    deOtroDia: false,
    montoInicial: '100.00',
    abiertaPor: LUCIA,
    abiertaEn: ABIERTA_EN,
    resumen: resumen(),
    movimientos: [],
    cierres: [],
    ...extra,
  };
}

const EGRESO = {
  id: ID_MOV1,
  numero: 1,
  tipo: 'EGRESO',
  concepto: 'EGRESO_MENOR',
  metodo: 'EFECTIVO',
  monto: '15.50',
  descripcion: 'Compra de tizas',
  comprobante: 'Boleta B001-123',
  alumno: null,
  registradoPor: LUCIA,
  // 09:15 en Lima.
  registradoEn: '2026-11-22T14:15:00.000Z',
};

const CON_EGRESO = caja({
  resumen: resumen({
    egresos: { efectivo: '15.50' },
    esperado: { efectivo: '84.50', yape: CERO, transferencia: CERO },
    ultimoMovimiento: 1,
  }),
  movimientos: [EGRESO],
});

const CON_MOVIMIENTOS = caja({
  resumen: resumen({
    ingresos: { efectivo: '42.00', yape: '88.00', transferencia: '120.00' },
    egresos: { efectivo: '15.50' },
    esperado: { efectivo: '126.50', yape: '88.00', transferencia: '120.00' },
    ultimoMovimiento: 4,
  }),
  movimientos: [
    {
      id: ID_MOV2,
      numero: 1,
      tipo: 'INGRESO',
      concepto: 'MENSUALIDAD',
      metodo: 'EFECTIVO',
      monto: '42.00',
      descripcion: null,
      comprobante: null,
      alumno: ALUMNA,
      registradoPor: LUCIA,
      registradoEn: '2026-11-22T13:45:00.000Z',
    },
    {
      id: ID_MOV3,
      numero: 2,
      tipo: 'INGRESO',
      concepto: 'INSCRIPCION',
      metodo: 'YAPE',
      monto: '88.00',
      descripcion: null,
      comprobante: null,
      alumno: ALUMNA,
      registradoPor: LUCIA,
      registradoEn: '2026-11-22T13:50:00.000Z',
    },
    {
      id: 'e4444444-4444-4444-8444-444444444444',
      numero: 3,
      tipo: 'INGRESO',
      concepto: 'CLASE_PARTICULAR',
      metodo: 'TRANSFERENCIA',
      monto: '120.00',
      descripcion: null,
      comprobante: null,
      alumno: ALUMNA,
      registradoPor: LUCIA,
      registradoEn: '2026-11-22T13:55:00.000Z',
    },
    { ...EGRESO, numero: 4 },
  ],
});

function cierreFaltante(extra: Record<string, unknown> = {}) {
  return {
    numero: 1,
    cerradoPor: LUCIA,
    // 18:05 en Lima.
    cerradoEn: '2026-11-22T23:05:00.000Z',
    montoInicial: '100.00',
    ingresos: { efectivo: CERO, yape: CERO, transferencia: CERO },
    egresos: { efectivo: '15.50' },
    esperado: { efectivo: '84.50', yape: CERO, transferencia: CERO },
    montoDeclarado: '80.00',
    diferencia: '-4.50',
    resultado: 'FALTANTE',
    observacion: 'Faltó el vuelto de la compra',
    tardio: false,
    movimientosHasta: 1,
    reapertura: null,
    ...extra,
  };
}

const CERRADA = caja({
  estado: 'CERRADA',
  resumen: CON_EGRESO.resumen,
  movimientos: [EGRESO],
  cierres: [cierreFaltante()],
});

const DE_OTRO_DIA = caja({ id: ID_OTRA, fecha: '2026-11-20', deOtroDia: true });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

type CajaApi = Record<string, unknown> | null;

/** Un servidor con estado: lo que devuelve `GET /api/cajas/actual` cambia con cada escritura, como en la API. */
function servidor(inicial: CajaApi, rol: 'ADMIN' | 'SECRETARIA' = 'SECRETARIA', extra: Record<string, Manejador> = {}) {
  const estado: { caja: CajaApi } = { caja: inicial };
  const api = simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol, { id: ID_YO }) }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    'GET /api/cajas/actual': () => ({ estado: 200, cuerpo: { caja: estado.caja } }),
    'POST /api/cajas': (cuerpo) => {
      const { montoInicial } = cuerpo as { montoInicial: string };
      estado.caja = caja({ montoInicial: `${montoInicial}.00`, resumen: resumen() });
      return { estado: 201, cuerpo: { caja: estado.caja } };
    },
    [`POST /api/cajas/${ID_CAJA}/egresos`]: () => {
      estado.caja = CON_EGRESO;
      return { estado: 201, cuerpo: { movimiento: EGRESO, caja: estado.caja } };
    },
    [`POST /api/cajas/${ID_CAJA}/cierre`]: () => {
      estado.caja = CERRADA;
      return { estado: 200, cuerpo: { caja: estado.caja } };
    },
    [`POST /api/cajas/${ID_CAJA}/reapertura`]: () => {
      estado.caja = caja({ ...CON_EGRESO, cierres: [cierreFaltante({ reapertura: REAPERTURA })] });
      return { estado: 200, cuerpo: { caja: estado.caja } };
    },
    ...extra,
  });
  return { api, estado };
}

const REAPERTURA = {
  reabiertaPor: { id: ID_YO, nombres: 'Rosa', apellidos: 'Quispe Mamani' },
  reabiertaEn: '2026-11-22T23:30:00.000Z',
  motivo: 'Faltaba registrar un cobro',
};

function diferido() {
  let resolver: () => void = () => undefined;
  const promesa = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

const estaPagina = () => screen.findByRole('heading', { level: 1, name: 'Caja del día' });

describe('inicio del panel (criterio 37)', () => {
  it.each(['ADMIN', 'SECRETARIA'] as const)('%s ve "Caja", que lleva a /panel/caja', async (rol) => {
    simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
    mostrar('/panel');
    const enlace = await screen.findByRole('link', { name: /^Caja/ });
    expect(enlace).toHaveAttribute('href', '/panel/caja');
  });

  it.each(['ENTRENADOR', 'ALUMNO'] as const)('%s no ve "Caja"', async (rol) => {
    simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
    mostrar('/panel');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Caja/ })).not.toBeInTheDocument();
  });

  it('desde el inicio se llega a la caja', async () => {
    servidor(null);
    mostrar('/panel');
    await userEvent.setup().click(await screen.findByRole('link', { name: /^Caja/ }));
    expect(await estaPagina()).toBeInTheDocument();
  });
});

describe('/panel/caja: permiso (criterio 37)', () => {
  it.each(['ENTRENADOR', 'ALUMNO'] as const)('%s ve "sin permiso" y no se pide la caja', async (rol) => {
    const api = simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
    mostrar('/panel/caja');
    expect(await screen.findByText('No tienes permiso para ver esta página')).toBeInTheDocument();
    expect(api.mock.calls.filter(([url]) => String(url).startsWith('/api/cajas'))).toHaveLength(0);
  });
});

describe('/panel/caja: sin caja, apertura (criterio 38 a)', () => {
  it('muestra el formulario "Abrir caja" con su ayuda y ningún otro botón de la caja', async () => {
    servidor(null);
    mostrar('/panel/caja');
    const formulario = await screen.findByRole('region', { name: 'Abrir caja' });
    expect(within(formulario).getByLabelText('Monto inicial (S/)')).toBeInTheDocument();
    expect(within(formulario).getByText(/El efectivo con el que empiezas el día/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar caja' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar egreso' })).not.toBeInTheDocument();
  });

  it('un monto inválido se explica junto al campo y no se envía', async () => {
    const { api } = servidor(null);
    mostrar('/panel/caja');
    const usuario = userEvent.setup();
    const campo = await screen.findByLabelText('Monto inicial (S/)');
    await usuario.click(screen.getByRole('button', { name: 'Abrir caja' }));
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    await usuario.clear(campo);
    await usuario.type(campo, '150,50');
    await usuario.click(screen.getByRole('button', { name: 'Abrir caja' }));
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(api, 'POST /api/cajas')).toHaveLength(0);
  });

  it('abre la caja con el monto como texto y una clave de idempotencia, y muestra la caja abierta', async () => {
    const { api } = servidor(null);
    mostrar('/panel/caja');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Monto inicial (S/)'), '100');
    await usuario.click(screen.getByRole('button', { name: 'Abrir caja' }));

    expect(await screen.findByText('Caja abierta con S/ 100.00.')).toBeInTheDocument();
    const [cuerpo] = llamadas(api, 'POST /api/cajas') as { claveIdempotencia: string; montoInicial: string }[];
    expect(cuerpo?.montoInicial).toBe('100');
    expect(cuerpo?.claveIdempotencia).toMatch(UUID);
    expect(Object.keys(cuerpo ?? {}).sort()).toEqual(['claveIdempotencia', 'montoInicial']);
    expect(screen.getByRole('button', { name: 'Registrar egreso' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar caja' })).toBeInTheDocument();
  });

  it('el cero es un monto inicial válido (DR-6)', async () => {
    const { api } = servidor(null);
    mostrar('/panel/caja');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Monto inicial (S/)'), '0');
    await usuario.click(screen.getByRole('button', { name: 'Abrir caja' }));
    await screen.findByText('Caja abierta con S/ 0.00.');
    expect(llamadas(api, 'POST /api/cajas')).toHaveLength(1);
  });

  it('mientras guarda, el campo y el botón quedan desactivados y un segundo clic no envía otra apertura', async () => {
    const espera = diferido();
    const { api } = servidor(null, 'SECRETARIA', {
      'POST /api/cajas': async () => {
        await espera.promesa;
        return { estado: 201, cuerpo: { caja: caja() } };
      },
    });
    mostrar('/panel/caja');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Monto inicial (S/)'), '100');
    await usuario.click(screen.getByRole('button', { name: 'Abrir caja' }));
    const boton = await screen.findByRole('button', { name: 'Abriendo…' });
    expect(boton).toBeDisabled();
    expect(screen.getByLabelText('Monto inicial (S/)')).toBeDisabled();
    await usuario.click(boton);
    espera.resolver();
    await screen.findByText('Caja abierta con S/ 100.00.');
    expect(llamadas(api, 'POST /api/cajas')).toHaveLength(1);
  });

  it('si la caja ya estaba abierta (409), avisa y muestra la caja que hay', async () => {
    let abierta = false;
    servidor(null, 'SECRETARIA', {
      'GET /api/cajas/actual': () => ({ estado: 200, cuerpo: { caja: abierta ? caja() : null } }),
      'POST /api/cajas': () => {
        abierta = true;
        return error('CAJA_YA_ABIERTA', 409, { cajaId: ID_CAJA, fecha: '2026-11-22' });
      },
    });
    mostrar('/panel/caja');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Monto inicial (S/)'), '100');
    await usuario.click(screen.getByRole('button', { name: 'Abrir caja' }));
    expect(await screen.findByText('Ya hay una caja abierta. Actualizamos la pantalla.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Cerrar caja' })).toBeInTheDocument();
  });

  it('una caja de ayer sin cerrar impide abrir la de hoy y se explica con su fecha (409)', async () => {
    let pendiente = false;
    servidor(null, 'SECRETARIA', {
      'GET /api/cajas/actual': () => ({ estado: 200, cuerpo: { caja: pendiente ? DE_OTRO_DIA : null } }),
      'POST /api/cajas': () => {
        pendiente = true;
        return error('CAJA_PENDIENTE_DE_CIERRE', 409, { cajaId: ID_OTRA, fecha: '2026-11-20' });
      },
    });
    mostrar('/panel/caja');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Monto inicial (S/)'), '100');
    await usuario.click(screen.getByRole('button', { name: 'Abrir caja' }));
    expect(
      await screen.findAllByText('La caja del 20/11/2026 sigue abierta. Ciérrala antes de abrir la de hoy.', {
        exact: false,
      }),
    ).not.toHaveLength(0);
    expect(await screen.findByRole('button', { name: 'Cerrar caja' })).toBeInTheDocument();
  });
});

describe('/panel/caja: caja abierta de hoy (criterio 38 b)', () => {
  it('muestra la fecha, quién la abrió y a qué hora (Lima), el monto inicial y el resumen por método', async () => {
    servidor(CON_MOVIMIENTOS);
    mostrar('/panel/caja');
    const resumen = await screen.findByRole('region', { name: 'Resumen de la caja' });
    expect(within(resumen).getByText('Caja del 22/11/2026')).toBeInTheDocument();
    expect(within(resumen).getByText('Abierta por Lucía Benites Rojas a las 08:30')).toBeInTheDocument();
    expect(within(resumen).getByText('Abierta')).toBeInTheDocument();
    const efectivo = within(resumen).getByRole('heading', { name: 'Efectivo esperado' }).closest('li');
    expect(efectivo).not.toBeNull();
    expect(within(efectivo as HTMLElement).getByText('S/ 126.50')).toBeInTheDocument();
    expect(within(efectivo as HTMLElement).getByText('S/ 100.00')).toBeInTheDocument();
    expect(within(efectivo as HTMLElement).getByText('S/ 42.00')).toBeInTheDocument();
    expect(within(efectivo as HTMLElement).getByText('S/ 15.50')).toBeInTheDocument();
    const yape = within(resumen).getByRole('heading', { name: 'Yape esperado' }).closest('li');
    expect(within(yape as HTMLElement).getAllByText('S/ 88.00')).toHaveLength(2);
    const transferencia = within(resumen).getByRole('heading', { name: 'Transferencia esperada' }).closest('li');
    expect(within(transferencia as HTMLElement).getAllByText('S/ 120.00')).toHaveLength(2);
    expect(within(resumen).getByText(/no suman al efectivo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar egreso' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar caja' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reabrir caja' })).not.toBeInTheDocument();
  });

  it('lista los movimientos con la hora, el concepto o la descripción, el método, el alumno y el monto', async () => {
    servidor(CON_MOVIMIENTOS);
    mostrar('/panel/caja');
    const lista = await screen.findByRole('list', { name: 'Movimientos' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(4);
    expect(within(filas[0] as HTMLElement).getByText('Mensualidad: Valeria Pinto Soto')).toBeInTheDocument();
    expect(within(filas[0] as HTMLElement).getByText(/08:45/)).toBeInTheDocument();
    expect(within(filas[0] as HTMLElement).getByText('Efectivo')).toBeInTheDocument();
    expect(within(filas[0] as HTMLElement).getByText('S/ 42.00')).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText('Inscripción: Valeria Pinto Soto')).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText('Yape')).toBeInTheDocument();
    expect(within(filas[2] as HTMLElement).getByText('Clase particular: Valeria Pinto Soto')).toBeInTheDocument();
    expect(within(filas[2] as HTMLElement).getByText('Transferencia')).toBeInTheDocument();
    const egreso = filas[3] as HTMLElement;
    expect(within(egreso).getByText('Egreso: Compra de tizas')).toBeInTheDocument();
    expect(within(egreso).getByText(/09:15/)).toBeInTheDocument();
    expect(within(egreso).getByText(/Comprobante: Boleta B001-123/)).toBeInTheDocument();
    expect(within(egreso).getByText('S/ 15.50')).toBeInTheDocument();
    expect(within(egreso).getByText('Egreso de', { exact: false })).toBeInTheDocument();
    // Nunca se muestra un DNI.
    expect(lista.textContent).not.toMatch(/dni/i);
  });

  it('sin movimientos, lo dice', async () => {
    servidor(caja());
    mostrar('/panel/caja');
    expect(await screen.findByText('Todavía no hay movimientos en esta caja.')).toBeInTheDocument();
  });

  it('las consultas llevan la academia y la identidad de la sesión (criterio 28 de 003)', async () => {
    servidor(caja());
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={['/panel/caja']}>
          <Rutas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Cerrar caja' });
    expect(
      cliente
        .getQueryCache()
        .findAll({ queryKey: ['caja-actual'] })
        .map((q) => q.queryKey),
    ).toEqual([['caja-actual', 'delfines', ID_YO]]);
  });

  it('si la caja no carga, ofrece reintentar', async () => {
    let intentos = 0;
    servidor(caja(), 'SECRETARIA', {
      'GET /api/cajas/actual': () =>
        ++intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: { caja: caja() } },
    });
    mostrar('/panel/caja');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la caja.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'Cerrar caja' })).toBeInTheDocument();
  });
});

describe('/panel/caja: caja abierta de otro día (criterio 38 c)', () => {
  it('avisa que sigue abierta, ofrece "Cerrar caja" y no ofrece "Registrar egreso"', async () => {
    servidor(DE_OTRO_DIA);
    mostrar('/panel/caja');
    expect(
      await screen.findByText(/La caja del 20\/11\/2026 sigue abierta\. Ciérrala antes de abrir la de hoy\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar caja' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar egreso' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Abrir caja' })).not.toBeInTheDocument();
  });
});

describe('/panel/caja: caja de hoy cerrada (criterio 38 d)', () => {
  it('muestra el resultado del cierre con su diferencia en palabras y su observación', async () => {
    servidor(CERRADA);
    mostrar('/panel/caja');
    const resultado = await screen.findByRole('region', { name: 'Resultado del cierre' });
    expect(within(resultado).getByText('Faltante')).toBeInTheDocument();
    expect(within(resultado).getByText('Faltante de S/ 4.50')).toBeInTheDocument();
    expect(within(resultado).getByText('S/ 84.50')).toBeInTheDocument();
    expect(within(resultado).getByText('S/ 80.00')).toBeInTheDocument();
    expect(within(resultado).getByText('Faltó el vuelto de la compra')).toBeInTheDocument();
    expect(within(resultado).getByText(/Lucía Benites Rojas, 22\/11\/2026 18:05/)).toBeInTheDocument();
    expect(within(resultado).queryByText('Cierre tardío')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar caja' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar egreso' })).not.toBeInTheDocument();
  });

  it('el cierre tardío y el que cuadra se marcan', async () => {
    servidor(
      caja({
        estado: 'CERRADA',
        cierres: [cierreFaltante({ tardio: true, diferencia: CERO, resultado: 'CUADRA', montoDeclarado: '84.50' })],
      }),
    );
    mostrar('/panel/caja');
    const resultado = await screen.findByRole('region', { name: 'Resultado del cierre' });
    expect(within(resultado).getByText('Cierre tardío')).toBeInTheDocument();
    expect(within(resultado).getAllByText('Cuadra')).not.toHaveLength(0);
  });

  it('la secretaria no puede reabrir: se le dice que pida al administrador', async () => {
    servidor(CERRADA, 'SECRETARIA');
    mostrar('/panel/caja');
    await screen.findByRole('region', { name: 'Resultado del cierre' });
    expect(screen.queryByRole('button', { name: 'Reabrir caja' })).not.toBeInTheDocument();
    expect(screen.getByText(/pide al administrador que la reabra/)).toBeInTheDocument();
  });

  it('el administrador ve "Reabrir caja"', async () => {
    servidor(CERRADA, 'ADMIN');
    mostrar('/panel/caja');
    expect(await screen.findByRole('button', { name: 'Reabrir caja' })).toBeInTheDocument();
  });

  it('un cierre anterior reabierto se ve con quién lo reabrió y el motivo', async () => {
    servidor(
      caja({
        estado: 'CERRADA',
        cierres: [
          cierreFaltante({ reapertura: REAPERTURA }),
          cierreFaltante({ numero: 2, diferencia: CERO, resultado: 'CUADRA', montoDeclarado: '84.50' }),
        ],
      }),
    );
    mostrar('/panel/caja');
    const resultado = await screen.findByRole('region', { name: 'Resultado del cierre' });
    expect(within(resultado).getByText(/Cierre 1: Faltante de S\/ 4\.50/)).toHaveTextContent(
      'Reabierto por Rosa Quispe Mamani el 22/11/2026 18:30: Faltaba registrar un cobro',
    );
  });
});

describe('/panel/caja: registrar un egreso (criterios 17 a 22)', () => {
  async function abrirEgreso() {
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Registrar egreso' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Registrar egreso' });
    return { usuario, dialogo };
  }

  it('muestra el efectivo disponible y valida con el esquema compartido sin enviar nada', async () => {
    const { api } = servidor(caja());
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirEgreso();
    expect(within(dialogo).getByText('S/ 100.00')).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar egreso' }));
    expect(within(dialogo).getByLabelText('Descripción')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialogo).getByLabelText('Monto (S/)')).toHaveAttribute('aria-invalid', 'true');

    await usuario.type(within(dialogo).getByLabelText('Descripción'), 'Compra de tizas');
    await usuario.type(within(dialogo).getByLabelText('Monto (S/)'), '0');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar egreso' }));
    expect(within(dialogo).getByLabelText('Monto (S/)')).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(api, `POST /api/cajas/${ID_CAJA}/egresos`)).toHaveLength(0);
  });

  it('registra el egreso con el monto como texto, cierra el diálogo, avisa y actualiza la lista', async () => {
    const { api } = servidor(caja());
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirEgreso();
    await usuario.type(within(dialogo).getByLabelText('Descripción'), '  Compra de tizas ');
    await usuario.type(within(dialogo).getByLabelText('Monto (S/)'), '15.50');
    await usuario.type(within(dialogo).getByLabelText('Comprobante (opcional)'), 'Boleta B001-123');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar egreso' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Egreso registrado: S/ 15.50.')).toBeInTheDocument();
    const [cuerpo] = llamadas(api, `POST /api/cajas/${ID_CAJA}/egresos`) as Record<string, unknown>[];
    expect(cuerpo).toMatchObject({ descripcion: 'Compra de tizas', monto: '15.50', comprobante: 'Boleta B001-123' });
    expect(cuerpo?.['claveIdempotencia']).toMatch(UUID);
    // Nunca viaja el método, el concepto ni el tipo: los fija la API (DR-3).
    expect(Object.keys(cuerpo ?? {}).sort()).toEqual(['claveIdempotencia', 'comprobante', 'descripcion', 'monto']);
    expect(await screen.findByText('Egreso: Compra de tizas')).toBeInTheDocument();
    expect(screen.getByText('S/ 84.50')).toBeInTheDocument();
  });

  it('el comprobante vacío se envía como nulo', async () => {
    const { api } = servidor(caja());
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirEgreso();
    await usuario.type(within(dialogo).getByLabelText('Descripción'), 'Compra de tizas');
    await usuario.type(within(dialogo).getByLabelText('Monto (S/)'), '15.5');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar egreso' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, `POST /api/cajas/${ID_CAJA}/egresos`)[0]).toMatchObject({ comprobante: null, monto: '15.5' });
  });

  it('un egreso mayor que el efectivo (409) muestra el disponible, deja el diálogo abierto y reutiliza la clave al reintentar', async () => {
    let intentos = 0;
    const { api } = servidor(caja(), 'SECRETARIA', {
      [`POST /api/cajas/${ID_CAJA}/egresos`]: () =>
        ++intentos === 1
          ? error('EFECTIVO_INSUFICIENTE', 409, { disponible: '100.00' })
          : { estado: 201, cuerpo: { movimiento: EGRESO, caja: CON_EGRESO } },
    });
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirEgreso();
    await usuario.type(within(dialogo).getByLabelText('Descripción'), 'Compra grande');
    await usuario.type(within(dialogo).getByLabelText('Monto (S/)'), '100.01');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar egreso' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'No hay tanto efectivo en la caja: solo hay S/ 100.00.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const monto = within(dialogo).getByLabelText('Monto (S/)');
    await usuario.clear(monto);
    await usuario.type(monto, '50');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar egreso' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const [primero, segundo] = llamadas(api, `POST /api/cajas/${ID_CAJA}/egresos`) as { claveIdempotencia: string }[];
    expect(primero?.claveIdempotencia).toMatch(UUID);
    expect(segundo?.claveIdempotencia).toBe(primero?.claveIdempotencia);
  });

  it('un diálogo nuevo usa una clave nueva', async () => {
    const { api } = servidor(caja(), 'SECRETARIA', {
      [`POST /api/cajas/${ID_CAJA}/egresos`]: () => error('EFECTIVO_INSUFICIENTE', 409, { disponible: '100.00' }),
    });
    mostrar('/panel/caja');
    const claves: string[] = [];
    for (let vez = 0; vez < 2; vez += 1) {
      const { usuario, dialogo } = await abrirEgreso();
      await usuario.type(within(dialogo).getByLabelText('Descripción'), 'Compra de tizas');
      await usuario.type(within(dialogo).getByLabelText('Monto (S/)'), '150');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar egreso' }));
      await within(dialogo).findByRole('alert');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Volver' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
    for (const cuerpo of llamadas(api, `POST /api/cajas/${ID_CAJA}/egresos`) as { claveIdempotencia: string }[]) {
      claves.push(cuerpo.claveIdempotencia);
    }
    expect(claves).toHaveLength(2);
    expect(claves[0]).not.toBe(claves[1]);
  });

  it('mientras guarda, los campos y los botones quedan desactivados y un segundo clic no envía otro egreso', async () => {
    const espera = diferido();
    const { api } = servidor(caja(), 'SECRETARIA', {
      [`POST /api/cajas/${ID_CAJA}/egresos`]: async () => {
        await espera.promesa;
        return { estado: 201, cuerpo: { movimiento: EGRESO, caja: CON_EGRESO } };
      },
    });
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirEgreso();
    await usuario.type(within(dialogo).getByLabelText('Descripción'), 'Compra de tizas');
    await usuario.type(within(dialogo).getByLabelText('Monto (S/)'), '15.50');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar egreso' }));
    const boton = await within(dialogo).findByRole('button', { name: 'Registrando…' });
    expect(boton).toBeDisabled();
    expect(within(dialogo).getByLabelText('Descripción')).toBeDisabled();
    expect(within(dialogo).getByLabelText('Monto (S/)')).toBeDisabled();
    expect(within(dialogo).getByRole('button', { name: 'Volver' })).toBeDisabled();
    await usuario.click(boton);
    espera.resolver();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, `POST /api/cajas/${ID_CAJA}/egresos`)).toHaveLength(1);
  });

  it('si otra persona cerró la caja mientras tanto (409 CAJA_CERRADA), cierra el diálogo, avisa y muestra el cierre', async () => {
    let cerrada = false;
    servidor(caja(), 'SECRETARIA', {
      'GET /api/cajas/actual': () => ({ estado: 200, cuerpo: { caja: cerrada ? CERRADA : caja() } }),
      [`POST /api/cajas/${ID_CAJA}/egresos`]: () => {
        cerrada = true;
        return error('CAJA_CERRADA', 409);
      },
    });
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirEgreso();
    await usuario.type(within(dialogo).getByLabelText('Descripción'), 'Compra de tizas');
    await usuario.type(within(dialogo).getByLabelText('Monto (S/)'), '5');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar egreso' }));
    expect(
      await screen.findByText('La caja ya está cerrada y no admite movimientos. Pide al administrador que la reabra.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Resultado del cierre' })).toBeInTheDocument();
  });

  it('un 400 del servidor se muestra junto al campo', async () => {
    servidor(caja(), 'SECRETARIA', {
      [`POST /api/cajas/${ID_CAJA}/egresos`]: () =>
        error('SOLICITUD_INVALIDA', 400, { errores: [{ campo: 'comprobante', mensaje: 'Comprobante no válido.' }] }),
    });
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirEgreso();
    await usuario.type(within(dialogo).getByLabelText('Descripción'), 'Compra de tizas');
    await usuario.type(within(dialogo).getByLabelText('Monto (S/)'), '5');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar egreso' }));
    expect(await within(dialogo).findByText('Comprobante no válido.')).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Comprobante (opcional)')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('/panel/caja: cerrar la caja (criterios 29 a 34 y 38)', () => {
  async function abrirCierre() {
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Cerrar caja' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Cerrar caja' });
    return { usuario, dialogo };
  }

  it('muestra el esperado por método antes de contar (conteo no ciego)', async () => {
    servidor(CON_MOVIMIENTOS);
    mostrar('/panel/caja');
    const { dialogo } = await abrirCierre();
    expect(within(dialogo).getByText('S/ 126.50')).toBeInTheDocument();
    expect(
      within(dialogo).getByText(/Yape esperado: S\/ 88\.00\. Transferencia esperada: S\/ 120\.00\./),
    ).toBeInTheDocument();
    expect(within(dialogo).getByText(/No suman al efectivo/)).toBeInTheDocument();
    // Todavía no hay conteo: tampoco hay diferencia.
    expect(within(dialogo).queryByText(/^Diferencia:/)).not.toBeInTheDocument();
  });

  it('muestra la diferencia mientras se escribe, en céntimos y con palabras', async () => {
    servidor(CON_EGRESO);
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirCierre();
    const contado = within(dialogo).getByLabelText('Efectivo contado (S/)');
    await usuario.type(contado, '80');
    expect(within(dialogo).getByText('Diferencia: Faltante de S/ 4.50')).toBeInTheDocument();
    await usuario.clear(contado);
    await usuario.type(contado, '84.5');
    expect(within(dialogo).getByText('Diferencia: Cuadra')).toBeInTheDocument();
    await usuario.clear(contado);
    await usuario.type(contado, '84.51');
    expect(within(dialogo).getByText('Diferencia: Sobrante de S/ 0.01')).toBeInTheDocument();
    await usuario.clear(contado);
    await usuario.type(contado, '84.49');
    expect(within(dialogo).getByText('Diferencia: Faltante de S/ 0.01')).toBeInTheDocument();
    // Lo que no es un monto no inventa una diferencia.
    await usuario.clear(contado);
    await usuario.type(contado, '84,5');
    expect(within(dialogo).queryByText(/^Diferencia:/)).not.toBeInTheDocument();
  });

  it('con diferencia exige la observación y no envía nada sin ella; con cuadre, la observación es opcional', async () => {
    const { api } = servidor(CON_EGRESO);
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirCierre();
    await usuario.type(within(dialogo).getByLabelText('Efectivo contado (S/)'), '80');
    expect(within(dialogo).getByLabelText('Observación (obligatoria)')).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar caja' }));
    expect(within(dialogo).getByText('Explica la diferencia (sobrante o faltante)')).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Observación (obligatoria)')).toHaveAttribute('aria-invalid', 'true');
    // Solo espacios tampoco explica nada.
    await usuario.type(within(dialogo).getByLabelText('Observación (obligatoria)'), '   ');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar caja' }));
    expect(within(dialogo).getByText('Explica la diferencia (sobrante o faltante)')).toBeInTheDocument();
    expect(llamadas(api, `POST /api/cajas/${ID_CAJA}/cierre`)).toHaveLength(0);

    const contado = within(dialogo).getByLabelText('Efectivo contado (S/)');
    await usuario.clear(contado);
    await usuario.type(contado, '84.50');
    expect(within(dialogo).getByLabelText('Observación (opcional)')).toBeInTheDocument();
  });

  it('cierra con faltante: envía el conteo como texto, el último movimiento visto y la observación, y muestra el resultado', async () => {
    const { api } = servidor(CON_EGRESO);
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirCierre();
    await usuario.type(within(dialogo).getByLabelText('Efectivo contado (S/)'), '80');
    await usuario.type(within(dialogo).getByLabelText('Observación (obligatoria)'), '  Faltó el vuelto de la compra ');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar caja' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [cuerpo] = llamadas(api, `POST /api/cajas/${ID_CAJA}/cierre`) as Record<string, unknown>[];
    expect(cuerpo).toMatchObject({
      montoDeclarado: '80',
      ultimoMovimientoVisto: 1,
      observacion: 'Faltó el vuelto de la compra',
    });
    expect(cuerpo?.['claveIdempotencia']).toMatch(UUID);
    expect(await screen.findByText('Caja cerrada. Este es el resultado del cierre.')).toBeInTheDocument();
    const resultado = await screen.findByRole('region', { name: 'Resultado del cierre' });
    expect(within(resultado).getByText('Faltante de S/ 4.50')).toBeInTheDocument();
    expect(within(resultado).getByText('Faltó el vuelto de la compra')).toBeInTheDocument();
  });

  it('cuadrado y sin observación: no envía el campo observación', async () => {
    const { api } = servidor(CON_EGRESO);
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirCierre();
    await usuario.type(within(dialogo).getByLabelText('Efectivo contado (S/)'), '84.50');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar caja' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [cuerpo] = llamadas(api, `POST /api/cajas/${ID_CAJA}/cierre`) as Record<string, unknown>[];
    expect(Object.keys(cuerpo ?? {}).sort()).toEqual(['claveIdempotencia', 'montoDeclarado', 'ultimoMovimientoVisto']);
  });

  it('el cero es un conteo válido', async () => {
    const { api } = servidor(caja());
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirCierre();
    await usuario.type(within(dialogo).getByLabelText('Efectivo contado (S/)'), '0');
    expect(within(dialogo).getByText('Diferencia: Faltante de S/ 100.00')).toBeInTheDocument();
    await usuario.type(within(dialogo).getByLabelText('Observación (obligatoria)'), 'Se llevaron todo el efectivo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar caja' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, `POST /api/cajas/${ID_CAJA}/cierre`)[0]).toMatchObject({
      montoDeclarado: '0',
      ultimoMovimientoVisto: 0,
    });
  });

  it('si entró un movimiento (409 CAJA_CAMBIO), avisa, muestra el esperado nuevo y reintenta con la misma clave y el último movimiento nuevo', async () => {
    let intentos = 0;
    const { estado, api } = servidor(CON_EGRESO, 'SECRETARIA', {
      [`POST /api/cajas/${ID_CAJA}/cierre`]: () => {
        intentos += 1;
        if (intentos === 1) {
          // Entró un cobro en efectivo de S/ 10.00 después de que se cargó la pantalla.
          estado.caja = caja({
            resumen: resumen({
              ingresos: { efectivo: '10.00', yape: CERO, transferencia: CERO },
              egresos: { efectivo: '15.50' },
              esperado: { efectivo: '94.50', yape: CERO, transferencia: CERO },
              ultimoMovimiento: 2,
            }),
            movimientos: [EGRESO],
          });
          return error('CAJA_CAMBIO', 409, { ultimoMovimiento: 2 });
        }
        estado.caja = CERRADA;
        return { estado: 200, cuerpo: { caja: CERRADA } };
      },
    });
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirCierre();
    expect(within(dialogo).getByText('S/ 84.50')).toBeInTheDocument();
    await usuario.type(within(dialogo).getByLabelText('Efectivo contado (S/)'), '84.50');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar caja' }));

    expect(await within(dialogo).findByText('Entró un movimiento nuevo: revisa el conteo.')).toBeInTheDocument();
    expect(await within(dialogo).findByText('S/ 94.50')).toBeInTheDocument();
    // El conteo sigue escrito y la diferencia se recalcula contra el esperado nuevo.
    expect(within(dialogo).getByLabelText('Efectivo contado (S/)')).toHaveValue('84.50');
    expect(await within(dialogo).findByText('Diferencia: Faltante de S/ 10.00')).toBeInTheDocument();

    const contado = within(dialogo).getByLabelText('Efectivo contado (S/)');
    await usuario.clear(contado);
    await usuario.type(contado, '94.50');
    await waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Cerrar caja' })).toBeEnabled());
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar caja' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const [primero, segundo] = llamadas(api, `POST /api/cajas/${ID_CAJA}/cierre`) as {
      claveIdempotencia: string;
      ultimoMovimientoVisto: number;
    }[];
    expect(primero?.ultimoMovimientoVisto).toBe(1);
    expect(segundo?.ultimoMovimientoVisto).toBe(2);
    expect(segundo?.claveIdempotencia).toBe(primero?.claveIdempotencia);
  });

  it('una caja de otro día se cierra igual', async () => {
    const { api, estado } = servidor(DE_OTRO_DIA, 'SECRETARIA', {
      [`POST /api/cajas/${ID_OTRA}/cierre`]: () => {
        estado.caja = caja({
          id: ID_OTRA,
          fecha: '2026-11-20',
          estado: 'CERRADA',
          cierres: [cierreFaltante({ tardio: true })],
        });
        return { estado: 200, cuerpo: { caja: estado.caja } };
      },
    });
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirCierre();
    await usuario.type(within(dialogo).getByLabelText('Efectivo contado (S/)'), '100');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar caja' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, `POST /api/cajas/${ID_OTRA}/cierre`)).toHaveLength(1);
    expect(await screen.findByText('Cierre tardío')).toBeInTheDocument();
  });

  it('mientras guarda, los campos y los botones quedan desactivados y un segundo clic no envía otro cierre', async () => {
    const espera = diferido();
    const { api } = servidor(CON_EGRESO, 'SECRETARIA', {
      [`POST /api/cajas/${ID_CAJA}/cierre`]: async () => {
        await espera.promesa;
        return { estado: 200, cuerpo: { caja: CERRADA } };
      },
    });
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirCierre();
    await usuario.type(within(dialogo).getByLabelText('Efectivo contado (S/)'), '84.50');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar caja' }));
    const boton = await within(dialogo).findByRole('button', { name: 'Cerrando…' });
    expect(boton).toBeDisabled();
    expect(within(dialogo).getByLabelText('Efectivo contado (S/)')).toBeDisabled();
    expect(within(dialogo).getByRole('button', { name: 'Volver' })).toBeDisabled();
    await usuario.click(boton);
    espera.resolver();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, `POST /api/cajas/${ID_CAJA}/cierre`)).toHaveLength(1);
  });
});

describe('/panel/caja: reabrir la caja, solo el administrador (criterios 35 y 36)', () => {
  async function abrirReapertura() {
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir caja' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Reabrir caja' });
    return { usuario, dialogo };
  }

  it('el motivo es obligatorio y no se envía nada sin él', async () => {
    const { api } = servidor(CERRADA, 'ADMIN');
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirReapertura();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir caja' }));
    expect(within(dialogo).getByLabelText('Motivo de la reapertura')).toHaveAttribute('aria-invalid', 'true');
    await usuario.type(within(dialogo).getByLabelText('Motivo de la reapertura'), 'ab');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir caja' }));
    expect(within(dialogo).getByRole('alert')).toBeInTheDocument();
    expect(llamadas(api, `POST /api/cajas/${ID_CAJA}/reapertura`)).toHaveLength(0);
  });

  it('reabre con el motivo, cierra el diálogo, avisa y vuelve a admitir egresos', async () => {
    const { api } = servidor(CERRADA, 'ADMIN');
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirReapertura();
    await usuario.type(within(dialogo).getByLabelText('Motivo de la reapertura'), '  Faltaba registrar un cobro ');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir caja' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, `POST /api/cajas/${ID_CAJA}/reapertura`)).toEqual([{ motivo: 'Faltaba registrar un cobro' }]);
    expect(await screen.findByText('Caja reabierta. Ya admite egresos y cobros.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Registrar egreso' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar caja' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reabrir caja' })).not.toBeInTheDocument();
  });

  it('si hay otra caja abierta (409), lo explica con su fecha y cierra el diálogo', async () => {
    servidor(CERRADA, 'ADMIN', {
      [`POST /api/cajas/${ID_CAJA}/reapertura`]: () =>
        error('HAY_OTRA_CAJA_ABIERTA', 409, { cajaId: ID_OTRA, fecha: '2026-11-20' }),
    });
    mostrar('/panel/caja');
    const { usuario, dialogo } = await abrirReapertura();
    await usuario.type(within(dialogo).getByLabelText('Motivo de la reapertura'), 'Faltaba registrar un cobro');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir caja' }));
    expect(
      await screen.findByText('Hay otra caja abierta, la del 20/11/2026. Ciérrala antes de reabrir esta.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('montos de la caja sin coma flotante (criterio 39)', () => {
  it('la diferencia se calcula en céntimos sobre el texto', () => {
    expect(diferenciaEnVivo('126.50', '126.50')).toBe('0.00');
    expect(diferenciaEnVivo('126.49', '126.50')).toBe('-0.01');
    expect(diferenciaEnVivo('126.50', '126.49')).toBe('0.01');
    expect(diferenciaEnVivo('0', '0.00')).toBe('0.00');
    expect(diferenciaEnVivo(' 0.3 ', '0.10')).toBe('0.20');
    expect(diferenciaEnVivo('80', '84.50')).toBe('-4.50');
  });

  it('un texto que no es un monto no tiene diferencia', () => {
    for (const texto of ['', ' ', '-1', '1e2', '84,5', '84.505', '100000', 'abc']) {
      expect(diferenciaEnVivo(texto, '84.50')).toBeNull();
    }
  });

  it('el resultado y la descripción salen del texto, sin signos sueltos ni "-0.00"', () => {
    expect(resultadoDeDiferencia('0.00')).toBe('CUADRA');
    expect(resultadoDeDiferencia('0.01')).toBe('SOBRANTE');
    expect(resultadoDeDiferencia('-0.01')).toBe('FALTANTE');
    expect(describirDiferencia('0.00')).toBe('Cuadra');
    expect(describirDiferencia('1200.00')).toBe('Sobrante de S/ 1,200.00');
    expect(describirDiferencia('-4.50')).toBe('Faltante de S/ 4.50');
  });
});
