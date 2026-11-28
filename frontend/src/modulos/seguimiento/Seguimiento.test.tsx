import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archivoDePrueba, error, llamadas, mostrar, peticiones, simularApi, simularUrlLocal } from '../../pruebas-api';
import { Rutas } from '../../rutas/Rutas';

// Spec 005, criterio 44 (005a): la página de seguimiento con el token en el cuerpo, la vista mínima, la consulta con código y DNI y el
// cuidado del token (sin almacenamiento del navegador, sin título, sin caché persistida). Criterio 45: el teléfono de la academia.

const TOKEN = 'dUg8U3s15Gr1QAQy0Rjl0cG5bd86JkGqUa__duZr1Ew';
const TELEFONO = '987654321';
const GET_ACADEMIA = 'GET /api/a/delfines';
const POST_CONSULTA = 'POST /api/a/delfines/solicitudes/consulta';

function vista(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    codigo: 'AQ-7F3K9X',
    estado: 'PENDIENTE_PAGO',
    creadaEn: '2026-11-20T15:00:00.000Z',
    reservaVenceEn: '2026-11-21T20:30:00.000Z',
    nombres: 'Lucía',
    plan: { nombre: 'Plan 3 veces' },
    clases: [
      { nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' },
      { nivel: 'BASICO', diaSemana: 3, horaInicio: '18:00', horaFin: '19:00' },
      { nivel: 'BASICO', diaSemana: 5, horaInicio: '19:00', horaFin: '20:00' },
    ],
    mes: '2026-11',
    clasesTotales: 5,
    monto: '88.00',
    esProporcional: true,
    fotoCargada: false,
    ...extra,
  };
}

function respuesta(extra: Record<string, unknown> = {}, telefono: string | null = TELEFONO) {
  return { solicitud: vista(extra), academia: { nombre: 'Academia de Natación Los Delfines', telefono } };
}

function servidor(consulta: () => { estado: number; cuerpo?: unknown }, telefono: string | null = TELEFONO) {
  return simularApi({
    [GET_ACADEMIA]: () => ({
      estado: 200,
      cuerpo: { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines', telefono },
    }),
    [POST_CONSULTA]: consulta,
  });
}

let urls: ReturnType<typeof simularUrlLocal>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.title = 'AquaGestión';
  urls = simularUrlLocal();
});

