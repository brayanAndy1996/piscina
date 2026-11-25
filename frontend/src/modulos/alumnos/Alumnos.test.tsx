import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error, llamadas, mostrar, rutaActual, sesionDe, simularApi } from '../../pruebas-api';
import { carnetDePrueba } from '../carnet/pruebas-carnet';

// Spec 008a, criterio 19: la búsqueda `/panel/alumnos` (solo con `VER_CARNET` de alcance `TODO`), el carnet `/panel/alumnos/{id}` con el PDF
// y el diálogo de regeneración del QR (motivo obligatorio y una clave por diálogo abierto). La API se simula.

const ID_LUCIA = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_MARIO = 'a2222222-2222-4222-8222-222222222222';
const RUTA_CARNET = `GET /api/alumnos/${ID_LUCIA}/carnet`;
const RUTA_QR = `POST /api/alumnos/${ID_LUCIA}/carnet/qr`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const LUCIA = {
  id: ID_LUCIA,
  nombres: 'Lucía Fernanda',
  apellidos: 'Prado Quispe',
  dni: '45678912',
  estado: 'ALUMNO_ACTIVO',
  nivel: 'INTERMEDIO',
  tieneFoto: true,
};
const MARIO = {
  id: ID_MARIO,
  nombres: 'Mario',
  apellidos: 'Rojas Díaz',
  dni: '71234567',
  estado: 'ALUMNO_VENCIDO',
  nivel: 'BASICO',
  tieneFoto: false,
};

function servidor(rol: 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO', rutas: Parameters<typeof simularApi>[0] = {}) {
  return simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }), ...rutas });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('/panel/alumnos: búsqueda (criterio 19)', () => {
  it.each(['ALUMNO', 'ENTRENADOR'] as const)('el rol %s no tiene esta página y no busca', async (rol) => {
    const api = servidor(rol);
    mostrar('/panel/alumnos');
    expect(await screen.findByRole('heading', { name: 'No tienes permiso para ver esta página' })).toBeInTheDocument();
    expect(llamadas(api, 'POST /api/alumnos/buscar')).toHaveLength(0);
  });

  it('busca con un POST (el texto va en el cuerpo, no en la dirección) y lista los resultados', async () => {
    const api = servidor('SECRETARIA', {
      'POST /api/alumnos/buscar': () => ({ estado: 200, cuerpo: { alumnos: [LUCIA, MARIO], hayMas: false } }),
    });
    mostrar('/panel/alumnos');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Buscar por DNI o nombre'), '  45678912 ');
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));

    const lista = await screen.findByRole('list', { name: 'Alumnos encontrados' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent('Prado Quispe, Lucía Fernanda');
    expect(filas[0]).toHaveTextContent('DNI 45678912');
    expect(filas[0]).toHaveTextContent('Nivel Intermedio');
    expect(filas[0]).toHaveTextContent('Activo');
    expect(filas[0]).toHaveTextContent('Con foto');
    expect(filas[1]).toHaveTextContent('Vencido');
    expect(filas[1]).toHaveTextContent('Foto pendiente');
    expect(within(filas[0]!).getByRole('link')).toHaveAttribute('href', `/panel/alumnos/${ID_LUCIA}`);
    expect(llamadas(api, 'POST /api/alumnos/buscar')).toEqual([{ texto: '45678912' }]);
    expect(rutaActual()).toBe('/panel/alumnos');
    expect(screen.queryByText('Hay más resultados; escribe más letras.')).not.toBeInTheDocument();
  });

  it('con más de 20 resultados avisa «Hay más resultados; escribe más letras»', async () => {
    servidor('ADMIN', {
      'POST /api/alumnos/buscar': () => ({ estado: 200, cuerpo: { alumnos: [LUCIA], hayMas: true } }),
    });
    mostrar('/panel/alumnos');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Buscar por DNI o nombre'), 'Prado');
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Hay más resultados; escribe más letras.')).toBeInTheDocument();
  });

  it('sin resultados lo dice', async () => {
    servidor('ADMIN', { 'POST /api/alumnos/buscar': () => ({ estado: 200, cuerpo: { alumnos: [], hayMas: false } }) });
    mostrar('/panel/alumnos');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Buscar por DNI o nombre'), 'Zzzz');
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('No encontramos alumnos con ese DNI o nombre.')).toBeInTheDocument();
  });

  it('un texto de menos de 3 caracteres se corrige en la pantalla, sin llamar a la API', async () => {
    const api = servidor('ADMIN');
    mostrar('/panel/alumnos');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Buscar por DNI o nombre'), 'ab');
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(llamadas(api, 'POST /api/alumnos/buscar')).toHaveLength(0);
  });

  it('si la búsqueda falla muestra el mensaje', async () => {
    servidor('ADMIN', { 'POST /api/alumnos/buscar': () => error('ERROR_INTERNO', 500) });
    mostrar('/panel/alumnos');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Buscar por DNI o nombre'), 'Prado');
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar al servidor');
  });
});

