import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, llamadas, type Manejador, mostrar, sesionDe, simularApi } from '../../pruebas-api';
import { Rutas } from '../../rutas/Rutas';

// Spec 005b, criterio 46 (PB14): el inicio del panel ("Solicitudes de inscripción" y "Nueva inscripción") y la página
// /panel/solicitudes (lista con filtro, cancelar con motivo, 409 y 404). La API se simula; los criterios 38 y 39 los prueba el backend.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const S1 = 'a1111111-1111-4111-8111-111111111111';
const S2 = 'a2222222-2222-4222-8222-222222222222';
const S3 = 'a3333333-3333-4333-8333-333333333333';
const S4 = 'a4444444-4444-4444-8444-444444444444';
const PLAN = 'b1111111-1111-4111-8111-111111111111';
const CLASE = 'c1111111-1111-4111-8111-111111111111';

function solicitud(extra: Record<string, unknown> = {}) {
  return {
    id: S1,
    codigo: 'AQ-7F3K9X',
    estado: 'PENDIENTE_PAGO',
    creadaEn: '2026-11-20T15:00:00.000Z',
    reservaVenceEn: '2026-11-21T20:30:00.000Z',
    nombres: 'Lucía Fernanda',
    apellidos: 'Prado Quispe',
    dni: '45678912',
    telefono: '987654321',
    menorDeEdad: false,
    plan: { id: PLAN, nombre: 'Plan 3 veces' },
    clases: [
      { id: CLASE, nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' },
      {
        id: 'c2222222-2222-4222-8222-222222222222',
        nivel: 'BASICO',
        diaSemana: 3,
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

const ACTIVA = solicitud();
const MENOR = solicitud({
  id: S2,
  codigo: 'AQ-2B4C6D',
  nombres: 'Mateo',
  apellidos: 'Rojas Vega',
  dni: '71234567',
  menorDeEdad: true,
  reservaVenceEn: '2026-11-22T20:30:00.000Z',
  creadaEn: '2026-11-19T15:00:00.000Z',
});
const VENCIDA = solicitud({
  id: S3,
  codigo: 'AQ-3C5D7E',
  estado: 'VENCIDA',
  reservaVenceEn: null,
  nombres: 'Ana',
  apellidos: 'Gómez Díaz',
  dni: '40123456',
});
const CANCELADA = solicitud({
  id: S4,
  codigo: 'AQ-4D6E8F',
  estado: 'CANCELADA',
  reservaVenceEn: null,
  nombres: 'Pedro',
  apellidos: 'Salas Luna',
  dni: '40987654',
});

const MI_ACADEMIA = {
  academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null },
};

type Solicitud = Record<string, unknown> & { id: string; estado: string };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** Un servidor con estado: la lista por filtro y la cancelación, que deja la solicitud `CANCELADA` como la API. */
function servidor(inicial: Solicitud[] = [ACTIVA, MENOR, VENCIDA, CANCELADA], extra: Record<string, Manejador> = {}) {
  const estado = { solicitudes: inicial };
  const por = (estados: string[]) => () => ({
    estado: 200,
    cuerpo: { solicitudes: estado.solicitudes.filter((s) => estados.includes(s.estado)) },
  });
  const api = simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('SECRETARIA', { id: ID_YO }) }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    'GET /api/solicitudes?estado=ACTIVAS': por(['PENDIENTE_PAGO']),
    'GET /api/solicitudes?estado=VENCIDAS': por(['VENCIDA']),
    'GET /api/solicitudes?estado=CANCELADAS': por(['CANCELADA']),
    'GET /api/solicitudes?estado=TODAS': por(['PENDIENTE_PAGO', 'VENCIDA', 'CANCELADA']),
    [`POST /api/solicitudes/${S1}/cancelar`]: () => {
      estado.solicitudes = estado.solicitudes.map((s) =>
        s.id === S1 ? { ...s, estado: 'CANCELADA', reservaVenceEn: null } : s,
      );
      return { estado: 200, cuerpo: { solicitud: estado.solicitudes.find((s) => s.id === S1) } };
    },
    ...extra,
  });
  return { api, estado };
}

function diferido() {
  let resolver: () => void = () => undefined;
  const promesa = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

const tarjeta = (codigo: string) => screen.findByRole('article', { name: `Solicitud ${codigo}` });

describe('inicio del panel (criterio 46)', () => {
  it.each(['ADMIN', 'SECRETARIA'] as const)(
    '%s ve "Solicitudes de inscripción" y "Nueva inscripción", que abre el formulario público de su academia',
    async (rol) => {
      simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
      mostrar('/panel');
      const solicitudes = await screen.findByRole('link', { name: /Solicitudes de inscripción/ });
      expect(solicitudes).toHaveAttribute('href', '/panel/solicitudes');
      const nueva = screen.getByRole('link', { name: /Nueva inscripción/ });
      expect(nueva).toHaveAttribute('href', '/a/delfines/inscripcion');
      // Se abre aparte: recepción no pierde el panel.
      expect(nueva).toHaveAttribute('target', '_blank');
      expect(nueva).toHaveAttribute('rel', expect.stringContaining('noopener'));
    },
  );

  it.each(['ENTRENADOR', 'ALUMNO'] as const)('%s no ve ninguna de las dos', async (rol) => {
    simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
    mostrar('/panel');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Solicitudes de inscripción/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nueva inscripción/ })).not.toBeInTheDocument();
  });

  it('la secretaria llega a la lista desde el inicio', async () => {
    servidor();
    mostrar('/panel');
    await userEvent.setup().click(await screen.findByRole('link', { name: /Solicitudes de inscripción/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Solicitudes de inscripción' })).toBeInTheDocument();
  });
});

describe('/panel/solicitudes: permiso (criterio 46)', () => {
  it.each(['ENTRENADOR', 'ALUMNO'] as const)(
    '%s que abre la ruta ve "sin permiso" y no se pide la lista',
    async (rol) => {
      const api = simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
      mostrar('/panel/solicitudes');
      expect(await screen.findByText('No tienes permiso para ver esta página')).toBeInTheDocument();
      expect(api.mock.calls.filter(([url]) => String(url).startsWith('/api/solicitudes'))).toHaveLength(0);
    },
  );

  it('el administrador también la ve', async () => {
    simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }),
      'GET /api/solicitudes?estado=ACTIVAS': () => ({ estado: 200, cuerpo: { solicitudes: [ACTIVA] } }),
    });
    mostrar('/panel/solicitudes');
    expect(await tarjeta('AQ-7F3K9X')).toBeInTheDocument();
  });
});