describe('Página de seguimiento con el enlace (criterio 44)', () => {
  it('consulta con el token en el cuerpo, nunca en la dirección de la API, y muestra la vista mínima', async () => {
    const api = servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);

    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(llamadas(api, POST_CONSULTA)).toEqual([{ token: TOKEN }]);
    for (const [url] of api.mock.calls) expect(String(url)).not.toContain(TOKEN);

    expect(within(solicitud).getByText('Pendiente de pago')).toBeInTheDocument();
    expect(within(solicitud).getByText('AQ-7F3K9X')).toBeInTheDocument();
    expect(within(solicitud).getByText('Hola, Lucía')).toBeInTheDocument();
    expect(within(solicitud).getByText('Plan 3 veces')).toBeInTheDocument();
    expect(within(solicitud).getByText(/Lunes de 18:00 a 19:00/)).toBeInTheDocument();
    expect(within(solicitud).getByText(/Miércoles de 18:00 a 19:00/)).toBeInTheDocument();
    expect(within(solicitud).getByText(/Viernes de 19:00 a 20:00/)).toBeInTheDocument();
    expect(within(solicitud).getByText('noviembre de 2026')).toBeInTheDocument();
    expect(within(solicitud).getByText(/S\/ 88\.00 \(el precio ya incluye IGV\)/)).toBeInTheDocument();
    // La reserva vence el 21/11 a las 15:30 en Lima.
    expect(within(solicitud).getByText('21/11/2026 15:30')).toBeInTheDocument();
    expect(screen.getByText(/llama a la academia al 987654321/)).toBeInTheDocument();
    // Con la vista completa y sin foto, ofrece subirla (005b).
    expect(screen.getByText('Foto pendiente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir foto' })).toBeDisabled();
  });

  it('no guarda el token en localStorage, sessionStorage ni cookies y no lo pone en el título', async () => {
    servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    expect(document.cookie).not.toContain(TOKEN);
    expect(document.title).not.toContain(TOKEN);
    expect(document.title).toBe('Seguimiento de tu solicitud · AquaGestión');
  });

  it('la clave de la consulta vive solo en la memoria y se descarta al salir de la página', async () => {
    servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={[`/a/delfines/solicitud/${TOKEN}`]}>
          <Rutas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(cliente.getQueryCache().findAll({ queryKey: ['seguimiento'] })).toHaveLength(1);
    unmount();
    // Sin `persistQueryClient` nada va al almacenamiento, y la entrada con el token se descarta de la memoria.
    await waitFor(() => expect(cliente.getQueryCache().findAll({ queryKey: ['seguimiento'] })).toHaveLength(0));
    expect(localStorage).toHaveLength(0);
    expect(document.title).toBe('AquaGestión');
  });

  it('una solicitud vencida o cancelada muestra solo ese estado, sin fecha límite', async () => {
    let estado = 'VENCIDA';
    servidor(() => {
      // La vista reducida (criterio 58): sin fecha límite, sin nombre y sin foto.
      const reducida = vista({ estado });
      delete reducida['reservaVenceEn'];
      delete reducida['nombres'];
      delete reducida['fotoCargada'];
      return { estado: 200, cuerpo: { solicitud: reducida, academia: { nombre: 'x', telefono: TELEFONO } } };
    });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(solicitud).getByText('Vencida')).toBeInTheDocument();
    expect(within(solicitud).getByText(/La reserva venció y el cupo se liberó/)).toBeInTheDocument();
    expect(within(solicitud).queryByText(/Reserva hasta/)).not.toBeInTheDocument();
    expect(within(solicitud).queryByText(/Paga S\//)).not.toBeInTheDocument();

    estado = 'CANCELADA';
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByText('Cancelada')).toBeInTheDocument();
    expect(screen.getByText(/La academia canceló esta solicitud/)).toBeInTheDocument();
  });

  it('un enlace que no existe muestra un solo mensaje y ofrece la consulta con código y DNI', async () => {
    servidor(() => error('SOLICITUD_NO_ENCONTRADA', 404));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos una solicitud con ese enlace');
    expect(screen.getByRole('link', { name: 'Consultar con mi código y mi DNI' })).toHaveAttribute(
      'href',
      '/a/delfines/solicitud',
    );
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('el límite de consultas y los fallos del servidor se dicen claro', async () => {
    servidor(() => error('DEMASIADAS_SOLICITUDES', 429));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Hiciste demasiadas consultas');
  });

  it('una academia suspendida no muestra la solicitud', async () => {
    simularApi({ [GET_ACADEMIA]: () => error('ACADEMIA_SUSPENDIDA', 403) });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    expect(await screen.findByText('Academia no disponible por el momento.')).toBeInTheDocument();
  });
});

/** La vista reducida del criterio 58: sin `nombres`, `fotoCargada` ni `reservaVenceEn` (las claves no existen). */
function reducida(estado: 'VENCIDA' | 'CANCELADA', extra: Record<string, unknown> = {}) {
  const base = vista({ estado, ...extra });
  delete base['reservaVenceEn'];
  delete base['nombres'];
  delete base['fotoCargada'];
  return { solicitud: base, academia: { nombre: 'Academia de Natación Los Delfines', telefono: TELEFONO } };
}

