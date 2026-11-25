import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archivoDePrueba,
  error,
  mostrar,
  peticiones,
  type Manejador,
  sesionDe,
  simularApi,
  simularUrlLocal,
} from '../../pruebas-api';
import { carnetDePrueba, ID_ALUMNO } from '../carnet/pruebas-carnet';
import { CapturaCamara } from './CapturaCamara';
import { MENSAJE_CAMARA } from './mensajes';

// Spec 008b, criterio 28: la foto desde el panel con un archivo o con la cámara, en el carnet del alumno y en las tarjetas de solicitudes.
// La API y la cámara se simulan (`navigator.mediaDevices`, el `canvas` y el video); lo del servidor lo prueba el backend.

const ID_SOLICITUD = 'a1111111-1111-4111-8111-111111111111';
const ID_VENCIDA = 'a3333333-3333-4333-8333-333333333333';
const RUTA_CARNET = `GET /api/alumnos/${ID_ALUMNO}/carnet`;
const RUTA_FOTO_ALUMNO = `PUT /api/alumnos/${ID_ALUMNO}/foto`;
const RUTA_FOTO_SOLICITUD = `PUT /api/solicitudes/${ID_SOLICITUD}/foto`;
const MENSAJE_CAMARA_COMPLETO = 'No se pudo usar la cámara. Revisa el permiso del navegador o elige un archivo.';

