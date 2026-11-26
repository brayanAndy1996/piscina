import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error, llamadas, mostrar, rutaActual, sesionDe, simularApi } from '../../pruebas-api';

// Spec 009a, criterios 19 y 34: la pantalla de recepción `/panel/asistencia` (lectora USB, cámara con `html5-qrcode`, buscador y los tres
// colores). La API se simula; las validaciones, el descuento y el aislamiento los prueba el backend.

const camara = vi.hoisted(() => ({
  iniciar: vi.fn<(configuracion: unknown) => Promise<void>>(),
  detener: vi.fn<() => Promise<void>>(),
  limpiar: vi.fn<() => void>(),
  alDecodificar: null as null | ((contenido: string) => void),
  creaciones: 0,
}));

vi.mock('html5-qrcode', () => ({
  Html5QrcodeSupportedFormats: { QR_CODE: 0 },
  Html5Qrcode: class {
    constructor() {
      camara.creaciones += 1;
    }
    start(configuracion: unknown, _opciones: unknown, alLeer: (contenido: string) => void) {
      camara.alDecodificar = alLeer;
      return camara.iniciar(configuracion);
    }
    stop() {
      return camara.detener();
    }
    clear() {
      camara.limpiar();
    }
  },
}));

const CONTENIDO = 'AQ1:Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo';
const OTRO_CONTENIDO = 'AQ1:b3Ryb3Rva2VuZGVwcnVlYmEwMDAwMDAwMDAwMDAwMDA';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ID_ALUMNO = 'a1b2c3d4-0000-4000-8000-000000000001';
const ALUMNO = {
  id: ID_ALUMNO,
  nombres: 'Lucía Fernanda',
  apellidos: 'Prado Quispe',
  nivel: 'INTERMEDIO',
  foto: null,
};
const CLASES = { usadas: 4, totales: 12, restantes: 8 };

function registrada(extra: { estadoLlegada?: 'PUNTUAL' | 'TARDE'; foto?: string | null; repetida?: boolean } = {}) {
  return {
    asistencia: {
      id: 'b1b2c3d4-0000-4000-8000-000000000002',
      fecha: '2026-11-26',
      horaLlegada: '18:05',
      llegadaEn: '2026-11-26T23:05:00.000Z',
      estadoLlegada: extra.estadoLlegada ?? 'PUNTUAL',
      metodo: 'QR',
      registroPosterior: false,
    },
    alumno: { ...ALUMNO, foto: extra.foto ?? null },
    clase: {
      id: 'c1b2c3d4-0000-4000-8000-000000000003',
      nivel: 'INTERMEDIO',
      diaSemana: 4,
      horaInicio: '18:00',
      horaFin: '19:00',
    },
    clases: CLASES,
    repetida: extra.repetida ?? false,
  };
}

function rechazo(codigo: string, alerta: 'ROJA' | 'AMARILLA', detalles: Record<string, unknown> = {}) {
  return error(codigo, 409, {
    alerta,
    alumno: ALUMNO,
    claseDeHoy: null,
    asistenciaDeHoy: null,
    clases: null,
    ...detalles,
  });
}

function servidor(rutas: Parameters<typeof simularApi>[0] = {}, rol: Parameters<typeof sesionDe>[0] = 'SECRETARIA') {
  return simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }), ...rutas });
}