describe('/panel/alumnos/{id}: carnet y regeneración del QR (criterio 19)', () => {
  it('muestra el carnet con «Descargar PDF» y «Regenerar QR»', async () => {
    servidor('SECRETARIA', { [RUTA_CARNET]: () => ({ estado: 200, cuerpo: carnetDePrueba() }) });
    mostrar(`/panel/alumnos/${ID_LUCIA}`);
    expect(await screen.findByRole('heading', { level: 2, name: 'Lucía Fernanda Prado Quispe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerar QR' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Volver a la búsqueda' })).toHaveAttribute('href', '/panel/alumnos');
    expect(screen.getByRole('img', { name: 'Foto pendiente' })).toBeInTheDocument();
  });

  it('un alumno sin QR muestra «QR sin generar»', async () => {
    servidor('ADMIN', { [RUTA_CARNET]: () => ({ estado: 200, cuerpo: carnetDePrueba({ qr: null }) }) });
    mostrar(`/panel/alumnos/${ID_LUCIA}`);
    expect(await screen.findByText('QR sin generar: pide en recepción que lo generen')).toBeInTheDocument();
  });

  it('el alumno no tiene esta página y no pide el carnet', async () => {
    const api = servidor('ALUMNO');
    mostrar(`/panel/alumnos/${ID_LUCIA}`);
    expect(await screen.findByRole('heading', { name: 'No tienes permiso para ver esta página' })).toBeInTheDocument();
    expect(llamadas(api, RUTA_CARNET)).toHaveLength(0);
  });

  it('con un 404 lo explica y no ofrece reintentar', async () => {
    servidor('ADMIN', { [RUTA_CARNET]: () => error('NO_ENCONTRADO', 404) });
    mostrar(`/panel/alumnos/${ID_LUCIA}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos este carnet.');
    expect(screen.queryByRole('button', { name: 'Volver a intentar' })).not.toBeInTheDocument();
  });

  it('«Regenerar QR» abre el diálogo con el aviso y exige el motivo, sin llamar a la API', async () => {
    const api = servidor('SECRETARIA', { [RUTA_CARNET]: () => ({ estado: 200, cuerpo: carnetDePrueba() }) });
    mostrar(`/panel/alumnos/${ID_LUCIA}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Regenerar QR' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Regenerar el QR' });
    expect(dialogo).toHaveTextContent(
      'El carnet impreso y el QR del celular dejarán de servir; habrá que imprimir uno nuevo.',
    );
    await usuario.click(within(dialogo).getByRole('button', { name: 'Regenerar el QR' }));
    expect(await within(dialogo).findByRole('alert')).toBeInTheDocument();
    expect(llamadas(api, RUTA_QR)).toHaveLength(0);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Volver' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('regenera con el motivo y una clave UUID, cierra el diálogo y muestra el QR nuevo', async () => {
    const nuevo = 'ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponmlkj';
    let actual = carnetDePrueba();
    const api = servidor('SECRETARIA', {
      [RUTA_CARNET]: () => ({ estado: 200, cuerpo: actual }),
      [RUTA_QR]: () => {
        actual = carnetDePrueba({ qr: { contenido: `AQ1:${nuevo}`, generadoEn: '2026-11-25T15:30:00.000Z' } });
        return { estado: 200, cuerpo: actual };
      },
    });
    mostrar(`/panel/alumnos/${ID_LUCIA}`);
    const usuario = userEvent.setup();
    const antes = (await screen.findByRole('img', { name: 'Código QR del carnet' })).getAttribute('src');
    await usuario.click(screen.getByRole('button', { name: 'Regenerar QR' }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Perdió el carnet');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Regenerar el QR' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const cuerpos = llamadas(api, RUTA_QR) as { claveIdempotencia: string; motivo: string }[];
    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0]?.motivo).toBe('Perdió el carnet');
    expect(cuerpos[0]?.claveIdempotencia).toMatch(UUID);
    expect(Object.keys(cuerpos[0] ?? {}).sort()).toEqual(['claveIdempotencia', 'motivo']);
    expect(await screen.findByText(/Se generó un QR nuevo/)).toBeInTheDocument();
    expect(screen.getByText(/QR generado el 25\/11\/2026 10:30/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Código QR del carnet' }).getAttribute('src')).not.toBe(antes),
    );
  });

  it('un reintento tras un error usa la misma clave; otro diálogo abierto usa una clave nueva', async () => {
    let intentos = 0;
    const api = servidor('ADMIN', {
      [RUTA_CARNET]: () => ({ estado: 200, cuerpo: carnetDePrueba() }),
      [RUTA_QR]: () => {
        intentos += 1;
        return intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: carnetDePrueba() };
      },
    });
    mostrar(`/panel/alumnos/${ID_LUCIA}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Regenerar QR' }));
    let dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Se compartió el QR');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Regenerar el QR' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No se pudo contactar al servidor');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Regenerar el QR' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await usuario.click(screen.getByRole('button', { name: 'Regenerar QR' }));
    dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Otro motivo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Regenerar el QR' }));
    await waitFor(() => expect(llamadas(api, RUTA_QR)).toHaveLength(3));

    const claves = (llamadas(api, RUTA_QR) as { claveIdempotencia: string }[]).map((c) => c.claveIdempotencia);
    expect(claves[0]).toBe(claves[1]);
    expect(claves[2]).not.toBe(claves[0]);
  });

  it('un doble clic envía una sola regeneración', async () => {
    let soltar: () => void = () => undefined;
    const retenida = new Promise<void>((resolver) => {
      soltar = resolver;
    });
    const api = servidor('ADMIN', {
      [RUTA_CARNET]: () => ({ estado: 200, cuerpo: carnetDePrueba() }),
      [RUTA_QR]: async () => {
        await retenida;
        return { estado: 200, cuerpo: carnetDePrueba() };
      },
    });
    mostrar(`/panel/alumnos/${ID_LUCIA}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Regenerar QR' }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Perdió el carnet');
    const boton = within(dialogo).getByRole('button', { name: 'Regenerar el QR' });
    await usuario.dblClick(boton);
    await waitFor(() => expect(llamadas(api, RUTA_QR)).toHaveLength(1));
    soltar();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, RUTA_QR)).toHaveLength(1);
  });

  it('con un 404 al regenerar explica y deja solo «Cerrar»', async () => {
    servidor('ADMIN', {
      [RUTA_CARNET]: () => ({ estado: 200, cuerpo: carnetDePrueba() }),
      [RUTA_QR]: () => error('NO_ENCONTRADO', 404),
    });
    mostrar(`/panel/alumnos/${ID_LUCIA}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Regenerar QR' }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Perdió el carnet');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Regenerar el QR' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'Este alumno ya no existe o no es de tu academia.',
    );
    expect(within(dialogo).getByRole('button', { name: 'Cerrar' })).toBeEnabled();
    expect(within(dialogo).getByRole('button', { name: 'Regenerar el QR' })).toBeDisabled();
  });
});

vi.setConfig({ testTimeout: 15_000 });
