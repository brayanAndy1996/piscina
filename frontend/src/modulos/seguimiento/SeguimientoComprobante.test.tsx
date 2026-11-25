import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archivoDePrueba, error, llamadas, mostrar, peticiones, simularApi, simularUrlLocal } from '../../pruebas-api';
import { datosDePagoParaCabecera } from './api';

// Spec 007b, criterios 28, 53 y 55: el seguimiento con los estados nuevos, los datos de pago de la academia y el formulario del comprobante
// (método, número de operación, monto, fecha de la operación e imagen) con su clave de idempotencia. La API se simula.

const TOKEN = 'dUg8U3s15Gr1QAQy0Rjl0cG5bd86JkGqUa__duZr1Ew';
const POST_CONSULTA = 'POST /api/a/delfines/solicitudes/consulta';
const PUT_COMPROBANTE = 'PUT /api/a/delfines/solicitudes/comprobante';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// 24/11/2026 10:00 en Lima; la solicitud se creó el 20/11.
const AHORA = new Date('2026-11-24T15:00:00.000Z');

const DATOS_DE_PAGO = {
  yapeNumero: '987654321',
  yapeTitular: 'Academia Los Delfines SAC',
  transferenciaBanco: 'Banco Pichincha',
  transferenciaCuenta: '191-1234567-0-12',
  transferenciaCci: '00219100123456701234',
  transferenciaTitular: 'Academia Los Delfines SAC',
};

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

const PENDIENTE = { ...BASE, estado: 'PENDIENTE_PAGO', reservaVenceEn: '2026-11-25T14:00:00.000Z', fotoCargada: true };
const EN_VERIFICACION = {
  ...BASE,
  estado: 'EN_VERIFICACION',
  fotoCargada: true,
  pago: { metodo: 'YAPE', monto: '88.00', fechaOperacion: '2026-11-24', enviadoEn: '2026-11-24T15:00:00.000Z' },
};
const RECHAZADA = {
  ...BASE,
  estado: 'PAGO_RECHAZADO',
  fotoCargada: true,
  rechazo: { motivo: 'La imagen no se lee', rechazadoEn: '2026-11-24T16:00:00.000Z' },
  pagableHasta: '2026-12-01T04:59:59.999Z',
};

function academia(datosDePago: unknown = DATOS_DE_PAGO) {
  return {
    nombre: 'Academia de Natación Los Delfines',
    telefono: '987654321',
    ...(datosDePago ? { datosDePago } : {}),
  };
}

