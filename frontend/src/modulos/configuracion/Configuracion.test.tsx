import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  error,
  llamadas,
  type Manejador,
  mostrar,
  type Respuesta,
  rutaActual,
  sesionDe,
  simularApi,
} from '../../pruebas-api';

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

describe('la cabecera nunca muestra datos de otra academia (criterio 28)', () => {
  const NOMBRE_A = 'Academia de Natación Los Delfines';
  const TELEFONO_A = '01 111 1111';
  const NOMBRE_B = 'Academia Tiburones del Sur';
  const TELEFONO_B = '01 222 2222';
  const sesionDeB = (debeCambiarClave: boolean) => ({
    usuario: {
      id: '7c8d9e0f-1a2b-4b3c-8d4e-6f708192a3b4',
      nombres: 'Bruno',
      apellidos: 'Salas Peña',
      rol: 'ADMIN',
      debeCambiarClave,
      academia: { nombreCorto: 'tiburones', nombre: NOMBRE_B },
    },
  });
  const CONFIGURACION_A = { ...POR_DEFECTO, telefono: TELEFONO_A };

  /** La sesión pasa de un administrador de A a uno de B (se ingresó en B en otra pestaña) y la página recupera el foco. */
  async function cambiarDeSesion(debeCambiarClave: boolean, miAcademiaDeB: () => Respuesta | Promise<Respuesta>) {
    let enB = false;
    simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: enB ? sesionDeB(debeCambiarClave) : sesionDe('ADMIN') }),
      'GET /api/mi-academia': () =>
        enB
          ? miAcademiaDeB()
          : {
              estado: 200,
              cuerpo: { academia: { nombre: NOMBRE_A, nombreCorto: 'delfines', telefono: TELEFONO_A } },
            },
      'GET /api/configuracion': () => ({ estado: 200, cuerpo: { configuracion: CONFIGURACION_A } }),
    });
    mostrar('/panel/configuracion');
    await screen.findByRole('link', { name: TELEFONO_A });
    enB = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(rutaActual()).toBe(debeCambiarClave ? '/cambiar-clave' : '/panel'));
    // Pasados unos instantes: ni un render posterior puede mostrar lo de A.
    await new Promise((resolver) => setTimeout(resolver, 300));
  }

  function sinDatosDeA() {
    const cabecera = screen.getByRole('banner');
    expect(cabecera).not.toHaveTextContent(NOMBRE_A);
    expect(cabecera).not.toHaveTextContent(TELEFONO_A);
    expect(cabecera).toHaveTextContent(NOMBRE_B);
    expect(cabecera).not.toHaveTextContent(/Teléfono:/);
  }

  it('con el cambio de contraseña pendiente en B, muestra el nombre de B y ningún teléfono', async () => {
    await cambiarDeSesion(true, () => error('CAMBIO_CLAVE_REQUERIDO', 403));
    sinDatosDeA();
  });

  it('mientras GET /api/mi-academia de B tarda, muestra el nombre de B y ningún teléfono', async () => {
    await cambiarDeSesion(false, () => new Promise<Respuesta>(() => undefined));
    sinDatosDeA();
  });

  it('si GET /api/mi-academia de B falla, muestra el nombre de B y ningún teléfono', async () => {
    await cambiarDeSesion(false, () => error('ERROR_INTERNO', 500));
    sinDatosDeA();
  });

  it('cuando responde GET /api/mi-academia de B, muestra el nombre y el teléfono de B', async () => {
    await cambiarDeSesion(false, () => ({
      estado: 200,
      cuerpo: { academia: { nombre: NOMBRE_B, nombreCorto: 'tiburones', telefono: TELEFONO_B } },
    }));
    const cabecera = screen.getByRole('banner');
    expect(await within(cabecera).findByRole('link', { name: TELEFONO_B })).toBeInTheDocument();
    expect(cabecera).toHaveTextContent(NOMBRE_B);
    expect(cabecera).not.toHaveTextContent(NOMBRE_A);
    expect(cabecera).not.toHaveTextContent(TELEFONO_A);
  });

  it('una respuesta de otra academia con la clave de la sesión no se muestra (comprobación del nombreCorto)', async () => {
    await cambiarDeSesion(false, () => ({
      estado: 200,
      cuerpo: { academia: { nombre: NOMBRE_A, nombreCorto: 'delfines', telefono: TELEFONO_A } },
    }));
    sinDatosDeA();
  });
});