function solicitud(extra: Record<string, unknown> = {}) {
  return {
    id: ID_SOLICITUD,
    codigo: 'AQ-7F3K9X',
    estado: 'PENDIENTE_PAGO',
    creadaEn: '2026-11-20T15:00:00.000Z',
    reservaVenceEn: '2026-11-21T20:30:00.000Z',
    nombres: 'Lucía Fernanda',
    apellidos: 'Prado Quispe',
    dni: '45678912',
    telefono: '987654321',
    menorDeEdad: false,
    plan: { id: 'b1111111-1111-4111-8111-111111111111', nombre: 'Plan 3 veces' },
    clases: [
      {
        id: 'c1111111-1111-4111-8111-111111111111',
        nivel: 'BASICO',
        diaSemana: 1,
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

/** Una cámara simulada: cada pista tiene su `stop`, para comprobar que se apaga. */
function simularCamara(pedir: () => Promise<MediaStream> = () => Promise.resolve(flujoDePrueba().flujo)) {
  const getUserMedia = vi.fn(pedir);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  return getUserMedia;
}

function flujoDePrueba() {
  const pistas = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const flujo = { getTracks: () => pistas } as unknown as MediaStream;
  return { flujo, pistas };
}

/** El `canvas` y el video que jsdom no implementa: dibujar no hace nada y `toBlob` entrega un JPEG de mentira. */
function simularLienzo() {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(480);
  const dibujar = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: dibujar } as never);
  const aBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((alTerminar, tipo) => alTerminar(new Blob(['jpeg-de-prueba'], { type: tipo })));
  return { dibujar, aBlob };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  simularUrlLocal();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('CapturaCamara (criterio 28)', () => {
  it('sin permiso avisa que no se pudo usar la cámara', async () => {
    simularCamara(() => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')));
    render(<CapturaCamara alUsar={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJE_CAMARA_COMPLETO);
    expect(MENSAJE_CAMARA).toBe(MENSAJE_CAMARA_COMPLETO);
    expect(screen.queryByRole('button', { name: 'Tomar foto' })).not.toBeInTheDocument();
  });

  it('sin cámara en el equipo avisa lo mismo', async () => {
    simularCamara(() => Promise.reject(new DOMException('Requested device not found', 'NotFoundError')));
    render(<CapturaCamara alUsar={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJE_CAMARA_COMPLETO);
  });

  it('fuera de un contexto seguro (sin navigator.mediaDevices) avisa lo mismo, sin pedir nada', async () => {
    render(<CapturaCamara alUsar={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJE_CAMARA_COMPLETO);
  });

  it('pide solo video y, al desmontarse, detiene todas las pistas', async () => {
    const { flujo, pistas } = flujoDePrueba();
    const getUserMedia = simularCamara(() => Promise.resolve(flujo));
    simularLienzo();
    const { unmount } = render(<CapturaCamara alUsar={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Tomar foto' })).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(pistas[0]?.stop).not.toHaveBeenCalled();
    unmount();
    expect(pistas[0]?.stop).toHaveBeenCalledTimes(1);
    expect(pistas[1]?.stop).toHaveBeenCalledTimes(1);
  });

  it('si el permiso llega después de desmontar, la cámara se apaga de inmediato', async () => {
    const { flujo, pistas } = flujoDePrueba();
    let conceder: (flujo: MediaStream) => void = () => undefined;
    simularCamara(() => new Promise<MediaStream>((resolver) => (conceder = resolver)));
    const { unmount } = render(<CapturaCamara alUsar={vi.fn()} />);
    unmount();
    conceder(flujo);
    await waitFor(() => expect(pistas[0]?.stop).toHaveBeenCalledTimes(1));
    expect(pistas[1]?.stop).toHaveBeenCalledTimes(1);
  });

  it('«Tomar foto» congela la imagen en un JPEG de calidad 0,9 a la resolución del video; «Usar esta foto» la entrega', async () => {
    simularCamara();
    const { dibujar, aBlob } = simularLienzo();
    const alUsar = vi.fn();
    const usuario = userEvent.setup();
    render(<CapturaCamara alUsar={alUsar} />);
    await usuario.click(await screen.findByRole('button', { name: 'Tomar foto' }));

    expect(aBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9);
    expect(dibujar).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 480);
    const lienzo = screen.getByRole<HTMLCanvasElement>('img', { name: 'Foto tomada con la cámara' });
    expect(lienzo.width).toBe(640);
    expect(lienzo.height).toBe(480);
    expect(screen.queryByRole('button', { name: 'Tomar foto' })).not.toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Usar esta foto' }));
    expect(alUsar).toHaveBeenCalledTimes(1);
    const entregada = alUsar.mock.calls[0]?.[0] as Blob;
    expect(entregada.type).toBe('image/jpeg');
  });

  it('«Volver a tomar» regresa a la vista en vivo sin entregar nada', async () => {
    simularCamara();
    simularLienzo();
    const alUsar = vi.fn();
    const usuario = userEvent.setup();
    render(<CapturaCamara alUsar={alUsar} />);
    await usuario.click(await screen.findByRole('button', { name: 'Tomar foto' }));
    await usuario.click(screen.getByRole('button', { name: 'Volver a tomar' }));
    expect(screen.getByRole('button', { name: 'Tomar foto' })).toBeInTheDocument();
    expect(alUsar).not.toHaveBeenCalled();
  });
});

function servidorCarnet(foto: string | null, extra: Record<string, Manejador> = {}) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('SECRETARIA') }),
    [RUTA_CARNET]: () => ({ estado: 200, cuerpo: carnetDePrueba({ foto }) }),
    [RUTA_FOTO_ALUMNO]: () => ({ estado: 204 }),
    ...extra,
  });
}

describe('/panel/alumnos/{id}: foto del carnet (criterio 28)', () => {
  it('sin foto ofrece «Agregar foto»; con foto, «Cambiar foto»', async () => {
    servidorCarnet(null);
    const { unmount } = mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    expect(await screen.findByRole('button', { name: 'Agregar foto' })).toBeInTheDocument();
    unmount();
    servidorCarnet('data:image/jpeg;base64,AAAA');
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    expect(await screen.findByRole('button', { name: 'Cambiar foto' })).toBeInTheDocument();
  });

  it('con un archivo: lo sube como cuerpo binario con su tipo, cierra el diálogo y vuelve a pedir el carnet', async () => {
    let fotoActual: string | null = null;
    const api = servidorCarnet(null, {
      [RUTA_CARNET]: () => ({ estado: 200, cuerpo: carnetDePrueba({ foto: fotoActual }) }),
      [RUTA_FOTO_ALUMNO]: () => {
        fotoActual = 'data:image/jpeg;base64,AAAA';
        return { estado: 204 };
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Agregar foto' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Agregar foto' });
    const guardar = within(dialogo).getByRole('button', { name: 'Guardar foto' });
    expect(guardar).toBeDisabled();
    await usuario.upload(within(dialogo).getByLabelText('Elegir una foto'), archivoDePrueba('lucia.png', 'image/png'));
    await usuario.click(guardar);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const subidas = peticiones(api, RUTA_FOTO_ALUMNO);
    expect(subidas).toHaveLength(1);
    expect((subidas[0]?.headers as Record<string, string>)['Content-Type']).toBe('image/png');
    expect(subidas[0]?.body).toBeInstanceOf(Blob);
    expect(await screen.findByText('Se guardó la foto del alumno.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Cambiar foto' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Foto de Lucía Fernanda Prado Quispe' })).toBeInTheDocument();
  });

  it('un archivo que no es JPG ni PNG se avisa en la pantalla, sin llamar a la API', async () => {
    const api = servidorCarnet(null);
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const usuario = userEvent.setup({ applyAccept: false });
    await usuario.click(await screen.findByRole('button', { name: 'Agregar foto' }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.upload(within(dialogo).getByLabelText('Elegir una foto'), archivoDePrueba('foto.gif', 'image/gif'));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('La foto debe ser un archivo JPG o PNG.');
    expect(within(dialogo).getByRole('button', { name: 'Guardar foto' })).toBeDisabled();
    expect(peticiones(api, RUTA_FOTO_ALUMNO)).toHaveLength(0);
  });

  it('con la cámara: toma la foto, la sube como image/jpeg y apaga la cámara al cerrar el diálogo', async () => {
    const { flujo, pistas } = flujoDePrueba();
    simularCamara(() => Promise.resolve(flujo));
    simularLienzo();
    const api = servidorCarnet(null);
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Agregar foto' }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Usar la cámara' }));
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Tomar foto' }));
    await usuario.click(within(dialogo).getByRole('button', { name: 'Usar esta foto' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const subidas = peticiones(api, RUTA_FOTO_ALUMNO);
    expect(subidas).toHaveLength(1);
    expect((subidas[0]?.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
    expect(pistas[0]?.stop).toHaveBeenCalledTimes(1);
    expect(pistas[1]?.stop).toHaveBeenCalledTimes(1);
  });

  it('la cámara se apaga al cerrar el diálogo sin tomar nada y al volver a «Elegir un archivo»', async () => {
    const primero = flujoDePrueba();
    const segundo = flujoDePrueba();
    const flujos = [primero.flujo, segundo.flujo];
    simularCamara(() => Promise.resolve(flujos.shift() as MediaStream));
    simularLienzo();
    const api = servidorCarnet(null);
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Agregar foto' }));
    let dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Usar la cámara' }));
    await within(dialogo).findByRole('button', { name: 'Tomar foto' });
    await usuario.click(within(dialogo).getByRole('button', { name: 'Elegir un archivo' }));
    expect(primero.pistas.every((pista) => pista.stop.mock.calls.length === 1)).toBe(true);

    await usuario.click(within(dialogo).getByRole('button', { name: 'Usar la cámara' }));
    await within(dialogo).findByRole('button', { name: 'Tomar foto' });
    dialogo = screen.getByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Volver' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(segundo.pistas.every((pista) => pista.stop.mock.calls.length === 1)).toBe(true);
    expect(peticiones(api, RUTA_FOTO_ALUMNO)).toHaveLength(0);
  });

  it('con Escape también se apaga la cámara', async () => {
    const { flujo, pistas } = flujoDePrueba();
    simularCamara(() => Promise.resolve(flujo));
    simularLienzo();
    servidorCarnet(null);
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Agregar foto' }));
    await usuario.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usar la cámara' }));
    await screen.findByRole('button', { name: 'Tomar foto' });
    await usuario.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pistas.every((pista) => pista.stop.mock.calls.length === 1)).toBe(true);
  });

  it('sin permiso de cámara avisa y deja la opción del archivo', async () => {
    simularCamara(() => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')));
    servidorCarnet(null);
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Agregar foto' }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Usar la cámara' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MENSAJE_CAMARA_COMPLETO);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Elegir un archivo' }));
    expect(within(dialogo).getByLabelText('Elegir una foto')).toBeInTheDocument();
  });

  it.each([
    ['IMAGEN_NO_VALIDA', 400, 'La imagen no es válida'],
    ['CARGA_EXCESIVA', 413, 'La foto pesa más de 5 MB'],
    ['NO_ENCONTRADO', 404, 'ya no existe'],
  ])('un %s (%i) se explica en español y no cierra el diálogo', async (codigo, estado, texto) => {
    servidorCarnet(null, { [RUTA_FOTO_ALUMNO]: () => error(codigo, estado) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Agregar foto' }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.upload(within(dialogo).getByLabelText('Elegir una foto'), archivoDePrueba('lucia.jpg', 'image/jpeg'));
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar foto' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(texto);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it.each(['ADMIN', 'SECRETARIA'] as const)('el %s ve el botón de la foto', async (rol) => {
    servidorCarnet(null, { 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    expect(await screen.findByRole('button', { name: 'Agregar foto' })).toBeInTheDocument();
  });
});

describe('/panel/solicitudes: foto de la solicitud (criterio 28)', () => {
  function servidorSolicitudes(solicitudes: ReturnType<typeof solicitud>[], extra: Record<string, Manejador> = {}) {
    return simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('SECRETARIA') }),
      'GET /api/mi-academia': () => ({
        estado: 200,
        cuerpo: { academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null } },
      }),
      'GET /api/solicitudes?estado=ACTIVAS': () => ({ estado: 200, cuerpo: { solicitudes } }),
      'GET /api/solicitudes?estado=CONFIRMADAS': () => ({ estado: 200, cuerpo: { solicitudes } }),
      'GET /api/solicitudes?estado=VENCIDAS': () => ({ estado: 200, cuerpo: { solicitudes } }),
      [RUTA_FOTO_SOLICITUD]: () => ({ estado: 204 }),
      ...extra,
    });
  }

  it.each(['PENDIENTE_PAGO', 'EN_VERIFICACION', 'PAGO_RECHAZADO'])(
    'una solicitud %s ofrece «Agregar foto»',
    async (estado) => {
      servidorSolicitudes([solicitud({ estado })]);
      mostrar('/panel/solicitudes');
      expect(
        await screen.findByRole('button', { name: 'Agregar la foto de la solicitud AQ-7F3K9X' }),
      ).toHaveTextContent('Agregar foto');
    },
  );

  it('una confirmada también; una vencida no', async () => {
    servidorSolicitudes([solicitud({ estado: 'CONFIRMADA', reservaVenceEn: null })]);
    const { unmount } = mostrar('/panel/solicitudes');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Confirmadas' }));
    expect(
      await screen.findByRole('button', { name: 'Agregar la foto de la solicitud AQ-7F3K9X' }),
    ).toBeInTheDocument();
    unmount();

    servidorSolicitudes([solicitud({ id: ID_VENCIDA, estado: 'VENCIDA', reservaVenceEn: null })]);
    mostrar('/panel/solicitudes');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Vencidas' }));
    await screen.findByRole('article', { name: 'Solicitud AQ-7F3K9X' });
    expect(screen.queryByRole('button', { name: /Agregar la foto/ })).not.toBeInTheDocument();
  });

  it('sube la foto de la solicitud con su tipo, cierra el diálogo y vuelve a pedir la lista', async () => {
    const api = servidorSolicitudes([solicitud()]);
    mostrar('/panel/solicitudes');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Agregar la foto de la solicitud AQ-7F3K9X' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Agregar foto' });
    expect(dialogo).toHaveTextContent('Lucía Fernanda Prado Quispe');
    await usuario.upload(within(dialogo).getByLabelText('Elegir una foto'), archivoDePrueba('lucia.jpg', 'image/jpeg'));
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar foto' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const subidas = peticiones(api, RUTA_FOTO_SOLICITUD);
    expect(subidas).toHaveLength(1);
    expect((subidas[0]?.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
    expect(await screen.findByText('Se guardó la foto de la solicitud AQ-7F3K9X.')).toBeInTheDocument();
    await waitFor(() => expect(peticiones(api, 'GET /api/solicitudes?estado=ACTIVAS').length).toBeGreaterThan(1));
  });

  it('un 409 dice que la solicitud ya no admite foto', async () => {
    servidorSolicitudes([solicitud()], { [RUTA_FOTO_SOLICITUD]: () => error('SOLICITUD_NO_EDITABLE', 409) });
    mostrar('/panel/solicitudes');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Agregar la foto de la solicitud AQ-7F3K9X' }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.upload(within(dialogo).getByLabelText('Elegir una foto'), archivoDePrueba('lucia.jpg', 'image/jpeg'));
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar foto' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('ya no admite foto');
    expect(within(dialogo).getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
  });
});