function conCamaraDisponible() {
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  camara.iniciar.mockReset().mockResolvedValue(undefined);
  camara.detener.mockReset().mockResolvedValue(undefined);
  camara.limpiar.mockReset();
  camara.alDecodificar = null;
  camara.creaciones = 0;
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

/** Escribe lo que escribiría la lectora y termina con Enter. */
async function leerConLectora(contenido: string) {
  const campo = screen.getByRole('textbox', { name: 'Lectora de QR' });
  await userEvent.setup().type(campo, `${contenido}{Enter}`);
}

describe('el inicio y el permiso (criterio 19)', () => {
  it.each(['ADMIN', 'SECRETARIA'] as const)(
    'el rol %s ve «Asistencia» en el inicio y llega a la pantalla',
    async (rol) => {
      servidor({}, rol);
      mostrar('/panel');
      const opcion = await screen.findByRole('link', { name: /Asistencia/ });
      expect(opcion).toHaveAttribute('href', '/panel/asistencia');
      await userEvent.setup().click(opcion);
      expect(await screen.findByRole('heading', { level: 1, name: 'Asistencia' })).toBeInTheDocument();
      expect(rutaActual()).toBe('/panel/asistencia');
    },
  );

  it.each(['ENTRENADOR', 'ALUMNO'] as const)(
    'el rol %s no ve la opción y, en la dirección, ve «sin permiso»',
    async (rol) => {
      servidor({}, rol);
      const { unmount } = mostrar('/panel');
      expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Asistencia/ })).not.toBeInTheDocument();
      unmount();
      const api = servidor({}, rol);
      mostrar('/panel/asistencia');
      expect(await screen.findByText('No tienes permiso para ver esta página')).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Lectora de QR' })).not.toBeInTheDocument();
      expect(llamadas(api, 'POST /api/asistencias/qr')).toHaveLength(0);
    },
  );
});

describe('la lectora USB como teclado (criterio 19, DT-12)', () => {
  it('el campo de la lectora tiene el foco al entrar', async () => {
    servidor();
    mostrar('/panel/asistencia');
    const campo = await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await waitFor(() => expect(campo).toHaveFocus());
  });

  it('con Enter manda el contenido tal cual y una clave nueva, se vacía y recupera el foco', async () => {
    const api = servidor({ 'POST /api/asistencias/qr': () => ({ estado: 201, cuerpo: registrada() }) });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    await screen.findByRole('article', { name: 'Resultado: Asistencia registrada' });
    const enviados = llamadas(api, 'POST /api/asistencias/qr');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toEqual({ contenido: CONTENIDO, claveIdempotencia: expect.stringMatching(UUID) as unknown });
    const campo = screen.getByRole('textbox', { name: 'Lectora de QR' });
    expect(campo).toHaveValue('');
    await waitFor(() => expect(campo).toHaveFocus());
    // Ni el contenido ni el token quedan en la pantalla ni en la dirección.
    expect(document.body.innerHTML).not.toContain(CONTENIDO);
    expect(rutaActual()).toBe('/panel/asistencia');
  });

  it('un Enter con el campo vacío no manda nada', async () => {
    const api = servidor();
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Lectora de QR' }), '{Enter}');
    expect(llamadas(api, 'POST /api/asistencias/qr')).toHaveLength(0);
  });
});

describe('el resultado verde (criterio 19)', () => {
  it('muestra el nombre, el nivel, la clase, «Puntual» y «Le quedan X de Y»; sin foto, «Foto pendiente»', async () => {
    servidor({ 'POST /api/asistencias/qr': () => ({ estado: 201, cuerpo: registrada() }) });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    const resultado = await screen.findByRole('article', { name: 'Resultado: Asistencia registrada' });
    expect(resultado).toHaveAttribute('data-color', 'verde');
    expect(within(resultado).getByText('Lucía Fernanda Prado Quispe')).toBeInTheDocument();
    expect(within(resultado).getByText('Nivel Intermedio')).toBeInTheDocument();
    expect(within(resultado).getByText('Clase de Jueves de 18:00 a 19:00')).toBeInTheDocument();
    expect(within(resultado).getByText('Puntual')).toBeInTheDocument();
    expect(within(resultado).getByText('Le quedan 8 de 12')).toBeInTheDocument();
    expect(within(resultado).getByRole('img', { name: 'Foto pendiente' })).toBeInTheDocument();
  });

  it('con la llegada tarde dice «Tarde» y con foto muestra la imagen', async () => {
    servidor({
      'POST /api/asistencias/qr': () => ({
        estado: 201,
        cuerpo: registrada({ estadoLlegada: 'TARDE', foto: 'data:image/jpeg;base64,/9j/4AAQ' }),
      }),
    });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    const resultado = await screen.findByRole('article', { name: 'Resultado: Asistencia registrada' });
    expect(within(resultado).getByText('Tarde')).toBeInTheDocument();
    expect(within(resultado).queryByText('Puntual')).not.toBeInTheDocument();
    expect(within(resultado).getByRole('img', { name: 'Foto de Lucía Fernanda Prado Quispe' })).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,/9j/4AAQ',
    );
  });

  it('una respuesta repetida (200) sigue en verde y avisa que ya estaba registrada', async () => {
    servidor({ 'POST /api/asistencias/qr': () => ({ estado: 200, cuerpo: registrada({ repetida: true }) }) });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    const resultado = await screen.findByRole('article', { name: 'Resultado: Asistencia registrada' });
    expect(within(resultado).getByText(/ya estaba registrada/)).toBeInTheDocument();
  });
});

