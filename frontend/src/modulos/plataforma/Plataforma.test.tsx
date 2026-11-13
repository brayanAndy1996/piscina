import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Rutas } from '../../rutas/Rutas';

const ID_A = '0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ID_B = '1c2d3e4f-5a6b-4b7c-9d8e-0f1a2b3c4d5e';
const SUPERADMIN = { id: '2d3e4f5a-6b7c-4c8d-8e9f-1a2b3c4d5e6f', correo: 'dueno@aquagestion.test', nombre: 'Dueño' };

function academia(id: string, nombre: string, nombreCorto: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    nombre,
    nombreCorto,
    estado: 'ACTIVA',
    // 03:00 UTC del 12/11 es el 11/11 a las 22:00 en Lima: la fecha debe ser la de Lima.
    creadaEn: '2026-11-12T03:00:00.000Z',
    suspendidaEn: null,
    motivoSuspension: null,
    ...extra,
  };
}

function error(codigo: string, estado: number, detalles?: unknown) {
  return { estado, cuerpo: { codigo, mensaje: `Mensaje de ${codigo}`, ...(detalles ? { detalles } : {}) } };
}

type Respuesta = { estado: number; cuerpo?: unknown };
type Manejador = (cuerpo: unknown) => Respuesta | Promise<Respuesta>;

