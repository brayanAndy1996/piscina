import { screen, waitFor, within } from '@testing-library/react';
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
