import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, llamadas, type Manejador, mostrar, rutaActual, sesionDe, simularApi } from '../../pruebas-api';

const POR_DEFECTO = {
  toleranciaTardanzaMinutos: 10,
  diasPorVencer: 5,
  diasPrioridadRenovacion: 5,
  intentosInicioSesion: 5,
  minutosBloqueo: 15,
  telefono: null,
};
const MI_ACADEMIA = {
  academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: '01 555 0000' },
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function comoAdmin(extra: Record<string, Manejador> = {}, configuracion: Record<string, unknown> = POR_DEFECTO) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    'GET /api/configuracion': () => ({ estado: 200, cuerpo: { configuracion } }),
    ...extra,
  });
}

const GUARDAR = { name: 'Guardar cambios' };

describe('menú y permiso (criterio 22)', () => {
  it('el administrador ve "Configuración" en el inicio y llega a /panel/configuracion', async () => {
    comoAdmin();
    mostrar('/panel');
    const enlace = await screen.findByRole('link', { name: /Configuración/ });
    expect(enlace).toHaveAttribute('href', '/panel/configuracion');
    await userEvent.setup().click(enlace);
    expect(await screen.findByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/panel/configuracion');
  });

  it.each(['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const)('el rol %s no ve la opción en el menú', async (rol) => {
    simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
    mostrar('/panel');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Configuración/ })).not.toBeInTheDocument();
  });

  it.each(['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const)(
    'el rol %s que abre la dirección ve "sin permiso" y no se pide la configuración',
    async (rol) => {
      const api = simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
      mostrar('/panel/configuracion');
      expect(await screen.findByText('No tienes permiso para ver esta página')).toBeInTheDocument();
      expect(screen.queryByLabelText('Tolerancia de tardanza (minutos)')).not.toBeInTheDocument();
      expect(llamadas(api, 'GET /api/configuracion')).toHaveLength(0);
    },
  );
});