describe('/panel/solicitudes: lista y filtro (criterio 46)', () => {
  it('pide las activas por defecto y muestra cada solicitud con sus datos', async () => {
    const { api } = servidor();
    mostrar('/panel/solicitudes');
    const primera = await tarjeta('AQ-7F3K9X');
    expect(llamadas(api, 'GET /api/solicitudes?estado=ACTIVAS')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Activas' })).toHaveAttribute('aria-pressed', 'true');

    expect(within(primera).getByText('Lucía Fernanda Prado Quispe')).toBeInTheDocument();
    expect(within(primera).getByText('Pendiente de pago')).toBeInTheDocument();
    expect(within(primera).getByText('45678912')).toBeInTheDocument();
    expect(within(primera).getByRole('link', { name: '987654321' })).toHaveAttribute('href', 'tel:987654321');
    expect(within(primera).getByText('Plan 3 veces')).toBeInTheDocument();
    expect(within(primera).getByText(/Lunes de 18:00 a 19:00/)).toBeInTheDocument();
    expect(within(primera).getByText(/Miércoles de 18:00 a 19:00/)).toBeInTheDocument();
    expect(within(primera).getByText(/noviembre de 2026/)).toBeInTheDocument();
    expect(within(primera).getByText('S/ 88.00')).toBeInTheDocument();
    // La reserva vence el 21/11 a las 15:30 en Lima; se creó el 20/11 a las 10:00.
    expect(within(primera).getByText('21/11/2026 15:30')).toBeInTheDocument();
    expect(within(primera).getByText('20/11/2026 10:00')).toBeInTheDocument();
    expect(within(primera).queryByText('Menor de edad')).not.toBeInTheDocument();

    // Un menor se marca; la lista está de la más nueva a la más antigua tal como la entrega la API.
    const menor = await tarjeta('AQ-2B4C6D');
    expect(within(menor).getByText('Menor de edad')).toBeInTheDocument();
    // Las vencidas y las canceladas no están en las activas.
    expect(screen.queryByRole('article', { name: 'Solicitud AQ-3C5D7E' })).not.toBeInTheDocument();
  });

  it('no muestra datos médicos, del apoderado ni nada fuera de lo pedido', async () => {
    servidor();
    mostrar('/panel/solicitudes');
    const primera = await tarjeta('AQ-7F3K9X');
    expect(primera.textContent).not.toMatch(
      /sangre|alergia|enfermedad|medicamento|seguro|apoderado|emergencia|consentimiento/i,
    );
  });

  it.each([
    ['Vencidas', 'VENCIDAS', 'AQ-3C5D7E', 'Vencida'],
    ['Canceladas', 'CANCELADAS', 'AQ-4D6E8F', 'Cancelada'],
    ['Todas', 'TODAS', 'AQ-4D6E8F', 'Cancelada'],
  ])('el filtro "%s" pide ?estado=%s', async (texto, estado, codigo, palabra) => {
    const { api } = servidor();
    mostrar('/panel/solicitudes');
    await tarjeta('AQ-7F3K9X');
    await userEvent.setup().click(screen.getByRole('button', { name: texto }));
    const otra = await tarjeta(codigo);
    expect(llamadas(api, `GET /api/solicitudes?estado=${estado}`)).toHaveLength(1);
    expect(screen.getByRole('button', { name: texto })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Activas' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(otra).getByText(palabra)).toBeInTheDocument();
  });

  it('"Todas" lista todas y una vencida no muestra fecha límite', async () => {
    servidor();
    mostrar('/panel/solicitudes');
    await tarjeta('AQ-7F3K9X');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Todas' }));
    const vencida = await tarjeta('AQ-3C5D7E');
    expect(within(vencida).queryByText('Reserva hasta')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('"Cancelar" aparece solo en las pendientes de pago y en las vencidas', async () => {
    servidor();
    mostrar('/panel/solicitudes');
    await tarjeta('AQ-7F3K9X');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Todas' }));
    await tarjeta('AQ-4D6E8F');
    expect(screen.getByRole('button', { name: 'Cancelar la solicitud AQ-7F3K9X' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar la solicitud AQ-2B4C6D' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar la solicitud AQ-3C5D7E' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar la solicitud AQ-4D6E8F' })).not.toBeInTheDocument();
  });

  it('sin solicitudes, lo dice según el filtro', async () => {
    servidor([]);
    mostrar('/panel/solicitudes');
    expect(await screen.findByText('No hay solicitudes activas.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Canceladas' }));
    expect(await screen.findByText('No hay solicitudes canceladas.')).toBeInTheDocument();
  });

  it('si la lista no carga, ofrece reintentar', async () => {
    let intentos = 0;
    servidor(undefined, {
      'GET /api/solicitudes?estado=ACTIVAS': () =>
        ++intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: { solicitudes: [ACTIVA] } },
    });
    mostrar('/panel/solicitudes');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las solicitudes.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await tarjeta('AQ-7F3K9X')).toBeInTheDocument();
  });

  it('las claves de las consultas llevan la academia y la identidad de la sesión', async () => {
    servidor();
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={['/panel/solicitudes']}>
          <Rutas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await tarjeta('AQ-7F3K9X');
    expect(
      cliente
        .getQueryCache()
        .findAll({ queryKey: ['solicitudes'] })
        .map((q) => q.queryKey),
    ).toEqual([['solicitudes', 'delfines', ID_YO, 'ACTIVAS']]);
  });
});

describe('/panel/solicitudes: cancelar (criterio 46)', () => {
  async function abrirCancelacion(codigo = 'AQ-7F3K9X') {
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: `Cancelar la solicitud ${codigo}` }));
    const dialogo = await screen.findByRole('dialog', { name: `Cancelar la solicitud ${codigo}` });
    return { usuario, dialogo };
  }

  it('el diálogo exige el motivo con el esquema compartido y no envía nada si no cumple', async () => {
    const { api } = servidor();
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCancelacion();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar solicitud' }));
    expect(within(dialogo).getByLabelText('Motivo de la cancelación')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialogo).getByRole('alert')).toBeInTheDocument();

    await usuario.type(within(dialogo).getByLabelText('Motivo de la cancelación'), 'ab');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar solicitud' }));
    expect(within(dialogo).getByRole('alert')).toBeInTheDocument();
    expect(llamadas(api, `POST /api/solicitudes/${S1}/cancelar`)).toHaveLength(0);
  });

  it('cancela con el motivo, cierra el diálogo, vuelve a pedir la lista y avisa', async () => {
    const { api } = servidor();
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCancelacion();
    await usuario.type(within(dialogo).getByLabelText('Motivo de la cancelación'), '  El cliente ya no vendrá  ');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar solicitud' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, `POST /api/solicitudes/${S1}/cancelar`)).toEqual([{ motivo: 'El cliente ya no vendrá' }]);
    expect(await screen.findByText('Solicitud AQ-7F3K9X cancelada. El cupo quedó libre.')).toBeInTheDocument();
    // La lista se pidió de nuevo y la cancelada ya no está entre las activas.
    await waitFor(() => expect(llamadas(api, 'GET /api/solicitudes?estado=ACTIVAS')).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Solicitud AQ-7F3K9X' })).not.toBeInTheDocument());
    expect(screen.getByRole('article', { name: 'Solicitud AQ-2B4C6D' })).toBeInTheDocument();
  });

  it('desactiva el botón mientras espera y un segundo clic no envía otra vez', async () => {
    const espera = diferido();
    const { api } = servidor(undefined, {
      [`POST /api/solicitudes/${S1}/cancelar`]: async () => {
        await espera.promesa;
        return { estado: 200, cuerpo: { solicitud: { ...ACTIVA, estado: 'CANCELADA', reservaVenceEn: null } } };
      },
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCancelacion();
    await usuario.type(within(dialogo).getByLabelText('Motivo de la cancelación'), 'Ya no viene');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar solicitud' }));
    const boton = await within(dialogo).findByRole('button', { name: 'Cancelando…' });
    expect(boton).toBeDisabled();
    await usuario.click(boton);
    expect(llamadas(api, `POST /api/solicitudes/${S1}/cancelar`)).toHaveLength(1);
    espera.resolver();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, `POST /api/solicitudes/${S1}/cancelar`)).toHaveLength(1);
  });

  it('"Volver" cierra el diálogo sin enviar', async () => {
    const { api } = servidor();
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCancelacion();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Volver' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(llamadas(api, `POST /api/solicitudes/${S1}/cancelar`)).toHaveLength(0);
  });

  it('409 SOLICITUD_NO_CANCELABLE: un mensaje claro y vuelve a pedir la lista', async () => {
    const { api } = servidor(undefined, {
      [`POST /api/solicitudes/${S1}/cancelar`]: () => error('SOLICITUD_NO_CANCELABLE', 409),
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCancelacion();
    await usuario.type(within(dialogo).getByLabelText('Motivo de la cancelación'), 'Ya no viene');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar solicitud' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Esta solicitud ya no se puede cancelar');
    await waitFor(() => expect(llamadas(api, 'GET /api/solicitudes?estado=ACTIVAS')).toHaveLength(2));
    // No tiene sentido volver a intentarlo: solo queda cerrar.
    expect(within(dialogo).getByRole('button', { name: 'Cancelar solicitud' })).toBeDisabled();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('404: un mensaje claro y vuelve a pedir la lista', async () => {
    const { api } = servidor(undefined, {
      [`POST /api/solicitudes/${S1}/cancelar`]: () => error('NO_ENCONTRADO', 404),
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCancelacion();
    await usuario.type(within(dialogo).getByLabelText('Motivo de la cancelación'), 'Ya no viene');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar solicitud' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('La solicitud ya no existe');
    await waitFor(() => expect(llamadas(api, 'GET /api/solicitudes?estado=ACTIVAS')).toHaveLength(2));
  });

  it('un 400 con el campo del motivo lo marca en el diálogo', async () => {
    servidor(undefined, {
      [`POST /api/solicitudes/${S1}/cancelar`]: () =>
        error('SOLICITUD_INVALIDA', 400, { errores: [{ campo: 'motivo', mensaje: 'El motivo no es válido.' }] }),
    });
    mostrar('/panel/solicitudes');
    const { usuario, dialogo } = await abrirCancelacion();
    await usuario.type(within(dialogo).getByLabelText('Motivo de la cancelación'), 'Ya no viene');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar solicitud' }));
    expect(await within(dialogo).findByText('El motivo no es válido.')).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Motivo de la cancelación')).toHaveAttribute('aria-invalid', 'true');
  });

  it('una vencida también se cancela', async () => {
    const { api } = servidor(undefined, {
      [`POST /api/solicitudes/${S3}/cancelar`]: () => ({
        estado: 200,
        cuerpo: { solicitud: { ...VENCIDA, estado: 'CANCELADA' } },
      }),
    });
    mostrar('/panel/solicitudes');
    await tarjeta('AQ-7F3K9X');
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Vencidas' }));
    await usuario.click(await screen.findByRole('button', { name: 'Cancelar la solicitud AQ-3C5D7E' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Cancelar la solicitud AQ-3C5D7E' });
    await usuario.type(within(dialogo).getByLabelText('Motivo de la cancelación'), 'Nunca vino');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar solicitud' }));
    await waitFor(() =>
      expect(llamadas(api, `POST /api/solicitudes/${S3}/cancelar`)).toEqual([{ motivo: 'Nunca vino' }]),
    );
  });
});