describe('el resultado rojo (criterios 7 y 19)', () => {
  it.each([
    ['MENSUALIDAD_NO_VIGENTE', 'No tiene una mensualidad vigente.'],
    ['SIN_CLASES_RESTANTES', 'No le quedan clases en su mensualidad.'],
    ['ALUMNO_INACTIVO', 'El alumno está inactivo.'],
    ['PAGO_EN_VERIFICACION', 'El pago de su mensualidad está en verificación.'],
  ])('%s: «No puede ingresar» con su motivo', async (codigo, motivo) => {
    servidor({ 'POST /api/asistencias/qr': () => rechazo(codigo, 'ROJA') });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    const resultado = await screen.findByRole('article', { name: 'Resultado: No puede ingresar' });
    expect(resultado).toHaveAttribute('data-color', 'rojo');
    expect(within(resultado).getByText(motivo)).toBeInTheDocument();
    expect(within(resultado).getByText('Lucía Fernanda Prado Quispe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('sin clases restantes muestra «Le quedan 0 de 12»', async () => {
    servidor({
      'POST /api/asistencias/qr': () =>
        rechazo('SIN_CLASES_RESTANTES', 'ROJA', { clases: { usadas: 12, totales: 12, restantes: 0 } }),
    });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    expect(await screen.findByText('Le quedan 0 de 12')).toBeInTheDocument();
  });
});

describe('el resultado amarillo (criterios 7 y 19)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  it('antes de la clase: «Su clase empieza a las 18:00»', async () => {
    vi.setSystemTime(new Date('2026-11-26T22:55:00Z')); // 17:55 en Lima
    servidor({
      'POST /api/asistencias/qr': () =>
        rechazo('FUERA_DE_HORARIO', 'AMARILLA', { claseDeHoy: { horaInicio: '18:00', horaFin: '19:00' } }),
    });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    const resultado = await screen.findByRole('article', { name: 'Resultado: Atención' });
    expect(resultado).toHaveAttribute('data-color', 'amarillo');
    expect(within(resultado).getByText('Está fuera del horario de su clase.')).toBeInTheDocument();
    expect(within(resultado).getByText('Su clase empieza a las 18:00.')).toBeInTheDocument();
  });

  it('después de la clase y en un día sin clase', async () => {
    vi.setSystemTime(new Date('2026-11-27T00:30:00Z')); // 19:30 en Lima
    servidor({
      'POST /api/asistencias/manual': () => ({ estado: 404 }),
      'POST /api/asistencias/qr': vi
        .fn()
        .mockReturnValueOnce(
          rechazo('FUERA_DE_HORARIO', 'AMARILLA', { claseDeHoy: { horaInicio: '18:00', horaFin: '19:00' } }),
        )
        .mockReturnValueOnce(rechazo('FUERA_DE_HORARIO', 'AMARILLA')) as never,
    });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    expect(await screen.findByText('Su clase de hoy fue de 18:00 a 19:00.')).toBeInTheDocument();
    await leerConLectora(OTRO_CONTENIDO);
    expect(await screen.findByText('Hoy no tiene clase.')).toBeInTheDocument();
  });

  it('ya marcó hoy: la hora, el estado y cómo se marcó', async () => {
    servidor({
      'POST /api/asistencias/qr': () =>
        rechazo('ASISTENCIA_YA_REGISTRADA', 'AMARILLA', {
          asistenciaDeHoy: { horaLlegada: '18:12', estadoLlegada: 'TARDE', metodo: 'MANUAL' },
          clases: CLASES,
        }),
    });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    const resultado = await screen.findByRole('article', { name: 'Resultado: Atención' });
    expect(within(resultado).getByText('Ya registró su asistencia de hoy.')).toBeInTheDocument();
    expect(within(resultado).getByText('Marcó a las 18:12 (Tarde, de forma manual).')).toBeInTheDocument();
  });

  it('una clase que no está en su mensualidad también es amarillo', async () => {
    servidor({
      'POST /api/asistencias/qr': () =>
        rechazo('CLASE_NO_INCLUIDA', 'AMARILLA', { claseDeHoy: { horaInicio: '18:00', horaFin: '19:00' } }),
    });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    const resultado = await screen.findByRole('article', { name: 'Resultado: Atención' });
    expect(within(resultado).getByText('La clase de hoy no está incluida en su mensualidad.')).toBeInTheDocument();
    expect(within(resultado).getByText('Su clase de hoy es de 18:00 a 19:00.')).toBeInTheDocument();
  });
});

