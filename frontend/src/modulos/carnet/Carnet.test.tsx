import { OPCIONES_QR } from '@aquagestion/contratos';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QRCode from 'qrcode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTENIDO, TOKEN, carnetDePrueba } from './pruebas-carnet';
import { error, llamadas, mostrar, sesionDe, simularApi, simularUrlLocal } from '../../pruebas-api';

// Spec 008a, criterio 20: «Mi carnet» (`/panel/mi-carnet`, solo ALUMNO, de solo lectura) y el inicio del panel por alcance de `VER_CARNET`.
// La API se simula; lo que lleva el carnet y su aislamiento los prueba el backend.

function servidor(rol: 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO', rutas: Parameters<typeof simularApi>[0] = {}) {
  return simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }), ...rutas });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/panel/mi-carnet (criterio 20)', () => {
  it('muestra el carnet con los datos, el horario, la vigencia y el QR dibujado con las opciones compartidas', async () => {
    servidor('ALUMNO', { 'GET /api/mi-carnet': () => ({ estado: 200, cuerpo: carnetDePrueba() }) });
    mostrar('/panel/mi-carnet');
    expect(await screen.findByRole('heading', { level: 2, name: 'Lucía Fernanda Prado Quispe' })).toBeInTheDocument();
    expect(within(screen.getByRole('article')).getByText('Academia de Natación Los Delfines')).toBeInTheDocument();
    expect(screen.getByText('45678912')).toBeInTheDocument();
    expect(screen.getByText('Nivel Intermedio')).toBeInTheDocument();
    expect(screen.getByText('Plan 3 veces')).toBeInTheDocument();
    expect(screen.getByText('Mar, Mié y Jue · 18:00 a 19:00')).toBeInTheDocument();
    expect(screen.getByText(/Del 01\/11\/2026 al 30\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText('(vigente hoy)')).toBeInTheDocument();
    expect(screen.getByText(/QR generado el 24\/11\/2026 10:00/)).toBeInTheDocument();

    const qr = await screen.findByRole('img', { name: 'Código QR del carnet' });
    const esperado = await QRCode.toString(CONTENIDO, { ...OPCIONES_QR, type: 'svg' });
    expect(qr.getAttribute('src')).toBe(`data:image/svg+xml;base64,${btoa(esperado)}`);
    // El token no se muestra en ninguna parte de la página, ni en el texto alternativo.
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('sin foto muestra «Foto pendiente»; con foto, la imagen', async () => {
    const api = servidor('ALUMNO', { 'GET /api/mi-carnet': () => ({ estado: 200, cuerpo: carnetDePrueba() }) });
    const { unmount } = mostrar('/panel/mi-carnet');
    expect(await screen.findByRole('img', { name: 'Foto pendiente' })).toHaveTextContent('Foto pendiente');
    unmount();
    api.mockClear();
    servidor('ALUMNO', {
      'GET /api/mi-carnet': () => ({
        estado: 200,
        cuerpo: carnetDePrueba({ foto: 'data:image/jpeg;base64,/9j/4AAQ' }),
      }),
    });
    mostrar('/panel/mi-carnet');
    const foto = await screen.findByRole('img', { name: 'Foto de Lucía Fernanda Prado Quispe' });
    expect(foto).toHaveAttribute('src', 'data:image/jpeg;base64,/9j/4AAQ');
    expect(screen.queryByText('Foto pendiente')).not.toBeInTheDocument();
  });

  it('sin QR dice «QR sin generar: pide en recepción que lo generen» y no dibuja nada', async () => {
    servidor('ALUMNO', { 'GET /api/mi-carnet': () => ({ estado: 200, cuerpo: carnetDePrueba({ qr: null }) }) });
    mostrar('/panel/mi-carnet');
    expect(await screen.findByText('QR sin generar: pide en recepción que lo generen')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Código QR del carnet' })).not.toBeInTheDocument();
  });

  it('sin matrícula lo dice, y con la matrícula vencida avisa que no está vigente hoy', async () => {
    servidor('ALUMNO', { 'GET /api/mi-carnet': () => ({ estado: 200, cuerpo: carnetDePrueba({ matricula: null }) }) });
    const { unmount } = mostrar('/panel/mi-carnet');
    expect(await screen.findByText('Sin matrícula registrada.')).toBeInTheDocument();
    unmount();
    const vencida = carnetDePrueba();
    servidor('ALUMNO', {
      'GET /api/mi-carnet': () => ({
        estado: 200,
        cuerpo: {
          ...vencida,
          alumno: { ...vencida.alumno, estado: 'ALUMNO_VENCIDO' },
          matricula: { ...vencida.matricula, vigenteHoy: false },
        },
      }),
    });
    mostrar('/panel/mi-carnet');
    expect(await screen.findByText('(no vigente hoy)')).toBeInTheDocument();
    expect(screen.getByText('Vencido')).toBeInTheDocument();
  });

  it('es de solo lectura: solo ofrece «Descargar PDF», sin regenerar ni foto', async () => {
    servidor('ALUMNO', { 'GET /api/mi-carnet': () => ({ estado: 200, cuerpo: carnetDePrueba() }) });
    mostrar('/panel/mi-carnet');
    await screen.findByRole('button', { name: 'Descargar PDF' });
    expect(screen.queryByRole('button', { name: /Regenerar/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/foto/i, { selector: 'button, a, label, input' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Volver al inicio' })).toHaveAttribute('href', '/panel');
  });

  it('«Descargar PDF» pide /api/mi-carnet/pdf (sin id) y entrega «carnet.pdf»', async () => {
    const api = servidor('ALUMNO', { 'GET /api/mi-carnet': () => ({ estado: 200, cuerpo: carnetDePrueba() }) });
    const base = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opciones?: RequestInit) =>
        url === '/api/mi-carnet/pdf'
          ? Promise.resolve(new Response('%PDF-1.3', { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
          : base(url, opciones),
      ),
    );
    simularUrlLocal();
    const entregas: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      entregas.push(this.download);
    });
    mostrar('/panel/mi-carnet');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(entregas).toEqual(['carnet.pdf']));
    expect(llamadas(api, 'GET /api/sesion').length).toBeGreaterThan(1);
  });

  it('si el PDF falla lo dice y deja volver a intentar', async () => {
    servidor('ALUMNO', {
      'GET /api/mi-carnet': () => ({ estado: 200, cuerpo: carnetDePrueba() }),
      'GET /api/mi-carnet/pdf': () => error('ERROR_INTERNO', 500),
    });
    mostrar('/panel/mi-carnet');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Descargar PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos descargar el PDF.');
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeEnabled();
  });

  it('con un 404 muestra el mensaje y no el carnet', async () => {
    servidor('ALUMNO', { 'GET /api/mi-carnet': () => error('NO_ENCONTRADO', 404) });
    mostrar('/panel/mi-carnet');
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos este carnet.');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it.each(['ADMIN', 'SECRETARIA', 'ENTRENADOR'] as const)(
    'el rol %s no tiene esta página: no pide el carnet',
    async (rol) => {
      const api = servidor(rol, { 'GET /api/mi-carnet': () => ({ estado: 200, cuerpo: carnetDePrueba() }) });
      mostrar('/panel/mi-carnet');
      expect(
        await screen.findByRole('heading', { name: 'No tienes permiso para ver esta página' }),
      ).toBeInTheDocument();
      expect(llamadas(api, 'GET /api/mi-carnet')).toHaveLength(0);
    },
  );
});

describe('inicio del panel: opciones de carnet por alcance (criterio 20)', () => {
  it('el alumno ve «Mi carnet» y ya no el aviso «Por ahora no hay más opciones»', async () => {
    servidor('ALUMNO');
    mostrar('/panel');
    const opcion = await screen.findByRole('link', { name: /Mi carnet/ });
    expect(opcion).toHaveAttribute('href', '/panel/mi-carnet');
    expect(screen.queryByRole('link', { name: /Alumnos y carnets/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Por ahora no hay más opciones/)).not.toBeInTheDocument();
  });

  it.each(['ADMIN', 'SECRETARIA'] as const)('el rol %s ve «Alumnos y carnets» y no «Mi carnet»', async (rol) => {
    servidor(rol);
    mostrar('/panel');
    const opcion = await screen.findByRole('link', { name: /Alumnos y carnets/ });
    expect(opcion).toHaveAttribute('href', '/panel/alumnos');
    expect(screen.queryByRole('link', { name: /Mi carnet/ })).not.toBeInTheDocument();
  });

  it('el entrenador no ve ninguna de las dos', async () => {
    servidor('ENTRENADOR');
    mostrar('/panel');
    await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' });
    expect(screen.queryByRole('link', { name: /Mi carnet/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alumnos y carnets/ })).not.toBeInTheDocument();
    const lista = screen.queryByRole('navigation', { name: 'Opciones' });
    if (lista) expect(within(lista).queryAllByRole('link')).toHaveLength(0);
  });
});