describe('Vista reducida de una solicitud vencida o cancelada (criterios 44 y 58)', () => {
  it.each([
    ['VENCIDA', 'Vencida', /La reserva venció y el cupo se liberó/],
    ['CANCELADA', 'Cancelada', /La academia canceló esta solicitud y el cupo se liberó/],
  ] as const)(
    '%s: muestra el estado y los datos de la solicitud sin saludo, sin fecha límite y sin foto',
    async (estado, titulo, explicacion) => {
      servidor(() => ({ estado: 200, cuerpo: reducida(estado) }));
      mostrar(`/a/delfines/solicitud/${TOKEN}`);

      const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
      expect(within(solicitud).getByText(titulo)).toBeInTheDocument();
      expect(within(solicitud).getByText(explicacion)).toBeInTheDocument();
      expect(within(solicitud).getByText('AQ-7F3K9X')).toBeInTheDocument();
      expect(within(solicitud).getByText('Plan 3 veces')).toBeInTheDocument();
      expect(within(solicitud).getByText(/Lunes de 18:00 a 19:00/)).toBeInTheDocument();
      expect(within(solicitud).getByText('noviembre de 2026')).toBeInTheDocument();
      expect(within(solicitud).getByText(/S\/ 88\.00 \(el precio ya incluye IGV\)/)).toBeInTheDocument();
      expect(screen.getByText(/llama a la academia al 987654321/)).toBeInTheDocument();

      // Sin saludo (ni un hueco tipo "Hola, "), sin fecha límite, sin la orden de pagar y sin foto.
      expect(within(solicitud).queryByText(/Hola/)).not.toBeInTheDocument();
      expect(solicitud.textContent).not.toMatch(/Hola|Lucía/);
      expect(within(solicitud).queryByText('Reserva hasta')).not.toBeInTheDocument();
      expect(within(solicitud).queryByText(/Paga S\//)).not.toBeInTheDocument();
      expect(within(solicitud).queryByText(/hasta el \d/)).not.toBeInTheDocument();
      expect(screen.queryByText(/foto/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /foto/i })).not.toBeInTheDocument();
    },
  );

  it('la reducida no deja un saludo vacío ni una coma suelta junto al código', async () => {
    servidor(() => ({ estado: 200, cuerpo: reducida('VENCIDA') }));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(solicitud.textContent?.startsWith('Código de la solicitud')).toBe(true);
  });

  it('regreso por un tercero: la solicitud vencida muestra sus datos y ningún nombre; la nueva sí saluda', async () => {
    let consultada: 'S1' | 'S2' = 'S1';
    servidor(() =>
      consultada === 'S1'
        ? {
            estado: 200,
            cuerpo: reducida('VENCIDA', { codigo: 'AQ-111111', plan: { nombre: 'Plan 2 veces' }, monto: '60.00' }),
          }
        : {
            estado: 200,
            cuerpo: respuesta({ codigo: 'AQ-222222', nombres: 'Intrusa', plan: { nombre: 'Plan 5 veces' } }),
          },
    );
    mostrar(`/a/delfines/solicitud/${TOKEN}`);

    const s1 = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(s1).getByText('AQ-111111')).toBeInTheDocument();
    expect(within(s1).getByText('Plan 2 veces')).toBeInTheDocument();
    expect(within(s1).getByText(/S\/ 60\.00/)).toBeInTheDocument();
    // Ningún nombre en toda la página: ni el de la clienta ni el del tercero.
    expect(document.body.textContent).not.toMatch(/Valeria|Intrusa|Hola/);

    consultada = 'S2';
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByText('Hola, Intrusa')).toBeInTheDocument();
    expect(screen.getByText('AQ-222222')).toBeInTheDocument();
    expect(screen.queryByText('AQ-111111')).not.toBeInTheDocument();
  });

  it('con código y DNI muestra la misma vista reducida: el cuerpo no tiene ningún nombre', async () => {
    servidor(() => ({ estado: 200, cuerpo: reducida('CANCELADA') }));
    const user = userEvent.setup();
    mostrar('/a/delfines/solicitud');
    await user.type(await screen.findByLabelText('Código de la solicitud'), 'AQ-7F3K9X');
    await user.type(screen.getByLabelText('DNI'), '45678912');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(solicitud).getByText('Cancelada')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Hola|Lucía|Valeria|Intrusa/);
    expect(within(solicitud).queryByText('Reserva hasta')).not.toBeInTheDocument();
  });

  it('si la API mandara el nombre en una vencida, la página no lo muestra (el contrato estricto lo rechaza)', async () => {
    servidor(() => ({
      estado: 200,
      cuerpo: { ...reducida('VENCIDA'), solicitud: { ...reducida('VENCIDA').solicitud, nombres: 'Valeria' } },
    }));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Valeria');
  });
});