describe('el formulario ante un GET en segundo plano y un guardado en curso (criterios 29 a 31)', () => {
  const INTENTOS = 'Intentos fallidos antes del bloqueo (intentos)';
  const BLOQUEO = 'Duración del bloqueo (minutos)';
  const TELEFONO = 'Teléfono de la academia';
  const AVISO_OTRO_ADMIN = /Otro administrador cambió la configuración/;
  const AVISO_SIN_COMPROBAR =
    'No pudimos comprobar si la configuración cambió. Tus cambios siguen aquí y puedes guardarlos.';

  function diferido() {
    let resolver: () => void = () => undefined;
    const promesa = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    return { promesa, resolver };
  }

  /** Corta y vuelve la conexión: la web vuelve a pedir la configuración sin desmontar el formulario. */
  function reconectar() {
    act(() => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
    });
  }

  it('29: un GET pedido antes de la respuesta del PATCH no deshace lo guardado', async () => {
    let actual: Record<string, unknown> = { ...POR_DEFECTO };
    let patch: ReturnType<typeof diferido> | null = null;
    let get: ReturnType<typeof diferido> | null = null;
    let retenerGet = false;
    const api = comoAdmin({
      'GET /api/configuracion': async () => {
        const foto = { ...actual };
        if (retenerGet) {
          get = diferido();
          await get.promesa;
        }
        return { estado: 200, cuerpo: { configuracion: foto } };
      },
      'PATCH /api/configuracion': async (cuerpo) => {
        patch = diferido();
        await patch.promesa;
        actual = { ...actual, ...(cuerpo as object) };
        return { estado: 200, cuerpo: { configuracion: actual } };
      },
    });
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    const intentos = await screen.findByLabelText(INTENTOS);
    await usuario.clear(intentos);
    await usuario.type(intentos, '3');
    await usuario.click(screen.getByRole('button', GUARDAR));
    await waitFor(() => expect(patch).not.toBeNull());

    // Una reconexión pide la configuración mientras el PATCH está en curso; ese GET leyó los valores de antes de guardar.
    retenerGet = true;
    reconectar();
    await waitFor(() => expect(get).not.toBeNull());
    await act(async () => {
      patch?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    expect(await screen.findByText('Configuración guardada.')).toBeInTheDocument();
    expect(screen.getByLabelText(INTENTOS)).toHaveValue('3');

    // a) y b) la respuesta vieja del GET no cambia los campos, ni muestra el aviso, ni quita el aviso de éxito
    await act(async () => {
      get?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    expect(screen.getByLabelText(INTENTOS)).toHaveValue('3');
    expect(screen.queryByText(AVISO_OTRO_ADMIN)).not.toBeInTheDocument();
    expect(screen.getByText('Configuración guardada.')).toBeInTheDocument();

    // c) lo siguiente se compara con la respuesta del PATCH: solo viaja el campo editado
    retenerGet = false;
    await usuario.type(screen.getByLabelText(TELEFONO), '01 555 0000');
    expect(screen.queryByText(AVISO_OTRO_ADMIN)).not.toBeInTheDocument();
    await usuario.click(screen.getByRole('button', GUARDAR));
    await waitFor(() => expect(llamadas(api, 'PATCH /api/configuracion')).toHaveLength(2));
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([
      { intentosInicioSesion: 3 },
      { telefono: '01 555 0000' },
    ]);
    (patch as ReturnType<typeof diferido> | null)?.resolver();
    await screen.findByText('Configuración guardada.');
  });

  it('30: un error del GET en segundo plano deja el formulario con lo escrito y muestra un aviso', async () => {
    let falla = false;
    const api = comoAdmin({
      'GET /api/configuracion': () =>
        falla ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: { configuracion: POR_DEFECTO } },
      'PATCH /api/configuracion': (cuerpo) => ({
        estado: 200,
        cuerpo: { configuracion: { ...POR_DEFECTO, ...(cuerpo as object) } },
      }),
    });
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    await usuario.type(await screen.findByLabelText(TELEFONO), '01 555 0000');
    const bloqueo = screen.getByLabelText(BLOQUEO);
    await usuario.clear(bloqueo);
    await usuario.type(bloqueo, '45');

    falla = true;
    reconectar();
    // a) el formulario sigue, con lo escrito y Guardar activo; b) el aviso está a la vista y no hay "Reintentar"
    expect(await screen.findByText(AVISO_SIN_COMPROBAR)).toBeInTheDocument();
    expect(screen.getByLabelText(TELEFONO)).toHaveValue('01 555 0000');
    expect(screen.getByLabelText(BLOQUEO)).toHaveValue('45');
    expect(screen.getByRole('button', GUARDAR)).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();

    // c) un GET posterior que responde bien quita el aviso y no toca lo escrito
    falla = false;
    reconectar();
    await waitFor(() => expect(screen.queryByText(AVISO_SIN_COMPROBAR)).not.toBeInTheDocument());
    expect(screen.getByLabelText(TELEFONO)).toHaveValue('01 555 0000');
    expect(screen.getByLabelText(BLOQUEO)).toHaveValue('45');

    // y lo escrito se guarda tal cual
    await usuario.click(screen.getByRole('button', GUARDAR));
    await screen.findByText('Configuración guardada.');
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([{ minutosBloqueo: 45, telefono: '01 555 0000' }]);
  });

  it('30: guardar con éxito quita el aviso del GET fallido', async () => {
    let falla = false;
    comoAdmin({
      'GET /api/configuracion': () =>
        falla ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: { configuracion: POR_DEFECTO } },
      'PATCH /api/configuracion': (cuerpo) => ({
        estado: 200,
        cuerpo: { configuracion: { ...POR_DEFECTO, ...(cuerpo as object) } },
      }),
    });
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    await usuario.type(await screen.findByLabelText(TELEFONO), '01 555 0000');
    falla = true;
    reconectar();
    expect(await screen.findByText(AVISO_SIN_COMPROBAR)).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', GUARDAR));
    await screen.findByText('Configuración guardada.');
    expect(screen.queryByText(AVISO_SIN_COMPROBAR)).not.toBeInTheDocument();
  });

  it('30: si el GET hecho al entrar falla con la caché llena, sigue mostrando el error con "Reintentar"', async () => {
    let falla = false;
    comoAdmin({
      'GET /api/configuracion': () =>
        falla ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: { configuracion: POR_DEFECTO } },
    });
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    await screen.findByLabelText(TELEFONO);
    await usuario.click(screen.getByRole('link', { name: /Volver al inicio/ }));
    falla = true;
    await usuario.click(await screen.findByRole('link', { name: /Configuración/ }));
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.queryByLabelText(TELEFONO)).not.toBeInTheDocument();
  });

  it('31: mientras se guarda, los campos y los botones "Usar el valor por defecto" están desactivados', async () => {
    let patch: ReturnType<typeof diferido> | null = null;
    const api = comoAdmin({
      'PATCH /api/configuracion': async (cuerpo) => {
        patch = diferido();
        await patch.promesa;
        return { estado: 200, cuerpo: { configuracion: { ...POR_DEFECTO, ...(cuerpo as object) } } };
      },
    });
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    await usuario.type(await screen.findByLabelText(TELEFONO), '01 555 0000');
    await usuario.click(screen.getByRole('button', GUARDAR));
    await waitFor(() => expect(patch).not.toBeNull());

    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    for (const etiqueta of [INTENTOS, BLOQUEO, TELEFONO, 'Tolerancia de tardanza (minutos)']) {
      expect(screen.getByLabelText(etiqueta)).toBeDisabled();
    }
    for (const boton of screen.getAllByRole('button', { name: /Usar el valor por defecto/ })) {
      expect(boton).toBeDisabled();
    }

    await act(async () => {
      patch?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    await screen.findByText('Configuración guardada.');
    expect(screen.getByLabelText(TELEFONO)).toBeEnabled();
    expect(screen.getByLabelText(TELEFONO)).toHaveValue('01 555 0000');
    for (const boton of screen.getAllByRole('button', { name: /Usar el valor por defecto/ })) {
      expect(boton).toBeEnabled();
    }
    // desactivar los campos no cambia lo que se envía
    expect(llamadas(api, 'PATCH /api/configuracion')).toEqual([{ telefono: '01 555 0000' }]);
  });

  it('31: si el PATCH falla, todo vuelve a activarse con lo escrito y los errores junto a cada campo', async () => {
    let patch: ReturnType<typeof diferido> | null = null;
    comoAdmin({
      'PATCH /api/configuracion': async () => {
        patch = diferido();
        await patch.promesa;
        return error('SOLICITUD_INVALIDA', 400, {
          errores: [{ campo: 'minutosBloqueo', mensaje: 'Mensaje de la API para el bloqueo.' }],
        });
      },
    });
    const usuario = userEvent.setup();
    mostrar('/panel/configuracion');
    await usuario.type(await screen.findByLabelText(TELEFONO), '01 555 0000');
    const bloqueo = screen.getByLabelText(BLOQUEO);
    await usuario.clear(bloqueo);
    await usuario.type(bloqueo, '20');
    await usuario.click(screen.getByRole('button', GUARDAR));
    await waitFor(() => expect(patch).not.toBeNull());
    expect(screen.getByLabelText(TELEFONO)).toBeDisabled();

    await act(async () => {
      patch?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    expect(await screen.findByText('Mensaje de la API para el bloqueo.')).toBeInTheDocument();
    expect(screen.getByLabelText(TELEFONO)).toBeEnabled();
    expect(screen.getByLabelText(TELEFONO)).toHaveValue('01 555 0000');
    expect(screen.getByLabelText(BLOQUEO)).toBeEnabled();
    expect(screen.getByLabelText(BLOQUEO)).toHaveValue('20');
    expect(screen.getByRole('button', GUARDAR)).toBeEnabled();
    for (const boton of screen.getAllByRole('button', { name: /Usar el valor por defecto/ })) {
      expect(boton).toBeEnabled();
    }
  });
});