describe('formulario (criterio 23)', () => {
  it('se llena con la configuración, agrupado, con ayuda, rango y valor por defecto', async () => {
    comoAdmin({}, { ...POR_DEFECTO, toleranciaTardanzaMinutos: 20, telefono: '01 555 0000' });
    mostrar('/panel/configuracion');
    const tolerancia = await screen.findByLabelText('Tolerancia de tardanza (minutos)');
    expect(tolerancia).toHaveValue('20');
    expect(screen.getByLabelText('Días de prioridad para renovar (días)')).toHaveValue('5');
    expect(screen.getByLabelText('Intentos fallidos antes del bloqueo (intentos)')).toHaveValue('5');
    expect(screen.getByLabelText('Duración del bloqueo (minutos)')).toHaveValue('15');
    expect(screen.getByLabelText('Teléfono de la academia')).toHaveValue('01 555 0000');

    for (const titulo of ['Asistencia y mensualidades', 'Seguridad del inicio de sesión', 'Identidad']) {
      expect(screen.getByRole('heading', { level: 2, name: titulo })).toBeInTheDocument();
    }
    expect(screen.getByText(/Rango: de 0 a 30 minutos\. Por defecto: 10 minutos\./)).toBeInTheDocument();
    expect(screen.getByText(/Rango: de 3 a 10 intentos\. Por defecto: 5 intentos\./)).toBeInTheDocument();
    expect(screen.getByText(/Rango: de 5 a 60 minutos\. Por defecto: 15 minutos\./)).toBeInTheDocument();

    const nombre = screen.getByLabelText('Nombre de la academia');
    expect(nombre).toHaveValue('Academia de Natación Los Delfines');
    expect(nombre).toHaveAttribute('readonly');
    expect(screen.getAllByRole('button', { name: /Usar el valor por defecto/ })).toHaveLength(6);
    expect(screen.getByRole('button', GUARDAR)).toBeDisabled();
  });

  it('guarda solo lo que cambió, avisa y deja los valores que devolvió la API', async () => {
    const api = comoAdmin({
      'PATCH /api/configuracion': () => ({
        estado: 200,
        cuerpo: { configuracion: { ...POR_DEFECTO, toleranciaTardanzaMinutos: 15 } },
      }),
    });
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    const tolerancia = await screen.findByLabelText('Tolerancia de tardanza (minutos)');
    await usuario.clear(tolerancia);
    await usuario.type(tolerancia, '15');
    await usuario.click(screen.getByRole('button', GUARDAR));

    expect(await screen.findByText('Configuración guardada.')).toBeInTheDocument();
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([{ toleranciaTardanzaMinutos: 15 }]);
    expect(screen.getByLabelText('Tolerancia de tardanza (minutos)')).toHaveValue('15');
    expect(screen.getByRole('button', GUARDAR)).toBeDisabled();
  });

  it('antes de escribir confirma que la sesión sigue siendo la de la página', async () => {
    const api = comoAdmin({
      'PATCH /api/configuracion': () => ({ estado: 200, cuerpo: { configuracion: POR_DEFECTO } }),
    });
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    const bloqueo = await screen.findByLabelText('Duración del bloqueo (minutos)');
    await usuario.clear(bloqueo);
    await usuario.type(bloqueo, '30');
    const antes = llamadas(api, 'GET /api/sesion').length;
    await usuario.click(screen.getByRole('button', GUARDAR));
    await waitFor(() => expect(llamadas(api, 'PATCH /api/configuracion')).toHaveLength(1));
    expect(llamadas(api, 'GET /api/sesion').length).toBeGreaterThan(antes);
    expect(localStorage).toHaveLength(0);
  });

  it.each([
    ['Tolerancia de tardanza (minutos)', '31', 'Debe ser como máximo 30 minutos.'],
    ['Tolerancia de tardanza (minutos)', '-1', 'Debe ser como mínimo 0 minutos.'],
    ['Intentos fallidos antes del bloqueo (intentos)', '2', 'Debe ser como mínimo 3 intentos.'],
    ['Duración del bloqueo (minutos)', '10.5', 'Debe ser un número entero.'],
    ['Días para marcar una mensualidad "por vencer" (días)', 'diez', 'Debe ser un número entero.'],
    ['Teléfono de la academia', '123', 'El teléfono debe tener al menos 6 caracteres.'],
  ])('valida con el esquema compartido antes de enviar: %s = %s', async (etiqueta, texto, mensaje) => {
    const api = comoAdmin();
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    const campo = await screen.findByLabelText(etiqueta);
    await usuario.clear(campo);
    await usuario.type(campo, texto);
    await usuario.click(screen.getByRole('button', GUARDAR));
    expect(await screen.findByText(mensaje)).toBeInTheDocument();
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(api, 'PATCH /api/configuracion')).toHaveLength(0);
  });

  it('los bordes del rango se aceptan', async () => {
    const api = comoAdmin({
      'PATCH /api/configuracion': () => ({
        estado: 200,
        cuerpo: { configuracion: { ...POR_DEFECTO, toleranciaTardanzaMinutos: 0, minutosBloqueo: 60 } },
      }),
    });
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    const tolerancia = await screen.findByLabelText('Tolerancia de tardanza (minutos)');
    await usuario.clear(tolerancia);
    await usuario.type(tolerancia, '0');
    const bloqueo = screen.getByLabelText('Duración del bloqueo (minutos)');
    await usuario.clear(bloqueo);
    await usuario.type(bloqueo, '60');
    await usuario.click(screen.getByRole('button', GUARDAR));
    await screen.findByText('Configuración guardada.');
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([{ toleranciaTardanzaMinutos: 0, minutosBloqueo: 60 }]);
  });

  it('el teléfono se recorta y vaciarlo envía null', async () => {
    const api = comoAdmin(
      {
        'PATCH /api/configuracion': (cuerpo) => ({
          estado: 200,
          cuerpo: { configuracion: { ...POR_DEFECTO, ...(cuerpo as object) } },
        }),
      },
      { ...POR_DEFECTO, telefono: '01 555 0000' },
    );
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    const telefono = await screen.findByLabelText('Teléfono de la academia');
    await usuario.clear(telefono);
    await usuario.click(screen.getByRole('button', GUARDAR));
    await screen.findByText('Configuración guardada.');
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([{ telefono: null }]);
    expect(telefono).toHaveValue('');

    await usuario.type(telefono, '  +51 987 654 321 ');
    await usuario.click(screen.getByRole('button', GUARDAR));
    await waitFor(() => expect(llamadas(api, 'PATCH /api/configuracion')).toHaveLength(2));
    expect(llamadas(api, 'PATCH /api/configuracion')[1]).toEqual({ telefono: '+51 987 654 321' });
  });

  it('"Usar el valor por defecto" vuelve el campo a su valor y habilita Guardar', async () => {
    const api = comoAdmin(
      { 'PATCH /api/configuracion': () => ({ estado: 200, cuerpo: { configuracion: POR_DEFECTO } }) },
      { ...POR_DEFECTO, toleranciaTardanzaMinutos: 25, telefono: '01 555 0000' },
    );
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    const tolerancia = await screen.findByLabelText('Tolerancia de tardanza (minutos)');
    const botonTolerancia = screen.getByRole('button', { name: /Usar el valor por defecto de Tolerancia de tardanza/ });
    await usuario.click(botonTolerancia);
    expect(tolerancia).toHaveValue('10');
    const botonTelefono = screen.getByRole('button', { name: /Usar el valor por defecto de Teléfono de la academia/ });
    await usuario.click(botonTelefono);
    expect(screen.getByLabelText('Teléfono de la academia')).toHaveValue('');
    await usuario.click(screen.getByRole('button', GUARDAR));
    await screen.findByText('Configuración guardada.');
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([{ toleranciaTardanzaMinutos: 10, telefono: null }]);
  });

  it('muestra junto a cada campo los errores 400 de la API', async () => {
    comoAdmin({
      'PATCH /api/configuracion': () =>
        error('SOLICITUD_INVALIDA', 400, {
          errores: [{ campo: 'minutosBloqueo', mensaje: 'Mensaje de la API para el bloqueo.' }],
        }),
    });
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    const bloqueo = await screen.findByLabelText('Duración del bloqueo (minutos)');
    await usuario.clear(bloqueo);
    await usuario.type(bloqueo, '20');
    await usuario.click(screen.getByRole('button', GUARDAR));
    const mensaje = await screen.findByText('Mensaje de la API para el bloqueo.');
    expect(bloqueo).toHaveAttribute('aria-describedby', expect.stringContaining(mensaje.id));
    expect(screen.queryByText('Configuración guardada.')).not.toBeInTheDocument();
  });

  it('un error de la API sin campo se muestra arriba del botón y no pierde lo escrito', async () => {
    comoAdmin({ 'PATCH /api/configuracion': () => error('SIN_PERMISO', 403) });
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    const bloqueo = await screen.findByLabelText('Duración del bloqueo (minutos)');
    await usuario.clear(bloqueo);
    await usuario.type(bloqueo, '20');
    await usuario.click(screen.getByRole('button', GUARDAR));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mensaje de SIN_PERMISO');
    expect(bloqueo).toHaveValue('20');
  });

  it('si no se puede cargar, lo dice y permite reintentar', async () => {
    let intento = 0;
    comoAdmin({
      'GET /api/configuracion': () =>
        ++intento === 1 ? error('ERROR', 500) : { estado: 200, cuerpo: { configuracion: POR_DEFECTO } },
    });
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Tolerancia de tardanza (minutos)')).toHaveValue('10');
  });
});

