import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error, llamadas, type Manejador, mostrar, rutaActual, sesionDe, simularApi } from '../../pruebas-api';

// Spec 007a, criterios 11, 13 a 17 y 54: el panel de solicitudes con el total, el ajuste y el último pago; "Cobrar en efectivo" con el
// aviso de la caja, el monto mostrado, la clave de idempotencia y los 409; "Ajustar monto" (solo el administrador) y "Imprimir ticket".
// La API se simula; los criterios del servidor los prueban las pruebas de integración del backend.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const S1 = 'a1111111-1111-4111-8111-111111111111';
const S2 = 'a2222222-2222-4222-8222-222222222222';
const S3 = 'a3333333-3333-4333-8333-333333333333';
const PLAN = 'b1111111-1111-4111-8111-111111111111';
const CLASE = 'c1111111-1111-4111-8111-111111111111';
const PAGO = 'f1111111-1111-4111-8111-111111111111';
const ID_CAJA = 'c0000000-0000-4000-8000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// 24/11/2026 10:00 en Lima.
const AHORA = new Date('2026-11-24T15:00:00.000Z');

function solicitud(extra: Record<string, unknown> = {}) {
  return {
    id: S1,
    codigo: 'AQ-7F3K9X',
    estado: 'PENDIENTE_PAGO',
    creadaEn: '2026-11-24T14:00:00.000Z',
    reservaVenceEn: '2026-11-25T14:00:00.000Z',
    nombres: 'Lucía Fernanda',
    apellidos: 'Prado Quispe',
    dni: '45678912',
    telefono: '987654321',
    menorDeEdad: false,
    plan: { id: PLAN, nombre: 'Plan 3 veces' },
    clases: [{ id: CLASE, nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
    mes: '2026-11',
    clasesTotales: 5,
    monto: '88.00',
    ajuste: null,
    pago: null,
    ...extra,
  };
}

const ACTIVA = solicitud();

function pagoEfectivo(extra: Record<string, unknown> = {}) {
  return {
    id: PAGO,
    estado: 'CONFIRMADO',
    metodo: 'EFECTIVO',
    concepto: 'INSCRIPCION',
    monto: '88.00',
    registradoEn: '2026-11-24T15:00:00.000Z',
    verificadoEn: '2026-11-24T15:00:00.000Z',
    numeroOperacion: null,
    fechaOperacion: null,
    motivoRechazo: null,
    numeroTicket: 5,
    ...extra,
  };
}

const PAGO_DEL_PANEL = {
  id: PAGO,
  metodo: 'EFECTIVO',
  estado: 'CONFIRMADO',
  monto: '88.00',
  registradoEn: '2026-11-24T15:00:00.000Z',
  verificadoEn: '2026-11-24T15:00:00.000Z',
  numeroOperacion: null,
  fechaOperacion: null,
  motivoRechazo: null,
  numeroTicket: 5,
};

const CONFIRMADA = solicitud({ estado: 'CONFIRMADA', reservaVenceEn: null, pago: PAGO_DEL_PANEL });

function persona() {
  return { id: ID_YO, nombres: 'Rosa', apellidos: 'Quispe Mamani' };
}

function caja(extra: Record<string, unknown> = {}) {
  const cero = '0.00';
  return {
    id: ID_CAJA,
    fecha: '2026-11-24',
    estado: 'ABIERTA',
    deOtroDia: false,
    montoInicial: '100.00',
    abiertaPor: persona(),
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
  rol?: 'ADMIN' | 'SECRETARIA';
  caja?: unknown;
  solicitudes?: unknown[];
  extra?: Record<string, Manejador>;
}

/** Un servidor con la lista, la caja de hoy y, por defecto, un cobro que sale bien. */
function servidor({
  rol = 'SECRETARIA',
  caja: cajaActual = caja(),
  solicitudes = [ACTIVA],
  extra = {},
}: Opciones = {}) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol, { id: ID_YO }) }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    'GET /api/solicitudes?estado=ACTIVAS': () => ({ estado: 200, cuerpo: { solicitudes } }),
    'GET /api/solicitudes?estado=CONFIRMADAS': () => ({ estado: 200, cuerpo: { solicitudes: [CONFIRMADA] } }),
    'GET /api/cajas/actual': () => ({ estado: 200, cuerpo: { caja: cajaActual } }),
    [`POST /api/solicitudes/${S1}/pago-efectivo`]: () => ({
      estado: 201,
      cuerpo: { pago: pagoEfectivo(), solicitud: CONFIRMADA },
    }),
    ...extra,
  });
}