function servidor(consultas: Record<string, unknown>[], extra: Parameters<typeof simularApi>[0] = {}) {
  let n = 0;
  return simularApi({
    'GET /api/a/delfines': () => ({
      estado: 200,
      cuerpo: { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines', telefono: '987654321' },
    }),
    [POST_CONSULTA]: () => {
      const solicitud = consultas[Math.min(n++, consultas.length - 1)];
      return {
        estado: 200,
        cuerpo: { solicitud, academia: academia(solicitud?.['estado'] === 'EN_VERIFICACION' ? null : undefined) },
      };
    },
    ...extra,
  });
}

function cabecera(opciones: RequestInit | undefined, nombre: string): string | undefined {
  return (opciones?.headers as Record<string, string> | undefined)?.[nombre];
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

const formulario = () => screen.findByRole('region', { name: 'Pagar con Yape o transferencia' });

async function llenar(usuario: ReturnType<typeof userEvent.setup>, numero = '0001-2345') {
  await usuario.type(screen.getByLabelText('Número de operación'), numero);
  await usuario.upload(
    screen.getByLabelText(/Imagen del comprobante/),
    archivoDePrueba('comprobante.png', 'image/png', 200),
  );
}

describe('seguimiento con comprobante: estados y datos de pago (criterios 28, 53 y 55)', () => {
  it('en PENDIENTE_PAGO muestra los datos de pago de la academia y el formulario con el total ya escrito', async () => {
    servidor([PENDIENTE]);
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const seccion = await formulario();
    const yape = within(seccion).getByRole('region', { name: 'Datos para pagar con Yape' });
    expect(within(yape).getByText('987654321')).toBeInTheDocument();
    expect(within(yape).getByText('Academia Los Delfines SAC')).toBeInTheDocument();
    const transferencia = within(seccion).getByRole('region', { name: 'Datos para pagar por transferencia' });
    expect(within(transferencia).getByText('Banco Pichincha')).toBeInTheDocument();
    expect(within(transferencia).getByText('191-1234567-0-12')).toBeInTheDocument();
    expect(within(transferencia).getByText('00219100123456701234')).toBeInTheDocument();
    expect(within(seccion).getByLabelText('Monto pagado (S/)')).toHaveValue('88.00');
    expect(within(seccion).getByLabelText('Método de pago')).toHaveValue('YAPE');
    // La fecha de la operación empieza hoy en Lima (24/11/2026) y no admite otra fuera del rango.
    const fecha = within(seccion).getByLabelText('Fecha de la operación');
    expect(fecha).toHaveValue('2026-11-24');
    expect(fecha).toHaveAttribute('min', '2026-11-20');
    expect(fecha).toHaveAttribute('max', '2026-11-24');
  });

  it('muestra solo los datos de pago que la academia tiene', async () => {
    simularApi({
      'GET /api/a/delfines': () => ({
        estado: 200,
        cuerpo: { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines', telefono: null },
      }),
      [POST_CONSULTA]: () => ({
        estado: 200,
        cuerpo: { solicitud: PENDIENTE, academia: { ...academia({ yapeNumero: '987654321' }), telefono: null } },
      }),
    });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const seccion = await formulario();
    expect(within(seccion).getByText('987654321')).toBeInTheDocument();
    expect(
      within(seccion).queryByRole('region', { name: 'Datos para pagar por transferencia' }),
    ).not.toBeInTheDocument();
  });

  it('en EN_VERIFICACION dice que se está revisando, muestra el comprobante enviado y no ofrece el formulario', async () => {
    servidor([EN_VERIFICACION]);
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(solicitud).getByText('Comprobante en revisión', { selector: 'span' })).toBeInTheDocument();
    expect(within(solicitud).getByText(/la academia lo está revisando/)).toBeInTheDocument();
    expect(
      within(solicitud).getByText(/Yape por S\/ 88\.00, operación del 24\/11\/2026, enviado el 24\/11\/2026 10:00/),
    ).toBeInTheDocument();
    expect(within(solicitud).queryByText('Reserva hasta')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pagar con Yape o transferencia' })).not.toBeInTheDocument();
  });

  it('en PAGO_RECHAZADO muestra el motivo, hasta cuándo se puede pagar, los datos de pago y el formulario', async () => {
    servidor([RECHAZADA]);
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(solicitud).getByText('Pago rechazado', { selector: 'span' })).toBeInTheDocument();
    expect(within(solicitud).getByText(/Motivo: La imagen no se lee/)).toBeInTheDocument();
    // El fin del mes de la matrícula en Lima: 30/11/2026.
    expect(within(solicitud).getByText(/hasta el 30\/11\/2026/)).toBeInTheDocument();
    const seccion = await formulario();
    expect(within(seccion).getByText('Banco Pichincha')).toBeInTheDocument();
    expect(within(seccion).getByLabelText('Número de operación')).toBeInTheDocument();
  });
});

describe('enviar el comprobante (criterios 36 a 42 y 55)', () => {
  it('manda la imagen con el token y los datos del pago en cabeceras, y pasa a EN_VERIFICACION', async () => {
    const api = servidor([PENDIENTE, EN_VERIFICACION], {
      [PUT_COMPROBANTE]: () => ({ estado: 201, cuerpo: { solicitud: EN_VERIFICACION } }),
    });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await formulario();
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await llenar(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Enviar comprobante' }));

    expect(await screen.findByText('Comprobante en revisión', { selector: 'span' })).toBeInTheDocument();
    const [envio] = peticiones(api, PUT_COMPROBANTE);
    expect(envio).toBeDefined();
    expect(cabecera(envio, 'X-Token-Solicitud')).toBe(TOKEN);
    expect(cabecera(envio, 'Content-Type')).toBe('image/png');
    const datos = JSON.parse(cabecera(envio, 'X-Pago-Datos') ?? '{}') as Record<string, string>;
    expect(datos).toEqual({
      claveIdempotencia: expect.stringMatching(UUID) as string,
      metodo: 'YAPE',
      numeroOperacion: '0001-2345',
      monto: '88.00',
      fechaOperacion: '2026-11-24',
    });
    for (const [url] of api.mock.calls) expect(String(url)).not.toContain(TOKEN);
    expect(screen.queryByRole('region', { name: 'Pagar con Yape o transferencia' })).not.toBeInTheDocument();
  });

  it('un doble clic envía un solo comprobante', async () => {
    let resolver: () => void = () => undefined;
    const espera = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    const api = servidor([PENDIENTE, EN_VERIFICACION], {
      [PUT_COMPROBANTE]: async () => {
        await espera;
        return { estado: 201, cuerpo: { solicitud: EN_VERIFICACION } };
      },
    });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await formulario();
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await llenar(usuario);
    const boton = screen.getByRole('button', { name: 'Enviar comprobante' });
    fireEvent.click(boton);
    fireEvent.click(boton);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled());
    resolver();
    await screen.findByText('Comprobante en revisión', { selector: 'span' });
    expect(peticiones(api, PUT_COMPROBANTE)).toHaveLength(1);
  });

  it('un reintento tras un fallo de red lleva la misma clave de idempotencia', async () => {
    let intentos = 0;
    const api = servidor([PENDIENTE, EN_VERIFICACION], {
      [PUT_COMPROBANTE]: () => {
        intentos += 1;
        return intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: { solicitud: EN_VERIFICACION } };
      },
    });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await formulario();
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await llenar(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Enviar comprobante' }));
    await usuario.click(await screen.findByRole('button', { name: 'Reintentar el envío' }));
    await screen.findByText('Comprobante en revisión', { selector: 'span' });
    const claves = peticiones(api, PUT_COMPROBANTE).map(
      (envio) =>
        (JSON.parse(cabecera(envio, 'X-Pago-Datos') ?? '{}') as { claveIdempotencia: string }).claveIdempotencia,
    );
    expect(claves).toHaveLength(2);
    expect(claves[0]).toMatch(UUID);
    expect(claves[1]).toBe(claves[0]);
  });

  it('sin imagen, sin número o con una fecha fuera de rango no envía nada y lo avisa en cada campo', async () => {
    const api = servidor([PENDIENTE]);
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await formulario();
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    fireEvent.change(screen.getByLabelText('Fecha de la operación'), { target: { value: '2026-11-25' } });
    await usuario.click(screen.getByRole('button', { name: 'Enviar comprobante' }));
    expect(await screen.findByText('Escribe el número de operación.')).toBeInTheDocument();
    expect(screen.getByText('La fecha de la operación no puede ser posterior a hoy.')).toBeInTheDocument();
    expect(screen.getByText('Elige la imagen del comprobante.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Fecha de la operación'), { target: { value: '2026-11-19' } });
    await usuario.click(screen.getByRole('button', { name: 'Enviar comprobante' }));
    expect(await screen.findByText(/no puede ser anterior al 20\/11\/2026/)).toBeInTheDocument();
    expect(llamadas(api, PUT_COMPROBANTE)).toHaveLength(0);
  });

  it('un monto distinto del total vuelve a mostrar el total y lo explica', async () => {
    servidor([PENDIENTE], {
      [PUT_COMPROBANTE]: () => error('MONTO_DISTINTO', 409, { total: '88.00' }),
    });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await formulario();
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await llenar(usuario);
    await usuario.clear(screen.getByLabelText('Monto pagado (S/)'));
    await usuario.type(screen.getByLabelText('Monto pagado (S/)'), '80');
    await usuario.click(screen.getByRole('button', { name: 'Enviar comprobante' }));
    expect(await screen.findByText(/debe ser igual al total a pagar: S\/ 88\.00/)).toBeInTheDocument();
    expect(screen.getByLabelText('Monto pagado (S/)')).toHaveValue('88.00');
  });

  it('un número de operación ya usado se avisa en su campo', async () => {
    servidor([PENDIENTE], { [PUT_COMPROBANTE]: () => error('NUMERO_OPERACION_YA_USADO', 409) });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await formulario();
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await llenar(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Enviar comprobante' }));
    const campo = await screen.findByLabelText('Número de operación');
    await waitFor(() => expect(campo).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText(/Ese número de operación ya se registró/)).toBeInTheDocument();
  });

  it('si la solicitud cambió (409 PAGO_EN_VERIFICACION), avisa y vuelve a consultarla', async () => {
    const api = servidor([PENDIENTE, EN_VERIFICACION], {
      [PUT_COMPROBANTE]: () => error('PAGO_EN_VERIFICACION', 409),
    });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await formulario();
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await llenar(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Enviar comprobante' }));
    expect(await screen.findByText(/Ya enviaste un comprobante y la academia lo está revisando/)).toBeInTheDocument();
    expect(await screen.findByText('Comprobante en revisión', { selector: 'span' })).toBeInTheDocument();
    expect(llamadas(api, POST_CONSULTA)).toHaveLength(2);
  });

  it('el JSON de la cabecera es ASCII aunque el número tenga dígitos de ancho completo', () => {
    const texto = datosDePagoParaCabecera({
      claveIdempotencia: '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70',
      metodo: 'TRANSFERENCIA',
      numeroOperacion: '１２３４５',
      monto: '88.00',
      fechaOperacion: '2026-11-24',
    });
    expect(texto).toMatch(/^[\x20-\x7e]*$/);
    expect(JSON.parse(texto)).toMatchObject({ numeroOperacion: '１２３４５' });
  });
});