describe('nombre y teléfono en el panel (criterio 24)', () => {
  it('muestra el nombre y el teléfono de GET /api/mi-academia', async () => {
    comoAdmin();
    mostrar('/panel');
    const enlace = await screen.findByRole('link', { name: '01 555 0000' });
    expect(enlace).toHaveAttribute('href', 'tel:015550000');
    const encabezado = screen.getByRole('banner');
    expect(within(encabezado).getByText('Academia de Natación Los Delfines')).toBeInTheDocument();
  });

  it('sin teléfono no muestra la línea del teléfono', async () => {
    comoAdmin({
      'GET /api/mi-academia': () => ({
        estado: 200,
        cuerpo: { academia: { ...MI_ACADEMIA.academia, telefono: null } },
      }),
    });
    mostrar('/panel');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Teléfono:/)).not.toBeInTheDocument());
  });

  it('si la petición falla, el panel funciona igual, con el nombre de la sesión y sin teléfono', async () => {
    comoAdmin({ 'GET /api/mi-academia': () => error('ERROR', 500) });
    mostrar('/panel');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    const encabezado = screen.getByRole('banner');
    expect(within(encabezado).getByText('Academia de Natación Los Delfines')).toBeInTheDocument();
    expect(screen.queryByText(/Teléfono:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeEnabled();
  });

  it('tras guardar un teléfono nuevo, el panel lo vuelve a pedir', async () => {
    let telefono: string | null = '01 555 0000';
    comoAdmin(
      {
        'GET /api/mi-academia': () => ({
          estado: 200,
          cuerpo: { academia: { ...MI_ACADEMIA.academia, telefono } },
        }),
        'PATCH /api/configuracion': () => {
          telefono = '01 777 1111';
          return { estado: 200, cuerpo: { configuracion: { ...POR_DEFECTO, telefono } } };
        },
      },
      { ...POR_DEFECTO, telefono },
    );
    mostrar('/panel/configuracion');
    const usuario = userEvent.setup();
    const campo = await screen.findByLabelText('Teléfono de la academia');
    await usuario.clear(campo);
    await usuario.type(campo, '01 777 1111');
    await usuario.click(screen.getByRole('button', GUARDAR));
    expect(await screen.findByRole('link', { name: '01 777 1111' })).toBeInTheDocument();
  });
});