/** Simula la API por "MÉTODO /ruta" y devuelve el mock de fetch para revisar las llamadas. */
function simularApi(rutas: Record<string, Manejador>) {
  const simulado = vi.fn((url: string, opciones?: RequestInit) => {
    const clave = `${opciones?.method ?? 'GET'} ${url}`;
    const manejador = rutas[clave];
    if (!manejador)
      return Promise.resolve(new Response(JSON.stringify({ codigo: 'NO_ENCONTRADO', mensaje: 'x' }), { status: 404 }));
    const cuerpo: unknown = typeof opciones?.body === 'string' ? JSON.parse(opciones.body) : undefined;
    return Promise.resolve(manejador(cuerpo)).then(
      ({ estado, cuerpo: salida }) =>
        new Response(salida === undefined ? null : JSON.stringify(salida), {
          status: estado,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
  });
  vi.stubGlobal('fetch', simulado);
  return simulado;
}

function llamadas(simulado: ReturnType<typeof simularApi>, clave: string): unknown[] {
  return simulado.mock.calls
    .filter(([url, opciones]) => `${opciones?.method ?? 'GET'} ${url}` === clave)
    .map(([, opciones]): unknown => (typeof opciones?.body === 'string' ? JSON.parse(opciones.body) : undefined));
}

function RutaActual() {
  return <p data-testid="ruta">{useLocation().pathname}</p>;
}

function mostrar(ruta: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <Rutas />
        <RutaActual />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rutaActual = () => screen.getByTestId('ruta').textContent;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('Rutas de la plataforma (criterio 70)', () => {
  it('/plataforma lleva a /plataforma/academias', async () => {
    simularApi({
      'GET /api/plataforma/sesion': () => ({ estado: 200, cuerpo: { superadmin: SUPERADMIN } }),
      'GET /api/plataforma/academias': () => ({ estado: 200, cuerpo: { academias: [] } }),
    });
    mostrar('/plataforma');
    expect(await screen.findByRole('heading', { name: 'Academias' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/plataforma/academias');
  });

  it('la página de inicio no enlaza a la plataforma', () => {
    simularApi({});
    mostrar('/');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('/plataforma');
  });
});

describe('/plataforma/ingresar (criterio 68)', () => {
  async function ingresar(correo = 'Dueno@AquaGestion.test ', clave = 'una-clave-larga-1') {
    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText('Correo'), correo);
    await usuario.type(screen.getByLabelText('Contraseña'), clave);
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
  }

  it('muestra el formulario de correo y contraseña', () => {
    simularApi({});
    mostrar('/plataforma/ingresar');
    expect(screen.getByRole('heading', { level: 1, name: 'AquaGestión' })).toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password');
  });

  it('valida con el esquema compartido antes de enviar', async () => {
    const api = simularApi({});
    mostrar('/plataforma/ingresar');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText('El correo no es válido.')).toBeInTheDocument();
    expect(screen.getByText('La contraseña es obligatoria.')).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it('con éxito envía el correo normalizado y lleva a /plataforma/academias sin guardar nada en el navegador', async () => {
    const api = simularApi({
      'POST /api/plataforma/sesion': () => ({ estado: 200, cuerpo: { superadmin: SUPERADMIN } }),
      'GET /api/plataforma/sesion': () => ({ estado: 200, cuerpo: { superadmin: SUPERADMIN } }),
      'GET /api/plataforma/academias': () => ({ estado: 200, cuerpo: { academias: [] } }),
    });
    mostrar('/plataforma/ingresar');
    await ingresar();
    expect(await screen.findByRole('heading', { name: 'Academias' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/plataforma/academias');
    expect(llamadas(api, 'POST /api/plataforma/sesion')).toEqual([
      { correo: 'dueno@aquagestion.test', clave: 'una-clave-larga-1' },
    ]);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it.each([
    [401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.'],
    [423, 'CUENTA_BLOQUEADA', 'La cuenta está bloqueada por varios intentos fallidos. Intenta de nuevo en 15 minutos.'],
    [429, 'DEMASIADAS_SOLICITUDES', 'Hiciste demasiados intentos. Espera un minuto.'],
  ])('con %i muestra el mensaje y se queda en el ingreso', async (estado, codigo, mensaje) => {
    simularApi({ 'POST /api/plataforma/sesion': () => error(codigo, estado) });
    mostrar('/plataforma/ingresar');
    await ingresar();
    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje);
    expect(rutaActual()).toBe('/plataforma/ingresar');
    expect(localStorage).toHaveLength(0);
  });

  it('ante un error de red muestra que no se pudo contactar al servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    mostrar('/plataforma/ingresar');
    await ingresar();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar al servidor');
  });

  it('mientras envía deshabilita el botón (un doble clic no envía dos veces)', async () => {
    const api = simularApi({ 'POST /api/plataforma/sesion': () => new Promise(() => undefined) });
    mostrar('/plataforma/ingresar');
    await ingresar();
    expect(await screen.findByRole('button', { name: 'Ingresando…' })).toBeDisabled();
    expect(llamadas(api, 'POST /api/plataforma/sesion')).toHaveLength(1);
  });
});

describe('/plataforma/academias (criterio 69)', () => {
  const lista = [
    academia(ID_A, 'Academia de Natación Los Delfines', 'delfines'),
    academia(ID_B, 'Club de Natación Tiburones', 'tiburones', {
      estado: 'SUSPENDIDA',
      suspendidaEn: '2026-11-12T15:00:00.000Z',
      motivoSuspension: 'Falta de pago',
    }),
  ];

  function conSesion(extra: Record<string, Manejador> = {}) {
    return simularApi({
      'GET /api/plataforma/sesion': () => ({ estado: 200, cuerpo: { superadmin: SUPERADMIN } }),
      'GET /api/plataforma/academias': () => ({ estado: 200, cuerpo: { academias: lista } }),
      ...extra,
    });
  }

  it('sin sesión (401) lleva a /plataforma/ingresar', async () => {
    simularApi({
      'GET /api/plataforma/sesion': () => error('NO_AUTENTICADO', 401),
      'GET /api/plataforma/academias': () => error('NO_AUTENTICADO', 401),
    });
    mostrar('/plataforma/academias');
    expect(await screen.findByLabelText('Correo')).toBeInTheDocument();
    expect(rutaActual()).toBe('/plataforma/ingresar');
  });

  it('muestra "Cargando academias…" mientras consulta', () => {
    simularApi({
      'GET /api/plataforma/sesion': () => new Promise(() => undefined),
      'GET /api/plataforma/academias': () => new Promise(() => undefined),
    });
    mostrar('/plataforma/academias');
    expect(screen.getByRole('status')).toHaveTextContent('Cargando academias…');
  });

  it('muestra nombre, nombre corto, estado y la fecha de creación en America/Lima (dd/MM/yyyy)', async () => {
    conSesion();
    mostrar('/plataforma/academias');
    const delfines = (await screen.findByText('Academia de Natación Los Delfines')).closest('li')!;
    expect(within(delfines).getByText('delfines')).toBeInTheDocument();
    expect(within(delfines).getByText('Activa')).toBeInTheDocument();
    expect(delfines).toHaveTextContent('Creada el 11/11/2026');
    const tiburones = screen.getByText('Club de Natación Tiburones').closest('li')!;
    expect(within(tiburones).getByText('Suspendida')).toBeInTheDocument();
    expect(tiburones).toHaveTextContent('Motivo: Falta de pago');
    expect(screen.getByText(SUPERADMIN.correo)).toBeInTheDocument();
  });

  it('sin academias muestra el estado vacío', async () => {
    conSesion({ 'GET /api/plataforma/academias': () => ({ estado: 200, cuerpo: { academias: [] } }) });
    mostrar('/plataforma/academias');
    expect(await screen.findByText(/Todavía no hay academias/)).toBeInTheDocument();
  });

  it('si la lista falla muestra el error y permite reintentar', async () => {
    let intentos = 0;
    conSesion({
      'GET /api/plataforma/academias': () =>
        ++intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: { academias: lista } },
    });
    mostrar('/plataforma/academias');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las academias.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Club de Natación Tiburones')).toBeInTheDocument();
  });

  describe('Nueva academia', () => {
    async function abrir() {
      const usuario = userEvent.setup();
      mostrar('/plataforma/academias');
      await usuario.click(await screen.findByRole('button', { name: 'Nueva academia' }));
      return usuario;
    }

    it('valida con crearAcademiaSchema (incluye las palabras reservadas) y no envía', async () => {
      const api = conSesion();
      const usuario = await abrir();
      await usuario.type(screen.getByLabelText('Nombre', { exact: true }), 'ab');
      await usuario.type(screen.getByLabelText('Nombre corto'), 'admin');
      await usuario.click(screen.getByRole('button', { name: 'Crear academia' }));
      expect(await screen.findByText('El nombre debe tener al menos 3 caracteres.')).toBeInTheDocument();
      expect(screen.getByText('Ese nombre corto está reservado por el sistema. Elige otro.')).toBeInTheDocument();
      expect(llamadas(api, 'POST /api/plataforma/academias')).toHaveLength(0);
    });

    it('crea la academia con el nombre corto normalizado, cierra el formulario y vuelve a pedir la lista', async () => {
      let creada = false;
      const api = conSesion({
        'POST /api/plataforma/academias': () => {
          creada = true;
          return { estado: 201, cuerpo: { academia: academia(ID_A, 'Nueva Academia', 'nueva') } };
        },
        'GET /api/plataforma/academias': () => ({
          estado: 200,
          cuerpo: { academias: creada ? [academia(ID_A, 'Nueva Academia', 'nueva')] : [] },
        }),
      });
      const usuario = await abrir();
      await usuario.type(screen.getByLabelText('Nombre', { exact: true }), '  Nueva Academia ');
      await usuario.type(screen.getByLabelText('Nombre corto'), ' Nueva ');
      await usuario.click(screen.getByRole('button', { name: 'Crear academia' }));
      expect(await screen.findByRole('heading', { name: 'Nueva Academia' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(llamadas(api, 'POST /api/plataforma/academias')).toEqual([
        { nombre: 'Nueva Academia', nombreCorto: 'nueva' },
      ]);
    });

    it('muestra el 409 junto al nombre corto', async () => {
      conSesion({ 'POST /api/plataforma/academias': () => error('NOMBRE_CORTO_EN_USO', 409) });
      const usuario = await abrir();
      await usuario.type(screen.getByLabelText('Nombre', { exact: true }), 'Otra academia');
      await usuario.type(screen.getByLabelText('Nombre corto'), 'delfines');
      await usuario.click(screen.getByRole('button', { name: 'Crear academia' }));
      const mensaje = await screen.findByText('Ese nombre corto ya lo usa otra academia. Elige otro.');
      expect(screen.getByLabelText('Nombre corto')).toHaveAccessibleDescription(
        expect.stringContaining(mensaje.textContent ?? ''),
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('muestra los errores por campo de un 400 del servidor', async () => {
      conSesion({
        'POST /api/plataforma/academias': () =>
          error('SOLICITUD_INVALIDA', 400, {
            errores: [{ campo: 'nombreCorto', mensaje: 'Formato no válido en el servidor.' }],
          }),
      });
      const usuario = await abrir();
      await usuario.type(screen.getByLabelText('Nombre', { exact: true }), 'Otra academia');
      await usuario.type(screen.getByLabelText('Nombre corto'), 'otra');
      await usuario.click(screen.getByRole('button', { name: 'Crear academia' }));
      expect(await screen.findByText('Formato no válido en el servidor.')).toBeInTheDocument();
    });

    it('se cierra con Cancelar y con Escape', async () => {
      const usuario = await abrir();
      await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await usuario.click(screen.getByRole('button', { name: 'Nueva academia' }));
      await usuario.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('si la sesión venció (401) lleva a /plataforma/ingresar', async () => {
      conSesion({ 'POST /api/plataforma/academias': () => error('NO_AUTENTICADO', 401) });
      const usuario = await abrir();
      await usuario.type(screen.getByLabelText('Nombre', { exact: true }), 'Otra academia');
      await usuario.type(screen.getByLabelText('Nombre corto'), 'otra');
      await usuario.click(screen.getByRole('button', { name: 'Crear academia' }));
      await waitFor(() => expect(rutaActual()).toBe('/plataforma/ingresar'));
    });
  });

  describe('Suspender y reactivar', () => {
    it('Suspender pide el motivo y no envía sin él', async () => {
      const api = conSesion();
      mostrar('/plataforma/academias');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Suspender Academia de Natación Los Delfines' }));
      const dialogo = screen.getByRole('dialog', { name: 'Suspender Academia de Natación Los Delfines' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Suspender academia' }));
      expect(await within(dialogo).findByText('El motivo debe tener al menos 3 caracteres.')).toBeInTheDocument();
      expect(llamadas(api, `POST /api/plataforma/academias/${ID_A}/suspender`)).toHaveLength(0);
    });

    it('Suspender con motivo envía la petición, cierra el diálogo y refresca la lista', async () => {
      let suspendida = false;
      const api = conSesion({
        [`POST /api/plataforma/academias/${ID_A}/suspender`]: () => {
          suspendida = true;
          return { estado: 200, cuerpo: { academia: lista[0] } };
        },
        'GET /api/plataforma/academias': () => ({
          estado: 200,
          cuerpo: {
            academias: suspendida
              ? [
                  academia(ID_A, 'Academia de Natación Los Delfines', 'delfines', {
                    estado: 'SUSPENDIDA',
                    suspendidaEn: '2026-11-12T15:00:00.000Z',
                    motivoSuspension: 'Deuda',
                  }),
                  lista[1],
                ]
              : lista,
          },
        }),
      });
      mostrar('/plataforma/academias');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Suspender Academia de Natación Los Delfines' }));
      await usuario.type(screen.getByLabelText('Motivo de la suspensión'), '  Deuda  ');
      await usuario.click(screen.getByRole('button', { name: 'Suspender academia' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(llamadas(api, `POST /api/plataforma/academias/${ID_A}/suspender`)).toEqual([{ motivo: 'Deuda' }]);
      expect(
        await screen.findByRole('button', { name: 'Reactivar Academia de Natación Los Delfines' }),
      ).toBeInTheDocument();
    });

    it('Suspender una academia ya suspendida (409) muestra el aviso', async () => {
      conSesion({ [`POST /api/plataforma/academias/${ID_A}/suspender`]: () => error('ACADEMIA_YA_SUSPENDIDA', 409) });
      mostrar('/plataforma/academias');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Suspender Academia de Natación Los Delfines' }));
      await usuario.type(screen.getByLabelText('Motivo de la suspensión'), 'Deuda');
      await usuario.click(screen.getByRole('button', { name: 'Suspender academia' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('La academia ya estaba suspendida.');
    });

    it('Reactivar pide confirmación y envía la petición sin motivo', async () => {
      const api = conSesion({
        [`POST /api/plataforma/academias/${ID_B}/reactivar`]: () => ({
          estado: 200,
          cuerpo: { academia: academia(ID_B, 'Club de Natación Tiburones', 'tiburones') },
        }),
      });
      mostrar('/plataforma/academias');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Reactivar Club de Natación Tiburones' }));
      expect(llamadas(api, `POST /api/plataforma/academias/${ID_B}/reactivar`)).toHaveLength(0);
      await usuario.click(screen.getByRole('button', { name: 'Reactivar academia' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(llamadas(api, `POST /api/plataforma/academias/${ID_B}/reactivar`)).toEqual([{}]);
    });

    it('Reactivar con motivo opcional lo envía recortado', async () => {
      const api = conSesion({
        [`POST /api/plataforma/academias/${ID_B}/reactivar`]: () => ({
          estado: 200,
          cuerpo: { academia: academia(ID_B, 'Club de Natación Tiburones', 'tiburones') },
        }),
      });
      mostrar('/plataforma/academias');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Reactivar Club de Natación Tiburones' }));
      await usuario.type(screen.getByLabelText('Motivo (opcional)'), ' Pagó la deuda ');
      await usuario.click(screen.getByRole('button', { name: 'Reactivar academia' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(llamadas(api, `POST /api/plataforma/academias/${ID_B}/reactivar`)).toEqual([{ motivo: 'Pagó la deuda' }]);
    });

    it('el motivo de Suspender y de Reactivar es un campo de una sola línea (criterio 76)', async () => {
      conSesion();
      mostrar('/plataforma/academias');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Suspender Academia de Natación Los Delfines' }));
      expect(screen.getByLabelText('Motivo de la suspensión').tagName).toBe('INPUT');
      await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));
      await usuario.click(await screen.findByRole('button', { name: 'Reactivar Club de Natación Tiburones' }));
      expect(screen.getByLabelText('Motivo (opcional)').tagName).toBe('INPUT');
    });

    it('Suspender no envía un motivo con caracteres de control bidireccional y muestra el error del esquema (criterio 77)', async () => {
      const api = conSesion();
      mostrar('/plataforma/academias');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Suspender Academia de Natación Los Delfines' }));
      await usuario.type(screen.getByLabelText('Motivo de la suspensión'), 'Falta de pago\u202e');
      await usuario.click(screen.getByRole('button', { name: 'Suspender academia' }));
      expect(await screen.findByText(/caracteres de dirección del texto/)).toBeInTheDocument();
      expect(llamadas(api, `POST /api/plataforma/academias/${ID_A}/suspender`)).toHaveLength(0);
    });

    it('Reactivar no envía un motivo con menos de 3 caracteres visibles (criterio 77)', async () => {
      const api = conSesion();
      mostrar('/plataforma/academias');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Reactivar Club de Natación Tiburones' }));
      await usuario.type(screen.getByLabelText('Motivo (opcional)'), 'a\u200bb');
      await usuario.click(screen.getByRole('button', { name: 'Reactivar academia' }));
      expect(await screen.findByText(/al menos 3 caracteres visibles/)).toBeInTheDocument();
      expect(llamadas(api, `POST /api/plataforma/academias/${ID_B}/reactivar`)).toHaveLength(0);
    });
  });

  it('Cerrar sesión envía DELETE y vuelve al ingreso', async () => {
    const api = conSesion({ 'DELETE /api/plataforma/sesion': () => ({ estado: 204 }) });
    mostrar('/plataforma/academias');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByLabelText('Correo')).toBeInTheDocument();
    expect(rutaActual()).toBe('/plataforma/ingresar');
    expect(llamadas(api, 'DELETE /api/plataforma/sesion')).toHaveLength(1);
  });
});