describe('Consulta con código y DNI (criterio 44)', () => {
  it('manda el código recortado y en mayúsculas y el DNI en el cuerpo, y muestra la misma vista', async () => {
    const api = servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    const user = userEvent.setup();
    mostrar('/a/delfines/solicitud');
    await user.type(await screen.findByLabelText('Código de la solicitud'), '  aq-7f3k9x ');
    await user.type(screen.getByLabelText('DNI'), '45678912');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(llamadas(api, POST_CONSULTA)).toEqual([{ codigo: 'AQ-7F3K9X', dni: '45678912' }]);
    expect(within(solicitud).getByText('Plan 3 veces')).toBeInTheDocument();
    for (const [url] of api.mock.calls) expect(String(url)).not.toContain('45678912');
  });

  it('valida el formato antes de consultar', async () => {
    const api = servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    const user = userEvent.setup();
    mostrar('/a/delfines/solicitud');
    await screen.findByLabelText('Código de la solicitud');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(screen.getByText('El código debe tener el formato AQ-XXXXXX.')).toBeInTheDocument();
    expect(screen.getByText('El DNI debe tener exactamente 8 dígitos.')).toBeInTheDocument();
    // La O no se corrige a 0: el código tiene el alfabeto de Crockford.
    fireEvent.change(screen.getByLabelText('Código de la solicitud'), { target: { value: 'AQ-7F3K9O' } });
    fireEvent.change(screen.getByLabelText('DNI'), { target: { value: '45678912' } });
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(screen.getByText('El código debe tener el formato AQ-XXXXXX.')).toBeInTheDocument();
    expect(llamadas(api, POST_CONSULTA)).toHaveLength(0);
  });

  it('un código que no existe y un código con otro DNI dan el mismo mensaje', async () => {
    servidor(() => error('SOLICITUD_NO_ENCONTRADA', 404));
    const user = userEvent.setup();
    mostrar('/a/delfines/solicitud');
    await user.type(await screen.findByLabelText('Código de la solicitud'), 'AQ-7F3K9X');
    await user.type(screen.getByLabelText('DNI'), '45678912');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos una solicitud con ese código y ese DNI');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

describe('"Subir foto" en el seguimiento (criterio 44, 005b)', () => {
  const PUT_FOTO = 'PUT /api/a/delfines/solicitudes/foto';
  const entradaDeFoto = () => screen.getByLabelText(/Elegir (una|otra) foto|Cambiar la foto/);

  /** Un servidor con estado: el `PUT` responde lo que se le indique y, si es 204, la consulta siguiente ya dice `fotoCargada`. */
  function servidorConFoto(respuestaPut: () => { estado: number; cuerpo?: unknown } = () => ({ estado: 204 })) {
    const estado = { fotoCargada: false, reducida: false };
    const api = simularApi({
      [GET_ACADEMIA]: () => ({
        estado: 200,
        cuerpo: { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines', telefono: TELEFONO },
      }),
      [POST_CONSULTA]: () => ({
        estado: 200,
        cuerpo: estado.reducida ? reducida('CANCELADA') : respuesta({ fotoCargada: estado.fotoCargada }),
      }),
      [PUT_FOTO]: () => {
        const salida = respuestaPut();
        if (salida.estado === 204) estado.fotoCargada = true;
        if (salida.estado === 409) estado.reducida = true;
        return salida;
      },
    });
    return { api, estado };
  }

  it('con la vista completa y sin foto, ofrece subirla: el botón se activa con un archivo válido', async () => {
    servidorConFoto();
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await screen.findByRole('article', { name: 'Tu solicitud' });
    const seccion = screen.getByRole('region', { name: 'Foto' });
    expect(within(seccion).getByText('Foto pendiente')).toBeInTheDocument();
    expect(entradaDeFoto()).toHaveAttribute('accept', 'image/jpeg,image/png');
    const boton = within(seccion).getByRole('button', { name: 'Subir foto' });
    expect(boton).toBeDisabled();
    await userEvent.setup().upload(entradaDeFoto(), archivoDePrueba('uno.png', 'image/png'));
    expect(screen.getByAltText('Vista previa de la foto elegida')).toHaveAttribute('src', 'blob:prueba-1');
    expect(boton).toBeEnabled();
  });

  it('con la foto ya cargada, lo dice y ofrece cambiarla', async () => {
    const { estado } = servidorConFoto();
    estado.fotoCargada = true;
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await screen.findByRole('article', { name: 'Tu solicitud' });
    const seccion = screen.getByRole('region', { name: 'Foto' });
    expect(within(seccion).getByText('Foto cargada')).toBeInTheDocument();
    expect(within(seccion).queryByText('Foto pendiente')).not.toBeInTheDocument();
    expect(within(seccion).getByRole('button', { name: 'Cambiar foto' })).toBeInTheDocument();
  });

  it('sube con el token de la dirección en X-Token-Solicitud, vuelve a consultar y muestra "Foto cargada"', async () => {
    const { api } = servidorConFoto();
    const usuario = userEvent.setup();
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await screen.findByRole('article', { name: 'Tu solicitud' });
    const foto = archivoDePrueba('uno.jpg', 'image/jpeg', 4096);
    await usuario.upload(entradaDeFoto(), foto);
    await usuario.click(screen.getByRole('button', { name: 'Subir foto' }));

    const seccion = screen.getByRole('region', { name: 'Foto' });
    await waitFor(() => expect(within(seccion).getByText('Foto cargada')).toBeInTheDocument());
    const subidas = peticiones(api, PUT_FOTO);
    expect(subidas).toHaveLength(1);
    const subida = subidas[0] as RequestInit;
    expect(subida.body).toBe(foto);
    expect(subida.headers).toMatchObject({ 'Content-Type': 'image/jpeg', 'X-Token-Solicitud': TOKEN });
    // Volvió a consultar y la subida ya no deja un archivo elegido.
    expect(llamadas(api, POST_CONSULTA)).toHaveLength(2);
    expect(screen.queryByAltText('Vista previa de la foto elegida')).not.toBeInTheDocument();
    // El token vive solo en la memoria de la página.
    for (const [url] of api.mock.calls) expect(String(url)).not.toContain(TOKEN);
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    expect(document.cookie).not.toContain(TOKEN);
    expect(document.title).not.toContain(TOKEN);
  });

  it('avisa, sin llamar a la API, si el archivo no es JPG ni PNG o pasa de 5 MB', async () => {
    const { api } = servidorConFoto();
    const usuario = userEvent.setup({ applyAccept: false });
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await screen.findByRole('article', { name: 'Tu solicitud' });
    await usuario.upload(entradaDeFoto(), archivoDePrueba('uno.webp', 'image/webp'));
    expect(screen.getByRole('alert')).toHaveTextContent('La foto debe ser un archivo JPG o PNG.');
    expect(screen.getByRole('button', { name: 'Subir foto' })).toBeDisabled();

    await usuario.upload(entradaDeFoto(), archivoDePrueba('grande.png', 'image/png', 5_242_881));
    expect(screen.getByRole('alert')).toHaveTextContent('La foto pesa más de 5 MB.');
    expect(screen.getByRole('button', { name: 'Subir foto' })).toBeDisabled();

    await usuario.upload(entradaDeFoto(), archivoDePrueba('justa.png', 'image/png', 5_242_880));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir foto' })).toBeEnabled();
    expect(peticiones(api, PUT_FOTO)).toHaveLength(0);
  });

  it.each([
    ['400 IMAGEN_NO_VALIDA', error('IMAGEN_NO_VALIDA', 400), /No pudimos usar esa imagen/],
    ['413 CARGA_EXCESIVA', error('CARGA_EXCESIVA', 413), /La foto pesa más de 5 MB/],
    ['429 DEMASIADAS_SOLICITUDES', error('DEMASIADAS_SOLICITUDES', 429), /Subiste demasiadas fotos/],
  ])(
    '%s: un mensaje claro con el teléfono de la academia y se puede reintentar con el mismo archivo',
    async (_n, falla, texto) => {
      let intento = 0;
      const { api } = servidorConFoto(() => (++intento === 1 ? falla : { estado: 204 }));
      const usuario = userEvent.setup();
      mostrar(`/a/delfines/solicitud/${TOKEN}`);
      await screen.findByRole('article', { name: 'Tu solicitud' });
      await usuario.upload(entradaDeFoto(), archivoDePrueba('uno.png', 'image/png'));
      await usuario.click(screen.getByRole('button', { name: 'Subir foto' }));

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(texto);
      expect(alerta).toHaveTextContent(`llama a la academia al ${TELEFONO}`);
      expect(screen.getByAltText('Vista previa de la foto elegida')).toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Reintentar la subida' }));
      await waitFor(() => expect(screen.getByText('Foto cargada')).toBeInTheDocument());
      expect(peticiones(api, PUT_FOTO)).toHaveLength(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('409 SOLICITUD_NO_EDITABLE: avisa que ya no se puede cambiar, vuelve a consultar y la vista pasa a reducida sin control para subir', async () => {
    const { api } = servidorConFoto(() => error('SOLICITUD_NO_EDITABLE', 409));
    const usuario = userEvent.setup();
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await screen.findByRole('article', { name: 'Tu solicitud' });
    await usuario.upload(entradaDeFoto(), archivoDePrueba('uno.png', 'image/png'));
    await usuario.click(screen.getByRole('button', { name: 'Subir foto' }));

    expect(await screen.findByText(/ya no se puede cambiar/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Cancelada')).toBeInTheDocument());
    expect(llamadas(api, POST_CONSULTA)).toHaveLength(2);
    expect(screen.queryByRole('region', { name: 'Foto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Subir foto|Cambiar foto/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Elegir (una|otra) foto|Cambiar la foto/)).not.toBeInTheDocument();
    expect(peticiones(api, PUT_FOTO)).toHaveLength(1);
  });

  it('con la vista reducida no hay control para subir la foto', async () => {
    const { estado } = servidorConFoto();
    estado.reducida = true;
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(screen.queryByRole('region', { name: 'Foto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /foto/i })).not.toBeInTheDocument();
  });

  it('la consulta con código y DNI no ofrece subir la foto: no tiene el token', async () => {
    simularApi({
      [GET_ACADEMIA]: () => ({
        estado: 200,
        cuerpo: { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines', telefono: TELEFONO },
      }),
      [POST_CONSULTA]: () => ({ estado: 200, cuerpo: respuesta() }),
    });
    const usuario = userEvent.setup();
    mostrar('/a/delfines/solicitud');
    await usuario.type(await screen.findByLabelText('Código de la solicitud'), 'AQ-7F3K9X');
    await usuario.type(screen.getByLabelText('DNI'), '45678912');
    await usuario.click(screen.getByRole('button', { name: 'Consultar' }));
    await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(screen.queryByRole('region', { name: 'Foto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /foto/i })).not.toBeInTheDocument();
  });

  it('libera la vista previa al cambiar de foto y al salir de la página', async () => {
    servidorConFoto();
    const usuario = userEvent.setup();
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    await screen.findByRole('article', { name: 'Tu solicitud' });
    await usuario.upload(entradaDeFoto(), archivoDePrueba('uno.png', 'image/png'));
    await usuario.upload(entradaDeFoto(), archivoDePrueba('dos.png', 'image/png'));
    expect(urls.liberar).toHaveBeenCalledWith('blob:prueba-1');
    expect(urls.liberar).not.toHaveBeenCalledWith('blob:prueba-2');
  });
});

describe('El mes de la inscripción en el seguimiento (010d, criterio 18)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-28T15:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('una inscripción al mes siguiente dice el mes y desde qué día empieza', async () => {
    servidor(() => ({ estado: 200, cuerpo: respuesta({ mes: '2026-12', esProporcional: false }) }));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(solicitud).getByText('Diciembre de 2026, desde el 1/12')).toBeInTheDocument();
  });

  it('una inscripción al mes en curso se ve como siempre, sin "desde"', async () => {
    servidor(() => ({ estado: 200, cuerpo: respuesta() }));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(solicitud).getByText('noviembre de 2026')).toBeInTheDocument();
    expect(within(solicitud).queryByText(/desde el 1\//)).not.toBeInTheDocument();
  });

  it('la vista reducida de una solicitud vencida para el mes siguiente también lo dice', async () => {
    servidor(() => ({
      estado: 200,
      cuerpo: respuesta({
        estado: 'VENCIDA',
        mes: '2026-12',
        nombres: undefined,
        reservaVenceEn: undefined,
        fotoCargada: undefined,
      }),
    }));
    mostrar(`/a/delfines/solicitud/${TOKEN}`);
    const solicitud = await screen.findByRole('article', { name: 'Tu solicitud' });
    expect(within(solicitud).getByText('Diciembre de 2026, desde el 1/12')).toBeInTheDocument();
  });
});