function diferido() {
  let resolver: () => void = () => undefined;
  const promesa = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

const tarjeta = (codigo: string) => screen.findByRole('article', { name: `Solicitud ${codigo}` });

async function abrirCobro() {
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole('button', { name: 'Cobrar en efectivo la solicitud AQ-7F3K9X' }));
  const dialogo = await screen.findByRole('dialog', { name: 'Cobrar en efectivo: AQ-7F3K9X' });
  return { usuario, dialogo };
}

describe('el panel de solicitudes con los pagos (criterio 54)', () => {
  it('muestra el ajuste y el último pago de cada solicitud', async () => {
    servidor({
      solicitudes: [
        solicitud({ monto: '35.00', ajuste: { montoCalculado: '88.00', motivo: 'Beca deportiva' } }),
        solicitud({
          id: S2,
          codigo: 'AQ-2B4C6D',
          estado: 'PAGO_RECHAZADO',
          reservaVenceEn: null,
          pago: {
            ...PAGO_DEL_PANEL,
            id: S3,
            metodo: 'YAPE',
            estado: 'RECHAZADO',
            verificadoEn: '2026-11-24T16:00:00.000Z',
            numeroOperacion: '12345',
            fechaOperacion: '2026-11-24',
            motivoRechazo: 'Foto ilegible',
            numeroTicket: null,
          },
        }),
      ],
    });
    mostrar('/panel/solicitudes');
    const primera = await tarjeta('AQ-7F3K9X');
    expect(within(primera).getByText('S/ 35.00')).toBeInTheDocument();
    expect(within(primera).getByText(/calculado: S\/ 88\.00/)).toBeInTheDocument();
    expect(within(primera).getByText(/Motivo: Beca deportiva/)).toBeInTheDocument();

    const rechazada = await tarjeta('AQ-2B4C6D');
    expect(within(rechazada).getByText('Pago rechazado', { selector: 'span' })).toBeInTheDocument();
    expect(within(rechazada).getByText(/Yape · Rechazado el 24\/11\/2026 11:00/)).toBeInTheDocument();
    expect(within(rechazada).getByText(/Operación 12345/)).toBeInTheDocument();
    expect(within(rechazada).getByText(/Motivo del rechazo: Foto ilegible/)).toBeInTheDocument();
    // En 007a solo se cobra lo pendiente de pago.
    expect(within(rechazada).queryByRole('button', { name: /Cobrar en efectivo/ })).not.toBeInTheDocument();
  });

  it('el filtro "Confirmadas" pide ?estado=CONFIRMADAS y muestra el ticket del pago', async () => {
    const api = servidor();
    mostrar('/panel/solicitudes');
    await tarjeta('AQ-7F3K9X');
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Confirmadas' }));
    const confirmada = await tarjeta('AQ-7F3K9X');
    expect(llamadas(api, 'GET /api/solicitudes?estado=CONFIRMADAS')).toHaveLength(1);
    expect(within(confirmada).getByText('Pago confirmado', { selector: 'span' })).toBeInTheDocument();
    expect(
      within(confirmada).getByText(/Efectivo · Confirmado el 24\/11\/2026 10:00 · Ticket N\.º 5/),
    ).toBeInTheDocument();
    // Una solicitud pagada ya no se cobra ni se cancela, pero sí se imprime su ticket.
    expect(within(confirmada).queryByRole('button', { name: /Cobrar en efectivo/ })).not.toBeInTheDocument();
    expect(within(confirmada).queryByRole('button', { name: /Cancelar/ })).not.toBeInTheDocument();
    expect(within(confirmada).getByRole('link', { name: /Imprimir el ticket/ })).toHaveAttribute(
      'href',
      `/panel/pagos/${PAGO}/ticket`,
    );
  });

  it('"Ajustar monto" solo lo ve el administrador', async () => {
    servidor({ rol: 'SECRETARIA' });
    mostrar('/panel/solicitudes');
    await tarjeta('AQ-7F3K9X');
    expect(screen.getByRole('button', { name: /Cobrar en efectivo/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ajustar el monto/ })).not.toBeInTheDocument();
  });

  it('el administrador ve "Ajustar monto" y "Cobrar en efectivo"', async () => {
    servidor({ rol: 'ADMIN' });
    mostrar('/panel/solicitudes');
    await tarjeta('AQ-7F3K9X');
    expect(screen.getByRole('button', { name: 'Ajustar el monto de la solicitud AQ-7F3K9X' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cobrar en efectivo/ })).toBeInTheDocument();
  });
});