describe('formulario con la base de llenado (criterio 27)', () => {
  const INTENTOS = 'Intentos fallidos antes del bloqueo (intentos)';
  const BLOQUEO = 'Duración del bloqueo (minutos)';
  const TOLERANCIA = 'Tolerancia de tardanza (minutos)';
  const TELEFONO = 'Teléfono de la academia';
  const AVISO =
    'Otro administrador cambió la configuración mientras editabas. Actualizamos los campos que no tocaste; revisa los tuyos antes de guardar.';

  /** Un servidor que guarda lo que recibe, como la API: el `PATCH` mezcla los cambios con lo vigente y responde con todo. */
  function servidor(inicial: Record<string, unknown> = POR_DEFECTO) {
    const estado = { actual: inicial };
    const api = comoAdmin({
      'GET /api/configuracion': () => ({ estado: 200, cuerpo: { configuracion: estado.actual } }),
      'PATCH /api/configuracion': (cuerpo) => {
        estado.actual = { ...estado.actual, ...(cuerpo as object) };
        return { estado: 200, cuerpo: { configuracion: estado.actual } };
      },
    });
    return { api, estado };
  }

  /** Corta y vuelve la conexión: la web vuelve a pedir la configuración sin desmontar el formulario. */
  function reconectar() {
    act(() => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
    });
  }

  it('a, b y c: al volver a la página tras un cambio de otro administrador, muestra lo vigente y envía solo el teléfono', async () => {
    const { api, estado } = servidor();
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    expect(await screen.findByLabelText(INTENTOS)).toHaveValue('5');
    await usuario.click(screen.getByRole('link', { name: /Volver al inicio/ }));

    // Otro administrador endurece la seguridad mientras este volvía al inicio.
    estado.actual = { ...POR_DEFECTO, intentosInicioSesion: 3, minutosBloqueo: 60 };
    await usuario.click(await screen.findByRole('link', { name: /Configuración/ }));
    await waitFor(() => expect(llamadas(api, 'GET /api/configuracion')).toHaveLength(2));

    // a) el formulario termina con los valores del servidor
    await waitFor(() => expect(screen.getByLabelText(INTENTOS)).toHaveValue('3'));
    expect(screen.getByLabelText(BLOQUEO)).toHaveValue('60');
    // b) sin ediciones, Guardar sigue desactivado
    expect(screen.getByRole('button', GUARDAR)).toBeDisabled();

    // c) solo se envía lo editado
    await usuario.type(screen.getByLabelText(TELEFONO), '01 555 0000');
    await usuario.click(screen.getByRole('button', GUARDAR));
    await screen.findByText('Configuración guardada.');
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([{ telefono: '01 555 0000' }]);
    expect(estado.actual).toEqual({
      ...POR_DEFECTO,
      intentosInicioSesion: 3,
      minutosBloqueo: 60,
      telefono: '01 555 0000',
    });
    expect(screen.getByLabelText(INTENTOS)).toHaveValue('3');
    expect(screen.getByLabelText(BLOQUEO)).toHaveValue('60');
  });

  it('a: no muestra el formulario con valores de la caché hasta tener la respuesta de la petición hecha al entrar', async () => {
    const { api, estado } = servidor();
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    expect(await screen.findByLabelText(INTENTOS)).toHaveValue('5');
    await usuario.click(screen.getByRole('link', { name: /Volver al inicio/ }));

    estado.actual = { ...POR_DEFECTO, intentosInicioSesion: 3 };
    let soltar: () => void = () => undefined;
    const demora = new Promise<void>((resolver) => {
      soltar = resolver;
    });
    simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }),
      'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
      'GET /api/configuracion': async () => {
        await demora;
        return { estado: 200, cuerpo: { configuracion: estado.actual } };
      },
    });
    await usuario.click(await screen.findByRole('link', { name: /Configuración/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Cargando…');
    expect(screen.queryByLabelText(INTENTOS)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', GUARDAR)).not.toBeInTheDocument();

    soltar();
    expect(await screen.findByLabelText(INTENTOS)).toHaveValue('3');
    expect(screen.getByRole('button', GUARDAR)).toBeDisabled();
    expect(llamadas(api, 'GET /api/configuracion')).toHaveLength(1);
  });

  it('b: sin ediciones, una base distinta que llega con el formulario a la vista lo recarga y Guardar sigue desactivado', async () => {
    const { api, estado } = servidor();
    mostrar('/panel/configuracion');
    expect(await screen.findByLabelText(INTENTOS)).toHaveValue('5');

    estado.actual = { ...POR_DEFECTO, intentosInicioSesion: 3, minutosBloqueo: 60, telefono: '01 777 1111' };
    reconectar();
    await waitFor(() => expect(screen.getByLabelText(INTENTOS)).toHaveValue('3'));
    expect(screen.getByLabelText(BLOQUEO)).toHaveValue('60');
    expect(screen.getByLabelText(TELEFONO)).toHaveValue('01 777 1111');
    expect(screen.getByRole('button', GUARDAR)).toBeDisabled();
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(llamadas(api, 'PATCH /api/configuracion')).toHaveLength(0);
  });

  it('d: con una base distinta y ediciones, actualiza lo que no se tocó, conserva lo editado y envía solo lo editado', async () => {
    const { api, estado } = servidor();
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    const tolerancia = await screen.findByLabelText(TOLERANCIA);
    await usuario.clear(tolerancia);
    await usuario.type(tolerancia, '20');
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();

    // El otro administrador cambia la seguridad y también la tolerancia (que este ya estaba editando).
    estado.actual = { ...POR_DEFECTO, toleranciaTardanzaMinutos: 25, intentosInicioSesion: 3, minutosBloqueo: 60 };
    reconectar();
    await waitFor(() => expect(screen.getByLabelText(INTENTOS)).toHaveValue('3'));
    expect(screen.getByLabelText(BLOQUEO)).toHaveValue('60');
    expect(screen.getByLabelText(TOLERANCIA)).toHaveValue('20');
    expect(screen.getByText(AVISO)).toBeInTheDocument();
    expect(screen.getByRole('button', GUARDAR)).toBeEnabled();

    await usuario.click(screen.getByRole('button', GUARDAR));
    await screen.findByText('Configuración guardada.');
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([{ toleranciaTardanzaMinutos: 20 }]);
    // e) la respuesta del PATCH pasa a ser la base: el aviso se va y Guardar vuelve a quedar desactivado
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(screen.getByLabelText(TOLERANCIA)).toHaveValue('20');
    expect(screen.getByLabelText(INTENTOS)).toHaveValue('3');
    expect(screen.getByLabelText(BLOQUEO)).toHaveValue('60');
    expect(screen.getByRole('button', GUARDAR)).toBeDisabled();
  });

  it('d: un campo editado que la base nueva ya tiene igual deja de enviarse', async () => {
    const { api, estado } = servidor();
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    await usuario.type(await screen.findByLabelText(TELEFONO), '01 555 0000');
    const bloqueo = screen.getByLabelText(BLOQUEO);
    await usuario.clear(bloqueo);
    await usuario.type(bloqueo, '30');

    estado.actual = { ...POR_DEFECTO, telefono: '01 555 0000', intentosInicioSesion: 4 };
    reconectar();
    await waitFor(() => expect(screen.getByLabelText(INTENTOS)).toHaveValue('4'));
    expect(screen.getByText(AVISO)).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', GUARDAR));
    await screen.findByText('Configuración guardada.');
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([{ minutosBloqueo: 30 }]);
  });

  it('d: si el administrador deshace sus ediciones, el aviso se va y Guardar vuelve a quedar desactivado', async () => {
    const { estado } = servidor();
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    const tolerancia = await screen.findByLabelText(TOLERANCIA);
    await usuario.clear(tolerancia);
    await usuario.type(tolerancia, '20');
    estado.actual = { ...POR_DEFECTO, minutosBloqueo: 60 };
    reconectar();
    expect(await screen.findByText(AVISO)).toBeInTheDocument();

    await usuario.clear(tolerancia);
    await usuario.type(tolerancia, '10');
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(screen.getByRole('button', GUARDAR)).toBeDisabled();
  });

  it('e: al guardar, la respuesta del PATCH es la nueva base: lo siguiente se compara con ella', async () => {
    const { api } = servidor();
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    const telefono = await screen.findByLabelText(TELEFONO);
    await usuario.type(telefono, '  01 555 0000  ');
    await usuario.click(screen.getByRole('button', GUARDAR));
    await screen.findByText('Configuración guardada.');
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([{ telefono: '01 555 0000' }]);
    expect(telefono).toHaveValue('01 555 0000');
    expect(screen.getByRole('button', GUARDAR)).toBeDisabled();

    // Volver al valor anterior es ahora un cambio frente a la respuesta del PATCH.
    await usuario.clear(telefono);
    expect(screen.getByRole('button', GUARDAR)).toBeEnabled();
    await usuario.click(screen.getByRole('button', GUARDAR));
    await waitFor(() => expect(llamadas(api, 'PATCH /api/configuracion')).toHaveLength(2));
    expect(llamadas(api, 'PATCH /api/configuracion')[1]).toEqual({ telefono: null });
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });
});