describe('lo que no es un alumno ni un rechazo (criterios 3 y 13)', () => {
  it('un QR que la API no reconoce (404) se avisa sin reintento y sin repetir el contenido', async () => {
    servidor({ 'POST /api/asistencias/qr': () => error('QR_NO_RECONOCIDO', 404) });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    expect(await screen.findByText('El QR no corresponde a ningún alumno de esta academia.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(CONTENIDO);
  });

  it('un contenido de más de 200 caracteres no se envía', async () => {
    const api = servidor();
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    const campo = screen.getByRole('textbox', { name: 'Lectora de QR' });
    await userEvent.setup().click(campo);
    await userEvent.setup().paste('A'.repeat(201));
    await userEvent.setup().keyboard('{Enter}');
    expect(await screen.findByText('El QR no corresponde a ningún alumno de esta academia.')).toBeInTheDocument();
    expect(llamadas(api, 'POST /api/asistencias/qr')).toHaveLength(0);
  });

  it('un fallo de red se puede reintentar con la misma clave; una lectura nueva usa otra', async () => {
    const api = servidor({
      'POST /api/asistencias/qr': vi
        .fn()
        .mockRejectedValueOnce(new Error('sin red'))
        .mockResolvedValue({ estado: 201, cuerpo: registrada() }) as never,
    });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });
    await leerConLectora(CONTENIDO);
    expect(await screen.findByText(/No se pudo contactar al servidor/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('article', { name: 'Resultado: Asistencia registrada' });
    const [primero, segundo] = llamadas(api, 'POST /api/asistencias/qr') as {
      contenido: string;
      claveIdempotencia: string;
    }[];
    expect(primero?.claveIdempotencia).toMatch(UUID);
    expect(segundo).toEqual(primero);
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();

    await leerConLectora(OTRO_CONTENIDO);
    await waitFor(() => expect(llamadas(api, 'POST /api/asistencias/qr')).toHaveLength(3));
    const tercero = llamadas(api, 'POST /api/asistencias/qr')[2] as { claveIdempotencia: string };
    expect(tercero.claveIdempotencia).toMatch(UUID);
    expect(tercero.claveIdempotencia).not.toBe(primero?.claveIdempotencia);
  });
});

describe('el mismo contenido durante 5 segundos (criterio 19, DT-12)', () => {
  it('lo ignora dentro de los 5 segundos, lo acepta después y no ignora otro contenido', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T23:05:00Z'));
    const api = servidor({ 'POST /api/asistencias/qr': () => ({ estado: 201, cuerpo: registrada() }) });
    mostrar('/panel/asistencia');
    await screen.findByRole('textbox', { name: 'Lectora de QR' });

    await leerConLectora(CONTENIDO);
    await screen.findByRole('article', { name: 'Resultado: Asistencia registrada' });
    expect(llamadas(api, 'POST /api/asistencias/qr')).toHaveLength(1);

    vi.setSystemTime(new Date('2026-11-26T23:05:04.900Z'));
    await leerConLectora(CONTENIDO);
    expect(await screen.findByText(/Ese QR se acaba de leer/)).toBeInTheDocument();
    expect(llamadas(api, 'POST /api/asistencias/qr')).toHaveLength(1);

    await leerConLectora(OTRO_CONTENIDO);
    await waitFor(() => expect(llamadas(api, 'POST /api/asistencias/qr')).toHaveLength(2));

    vi.setSystemTime(new Date('2026-11-26T23:05:05.000Z'));
    await leerConLectora(CONTENIDO);
    await waitFor(() => expect(llamadas(api, 'POST /api/asistencias/qr')).toHaveLength(3));
  });
});

describe('la cámara con html5-qrcode (criterios 19 y 34)', () => {
  it('«Usar la cámara» la enciende por la cámara trasera, lee el QR y manda el contenido una sola vez en 5 segundos', async () => {
    conCamaraDisponible();
    const api = servidor({ 'POST /api/asistencias/qr': () => ({ estado: 201, cuerpo: registrada() }) });
    mostrar('/panel/asistencia');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Usar la cámara' }));
    await waitFor(() => expect(camara.iniciar).toHaveBeenCalledWith({ facingMode: 'environment' }));
    expect(screen.getByRole('button', { name: 'Apagar la cámara' })).toBeInTheDocument();
    expect(camara.alDecodificar).not.toBeNull();

    act(() => {
      camara.alDecodificar?.(CONTENIDO);
      camara.alDecodificar?.(CONTENIDO);
      camara.alDecodificar?.(CONTENIDO);
    });
    await screen.findByRole('article', { name: 'Resultado: Asistencia registrada' });
    act(() => camara.alDecodificar?.(CONTENIDO));
    expect(llamadas(api, 'POST /api/asistencias/qr')).toHaveLength(1);
    expect(llamadas(api, 'POST /api/asistencias/qr')[0]).toMatchObject({ contenido: CONTENIDO });
  });

  it('se apaga al pulsar «Apagar la cámara», al cambiar de modo y al salir de la página', async () => {
    conCamaraDisponible();
    servidor();
    const { unmount } = mostrar('/panel/asistencia');
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole('button', { name: 'Usar la cámara' }));
    await waitFor(() => expect(camara.iniciar).toHaveBeenCalledTimes(1));
    await usuario.click(screen.getByRole('button', { name: 'Apagar la cámara' }));
    await waitFor(() => expect(camara.detener).toHaveBeenCalledTimes(1));

    await usuario.click(screen.getByRole('button', { name: 'Usar la cámara' }));
    await waitFor(() => expect(camara.iniciar).toHaveBeenCalledTimes(2));
    await usuario.click(screen.getByRole('button', { name: 'Buscar alumno' }));
    await waitFor(() => expect(camara.detener).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Apagar la cámara' })).not.toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Escanear' }));
    await usuario.click(screen.getByRole('button', { name: 'Usar la cámara' }));
    await waitFor(() => expect(camara.iniciar).toHaveBeenCalledTimes(3));
    unmount();
    await waitFor(() => expect(camara.detener).toHaveBeenCalledTimes(3));
    expect(camara.limpiar).toHaveBeenCalledTimes(3);
  });

  it('si la persona sale antes de que la cámara termine de encender, se apaga apenas enciende', async () => {
    conCamaraDisponible();
    let encendida: () => void = () => undefined;
    camara.iniciar.mockImplementation(() => new Promise<void>((resolver) => (encendida = resolver)));
    servidor();
    const { unmount } = mostrar('/panel/asistencia');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Usar la cámara' }));
    await waitFor(() => expect(camara.iniciar).toHaveBeenCalledTimes(1));
    unmount();
    camara.detener.mockClear();
    await act(async () => {
      encendida();
      await Promise.resolve();
    });
    await waitFor(() => expect(camara.detener).toHaveBeenCalled());
  });

  it('sin permiso para la cámara avisa y deja el campo de la lectora', async () => {
    conCamaraDisponible();
    camara.iniciar.mockRejectedValue(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    servidor();
    mostrar('/panel/asistencia');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Usar la cámara' }));
    expect(await screen.findByText(/falta el permiso/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Lectora de QR' })).toBeInTheDocument();
  });

  it('fuera de localhost o HTTPS, o sin cámara, avisa sin cargar la biblioteca', async () => {
    servidor();
    mostrar('/panel/asistencia');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Usar la cámara' }));
    expect(await screen.findByText(/solo funciona desde localhost o con HTTPS/)).toBeInTheDocument();
    expect(camara.creaciones).toBe(0);
    expect(screen.getByRole('textbox', { name: 'Lectora de QR' })).toBeInTheDocument();
  });
});

describe('buscar al alumno y registrar de forma manual (criterios 5 y 19)', () => {
  const LUCIA = {
    id: ID_ALUMNO,
    nombres: 'Lucía Fernanda',
    apellidos: 'Prado Quispe',
    dni: '45678912',
    estado: 'ALUMNO_ACTIVO',
    nivel: 'INTERMEDIO',
    tieneFoto: false,
  };

  it('busca por DNI o nombre y «Registrar asistencia» manda el alumno con una clave nueva por clic', async () => {
    const api = servidor({
      'POST /api/alumnos/buscar': () => ({ estado: 200, cuerpo: { alumnos: [LUCIA], hayMas: false } }),
      'POST /api/asistencias/manual': () => ({ estado: 201, cuerpo: registrada() }),
    });
    mostrar('/panel/asistencia');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Buscar alumno' }));
    await usuario.type(screen.getByRole('textbox', { name: 'Buscar por DNI o nombre' }), '45678912{Enter}');
    expect(llamadas(api, 'POST /api/alumnos/buscar')).toEqual([{ texto: '45678912' }]);

    const lista = await screen.findByRole('list', { name: 'Alumnos encontrados' });
    expect(within(lista).getByText('Prado Quispe, Lucía Fernanda')).toBeInTheDocument();
    await usuario.click(
      within(lista).getByRole('button', { name: 'Registrar asistencia de Lucía Fernanda Prado Quispe' }),
    );

    const resultado = await screen.findByRole('article', { name: 'Resultado: Asistencia registrada' });
    expect(within(resultado).getByText('Le quedan 8 de 12')).toBeInTheDocument();
    const enviados = llamadas(api, 'POST /api/asistencias/manual');
    expect(enviados).toEqual([{ alumnoId: ID_ALUMNO, claveIdempotencia: expect.stringMatching(UUID) as unknown }]);
    // La búsqueda y el DNI no viajan en ninguna dirección.
    expect(api.mock.calls.some(([url]) => String(url).includes('45678912'))).toBe(false);

    await usuario.click(
      within(lista).getByRole('button', { name: 'Registrar asistencia de Lucía Fernanda Prado Quispe' }),
    );
    await waitFor(() => expect(llamadas(api, 'POST /api/asistencias/manual')).toHaveLength(2));
    const [uno, dos] = llamadas(api, 'POST /api/asistencias/manual') as { claveIdempotencia: string }[];
    expect(dos?.claveIdempotencia).not.toBe(uno?.claveIdempotencia);
  });

  it('un rechazo de la vía manual se ve igual que el del QR y un 404 se avisa', async () => {
    servidor({
      'POST /api/alumnos/buscar': () => ({ estado: 200, cuerpo: { alumnos: [LUCIA], hayMas: false } }),
      'POST /api/asistencias/manual': vi
        .fn()
        .mockReturnValueOnce(rechazo('MENSUALIDAD_NO_VIGENTE', 'ROJA'))
        .mockReturnValueOnce(error('NO_ENCONTRADO', 404)) as never,
    });
    mostrar('/panel/asistencia');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Buscar alumno' }));
    await usuario.type(screen.getByRole('textbox', { name: 'Buscar por DNI o nombre' }), 'Lucía{Enter}');
    const boton = await screen.findByRole('button', { name: /Registrar asistencia de/ });
    await usuario.click(boton);
    expect(await screen.findByRole('article', { name: 'Resultado: No puede ingresar' })).toBeInTheDocument();
    await usuario.click(boton);
    expect(await screen.findByText(/No encontramos a este alumno/)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