describe('cobrar en efectivo (criterios 13, 14, 16, 17 y 54)', () => {
  it('muestra el total, envía el monto mostrado con una clave nueva y ofrece imprimir el ticket', async () => {
    const api = servidor();
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCobro();
    expect(within(dialogo).getByText('S/ 88.00')).toBeInTheDocument();
    const confirmar = await within(dialogo).findByRole('button', { name: 'Cobrar S/ 88.00' });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.click(confirmar);

    const resultado = await screen.findByRole('dialog', { name: 'Cobro registrado: AQ-7F3K9X' });
    expect(within(resultado).getByRole('status')).toHaveTextContent(
      'Se cobró S/ 88.00 en efectivo a Lucía Fernanda Prado Quispe.',
    );
    expect(within(resultado).getByRole('status')).toHaveTextContent('Ticket N.º 5');
    const cuerpos = llamadas(api, `POST /api/solicitudes/${S1}/pago-efectivo`) as {
      claveIdempotencia: string;
      montoMostrado: string;
    }[];
    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0]?.claveIdempotencia).toMatch(UUID);
    expect(Object.keys(cuerpos[0] ?? {}).sort()).toEqual(['claveIdempotencia', 'montoMostrado']);
    expect(cuerpos[0]?.montoMostrado).toBe('88.00');
    // La lista y la caja se vuelven a pedir: la solicitud ya no está pendiente y el efectivo cambió.
    await waitFor(() => expect(llamadas(api, 'GET /api/solicitudes?estado=ACTIVAS').length).toBeGreaterThan(1));

    await usuario.click(within(resultado).getByRole('link', { name: 'Imprimir ticket' }));
    expect(rutaActual()).toBe(`/panel/pagos/${PAGO}/ticket`);
  });

  it('sin la caja de hoy abierta avisa y no deja confirmar', async () => {
    const api = servidor({ caja: null });
    mostrar('/panel/solicitudes');
    const { dialogo } = await abrirCobro();
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Abre la caja antes de cobrar.');
    expect(within(dialogo).getByRole('link', { name: 'Ir a la caja' })).toHaveAttribute('href', '/panel/caja');
    expect(within(dialogo).getByRole('button', { name: 'Cobrar S/ 88.00' })).toBeDisabled();
    expect(llamadas(api, `POST /api/solicitudes/${S1}/pago-efectivo`)).toHaveLength(0);
  });

  it('con la caja de hoy cerrada también avisa', async () => {
    servidor({ caja: caja({ estado: 'CERRADA' }) });
    mostrar('/panel/solicitudes');
    const { dialogo } = await abrirCobro();
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Abre la caja antes de cobrar.');
    expect(within(dialogo).getByRole('button', { name: 'Cobrar S/ 88.00' })).toBeDisabled();
  });

  it('con una caja abierta de otro día dice de qué día es y no deja confirmar', async () => {
    servidor({ caja: caja({ fecha: '2026-11-23', deOtroDia: true }) });
    mostrar('/panel/solicitudes');
    const { dialogo } = await abrirCobro();
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('La caja abierta es del 23/11/2026');
    expect(within(dialogo).getByRole('button', { name: 'Cobrar S/ 88.00' })).toBeDisabled();
  });

  it('un doble clic no cobra dos veces: el botón se desactiva y se envía una sola vez', async () => {
    const espera = diferido();
    const api = servidor({
      extra: {
        [`POST /api/solicitudes/${S1}/pago-efectivo`]: async () => {
          await espera.promesa;
          return { estado: 201, cuerpo: { pago: pagoEfectivo(), solicitud: CONFIRMADA } };
        },
      },
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCobro();
    const confirmar = await within(dialogo).findByRole('button', { name: 'Cobrar S/ 88.00' });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.dblClick(confirmar);
    const cobrando = await within(dialogo).findByRole('button', { name: 'Cobrando…' });
    expect(cobrando).toBeDisabled();
    await usuario.click(cobrando);
    expect(llamadas(api, `POST /api/solicitudes/${S1}/pago-efectivo`)).toHaveLength(1);
    espera.resolver();
    await screen.findByRole('dialog', { name: 'Cobro registrado: AQ-7F3K9X' });
    expect(llamadas(api, `POST /api/solicitudes/${S1}/pago-efectivo`)).toHaveLength(1);
  });

  it('409 MONTO_CAMBIO: muestra el total nuevo y cobra con él solo al confirmar otra vez, con la misma clave', async () => {
    let intento = 0;
    const api = servidor({
      extra: {
        [`POST /api/solicitudes/${S1}/pago-efectivo`]: () =>
          ++intento === 1
            ? error('MONTO_CAMBIO', 409, { total: '35.00' })
            : { estado: 201, cuerpo: { pago: pagoEfectivo({ monto: '35.00' }), solicitud: CONFIRMADA } },
      },
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCobro();
    const confirmar = await within(dialogo).findByRole('button', { name: 'Cobrar S/ 88.00' });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.click(confirmar);

    expect(await within(dialogo).findByRole('status')).toHaveTextContent(
      'El monto cambió desde que lo viste: ahora es S/ 35.00.',
    );
    // Nada se cobró: el botón ahora muestra el total nuevo y espera otro clic.
    const otra = await within(dialogo).findByRole('button', { name: 'Cobrar S/ 35.00' });
    expect(llamadas(api, `POST /api/solicitudes/${S1}/pago-efectivo`)).toHaveLength(1);
    await usuario.click(otra);
    await screen.findByRole('dialog', { name: 'Cobro registrado: AQ-7F3K9X' });
    const cuerpos = llamadas(api, `POST /api/solicitudes/${S1}/pago-efectivo`) as {
      claveIdempotencia: string;
      montoMostrado: string;
    }[];
    expect(cuerpos.map((c) => c.montoMostrado)).toEqual(['88.00', '35.00']);
    expect(cuerpos[1]?.claveIdempotencia).toBe(cuerpos[0]?.claveIdempotencia);
  });

  it.each([
    ['SIN_CAJA_ABIERTA', undefined, 'Abre la caja antes de cobrar.'],
    ['CAJA_DE_OTRO_DIA', { cajaId: ID_CAJA, fecha: '2026-11-23' }, 'La caja abierta es del 23/11/2026'],
  ])('409 %s: lo explica, ofrece ir a la caja y deja volver a intentar', async (codigo, detalles, texto) => {
    servidor({
      extra: { [`POST /api/solicitudes/${S1}/pago-efectivo`]: () => error(codigo, 409, detalles) },
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCobro();
    const confirmar = await within(dialogo).findByRole('button', { name: 'Cobrar S/ 88.00' });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.click(confirmar);
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(texto);
    expect(within(dialogo).getByRole('link', { name: 'Ir a la caja' })).toHaveAttribute('href', '/panel/caja');
  });

  it.each([
    ['SOLICITUD_NO_COBRABLE', { estado: 'VENCIDA' }, 'ya no se puede cobrar'],
    ['SOLICITUD_YA_PAGADA', undefined, 'ya está pagada'],
    ['SIN_CUPO', undefined, 'Ya no hay cupo'],
    ['DNI_DEL_PERSONAL', undefined, 'Ya existe un usuario de la academia con el DNI de esta persona'],
    ['CLAVE_YA_USADA', undefined, 'Ese cobro ya se había registrado con otros datos'],
  ])('409 %s: un mensaje claro, ya no se puede confirmar y la lista se actualiza', async (codigo, detalles, texto) => {
    const api = servidor({
      extra: { [`POST /api/solicitudes/${S1}/pago-efectivo`]: () => error(codigo, 409, detalles) },
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCobro();
    const confirmar = await within(dialogo).findByRole('button', { name: 'Cobrar S/ 88.00' });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.click(confirmar);
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(texto);
    await waitFor(() => expect(llamadas(api, 'GET /api/solicitudes?estado=ACTIVAS').length).toBeGreaterThan(1));
    expect(within(dialogo).getByRole('button', { name: 'Cobrar S/ 88.00' })).toBeDisabled();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('"Volver" cierra el diálogo sin enviar nada', async () => {
    const api = servidor();
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCobro();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Volver' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(llamadas(api, `POST /api/solicitudes/${S1}/pago-efectivo`)).toHaveLength(0);
  });
});

describe('ajustar el monto (criterio 11 y 54)', () => {
  async function abrirAjuste() {
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Ajustar el monto de la solicitud AQ-7F3K9X' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Ajustar el monto de la solicitud AQ-7F3K9X' });
    return { usuario, dialogo };
  }

  it('exige soles enteros de 1 en adelante y un motivo, con el esquema compartido, sin enviar si no cumple', async () => {
    const api = servidor({ rol: 'ADMIN' });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirAjuste();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar ajuste' }));
    expect(within(dialogo).getByLabelText('Nuevo monto (S/)')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialogo).getByLabelText('Motivo del ajuste')).toHaveAttribute('aria-invalid', 'true');

    for (const invalido of ['0', '35.50', '-5', 'abc', '100000']) {
      await usuario.clear(within(dialogo).getByLabelText('Nuevo monto (S/)'));
      await usuario.type(within(dialogo).getByLabelText('Nuevo monto (S/)'), invalido);
      await usuario.type(within(dialogo).getByLabelText('Motivo del ajuste'), 'Beca');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar ajuste' }));
      expect(within(dialogo).getByLabelText('Nuevo monto (S/)')).toHaveAttribute('aria-invalid', 'true');
      await usuario.clear(within(dialogo).getByLabelText('Motivo del ajuste'));
    }
    expect(llamadas(api, `POST /api/solicitudes/${S1}/ajuste-monto`)).toHaveLength(0);
  });

  it('ajusta con el motivo recortado, cierra el diálogo, avisa y vuelve a pedir la lista', async () => {
    const api = servidor({
      rol: 'ADMIN',
      extra: {
        [`POST /api/solicitudes/${S1}/ajuste-monto`]: () => ({
          estado: 200,
          cuerpo: {
            solicitud: solicitud({ monto: '35.00', ajuste: { montoCalculado: '88.00', motivo: 'Beca deportiva' } }),
          },
        }),
      },
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirAjuste();
    await usuario.type(within(dialogo).getByLabelText('Nuevo monto (S/)'), ' 35 ');
    await usuario.type(within(dialogo).getByLabelText('Motivo del ajuste'), '  Beca deportiva  ');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar ajuste' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, `POST /api/solicitudes/${S1}/ajuste-monto`)).toEqual([
      { montoAjustado: '35', motivo: 'Beca deportiva' },
    ]);
    expect(await screen.findByText('Monto de la solicitud AQ-7F3K9X ajustado a S/ 35.00.')).toBeInTheDocument();
    await waitFor(() => expect(llamadas(api, 'GET /api/solicitudes?estado=ACTIVAS').length).toBeGreaterThan(1));
  });

  it('409 SOLICITUD_NO_AJUSTABLE: un mensaje claro y solo queda cerrar', async () => {
    servidor({
      rol: 'ADMIN',
      extra: {
        [`POST /api/solicitudes/${S1}/ajuste-monto`]: () =>
          error('SOLICITUD_NO_AJUSTABLE', 409, { estado: 'CONFIRMADA' }),
      },
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirAjuste();
    await usuario.type(within(dialogo).getByLabelText('Nuevo monto (S/)'), '35');
    await usuario.type(within(dialogo).getByLabelText('Motivo del ajuste'), 'Beca deportiva');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar ajuste' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('ya no se puede ajustar');
    expect(within(dialogo).getByRole('button', { name: 'Guardar ajuste' })).toBeDisabled();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('un 400 con el campo del monto lo marca en el diálogo', async () => {
    servidor({
      rol: 'ADMIN',
      extra: {
        [`POST /api/solicitudes/${S1}/ajuste-monto`]: () =>
          error('SOLICITUD_INVALIDA', 400, {
            errores: [{ campo: 'montoAjustado', mensaje: 'El monto no es válido.' }],
          }),
      },
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirAjuste();
    await usuario.type(within(dialogo).getByLabelText('Nuevo monto (S/)'), '35');
    await usuario.type(within(dialogo).getByLabelText('Motivo del ajuste'), 'Beca deportiva');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar ajuste' }));
    expect(await within(dialogo).findByText('El monto no es válido.')).toBeInTheDocument();
  });
});
